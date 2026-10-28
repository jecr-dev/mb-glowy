# Activar administración, comunas y correo con Zoho Mail

El código no contrata servicios ni envía correos hasta configurar el SMTP. Usar únicamente las cuotas gratuitas disponibles en tu Supabase y tu cuenta Zoho. Algunos planes gratuitos de Zoho permiten solo webmail; **tener correo en Zoho no demuestra que el SMTP esté habilitado**. Si tu cuenta no lo permite, el envío automático queda bloqueado y no hay que contratar un plan sin decidirlo antes.

## 1. Comprobar Zoho sin pagar

Entrar a la cuenta remitente de Zoho y localizar la configuración de servidores SMTP. Consultar https://www.zoho.com/mail/help/zoho-smtp.html para los servidores de la región y del plan de tu cuenta. El usuario es la dirección completa, no solo el nombre.

Si SMTP está disponible, usar TLS en puerto **465** (SSL) o **587** (STARTTLS), con verificación de certificado. Preferir **465** en Supabase Edge Functions; usar 587 únicamente si la plataforma permite la conexión saliente. El worker admite los servidores `smtp.zoho.*` y `smtppro.zoho.*` de las regiones habituales. Usar una contraseña de aplicación si Zoho exige autenticación de dos factores. No pegar contraseñas en chats, GitHub ni archivos de configuración de la web.

Si no hay acceso SMTP en el plan gratuito, detener aquí la activación del correo y mantener los trabajos pendientes: el sitio puede administrar reservas, pero no debe ofrecerse al público el flujo de confirmación por correo hasta resolver el envío. No se ha validado tu plan ni enviado correos reales durante el desarrollo.

## 2. Secretos de la Edge Function

En Supabase → Edge Functions → Secrets configurar:

| Nombre | Contenido |
|---|---|
| `SMTP_HOST` | El servidor SMTP indicado por Zoho para tu cuenta/región. |
| `SMTP_PORT` | `465` o `587`. |
| `SMTP_USER` | `m.barahona@mbglowy.com`, cuenta principal que autentica en Zoho. |
| `SMTP_FROM` | `reserva@mbglowy.com`, alias autorizado para enviar. |
| `SMTP_REPLY_TO` | `reserva@mbglowy.com`; las respuestas llegan a la bandeja principal por el alias. |
| `SMTP_PASSWORD` | Contraseña SMTP/de aplicación, solo en el panel seguro. |
| `MB_MAIL_WORKER_SECRET` | Una cadena aleatoria privada de al menos 32 caracteres. Puede generarse localmente con `openssl rand -hex 32`. |
| `PUBLIC_SITE_URL` | `https://mbglowy.com/app/` |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se inyectan en el servidor por Supabase: **no poner service_role ni los secretos SMTP en `app/config.js`**.

El inicio de sesión SMTP usa la cuenta principal **m.barahona@mbglowy.com** y su contraseña SMTP/de aplicación. El remitente visible es **MB Glowy · Reservas <reserva@mbglowy.com>**. Zoho debe autorizar el envío desde ese alias. Los avisos administrativos van a **m.barahona@mbglowy.com**. El alias no tiene contraseña propia.

## 3. Actualizar la base y la página

En Supabase → SQL Editor ejecutar **una vez** `supabase/migrations/20261028_confirmations_communes.sql`. Requiere haber ejecutado antes `20261027_booking_durations.sql`. No repetir `schema.sql` ni borrar tablas. Esta nueva migración se ejecuta en una transacción; repetirla provoca un error y no aplica cambios parciales.

Preparar la publicación de la rama del frontend, pero completarla solo después del worker y cron de los pasos siguientes. Coordinar esta actualización durante una pausa de reservas: la ruta anterior deja de aceptar reservas para exigir comuna y dirección. La versión anterior de la página no tiene dirección/comuna y debe recargarse. Las reservas antiguas conservan su estado confirmado; no se envía un correo masivo por migrar. Sus comunas/direcciones anteriores deben completarse desde el panel; al modificar una cita futura se pide confirmación nueva.

## 4. Desplegar el worker

Desde una terminal con el repositorio actual y acceso a tu cuenta Supabase:

```sh
npx supabase login
npx supabase functions deploy booking-mailer --project-ref wbfkttlfbfxpzehpuexq --use-api
```

