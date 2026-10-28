# MB Glowy · Web y PWA de agenda

Sitio estático sin compilación. Servir el repositorio con `python3 -m http.server 8000`.
Página pública `/`; reservas y PWA `/app/`; administración `/app/#admin`.

## Nueva versión: confirmación, comunas y Zoho

La instalación actual requiere además `supabase/migrations/20261028_confirmations_communes.sql`, después de la actualización por duración. La configuración de SMTP, secretos, Edge Function, cron, reglas y pruebas reales está en [docs/zoho-setup.md](docs/zoho-setup.md). El correo no queda activo por publicar los archivos: requiere SMTP habilitado en la cuenta Zoho, sin contratar un servicio de pago.

## Activación con Supabase

1. Crear un proyecto en https://supabase.com/dashboard con una región apropiada para Chile. Mantener la contraseña de la base de datos privada.
2. Ejecutar `supabase/schema.sql` en SQL Editor de un proyecto **nuevo**. El archivo crea tablas, políticas RLS y funciones; no es una migración idempotente para proyectos existentes. Después ejecutar `supabase/migrations/20261027_booking_durations.sql` para activar las citas por duración. En proyectos existentes ejecutar **solo la migración**, sin repetir `schema.sql`.
3. En Authentication → Users, crear la cuenta de la administradora con su correo. Establecer su contraseña por un canal seguro. Desactivar el registro público si no se necesita: las clientas reservan sin crear cuenta.
4. Copiar el UUID de la administradora y ejecutar en SQL Editor:
   ```sql
   insert into public.admins(user_id) values ('UUID-DE-LA-ADMINISTRADORA');
   ```
   Crear una cuenta por sí solo no concede privilegios. Solo el propietario del proyecto debe asignar administradoras.
5. En `app/config.js`, completar `url` con la URL HTTPS del proyecto y `anonKey` con la clave pública **anon** de Supabase (Project Settings → API/API Keys). Esta clave es pública y la protección depende de RLS. Nunca colocar una clave `service_role`, contraseña o clave secreta en el sitio.
6. Publicar los archivos por HTTPS, por ejemplo en el alojamiento estático actual. Permitir conexión al dominio exacto del proyecto `PROYECTO.supabase.co` en la configuración de red del entorno de desarrollo si está restringido. El sitio publicado debe poder acceder al mismo destino.
7. Entrar en `/app/#admin`, crear servicios y abrir horarios. Cada horario es un bloque de disponibilidad que admite varias citas consecutivas. Cada reserva ocupa la duración del tratamiento (por ejemplo, 300 minutos para 5 horas). Solo se ofrecen inicios cada 5 minutos donde cabe la cita completa, sin solapamientos. Las horas introducidas usan la zona horaria del dispositivo; los listados muestran America/Santiago.
8. Desde otro navegador, reservar un cupo y verificar el nombre, correo y teléfono en el panel. Verificar que solo el intervalo reservado desaparece y que se puede usar el tiempo restante si cabe otra cita; cancelar para liberar ese intervalo. Intentar reservar simultáneamente el mismo cupo: solo una operación debe confirmarse. Validar que una cuenta sin rol no accede a las reservas ni las modifica.

## Administración en dashboard

El panel `/app/#admin` abre directamente en reservas y ofrece navegación por secciones, contadores, filtros y listas paginadas. Los formularios se abren en ventanas. Está adaptado a escritorio, tablet y móvil, con estados de correo en el detalle de cada reserva. Este cambio visual no requiere migraciones SQL ni redesplegar la función de correo.

## Agenda visual para clientas

Después de seleccionar un tratamiento, el calendario mensual marca únicamente los días con disponibilidad. Cada opción muestra inicio y fin completos, con un resumen de fecha, día de la semana y duración. Se muestran doce opciones a la vez y se pueden ampliar con “Ver más horarios”. Cambiar de día o tratamiento borra la selección anterior; todas las fechas usan America/Santiago. No requiere nuevas tablas ni migraciones adicionales a la actualización por duración.

