# MB Glowy · Web y PWA de agenda

Sitio estático sin compilación. Servir el repositorio con `python3 -m http.server 8000`.
Página pública `/`; reservas y PWA `/app/`; administración `/app/#admin`.

## Activación con Supabase

1. Crear un proyecto en https://supabase.com/dashboard con una región apropiada para Chile. Mantener la contraseña de la base de datos privada.
2. Ejecutar `supabase/schema.sql` en SQL Editor de un proyecto **nuevo**. El archivo crea tablas, políticas RLS y funciones; no es una migración idempotente para proyectos existentes.
3. En Authentication → Users, crear la cuenta de la administradora con su correo. Establecer su contraseña por un canal seguro. Desactivar el registro público si no se necesita: las clientas reservan sin crear cuenta.
4. Copiar el UUID de la administradora y ejecutar en SQL Editor:
   ```sql
   insert into public.admins(user_id) values ('UUID-DE-LA-ADMINISTRADORA');
   ```
   Crear una cuenta por sí solo no concede privilegios. Solo el propietario del proyecto debe asignar administradoras.
5. En `app/config.js`, completar `url` con la URL HTTPS del proyecto y `anonKey` con la clave pública **anon** de Supabase (Project Settings → API/API Keys). Esta clave es pública y la protección depende de RLS. Nunca colocar una clave `service_role`, contraseña o clave secreta en el sitio.
6. Publicar los archivos por HTTPS, por ejemplo en el alojamiento estático actual. Permitir conexión al dominio exacto del proyecto `PROYECTO.supabase.co` en la configuración de red del entorno de desarrollo si está restringido. El sitio publicado debe poder acceder al mismo destino.
7. Entrar en `/app/#admin`, crear servicios y abrir horarios. Cada horario es un cupo; admite varios tratamientos elegibles, pero solo una reserva. Las horas introducidas usan la zona horaria del dispositivo; los listados muestran America/Santiago.
8. Desde otro navegador, reservar un cupo y verificar el nombre, correo y teléfono en el panel. Verificar que el cupo desaparece; cancelar para liberarlo. Intentar reservar simultáneamente el mismo cupo: solo una operación debe confirmarse. Validar que una cuenta sin rol no accede a las reservas ni las modifica.

## Instalar en iPhone

Abrir `https://TU-DOMINIO/app/` en Safari → Compartir → Añadir a pantalla de inicio. También se usa directamente desde el navegador. Los procesos de desarrollo no necesitan ejecutarse para el sitio publicado. No es una app de App Store.

## Comportamiento y límites

- Añadir, modificar y eliminar servicios. Un servicio con historial de reservas se oculta en lugar de eliminar los datos históricos; se puede volver a activar editándolo.
- Horarios sin solapamientos para una sola profesional/agenda. La duración del tratamiento debe caber en el cupo. Se reserva el cupo completo.
- Acceso administrativo con Supabase Auth; sesión limitada a la pestaña. Cuando caduca, cerrar sesión e ingresar de nuevo. No se implementa recuperación de contraseña en esta interfaz: se gestiona desde Supabase.
- Los datos personales se consultan solo con rol administrativo. No se guardan en el caché del service worker. El shell puede abrir sin conexión, pero para consultar o reservar se requiere internet.
- Confirmación en pantalla con código; no hay correos, pagos, recordatorios, reagendamiento automático ni notificaciones push.
- La restricción única en PostgreSQL y el bloqueo de fila impiden reservar dos veces el mismo cupo. Las funciones públicas no devuelven nombres ni datos de contacto.
- Antes de un lanzamiento abierto, definir política de privacidad y retención, canal para cancelaciones y protección antiabuso de reservas (por ejemplo, CAPTCHA validado en una función de servidor y límites por cliente). La versión actual no incluye protección contra reservas automatizadas.

## Validación

Comprobaciones de sintaxis: `node --check app/app.js` y `node --check app/sw.js`.
La conexión real, políticas y concurrencia necesitan ejecutar el esquema en Supabase y completar las comprobaciones del paso 8. Sin configuración, se muestra agenda en preparación sin simular disponibilidad ni guardar reservas locales.
