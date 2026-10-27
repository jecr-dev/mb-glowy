-- Ejecutar una vez en un proyecto Supabase nuevo mediante SQL Editor.
create extension if not exists btree_gist;
create table public.admins(user_id uuid primary key references auth.users(id) on delete cascade);
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from admins where user_id=auth.uid())$$;
create table public.services(id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 120), description text not null default '', duration_minutes int not null check(duration_minutes between 5 and 480), price int not null check(price>=0),active boolean not null default true);
create table public.slots(id uuid primary key default gen_random_uuid(),starts_at timestamptz not null,ends_at timestamptz not null,blocked boolean not null default false,check(ends_at>starts_at),exclude using gist(tstzrange(starts_at,ends_at,'[)') with &&));
create table public.slot_services(slot_id uuid references public.slots on delete cascade,service_id uuid references public.services on delete cascade,primary key(slot_id,service_id));
create table public.bookings(id uuid primary key default gen_random_uuid(),slot_id uuid not null references public.slots,service_id uuid not null references public.services,customer_name text not null check(length(trim(customer_name)) between 2 and 120),customer_email text not null check(length(customer_email)<=254 and customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),customer_phone text not null check(length(trim(customer_phone)) between 7 and 30),status text not null default 'confirmed' check(status in ('confirmed','cancelled')),created_at timestamptz not null default now());
create unique index one_booking_per_slot on public.bookings(slot_id) where status='confirmed';
alter table public.admins enable row level security;
alter table public.services enable row level security;
alter table public.slots enable row level security;
alter table public.slot_services enable row level security;
alter table public.bookings enable row level security;
create policy own_admin on public.admins for select to authenticated using(user_id=auth.uid());
create policy public_services on public.services for select to anon,authenticated using(active or public.is_admin());
create policy manage_services on public.services for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy manage_slots on public.slots for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy manage_slot_services on public.slot_services for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy read_bookings on public.bookings for select to authenticated using(public.is_admin());
create policy update_bookings on public.bookings for update to authenticated using(public.is_admin()) with check(public.is_admin());
-- No acceso público a reservas ni a datos personales. Solo RPC para crear una reserva.
create function public.available_slots() returns table(slot_id uuid,service_id uuid,starts_at timestamptz,ends_at timestamptz) language sql stable security definer set search_path=public as $$
 select s.id,x.service_id,s.starts_at,s.ends_at from slots s join slot_services x on x.slot_id=s.id join services v on v.id=x.service_id
 where not s.blocked and s.starts_at>now() and v.active and s.ends_at-s.starts_at>=make_interval(mins=>v.duration_minutes) and not exists(select 1 from bookings b where b.slot_id=s.id and b.status='confirmed') order by s.starts_at
$$;
create function public.book_slot(slot_id uuid,service_id uuid,customer_name text,customer_email text,customer_phone text) returns uuid language plpgsql security definer set search_path=public as $$
declare s slots; v services; result uuid;
begin
 select * into s from slots where id=book_slot.slot_id for update;
 if not found or s.blocked or s.starts_at<=now() then raise exception 'Horario no disponible'; end if;
 select * into v from services where id=book_slot.service_id and active for share;
 if not found or not exists(select 1 from slot_services x where x.slot_id=s.id and x.service_id=v.id) or s.ends_at-s.starts_at<make_interval(mins=>v.duration_minutes) then raise exception 'Tratamiento no disponible para ese horario'; end if;
 if exists(select 1 from bookings b where b.slot_id=s.id and b.status='confirmed') then raise exception 'Ese horario acaba de ser reservado. Elige otro.'; end if;
 insert into bookings(slot_id,service_id,customer_name,customer_email,customer_phone) values(s.id,v.id,trim(book_slot.customer_name),lower(trim(book_slot.customer_email)),trim(book_slot.customer_phone)) returning id into result;
 return result;
end $$;
create function public.create_slot(start_time timestamptz,end_time timestamptz,service_ids uuid[]) returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if not public.is_admin() then raise exception 'Acceso denegado'; end if;
 if start_time<=now() or end_time<=start_time or coalesce(cardinality(service_ids),0)=0 then raise exception 'Selecciona un horario futuro y al menos un tratamiento'; end if;
 if exists(select 1 from unnest(service_ids) x left join services s on s.id=x where s.id is null or not s.active or make_interval(mins=>s.duration_minutes)>end_time-start_time) then raise exception 'Los tratamientos deben estar activos y caber en el horario'; end if;
 insert into slots(starts_at,ends_at) values(start_time,end_time) returning id into result;
 insert into slot_services select result,unnest(service_ids);return result;
end $$;
create function public.remove_service(service uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'Acceso denegado';end if;
 perform 1 from services where id=service for update;
 if exists(select 1 from bookings where service_id=service) then update services set active=false where id=service;
 else delete from services where id=service;end if;
end $$;
revoke all on function public.is_admin(),public.available_slots(),public.book_slot(uuid,uuid,text,text,text),public.create_slot(timestamptz,timestamptz,uuid[]),public.remove_service(uuid) from public;
grant execute on function public.is_admin() to anon,authenticated;
grant execute on function public.available_slots(),public.book_slot(uuid,uuid,text,text,text) to anon,authenticated;
grant execute on function public.create_slot(timestamptz,timestamptz,uuid[]),public.remove_service(uuid) to authenticated;
grant select on public.services to anon;
grant select on public.admins to authenticated;
grant select,insert,update,delete on public.services,public.slots,public.slot_services to authenticated;
grant select on public.bookings to authenticated;
revoke update on public.bookings from authenticated;
grant update(status) on public.bookings to authenticated;
