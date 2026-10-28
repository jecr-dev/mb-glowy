const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => new Date(value).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full', timeStyle: 'short' });
export function bookingMail(job, site) {
  const p = job.payload;
  const admin = job.kind.startsWith('admin_');
  const kind = job.kind.replace(/^admin_/, '');
  const titles = { booked: p.status === 'confirmed' ? 'Reserva recibida · confirmada' : 'Reserva recibida · por confirmar', updated: p.status === 'confirmed' ? 'Reserva modificada · confirmada' : 'Reserva modificada · confirma los nuevos datos', confirmed: 'Reserva confirmada', cancelled: 'Reserva cancelada', unconfirmed: 'Reserva no confirmada · horario liberado', reminder: p.status === 'confirmed' ? 'Recordatorio de tu atención · reserva confirmada' : 'Tu atención es en 5 horas · confirma tu reserva' };
  const title = (admin ? 'Aviso de agenda: ' : '') + (titles[kind] || 'Actualización de reserva');
  const details = `${p.service}${p.duration_minutes ? ` · ${p.duration_minutes} minutos` : ''}${p.price != null ? ` · ${Number(p.price).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })}` : ''}\nInicio: ${date(p.starts_at)}\nFin: ${date(p.ends_at)}\nComuna: ${p.commune}\nDirección: ${p.address}\nNombre: ${p.name}\nCorreo: ${p.email}\nTeléfono: ${p.phone}\nCódigo: ${p.booking_id}`;
  const deadline = date(new Date(new Date(p.starts_at).getTime() - 3 * 3600000));
  const cutoff = date(new Date(new Date(p.starts_at).getTime() - 150 * 60000));
  const pending = p.status === 'pending' && !['cancelled', 'unconfirmed'].includes(kind);
  const url = new URL(site);
  if (url.protocol !== 'https:') throw new Error('PUBLIC_SITE_URL must use HTTPS');
  url.hash = 'confirm/' + p.token;
  const instructions = kind === 'unconfirmed'
    ? 'La reserva no fue confirmada dentro del plazo y su tiempo quedó disponible. Este enlace ya no permite confirmar. Contacta con MB Glowy para una nueva atención.'
    : kind === 'cancelled' ? 'La reserva fue cancelada. El enlace de confirmación ya no es válido.'
    : pending ? `Confirma al menos 3 horas antes, hasta ${deadline}. El plazo final de gracia termina a las ${cutoff}; si faltan menos de 2 horas y 30 minutos para la cita, se rechazará la confirmación y el tiempo se liberará.`
    : 'Tu reserva está confirmada. Para cambios, contacta con MB Glowy.';
  const action = admin ? `Administración: ${new URL('#admin', site)}` : pending ? `Confirmar asistencia: ${url}` : '';
  // Copia íntegra de las condiciones aceptadas en el correo inicial, sin depender de un enlace modificable.
  const legalDocs = !admin && kind === 'booked' && Array.isArray(p.legal_documents) ? p.legal_documents : [];
  const legalHtml = legalDocs.map(d => {
    const body = String(d.content).match(/<main>([\s\S]*?)<\/main>/)?.[1] || escape(d.content);
    return `<section>${body.replace(/href="([^"]+)"/g, (_, href) => `href="${escape(new URL(href, new URL(d.url || '/legal/2026-10-28/', site)).href)}"`)}</section>`;
  }).join('');
  const legalText = legalDocs.map(d => String(d.content).match(/<main>([\s\S]*?)<\/main>/)?.[1] || String(d.content)).join('\n\n').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const receipt = legalDocs.length ? `\n\nAceptaciones: ${p.legal_receipt} · Versión: ${p.legal_version}\n${legalText}` : '';
  const text = `${title}\n\n${details}\n\n${instructions}\n\n${action}\n\nMB Glowy · reserva@mbglowy.com${receipt}`;
  const html = `<div style="background:#F3E8DF;color:#4A352F;padding:28px;font-family:Arial,sans-serif;max-width:600px;margin:auto"><h1 style="font-family:Georgia,serif">MB Glowy</h1><h2>${escape(title)}</h2><p style="white-space:pre-line">${escape(details)}</p><p>${escape(instructions)}</p>${action ? `<p><a style="display:inline-block;background:#8F6E65;color:#fff;padding:14px 22px;border-radius:24px" href="${escape(admin ? new URL('#admin', site) : url)}">${admin ? 'Ver administración' : 'Confirmar mi asistencia'}</a></p>` : ''}<p>reserva@mbglowy.com</p>${legalDocs.length ? `<hr><p>Aceptaciones: ${escape(p.legal_receipt)} · Versión: ${escape(p.legal_version)}</p>${legalHtml}` : ''}</div>`;
  return { subject: title, text, html };
}
