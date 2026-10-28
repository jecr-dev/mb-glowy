begin;
-- Requiere las migraciones de reservas, comunas y pausas. No borra reservas.
create table if not exists public.legal_settings(id boolean primary key default true check(id),ready boolean not null default false,version text not null);
insert into public.legal_settings(id,ready,version) values(true,false,'2026-10-28.v1') on conflict do nothing;
create table if not exists public.legal_documents(
 version text not null,kind text not null check(kind in ('terminos','privacidad','cookies','reembolsos')),
 url text not null,content text not null,sha256 text not null check(sha256=encode(sha256(convert_to(content,'UTF8')),'hex')),
 primary key(version,kind));
create table if not exists public.legal_acceptances(
 id uuid primary key default gen_random_uuid(),accepted_at timestamptz not null default clock_timestamp(),
 subject_email text not null,admin_user_id uuid,booking_reference uuid,
 source text not null check(source in ('booking','contact','admin:login','admin:service','admin:slot','admin:edit-booking')),
 version text not null,terms_accepted boolean not null check(terms_accepted),privacy_accepted boolean not null check(privacy_accepted),
 method text not null default 'two_unchecked_required_checkboxes_explicit_submit',
 booking_snapshot jsonb not null default '{}'::jsonb,
 identity_assurance text not null check(identity_assurance in ('declared_email','authenticated_admin')),
 check(length(subject_email)<=254));
alter table public.legal_settings enable row level security;
alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;
revoke all on public.legal_settings,public.legal_documents,public.legal_acceptances from public,anon,authenticated;
grant select on public.legal_documents,public.legal_acceptances to authenticated;
drop policy if exists admin_legal_documents on public.legal_documents;
create policy admin_legal_documents on public.legal_documents for select to authenticated using(public.is_admin());
drop policy if exists admin_legal_acceptances on public.legal_acceptances;
create policy admin_legal_acceptances on public.legal_acceptances for select to authenticated using(public.is_admin());
create or replace function public.prevent_legal_mutation() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Evidencia de aceptación: no se modifica desde la aplicación. Tramita las solicitudes de derechos mediante el procedimiento documentado.';end $$;
drop trigger if exists immutable_legal_acceptances on public.legal_acceptances;
create trigger immutable_legal_acceptances before update or delete on public.legal_acceptances for each row execute function public.prevent_legal_mutation();
drop trigger if exists immutable_legal_documents on public.legal_documents;
create trigger immutable_legal_documents before update or delete on public.legal_documents for each row execute function public.prevent_legal_mutation();
create or replace function public.legal_bundle() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('ready',s.ready,'version',s.version,'documents',(select jsonb_agg(jsonb_build_object('kind',d.kind,'url',d.url,'sha256',d.sha256) order by d.kind) from legal_documents d where d.version=s.version)) from legal_settings s where id
$$;
create or replace function public.record_legal_acceptance(p_email text,p_version text,p_terms boolean,p_privacy boolean,p_source text,p_booking uuid default null,p_admin uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if p_terms is distinct from true or p_privacy is distinct from true then raise exception 'Debes aceptar los términos y autorizar la política de privacidad por separado.';end if;
 if not exists(select 1 from legal_settings where id and ready and version=p_version) or (select count(*) from legal_documents where version=p_version)<>4 then raise exception 'Los documentos han cambiado o aún no están habilitados. Recarga y revisa las políticas.';end if;
 if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Correo no válido';end if;
 insert into legal_acceptances(subject_email,admin_user_id,booking_reference,source,version,terms_accepted,privacy_accepted,identity_assurance,booking_snapshot)
 values(lower(trim(p_email)),p_admin,p_booking,p_source,p_version,true,true,case when p_admin is null then 'declared_email' else 'authenticated_admin' end,
 coalesce((select jsonb_build_object('service_id',b.service_id,'service_name',v.name,'price_clp',v.price,'starts_at',b.starts_at,'ends_at',b.ends_at,'commune',b.commune) from bookings b join services v on v.id=b.service_id where b.id=p_booking),'{}'::jsonb)) returning id into result;
 return result;
end $$;
-- Se conserva la lógica vigente de duración, comuna, bloqueo y correos; se cierra el acceso anterior sin aceptación.
do $$begin
 if to_regprocedure('public.book_slot_legacy_without_consent(uuid,uuid,text,text,text,timestamp with time zone,text,text)') is null then
  alter function public.book_slot(uuid,uuid,text,text,text,timestamptz,text,text) rename to book_slot_legacy_without_consent;
 end if;
end $$;
revoke all on function public.book_slot_legacy_without_consent(uuid,uuid,text,text,text,timestamptz,text,text) from public,anon,authenticated;
create or replace function public.book_slot(slot_id uuid,service_id uuid,customer_name text,customer_email text,customer_phone text,appointment_start timestamptz,customer_commune text,customer_address text,legal_version text,terms_accepted boolean,privacy_accepted boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;receipt uuid;
begin
 -- Ambos cambios se confirman en una sola transacción, o ninguno.
 result:=book_slot_legacy_without_consent(slot_id,service_id,customer_name,customer_email,customer_phone,appointment_start,customer_commune,customer_address);
 receipt:=record_legal_acceptance(customer_email,legal_version,terms_accepted,privacy_accepted,'booking',result);
 update booking_email_jobs set payload=payload||jsonb_build_object('legal_version',legal_version,'legal_receipt',receipt,'legal_documents',
 (select jsonb_agg(jsonb_build_object('kind',d.kind,'url',d.url,'content',d.content,'sha256',d.sha256) order by d.kind) from legal_documents d where d.version=legal_version))
 where booking_id=result and kind in ('booked','admin_booked');
 return result;
end $$;
create or replace function public.contact_legal_acceptance(p_email text,p_version text,p_terms boolean,p_privacy boolean)
returns uuid language sql security definer set search_path=public as $$select record_legal_acceptance(p_email,p_version,p_terms,p_privacy,'contact')$$;
create or replace function public.admin_legal_acceptance(p_version text,p_terms boolean,p_privacy boolean,p_form text)
returns uuid language plpgsql security definer set search_path=public as $$
declare email text;
begin
 if not public.is_admin() then raise exception 'Acceso denegado';end if;
 if p_form not in ('login','service','slot','edit-booking') or p_form is null then raise exception 'Formulario no válido';end if;
 select u.email into email from auth.users u where u.id=auth.uid();
 return record_legal_acceptance(email,p_version,p_terms,p_privacy,'admin:'||p_form,null,auth.uid());
end $$;
revoke all on function public.prevent_legal_mutation(),public.legal_bundle(),public.record_legal_acceptance(text,text,boolean,boolean,text,uuid,uuid),public.book_slot(uuid,uuid,text,text,text,timestamptz,text,text,text,boolean,boolean),public.contact_legal_acceptance(text,text,boolean,boolean),public.admin_legal_acceptance(text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.legal_bundle(),public.book_slot(uuid,uuid,text,text,text,timestamptz,text,text,text,boolean,boolean),public.contact_legal_acceptance(text,text,boolean,boolean) to anon,authenticated;
grant execute on function public.admin_legal_acceptance(text,boolean,boolean,text) to authenticated;