`supabase/config.toml` desactiva la validación JWT solo de esta función; el worker exige `x-worker-secret` y rechaza peticiones sin el secreto. No tiene una ruta pública de envío arbitrario: obtiene exclusivamente trabajos de la cola privada.

No llamar al worker desde la página, no añadir contraseñas en URLs y no revelar su secreto por chat.

## 5. Activar tareas automáticas

En Supabase → Vault crear un secreto llamado **`mb_mail_worker_secret`** con **el mismo valor** que `MB_MAIL_WORKER_SECRET`. No es la contraseña de Zoho.

Ejecutar `supabase/schedule_mailer.sql` en SQL Editor. Instala/usa `pg_cron` y `pg_net` y registra dos tareas cada minuto: caducar reservas pendientes y solicitar envíos a la Edge Function. Revisar las ejecuciones en Supabase Cron y los logs de la función, sin imprimir secretos. Si Vault o esas extensiones no están disponibles, la programación no está activa: no afirmar que los recordatorios funcionan.

La cola programa el recordatorio para cinco horas antes. El envío real puede retrasarse por la ejecución del cron, reintentos, cuota o el proveedor. Si se reserva con menos de cinco horas de antelación, se envía el correo inicial de confirmación inmediatamente y no un recordatorio retroactivo duplicado.

## 6. Publicar frontend y probar antes de usar con clientas

1. Integrar/publicar la rama del frontend en GitHub, esperar Pages y recargar la app. Crear un bloque de prueba futuro, asignar tratamiento y comuna.
2. Reservar con un correo propio y dirección de prueba. Debe aparecer **Reservada · por confirmar**.
3. Esperar el correo de la clienta y el aviso a m.barahona@mbglowy.com. Revisar spam. En el panel, abrir **Estado de los correos**: “Enviado” significa aceptado por SMTP, no leído ni entregado a bandeja de entrada.
4. Abrir el enlace: ver los datos **sin confirmar automáticamente**. Pulsar **Confirmar mi asistencia**; el panel debe mostrar **Confirmada** y encolarse el recibo.
5. Editar la cita: el enlace anterior debe caducar y el nuevo correo pedir otra confirmación.
6. Cancelar y eliminar la reserva; eliminar su bloque. No deben enviarse recordatorios de citas canceladas.
7. Verificar en cron el recordatorio de cinco horas y la expiración de una cita de prueba que no se confirme. El corte también se impone en cada intento de confirmación, independientemente del cron.

## Reglas acordadas

- Nuevas reservas con al menos **3 horas** de antelación. Se solicita confirmar al menos tres horas antes; existe un margen de gracia de 30 minutos. A falta de **menos de 2 h 30 min**, la confirmación se rechaza, queda **No confirmada** y se libera el intervalo. Una cita ya confirmada permanece confirmada.
- Una edición de fecha, tratamiento o datos personales vuelve a **por confirmar**, recalcula la duración y rota el enlace privado. No puede sobrepasar el cierre ni solaparse con otra cita. La confirmación manual administrativa también respeta el plazo; no hay anulación del corte.
- Una comuna administrativa puede ser cualquiera de Chile (campo de texto). Las clientas solo pueden usar la comuna fijada. Sin comuna administrativa, la primera reserva elige **Coquimbo, La Serena u Ovalle**, de forma atómica. Se conserva para el resto del bloque aun después de cancelar/eliminar; la administradora puede cambiarla o limpiarla cuando no queden citas vigentes incompatibles.
- Se requiere dirección para atención a domicilio. Las citas del mismo bloque quedan en una comuna; no se han añadido tiempos de traslado entre domicilios.
- Borrar una cita futura vigente encola cancelación; borrar una cancelada o pasada elimina su registro. Los trabajos de correo conservan temporalmente los datos mínimos necesarios: los enviados o desvinculados se limpian después de siete días al ejecutar el worker.
- Se pueden borrar bloques después de borrar sus reservas. La edición del bloque no puede dejar fuera o cambiar la comuna de sus citas vigentes.
- La cola tiene reintentos, bloqueo contra trabajadores simultáneos, estado de entrega y mensajes con identificador estable. SMTP no ofrece idempotencia garantizada: una caída tras enviar y antes de registrar el resultado puede producir un duplicado.

## Validaciones locales

