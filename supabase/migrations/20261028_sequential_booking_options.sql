-- Opciones consecutivas: duración completa + margen elegido por bloque.
-- Requiere 20261028_booking_gap.sql. Idempotente; no cambia las reservas.
begin;
create or replace function public.available_slots() returns table(slot_id uuid,service_id uuid,starts_at timestamptz,ends_at timestamptz,commune text,gap_minutes int)
language sql stable security definer set search_path=public as $$
 with free_windows as (
  select s.id,s.commune,s.gap_minutes,v.id service_id,v.name,v.duration_minutes,
   tstzmultirange(tstzrange(s.starts_at,s.ends_at,'[)')) - coalesce((
    select range_agg(tstzrange(b.starts_at-make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes)),b.ends_at+make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes)),'[)'))
    from bookings b join slots bs on bs.id=b.slot_id
    where (b.status='confirmed' or (b.status='pending' and b.starts_at>=now()+interval '150 minutes'))
    and b.starts_at<s.ends_at+make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes))
    and b.ends_at>s.starts_at-make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes))
   ),'{}'::tstzmultirange) as free
  from slots s join slot_services x on x.slot_id=s.id join services v on v.id=x.service_id
  where not s.blocked and v.active
 )
 select f.id,f.service_id,c,c+make_interval(mins=>f.duration_minutes),f.commune,f.gap_minutes
 from free_windows f cross join lateral unnest(f.free) w
 cross join lateral generate_series(lower(w),upper(w)-make_interval(mins=>f.duration_minutes),make_interval(mins=>f.duration_minutes+f.gap_minutes)) c
 where c>=now()+interval '3 hours' order by c,f.name;
$$;
-- La edición manual admite minutos enteros. Los límites y márgenes se validan
-- igualmente; los inicios ofrecidos al público se generan por duración + pausa.
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
 if mod(extract(epoch from(p_start-s.starts_at)),60)<>0 then raise exception 'Selecciona una hora disponible';end if;
 if exists(select 1 from bookings b join slots bs on bs.id=b.slot_id where b.id is distinct from p_exclude and b.status in ('pending','confirmed') and b.starts_at<finish+make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes)) and b.ends_at>p_start-make_interval(mins=>greatest(s.gap_minutes,bs.gap_minutes))) then raise exception 'No hay suficiente tiempo libre entre citas para el margen configurado. Elige otro horario.';end if;
 return finish;
end $$;

notify pgrst,'reload schema';
commit;
