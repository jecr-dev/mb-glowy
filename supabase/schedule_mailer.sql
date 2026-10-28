-- Ejecutar solo después de desplegar booking-mailer y configurar el secreto en Vault.
-- No pegar contraseñas aquí. Vault debe contener mb_mail_worker_secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname in ('mb-expire-reservations','mb-send-mail');
-- El corte de confirmación también se comprueba en cada intento, incluso si cron se retrasa.
select cron.schedule('mb-expire-reservations','* * * * *', $$select public.expire_pending_bookings();$$);
select cron.schedule('mb-send-mail','* * * * *', $$
 select net.http_post(
 url:='https://wbfkttlfbfxpzehpuexq.supabase.co/functions/v1/booking-mailer',
 headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='mb_mail_worker_secret' limit 1)),
 body:='{}'::jsonb,timeout_milliseconds:=120000
 );
$$);
