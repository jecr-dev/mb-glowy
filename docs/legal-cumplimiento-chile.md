# Revisión de privacidad y contratación · Chile

Estado: **preparado para revisión, no publicado**. Falta identificar al responsable. No ejecutar la migración ni fusionar esta rama antes de completar esa identificación: `ready=false` impide nuevas aceptaciones y reservas. No es una certificación legal.

## Datos confirmados por la titular

- Operación solo en Chile; la SIC es colombiana y no se presenta como autoridad chilena.
- No se reciben pagos web ni anticipos.
- Contacto operativo de reservas: reserva@mbglowy.com. Correo principal conocido: m.barahona@mbglowy.com. Falta confirmar el correo para derechos de privacidad.
- Faltan nombre legal/razón social, RUT del negocio si corresponde y domicilio comercial/de contacto.

## Marco que debe verificarse

Fuentes oficiales de referencia: [LeyChile / Biblioteca del Congreso Nacional](https://www.bcn.cl/leychile/) y [SERNAC](https://www.sernac.cl/). La consulta HTTP a BCN devolvió 403 del proxy del entorno el 28-10-2026. **No se pudo contrastar el texto consolidado vigente ni las orientaciones oficiales en línea.** Las referencias siguientes se basan en conocimiento normativo y requieren contraste antes de presentar el trabajo como revisión jurídica cerrada.

| Norma | Aspecto a revisar | Tratamiento en el cambio |
| --- | --- | --- |
| Ley 19.496, en particular arts. 3 bis, 12 A, 16 y 30 y normas aplicables al servicio | Información previa, precios totales, contratación a distancia, retracto, cláusulas abusivas y confirmación | Condiciones accesibles, precios en CLP, sin exclusión general de retracto ni penalidad automática. Copia de los textos aceptados en el correo inicial. Falta verificar la información y práctica comercial real. |
| Reglamento de Comercio Electrónico, Decreto 6 de 2021 del Ministerio de Economía | Identidad y contacto del proveedor, características, costos y condiciones antes de contratar | Formularios y políticas enlazados; identificación pendiente. La titular debe confirmar que los precios son totales y no existen cobros de traslado no informados. |
| Ley 19.628 | Finalidad, autorización informada, confidencialidad, acceso, rectificación y eliminación/bloqueo | Casilla separada, evidencia restringida, política y procedimiento de derechos. No se solicitan antecedentes clínicos en formularios. |
| Ley 19.799 | Documentos y manifestaciones electrónicas | Evidencia de envío de casillas con textos versionados. No se ofrece firma avanzada ni identidad civil verificada. |
| Ley 21.719 | Reforma de datos personales, derechos, seguridad, transferencias, nueva institucionalidad | Entrada en vigor prevista para 01-12-2026: revisar adaptación antes de esa fecha. Este cambio por sí solo no implementa todas sus obligaciones organizativas. |
| Normativa sanitaria y habilitación profesional aplicable a cada procedimiento | Contraindicaciones, consentimiento informado clínico y autorizaciones | No se sustituye por las casillas web. Requiere revisión del catálogo real, habilitación y operación de la profesional. |

## Auditoría del código

No se detectaron cookies propias, analítica, píxeles, marketing ni almacenamiento local publicitario. Se retiró la carga de Google Fonts para evitar una conexión externa innecesaria. `sessionStorage.mb-token` contiene la sesión administrativa; Cache Storage conserva archivos estáticos de la PWA. La lista del service worker excluye configuración, API y datos personales. No se incorpora un banner de consentimiento opcional para almacenamiento exclusivamente necesario. Debe repetirse la auditoría si se agregan herramientas, anuncios, mapas, videos o métricas. Esto no es un análisis de los registros internos de los proveedores.

## Evidencia y límites

- Cada formulario contiene dos casillas obligatorias y sin premarcar: términos (que incluyen reembolsos) y privacidad. Incluye también login, servicios, disponibilidad y edición administrativa por solicitud de la titular. Esas aceptaciones administrativas no representan a las clientas.
- La API de reservas exige ambas aceptaciones y la versión vigente habilitada. La ruta anterior pierde sus permisos públicos; no se puede omitir el consentimiento usando la firma anterior.
- Reserva y evidencia se confirman en una sola transacción. Una reserva rechazada no deja una falsa aceptación de reserva exitosa.
- La fecha procede de PostgreSQL, no del reloj del dispositivo. Se conservan correo declarado, fuente, método, versión y fotografía comercial de tratamiento/precio/fecha/comuna. No se recogen IP ni huellas del navegador.
- `legal_documents` conserva el HTML completo de las cuatro políticas y SHA-256 verificado contra el contenido. `legal_acceptances` conserva el evento y referencias aun si se elimina la reserva. RLS y permisos impiden lectura pública y modificación desde la aplicación.
- **No es una prueba absoluta de identidad ni un registro inviolable.** Un correo declarado puede ser suplantado; el propietario de PostgreSQL puede alterar sus controles. Las huellas permiten contrastar copias, no acreditan por sí mismas una fecha externa. Guardar exportaciones con acceso restringido, respaldos y, si se necesita mayor fuerza probatoria, un servicio de sellado temporal o custodia independiente.
- No se atribuyen aceptaciones retroactivas a reservas anteriores. No se marca publicidad como aceptada.
- Exportación desde administración: **Exportar aceptaciones**, JSON con eventos y copias de documentos. Contiene datos personales; no compartirlo públicamente ni por enlaces abiertos. La fecha de exportación es del dispositivo y se distingue de las fechas de aceptación del servidor.
- El formulario de contacto registra aceptación y luego ofrece abrir el correo. No afirma haber enviado un correo: la persona aún debe pulsar Enviar en su programa. La evidencia no significa que la consulta llegó al negocio. No guarda el contenido del mensaje en Supabase.

## Puesta en marcha, una vez identificada la titular

1. Completar `legal/responsable.json`, revisar los textos y poner `ready=true` solamente con información real. Ejecutar `python3 scripts/build_legal_documents.py` y `python3 scripts/build_legal_migration.py`. Revisar el resultado. Estas herramientas son para preparar esta versión antes de su primera publicación; nunca regenerar una versión ya aceptada.
2. En Supabase, SQL Editor, query nueva: ejecutar `supabase/migrations/20261028_legal_consent.sql`. No volver a ejecutar `schema.sql`. La migración añade tablas/funciones y revoca la ruta vieja; no borra reservas.
3. Actualizar `templates.mjs` en la función `booking-mailer` y volver a desplegarla para incluir copia íntegra de las políticas en el primer correo de reserva. Mantener los secretos SMTP y el cron existentes; no cambiarlos.
4. Fusionar/publicar la rama de la web y recargar. La web anterior dejará de reservar con la ruta vieja al aplicar la migración: coordinar ambos pasos en una ventana corta de mantenimiento.
5. Probar una consulta, una reserva, correo inicial con copia de las condiciones, confirmación, cancelación y exportación. Contrastar las huellas del JSON con los archivos archivados. No probar con datos de clientas reales sin necesidad.

## Procedimiento organizativo pendiente de la titular

Antes de afirmar cumplimiento, verificar identidad y contactos públicos; precios finales e impuestos; emisión de comprobantes y obligaciones tributarias; autorizaciones y alcance de cada tratamiento; tratamiento de menores y datos de salud fuera del sitio; contratos de encargado y región efectiva de Supabase, Zoho y GitHub; transferencias internacionales; gestión de cuentas/MFA y acceso de personal; respuesta a incidentes; y canal de ejercicio de derechos. No sustituir evaluación clínica por aceptar políticas.

Registrar las solicitudes de privacidad recibidas, fecha, alcance, verificación proporcional de identidad, decisión y respuesta. Aplicar los plazos legales vigentes una vez contrastados, no inventar un plazo único para todo. Revisar conservación al menos anualmente: justificar para qué se mantiene cada conjunto de datos y suprimir/anonimizar lo que ya no haga falta, considerando responsabilidades, reclamos abiertos, buzones y respaldos.

Las aceptaciones no se borran desde la web. Una solicitud legalmente procedente de supresión exige un procedimiento supervisado del propietario de la base de datos, acotado a las filas necesarias, dejando registro de motivo/alcance sin retener innecesariamente los datos suprimidos. No dar acceso `service_role` al navegador ni deshabilitar globalmente RLS.

Para nuevas políticas: crear otra carpeta/versión, conservar las anteriores, insertar nuevos documentos y activar la nueva versión con una migración revisada; actualizar enlaces de la interfaz y la versión esperada. No cambiar la información histórica aceptada.
