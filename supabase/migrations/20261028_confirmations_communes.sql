-- Requiere las migraciones anteriores. Ejecutar completo, una vez.
begin;
lock table public.bookings,public.slots in access exclusive mode;
alter table public.slots add column commune text;
alter table public.slots add column commune_source text check(commune_source in ('admin','booking'));
alter table public.bookings add column commune text not null default '';
alter table public.bookings add column customer_address text not null default '';
alter table public.bookings add column revision int not null default 1;
alter table public.bookings add column confirmed_at timestamptz;
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check check(status in ('pending','confirmed','unconfirmed','cancelled'));
alter table public.bookings alter column status set default 'pending';
create index bookings_pending_due on public.bookings(starts_at) where status='pending';
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap exclude using gist
(tstzrange(starts_at,ends_at,'[)') with &&) where(status in ('pending','confirmed'));
create table public.booking_confirmation_tokens(booking_id uuid primary key references public.bookings on delete cascade,token uuid not null unique default gen_random_uuid());
create table public.booking_email_jobs(
 id uuid primary key default gen_random_uuid(),booking_id uuid references public.bookings on delete set null,
 kind text not null,recipient text not null,payload jsonb not null,due_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','sending','sent','failed')),
 attempts int not null default 0,lease_until timestamptz,sent_at timestamptz,last_error text,
 created_at timestamptz not null default now());
create index email_jobs_due on public.booking_email_jobs(due_at) where state in ('pending','sending');
alter table public.booking_confirmation_tokens enable row level security;
alter table public.booking_email_jobs enable row level security;
revoke all on public.booking_confirmation_tokens,public.booking_email_jobs from anon,authenticated;
create policy admin_email_status on public.booking_email_jobs for select to authenticated using(public.is_admin());
-- El panel solo ve estado de entrega, nunca el token de confirmación.
grant select(id,booking_id,kind,state,attempts,sent_at,last_error,due_at) on public.booking_email_jobs to authenticated;

create function public.queue_booking_mail() returns trigger language plpgsql security definer set search_path=public as $$
declare p jsonb; t uuid; customer_kind text; admin_kind text;
begin
 if TG_OP='INSERT' or new.revision<>old.revision then
  insert into booking_confirmation_tokens(booking_id) values(new.id)
  on conflict(booking_id) do update set token=gen_random_uuid() returning token into t;
  delete from booking_email_jobs where booking_id=new.id and state in ('pending','sending','failed');
  customer_kind:=case when TG_OP='INSERT' then 'booked' else 'updated' end;
  admin_kind:=case when TG_OP='INSERT' then 'admin_booked' else 'admin_updated' end;
 elsif new.status is distinct from old.status then
  select token into t from booking_confirmation_tokens where booking_id=new.id;
  customer_kind:=case new.status when 'confirmed' then 'confirmed' when 'cancelled' then 'cancelled' when 'unconfirmed' then 'unconfirmed' end;
  admin_kind:='admin_'||customer_kind;
  if new.status in ('cancelled','unconfirmed') then
   delete from booking_email_jobs where booking_id=new.id and state in ('pending','sending','failed');
  end if;
 else return new;
 end if;
 p:=jsonb_build_object('booking_id',new.id,'name',new.customer_name,'email',new.customer_email,'phone',new.customer_phone,'address',new.customer_address,'commune',new.commune,'starts_at',new.starts_at,'ends_at',new.ends_at,'status',new.status,'revision',new.revision,'token',t,'service',(select name from services where id=new.service_id),'price',(select price from services where id=new.service_id),'duration_minutes',(extract(epoch from(new.ends_at-new.starts_at))/60)::int);
 if customer_kind is not null then
  insert into booking_email_jobs(booking_id,kind,recipient,payload) values(new.id,customer_kind,new.customer_email,p),(new.id,admin_kind,'m.valenzuela@mbglowy.com',p);
 end if;
 if (TG_OP='INSERT' or new.revision<>old.revision) and new.starts_at>now()+interval '5 hours' and new.status in ('pending','confirmed') then
  insert into booking_email_jobs(booking_id,kind,recipient,payload,due_at) values(new.id,'reminder',new.customer_email,p,new.starts_at-interval '5 hours');
 end if;
 return new;
end $$;
create trigger queue_booking_mail after insert or update on public.bookings for each row execute function public.queue_booking_mail();

create function public.expire_pending_bookings() returns void language sql security definer set search_path=public as $$
 update bookings set status='unconfirmed' where status='pending' and starts_at<now()+interval '150 minutes';
$$;

