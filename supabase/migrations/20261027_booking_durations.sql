-- Ejecutar después de schema.sql. Conserva los datos y puede ejecutarse de nuevo.
begin;
lock table public.bookings, public.slots in access exclusive mode;
alter table public.bookings add column if not exists starts_at timestamptz;
alter table public.bookings add column if not exists ends_at timestamptz;
-- Las reservas anteriores ocupaban todo el bloque: conservar esa ocupación.
update public.bookings b set starts_at=s.starts_at, ends_at=s.ends_at
from public.slots s where s.id=b.slot_id and (b.starts_at is null or b.ends_at is null);
alter table public.bookings alter column starts_at set not null;
alter table public.bookings alter column ends_at set not null;
alter table public.bookings drop constraint if exists booking_positive_duration;
alter table public.bookings add constraint booking_positive_duration check(ends_at>starts_at);
drop index if exists public.one_booking_per_slot;
alter table public.bookings drop constraint if exists bookings_no_overlap;
-- Intervalos [inicio, fin): una cita puede empezar justo al terminar otra.
alter table public.bookings add constraint bookings_no_overlap exclude using gist
(tstzrange(starts_at,ends_at,'[)') with &&) where (status='confirmed');

create or replace function public.available_slots()
returns table(slot_id uuid,service_id uuid,starts_at timestamptz,ends_at timestamptz)
language sql stable security definer set search_path=public as $$
 select s.id,v.id,candidate,candidate+make_interval(mins=>v.duration_minutes)
 from slots s join slot_services x on x.slot_id=s.id join services v on v.id=x.service_id
 cross join lateral generate_series(s.starts_at,s.ends_at-make_interval(mins=>v.duration_minutes),interval '5 minutes') candidate
 where not s.blocked and v.active and candidate>now()
 and not exists(select 1 from bookings b where b.status='confirmed'
  and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(candidate,candidate+make_interval(mins=>v.duration_minutes),'[)'))
 order by candidate,v.name
$$;

-- Eliminar la ruta anterior: nunca debe aceptar reservas sin hora de inicio.
drop function if exists public.book_slot(uuid,uuid,text,text,text);
create or replace function public.book_slot(slot_id uuid,service_id uuid,customer_name text,customer_email text,customer_phone text,appointment_start timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare s slots; v services; appointment_end timestamptz; result uuid;
begin
 select * into s from slots where id=book_slot.slot_id for update;
 if not found or s.blocked or appointment_start is null or appointment_start<=now() or appointment_start<s.starts_at then
  raise exception 'Horario no disponible. Actualiza los horarios y elige otro.';
 end if;
 select * into v from services where id=book_slot.service_id and active for share;
 if not found or not exists(select 1 from slot_services x where x.slot_id=s.id and x.service_id=v.id) then
  raise exception 'Tratamiento no disponible para ese horario';
 end if;
 appointment_end:=appointment_start+make_interval(mins=>v.duration_minutes);
 if appointment_end>s.ends_at then raise exception 'El tratamiento excede el tiempo disponible'; end if;
 if mod(extract(epoch from (appointment_start-s.starts_at)),300)<>0 then raise exception 'Selecciona una hora de inicio disponible'; end if;
 if exists(select 1 from bookings b where b.status='confirmed'
  and tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(appointment_start,appointment_end,'[)')) then
  raise exception 'Ese horario acaba de ser reservado. Actualiza los horarios y elige otro.';
 end if;
 insert into bookings(slot_id,service_id,customer_name,customer_email,customer_phone,starts_at,ends_at)
 values(s.id,v.id,trim(book_slot.customer_name),lower(trim(book_slot.customer_email)),trim(book_slot.customer_phone),appointment_start,appointment_end)
 returning id into result;
 return result;
exception when exclusion_violation then
 raise exception 'Ese horario acaba de ser reservado. Actualiza los horarios y elige otro.';
end $$;

-- Evitar mover la disponibilidad de citas existentes (incluido el historial).
create or replace function public.protect_booked_slot() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (new.starts_at<>old.starts_at or new.ends_at<>old.ends_at)
 and exists(select 1 from bookings where slot_id=old.id) then
  raise exception 'No se puede mover un bloque con reservas. Bloquéalo y crea otro horario.';
 end if;
 return new;
end $$;
drop trigger if exists protect_booked_slot on public.slots;
create trigger protect_booked_slot before update on public.slots for each row execute function public.protect_booked_slot();
revoke all on function public.book_slot(uuid,uuid,text,text,text,timestamptz),public.protect_booked_slot() from public;
grant execute on function public.book_slot(uuid,uuid,text,text,text,timestamptz) to anon,authenticated;
notify pgrst,'reload schema';
commit;
