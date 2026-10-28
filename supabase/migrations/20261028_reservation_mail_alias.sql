-- Actualiza solo el destinatario administrativo. No cambia reservas ni usuarios.
-- Requiere 20261028_confirmations_communes.sql. Puede ejecutarse de nuevo.
begin;
create or replace function public.queue_booking_mail() returns trigger language plpgsql security definer set search_path=public as $$
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
  insert into booking_email_jobs(booking_id,kind,recipient,payload) values(new.id,customer_kind,new.customer_email,p),(new.id,admin_kind,'m.barahona@mbglowy.com',p);
 end if;
 if (TG_OP='INSERT' or new.revision<>old.revision) and new.starts_at>now()+interval '5 hours' and new.status in ('pending','confirmed') then
  insert into booking_email_jobs(booking_id,kind,recipient,payload,due_at) values(new.id,'reminder',new.customer_email,p,new.starts_at-interval '5 hours');
 end if;
 return new;
end $$;

update public.booking_email_jobs set recipient='m.barahona@mbglowy.com'
where kind like 'admin\_%' escape '\' and recipient='m.valenzuela@mbglowy.com' and state in ('pending','failed');
commit;