-- Confirma solo mediante acción explícita. El enlace usa un token aleatorio privado.
create function public.booking_confirmation_info(p_token uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('service',s.name,'starts_at',b.starts_at,'ends_at',b.ends_at,'commune',b.commune,
 'status',case when b.status='pending' and b.starts_at<now()+interval '150 minutes' then 'unconfirmed' else b.status end,
 'can_confirm',b.status='pending' and b.starts_at>=now()+interval '150 minutes')
 from booking_confirmation_tokens t join bookings b on b.id=t.booking_id join services s on s.id=b.service_id where t.token=p_token;
$$;
create function public.confirm_booking(p_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare b bookings;
begin
 select b1.* into b from bookings b1 join booking_confirmation_tokens t on t.booking_id=b1.id where t.token=p_token for update of b1;
 if not found then return jsonb_build_object('ok',false,'message','Enlace no válido o reserva eliminada.');end if;
 if b.status='confirmed' then return jsonb_build_object('ok',true,'message','Tu reserva ya está confirmada.');end if;
 if b.status='pending' and b.starts_at<now()+interval '150 minutes' then
  update bookings set status='unconfirmed' where id=b.id;
  return jsonb_build_object('ok',false,'message','El plazo terminó: quedan menos de 2 horas y 30 minutos. La reserva está no confirmada y el horario fue liberado.');
 end if;
 if b.status<>'pending' then return jsonb_build_object('ok',false,'message','Esta reserva ya no admite confirmación.');end if;
 update bookings set status='confirmed',confirmed_at=now() where id=b.id;
 return jsonb_build_object('ok',true,'message','Tu reserva está confirmada. Te esperamos.');
end $$;

drop function public.available_slots();
create function public.available_slots() returns table(slot_id uuid,service_id uuid,starts_at timestamptz,ends_at timestamptz,commune text)
language sql stable security definer set search_path=public as $$
 select s.id,v.id,c,c+make_interval(mins=>v.duration_minutes),s.commune
 from slots s join slot_services x on x.slot_id=s.id join services v on v.id=x.service_id
 cross join lateral generate_series(s.starts_at,s.ends_at-make_interval(mins=>v.duration_minutes),interval '5 minutes') c
 where not s.blocked and v.active and c>=now()+interval '3 hours'
 and not exists(select 1 from bookings b where (b.status='confirmed' or (b.status='pending' and b.starts_at>=now()+interval '150 minutes'))
 and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(c,c+make_interval(mins=>v.duration_minutes),'[)')) order by c,v.name;
$$;

create function public.validate_booking_time(p_slot uuid,p_service uuid,p_start timestamptz,p_exclude uuid default null) returns timestamptz
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
 if exists(select 1 from bookings b where b.id is distinct from p_exclude and b.status in ('pending','confirmed') and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(p_start,finish,'[)')) then raise exception 'El horario ya está reservado';end if;
 return finish;
end $$;
create function public.assign_booking_commune(p_slot uuid,p_commune text) returns text language plpgsql security definer set search_path=public as $$
declare s slots; c text:=trim(p_commune);
begin
 select * into s from slots where id=p_slot for update;
 if s.commune is not null then
  if lower(c)<>lower(s.commune) or c is null then raise exception 'El bloque está asignado a la comuna %',s.commune;end if;
  return s.commune;
 end if;
 c:=case lower(c) when 'coquimbo' then 'Coquimbo' when 'la serena' then 'La Serena' when 'ovalle' then 'Ovalle' else null end;
 if c is null then raise exception 'Selecciona Coquimbo, La Serena u Ovalle';end if;
 update slots set commune=c,commune_source='booking' where id=p_slot;
 return c;
end $$;
drop function public.book_slot(uuid,uuid,text,text,text,timestamptz);
create function public.book_slot(slot_id uuid,service_id uuid,customer_name text,customer_email text,customer_phone text,appointment_start timestamptz,customer_commune text,customer_address text)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; finish timestamptz;c text;
begin
 perform expire_pending_bookings();
 finish:=validate_booking_time(slot_id,service_id,appointment_start);
 c:=assign_booking_commune(slot_id,customer_commune);
 if length(trim(customer_address)) not between 5 and 300 or customer_address is null then raise exception 'Indica la dirección completa de atención';end if;
 insert into bookings(slot_id,service_id,customer_name,customer_email,customer_phone,starts_at,ends_at,commune,customer_address,status)
 values(slot_id,service_id,trim(customer_name),lower(trim(customer_email)),trim(customer_phone),appointment_start,finish,c,trim(customer_address),'pending') returning id into result;
 return result;
exception when exclusion_violation then raise exception 'Ese horario acaba de ser reservado. Actualiza la agenda.';
end $$;

-- La edición de bloques permite conservar reservas incluidas, nunca desplazarlas.
create or replace function public.protect_booked_slot() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from bookings b where b.slot_id=old.id and b.status in ('pending','confirmed') and
 (b.starts_at<new.starts_at or b.ends_at>new.ends_at or (b.commune<>'' and b.commune is distinct from new.commune))) then
  raise exception 'El bloque debe contener las reservas vigentes y conservar su comuna';end if;
 return new;
end $$;
create function public.admin_save_slot(p_id uuid,p_start timestamptz,p_end timestamptz,p_services uuid[],p_commune text,p_blocked boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;c text:=nullif(trim(p_commune),'');
begin
 if not is_admin() then raise exception 'Acceso denegado';end if;
 perform expire_pending_bookings();
 if p_end<=p_start or p_start is null or p_end is null or cardinality(p_services) is null or cardinality(p_services)=0 then raise exception 'Indica inicio, fin y tratamientos';end if;
 if c is not null and length(c) not between 2 and 100 then raise exception 'Comuna no válida';end if;
 if exists(select 1 from unnest(p_services) x left join services s on s.id=x where s.id is null or (not s.active and not exists(select 1 from slot_services q where q.slot_id=p_id and q.service_id=x)) or (s.active and make_interval(mins=>s.duration_minutes)>p_end-p_start)) then raise exception 'Los servicios deben estar activos y caber completos';end if;
 if p_id is null then
  if p_start<=now() then raise exception 'El bloque debe ser futuro';end if;
  insert into slots(starts_at,ends_at,commune,commune_source,blocked) values(p_start,p_end,c,case when c is not null then 'admin' end,p_blocked) returning id into result;
 else
  perform 1 from slots where id=p_id for update;
  if not found then raise exception 'Bloque no encontrado';end if;
  if exists(select 1 from bookings where slot_id=p_id and status in ('pending','confirmed') and not(service_id=any(p_services))) then raise exception 'No puedes quitar tratamientos de reservas vigentes';end if;
  update slots set starts_at=p_start,ends_at=p_end,commune=c,commune_source=case when c is not null then 'admin' end,blocked=p_blocked where id=p_id;result:=p_id;
 end if;
 delete from slot_services where slot_id=result;
 insert into slot_services select result,unnest(p_services);
 return result;
end $$;
create function public.admin_set_slot_blocked(p_id uuid,p_blocked boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_admin() then raise exception 'Acceso denegado';end if;
 update slots set blocked=p_blocked where id=p_id;
end $$;
create function public.admin_delete_slot(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_admin() then raise exception 'Acceso denegado';end if;
 perform expire_pending_bookings();
 perform 1 from slots where id=p_id for update;
 if exists(select 1 from bookings where slot_id=p_id) then raise exception 'Elimina primero las reservas de este bloque (también las pasadas o canceladas).';end if;
 delete from slots where id=p_id;
end $$;
create function public.admin_save_booking(p_id uuid,p_slot uuid,p_service uuid,p_start timestamptz,p_name text,p_email text,p_phone text,p_commune text,p_address text,p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare b bookings;finish timestamptz;c text;changed boolean;
begin
 if not is_admin() then raise exception 'Acceso denegado';end if;
 perform expire_pending_bookings();
 -- Orden de bloqueo compartido con las reservas públicas.
 perform 1 from slots where id=p_slot for update;
 select * into b from bookings where id=p_id for update;
 if not found then raise exception 'Reserva no encontrada';end if;
 if p_status not in ('pending','confirmed','cancelled') then raise exception 'Estado no válido';end if;
 if p_status='cancelled' then update bookings set status='cancelled' where id=p_id;return;end if;
 changed:=(b.slot_id,b.service_id,b.starts_at,b.customer_name,b.customer_email,b.customer_phone,b.commune,b.customer_address) is distinct from (p_slot,p_service,p_start,trim(p_name),lower(trim(p_email)),trim(p_phone),trim(p_commune),trim(p_address));
 if not changed and b.status='confirmed' and p_status='confirmed' then return;end if;
 if not changed and b.status='pending' and p_status='confirmed' then
  if b.starts_at<now()+interval '150 minutes' then raise exception 'Plazo de confirmación vencido';end if;
  update bookings set status='confirmed',confirmed_at=now() where id=p_id;return;
 end if;
 if b.status in ('cancelled','unconfirmed') and b.starts_at<now() then raise exception 'Una reserva pasada no puede reactivarse';end if;
 finish:=validate_booking_time(p_slot,p_service,p_start,p_id);c:=assign_booking_commune(p_slot,p_commune);
 if p_address is null or length(trim(p_address)) not between 5 and 300 then raise exception 'Indica la dirección de atención';end if;
 update bookings set slot_id=p_slot,service_id=p_service,starts_at=p_start,ends_at=finish,customer_name=trim(p_name),customer_email=lower(trim(p_email)),customer_phone=trim(p_phone),commune=c,customer_address=trim(p_address),
 status='pending',confirmed_at=null,revision=revision+1 where id=p_id;
 -- Cambiar los datos exige una confirmación nueva, incluso si antes estaba confirmada.
end $$;
create function public.admin_delete_booking(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_admin() then raise exception 'Acceso denegado';end if;
 perform 1 from bookings where id=p_id for update;
 -- Avisar antes de eliminar una cita futura vigente; el trabajo conserva solo lo necesario hasta enviarse.
 update bookings set status='cancelled' where id=p_id and status in ('pending','confirmed') and starts_at>now();
 delete from booking_email_jobs where booking_id=p_id and state<>'sent' and kind not in ('cancelled','admin_cancelled');
 delete from bookings where id=p_id;
end $$;

-- Cola privada: solo la Edge Function, mediante service_role, puede reclamar trabajos.
create function public.claim_booking_emails(p_limit int default 20) returns setof public.booking_email_jobs language plpgsql security definer set search_path=public as $$
begin
 perform expire_pending_bookings();
 update booking_email_jobs set state='failed',last_error='MAX_ATTEMPTS' where state='sending' and lease_until<now() and attempts>=8;
 delete from booking_email_jobs where (state='sent' and sent_at<now()-interval '7 days') or (booking_id is null and created_at<now()-interval '7 days');
 -- No enviar recordatorios de citas canceladas, vencidas o ya pasadas.
 delete from booking_email_jobs j where kind='reminder' and (not exists(select 1 from bookings b where b.id=j.booking_id and b.status in ('pending','confirmed') and b.starts_at>now()));
 update booking_email_jobs j set payload=j.payload||jsonb_build_object('status',b.status) from bookings b where j.booking_id=b.id and j.state<>'sent' and j.kind in ('booked','updated','reminder','admin_booked','admin_updated');
 return query update booking_email_jobs j set state='sending',attempts=j.attempts+1,lease_until=now()+interval '5 minutes'
 where j.id in(select x.id from booking_email_jobs x where (x.state='pending' or (x.state='sending' and x.lease_until<now())) and x.due_at<=now() and x.attempts<8 order by x.due_at for update skip locked limit greatest(1,least(p_limit,50))) returning j.*;
end $$;
create function public.finish_booking_email(p_id uuid,p_success boolean,p_error text default null) returns void language sql security definer set search_path=public as $$
 update booking_email_jobs set state=case when p_success then 'sent' when attempts>=8 then 'failed' else 'pending' end,
 sent_at=case when p_success then now() end,last_error=case when p_success then null else left(p_error,300) end,
 due_at=case when p_success then due_at else now()+make_interval(mins=>least(60,power(2,attempts)::int)) end,lease_until=null where id=p_id and state='sending';
$$;
revoke update on public.bookings from authenticated;
-- Fuerza el uso de operaciones que validan reservas, comuna y notificaciones.
revoke insert,update,delete on public.slots,public.slot_services from authenticated;
-- El bloqueo/desbloqueo es una edición validada por admin_save_slot.
revoke all on function public.queue_booking_mail(),public.expire_pending_bookings(),public.validate_booking_time(uuid,uuid,timestamptz,uuid),public.assign_booking_commune(uuid,text),public.booking_confirmation_info(uuid),public.confirm_booking(uuid),public.available_slots(),public.book_slot(uuid,uuid,text,text,text,timestamptz,text,text),public.admin_save_slot(uuid,timestamptz,timestamptz,uuid[],text,boolean),public.admin_set_slot_blocked(uuid,boolean),public.admin_delete_slot(uuid),public.admin_save_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text),public.admin_delete_booking(uuid),public.claim_booking_emails(int),public.finish_booking_email(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.booking_confirmation_info(uuid),public.confirm_booking(uuid),public.available_slots(),public.book_slot(uuid,uuid,text,text,text,timestamptz,text,text) to anon,authenticated;
grant execute on function public.admin_save_slot(uuid,timestamptz,timestamptz,uuid[],text,boolean),public.admin_set_slot_blocked(uuid,boolean),public.admin_delete_slot(uuid),public.admin_save_booking(uuid,uuid,uuid,timestamptz,text,text,text,text,text,text),public.admin_delete_booking(uuid),public.expire_pending_bookings() to authenticated;
-- La función de expiración no revela datos ni permite cambiar reservas confirmadas.
grant execute on function public.claim_booking_emails(int),public.finish_booking_email(uuid,boolean,text),public.expire_pending_bookings() to service_role;
notify pgrst,'reload schema';
commit;