## Instalar en iPhone

Abrir `https://TU-DOMINIO/app/` en Safari → Compartir → Añadir a pantalla de inicio. También se usa directamente desde el navegador. Los procesos de desarrollo no necesitan ejecutarse para el sitio publicado. No es una app de App Store.

## Comportamiento y límites

- Añadir, modificar y eliminar servicios. Un servicio con historial de reservas se oculta en lugar de eliminar los datos históricos; se puede volver a activar editándolo.
- Horarios sin solapamientos para una sola profesional/agenda. La duración completa del tratamiento debe caber en el tiempo libre del bloque, sin cruzar otras citas ni el cierre. Se admiten duraciones de 5 a 480 minutos, incluidas las citas de 5 horas (300 minutos). Las reservas guardan su inicio y fin: editar después la duración del servicio no mueve citas anteriores.
- Acceso administrativo con Supabase Auth; sesión limitada a la pestaña. Cuando caduca, se solicita iniciar sesión de nuevo. No se implementa recuperación de contraseña en esta interfaz: se gestiona desde Supabase.
- Los datos personales se consultan solo con rol administrativo. No se guardan en el caché del service worker. El shell puede abrir sin conexión, pero para consultar o reservar se requiere internet.
- Confirmación en pantalla con código; la nueva versión encola correos y recordatorios de confirmación mediante Zoho SMTP cuando se configura el worker. No hay pagos ni notificaciones push.
- Una restricción de exclusión de intervalos en PostgreSQL y el bloqueo de fila impiden reservas que se solapen, incluso entre peticiones simultáneas. El final de una cita puede coincidir con el inicio de la siguiente. Las funciones públicas no devuelven nombres ni datos de contacto.
- Antes de un lanzamiento abierto, definir política de privacidad y retención, canal para cancelaciones y protección antiabuso de reservas (por ejemplo, CAPTCHA validado en una función de servidor y límites por cliente). La versión actual no incluye protección contra reservas automatizadas.

## Validación

Comprobaciones de sintaxis: `node --check app/app.js` y `node --check app/sw.js`.
La conexión real, políticas y concurrencia necesitan ejecutar el esquema en Supabase y completar las comprobaciones del paso 8. Sin configuración, se muestra agenda en preparación sin simular disponibilidad ni guardar reservas locales.

## Actualizar una agenda ya existente a reservas por duración

1. Ejecutar **solo** `supabase/migrations/20261027_booking_durations.sql` en SQL Editor. Es transaccional e idempotente; no borrar tablas ni ejecutar de nuevo el esquema inicial.
2. Publicar el frontend de esta misma versión inmediatamente después. La ruta antigua sin hora de inicio se elimina para impedir reservas ambiguas; las pestañas antiguas deben recargarse.
3. Las reservas creadas con la versión anterior conservan la ocupación del **bloque completo**. No se puede reconstruir otra hora real a partir de los datos anteriores. Para reducir esa ocupación, confirmar con la clienta, cancelar y crear de nuevo con su hora correcta. Las citas nuevas usan la duración exacta del servicio.
4. Probar una disponibilidad de seis horas con un servicio de 300 minutos: la cita reserva cinco horas y solo queda una hora para otro tratamiento. Un servicio de más de una hora ya no cabe; al reservar esa última hora, no queda disponibilidad.

Pruebas de integración locales, en un PostgreSQL 17 descartable y sin datos de producción:

```sh
python3 -m unittest discover -s tests -v
```

Requieren Docker y descargan la imagen oficial `postgres:17` si no existe. Verifican límites, duración de cinco horas, tiempo restante, cancelación, concurrencia, migración de reservas anteriores y permisos. La publicación y ejecución en Supabase se verifican por separado.

Prueba de interfaz con API simulada: con un servidor local en puerto 8000 y Playwright/Chromium disponibles, ejecutar `node tests/booking-ui.cjs`. `MB_BASE_URL` y `CHROMIUM_PATH` permiten cambiar servidor y navegador.
