-- Margen configurable entre citas por bloque. Requiere confirmaciones/comunas. Idempotente.
-- Conserva todas las reservas existentes y la cuadrícula de inicios cada 5 minutos.
begin;
alter table public.slots add column if not exists gap_minutes int not null default 10;
alter table public.slots drop constraint if exists slots_gap_minutes_check;
alter table public.slots add constraint slots_gap_minutes_check check(gap_minutes in (10,15,20,25,30));
drop function public.available_slots();
create function public.available_slots() returns table(slot_id uuid,service_id uuid,starts_at timestamptz,ends_at timestamptz,commune text,gap_minutes int)
language sql stable security definer set search_path=public as $$
 select s.id,v.id,c,c+make_interval(mins=>v.duration_minutes),s.commune,s.gap_minutes
 from slots s join slot_services x on x.slot_id=s.id join services v on v.id=x.service_id
 cross join lateral generate_series(s.starts_at,s.ends_at-make_interval(mins=>v.duration_minutes),interval '5 minutes') c
 where not s.blocked and v.active and c>=now()+interval '3 hours'
 and not exists(select 1 from bookings b join slots bs on bs.id=b.slot_id where (b.status='confirmed' or (b.status='pending' and b.starts_at>=now()+interval '150 minutes'))
 and b.starts_at<c+make_interval(mins=>v.duration_minutes)+make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes)) and b.ends_at>c-make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes))) order by c,v.name;
$$;

create or replace function public.validate_booking_time(p_slot uuid,p_service uuid,p_start timestamptz,p_exclude uuid default null) returns timestamptz
language plpgsql security definer set search_path=public as $$
declare s slots;v services;finish timestamptz;
begin
 select * into s from slots where id=p_slot for update;
 if not found or s.blocked or p_start is null or p_start<now()+interval '3 hours' or p_start<s.starts_at then raise exception 'La reserva debe estar disponible y realizarse al menos 3 horas antes.';end if;
 select * into v from services where id=p_service and active for share;
 if not found or not exists(select 1 from slot_services where slot_id=s.id and service_id=v.id) then raise exception 'Tratamiento no permitido en este bloque';end if;
 finish:=p_start+make_interval(mins=>v.duration_minutes);
 if finish>s.ends_at then raise exception 'El tratamiento excede el tiempo disponible';end if;
 if mod(extract(epoch from(p_start-s.starts_at)),300)<>0 then raise exception 'Selecciona una hora disponible';end if;
 if exists(select 1 from bookings b join slots bs on bs.id=b.slot_id where b.id is distinct from p_exclude and b.status in ('pending','confirmed') and b.starts_at<finish+make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes)) and b.ends_at>p_start-make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes))) then raise exception 'No hay suficiente tiempo libre entre citas para el margen configurado. Elige otro horario.';end if;
 return finish;
end $$;

-- Defensa en la base: serializa las nuevas ocupaciones incluso entre bloques distintos.
-- No altera ni invalida citas anteriores con un margen menor.
create or replace function public.enforce_booking_gap() returns trigger
language plpgsql security definer set search_path=public as $$
declare margin int;
begin
 if new.status not in ('pending','confirmed') then return new;end if;
 if TG_OP='UPDATE' and old.status in ('pending','confirmed') and
  (new.starts_at,new.ends_at,new.slot_id) is not distinct from (old.starts_at,old.ends_at,old.slot_id) then
  return new;
 end if;
 perform pg_advisory_xact_lock(108194,10);
 select gap_minutes into margin from slots where id=new.slot_id;
 if exists(select 1 from bookings b join slots bs on bs.id=b.slot_id where b.id<>new.id and
  (b.status='confirmed' or (b.status='pending' and b.starts_at>=now()+interval '150 minutes'))
  and b.starts_at<new.ends_at+make_interval(mins=>greatest(margin,bs.gap_minutes)) and b.ends_at>new.starts_at-make_interval(mins=>greatest(margin,bs.gap_minutes))) then
  raise exception 'No hay suficiente tiempo libre entre citas para el margen configurado. Elige otro horario.';
 end if;
 return new;
end $$;
drop trigger if exists enforce_booking_gap on public.bookings;
create trigger enforce_booking_gap before insert or update on public.bookings for each row execute function public.enforce_booking_gap();
revoke all on function public.enforce_booking_gap() from public,anon,authenticated;
revoke all on function public.available_slots() from public;
grant execute on function public.available_slots() to anon,authenticated;
drop function if exists public.admin_save_slot(uuid,timestamptz,timestamptz,uuid[],text,boolean);
create or replace function public.admin_save_slot(p_id uuid,p_start timestamptz,p_end timestamptz,p_services uuid[],p_commune text,p_blocked boolean default false,p_gap_minutes int default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;c text:=nullif(trim(p_commune),'');margin int;
begin
 if not is_admin() then raise exception 'Acceso denegado';end if;
 perform expire_pending_bookings();
 margin:=coalesce(p_gap_minutes,(select gap_minutes from slots where id=p_id),10);
 if margin not in (10,15,20,25,30) then raise exception 'El margen debe ser 10, 15, 20, 25 o 30 minutos';end if;
 if p_end<=p_start or p_start is null or p_end is null or cardinality(p_services) is null or cardinality(p_services)=0 then raise exception 'Indica inicio, fin y tratamientos';end if;
 if c is not null and length(c) not between 2 and 100 then raise exception 'Comuna no válida';end if;
 if exists(select 1 from unnest(p_services) x left join services s on s.id=x where s.id is null or (not s.active and not exists(select 1 from slot_services q where q.slot_id=p_id and q.service_id=x)) or (s.active and make_interval(mins=>s.duration_minutes)>p_end-p_start)) then raise exception 'Los servicios deben estar activos y caber completos';end if;
 if p_id is null then
  if p_start<=now() then raise exception 'El bloque debe ser futuro';end if;
  insert into slots(starts_at,ends_at,commune,commune_source,blocked,gap_minutes) values(p_start,p_end,c,case when c is not null then 'admin' end,p_blocked,margin) returning id into result;
 else
  perform 1 from slots where id=p_id for update;
  if not found then raise exception 'Bloque no encontrado';end if;
  if exists(select 1 from bookings where slot_id=p_id and status in ('pending','confirmed') and not(service_id=any(p_services))) then raise exception 'No puedes quitar tratamientos de reservas vigentes';end if;
  update slots set starts_at=p_start,ends_at=p_end,commune=c,commune_source=case when c is not null then 'admin' end,blocked=p_blocked,gap_minutes=margin where id=p_id;result:=p_id;
 end if;
 delete from slot_services where slot_id=result;
 insert into slot_services select result,unnest(p_services);
 return result;
end $$;
revoke all on function public.admin_save_slot(uuid,timestamptz,timestamptz,uuid[],text,boolean,int) from public,anon;
grant execute on function public.admin_save_slot(uuid,timestamptz,timestamptz,uuid[],text,boolean,int) to authenticated;
notify pgrst,'reload schema';
commit;