```sh
python3 -m unittest discover -s tests -v
node tests/booking-ui.cjs
# Requiere Deno; no envía correos reales y sustituye SMTP por un doble de prueba.
deno test --allow-env --allow-read --import-map=tests/worker-import-map.json tests/booking-mailer.test.ts
deno check supabase/functions/booking-mailer/index.ts
```

Los tests PostgreSQL usan contenedores descartables, nunca producción. Los de navegador simulan la API. Las pruebas SMTP del worker simulan Zoho; los secretos, despliegue y aceptación real por Zoho deben verificarse por separado.

## Aplicar el alias de reservas a una instalación existente

1. Ejecutar solo `supabase/migrations/20261028_reservation_mail_alias.sql` (después de la migración de confirmaciones). Actualiza los avisos administrativos nuevos y pendientes; no modifica mensajes ya enviados ni las reservas.
2. Configurar `SMTP_USER=m.barahona@mbglowy.com`, `SMTP_FROM=reserva@mbglowy.com` y `SMTP_REPLY_TO=reserva@mbglowy.com` en los secretos de la función. Mantener la contraseña de aplicación de la cuenta principal exclusivamente en `SMTP_PASSWORD`.
3. Desplegar de nuevo `booking-mailer` e integrar/publicar el frontend. Probar con una reserva propia que Zoho acepta el alias y que una respuesta llega a la bandeja principal. Crear un alias no activa automáticamente SMTP ni los recordatorios.

## Si aparece “Could not find the function … in the schema cache”

La página nueva necesita las funciones de `20261028_confirmations_communes.sql`. La publicación de GitHub no ejecuta migraciones de Supabase. En una consulta nueva comprobar:

```sql
select
  to_regprocedure('public.expire_pending_bookings()') as vencimientos,
  to_regprocedure('public.book_slot(uuid,uuid,text,text,text,timestamptz,text,text)') as reservas;
```

Si alguno es `NULL`, revisar/aplicar la actualización completa `supabase/migrations/20261028_confirmations_communes.sql`. No ejecutar de nuevo `schema.sql`. Si la actualización informa un error, compartir ese error antes de intentar más cambios: la transacción revierte las modificaciones al fallar.

Si ambas funciones existen pero la API aún no las encuentra, recargar únicamente la caché:

```sql
notify pgrst, 'reload schema';
```

Esperar unos segundos y recargar la página. Los correos requieren la configuración SMTP y el worker descritos arriba; la migración por sí sola solo encola los envíos.

Prueba adicional del aviso de éxito y errores de versión: `node tests/booking-success.cjs` con servidor local en puerto 8003 (o `MB_BASE_URL`). El aviso debe aparecer después de guardar, incluso si falla la recarga, y nunca ante una reserva rechazada.

## Margen configurable entre atenciones

Ejecutar `supabase/migrations/20261028_booking_gap.sql` en una consulta nueva después de confirmaciones/comunas. No repetir el esquema inicial. Es idempotente y conserva las reservas existentes. En cada bloque la administradora puede elegir 10, 15, 20, 25 o 30 minutos libres entre citas (10 por defecto). Entre dos bloques se respeta el mayor margen. Al editar la preferencia no se mueven citas ya guardadas; las nuevas o editadas deben cumplirla.

Una atención que termina a las 12:00, con margen de 20 minutos, permite otra desde las 12:20. Las opciones de inicio siguen en pasos de cinco minutos: el margen es tiempo libre real, no el paso de la cuadrícula. La duración del tratamiento no cambia y siempre debe caber antes del cierre; no se exige una pausa adicional dentro del bloque después de la última cita. Cancelar o vencer una reserva libera su ocupación. No es necesario redesplegar el worker de correo.

Pruebas específicas: `python3 -m unittest discover -s tests -p test_booking_gap.py -v`.

## Ver el estado de los correos en administración

El resumen **Estado de los correos** aparece al inicio del panel. Cada tarjeta de reserva incluye **Correos de esta reserva**, con el aviso para la clienta y para administración, estado y fecha. Los recordatorios futuros aparecen como **Programado**; **Enviado** significa aceptado por Zoho. **Actualizar correos** consulta el progreso sin reiniciar formularios ni perder ediciones pendientes. El detalle completo está disponible mediante **Ver detalle de envíos**. Esta mejora es solo de frontend y no requiere SQL.

Prueba local: `MB_BASE_URL=http://127.0.0.1:8005 node tests/admin-mail-status.cjs` (servidor local y Playwright/Chromium disponibles).
