import nodemailer from 'npm:nodemailer@10.2.1';
import { bookingMail } from './templates.mjs';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function sameSecret(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  const left = new Uint8Array(x), right = new Uint8Array(y);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('MB_MAIL_WORKER_SECRET');
  if (!secret || secret.length < 32) return json({ error: 'Worker not configured' }, 503);
  if (!await sameSecret(request.headers.get('x-worker-secret') || '', secret)) return json({ error: 'Unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const host = Deno.env.get('SMTP_HOST') || 'smtp.zoho.com';
  const port = Number(Deno.env.get('SMTP_PORT') || '465');
  const user = Deno.env.get('SMTP_USER'), pass = Deno.env.get('SMTP_PASSWORD');
  const site = Deno.env.get('PUBLIC_SITE_URL') || 'https://mbglowy.com/app/';
  if (!url || !key || !user || !pass || ![465, 587].includes(port) || !/^smtp(?:pro)?\.zoho\.(com|eu|in|com\.au|jp|ca|sa|com\.cn)$/.test(host)) return json({ error: 'Zoho SMTP configuration missing or invalid' }, 503);
  async function rpc(name: string, body: unknown) {
    const response = await fetch(url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: key!, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('DATABASE_OPERATION_FAILED');
    return await response.json();
  }
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: true, auth: { user, pass }, tls: { rejectUnauthorized: true }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000 });
  try {
    const jobs = await rpc('claim_booking_emails', { p_limit: 5 });
    let sent = 0, failed = 0;
    for (const job of jobs) {
      try {
        const mail = bookingMail(job, site);
        const result = await transport.sendMail({ from: { name: 'MB Glowy', address: user }, to: job.recipient, messageId: `<${job.id}@mbglowy.com>`, ...mail });
        if (!result.accepted?.length) throw new Error('SMTP_RECIPIENT_REJECTED');
        await rpc('finish_booking_email', { p_id: job.id, p_success: true });
        sent++;
      } catch (error) {
        // No registrar mensajes SMTP: pueden contener direcciones o credenciales.
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code).slice(0, 40) : 'MAIL_SEND_FAILED';
        await rpc('finish_booking_email', { p_id: job.id, p_success: false, p_error: code });
        failed++;
      }
    }
    return json({ sent, failed });
  } catch {
    return json({ error: 'Mail worker failed' }, 502);
  } finally {
    transport.close();
  }
});
