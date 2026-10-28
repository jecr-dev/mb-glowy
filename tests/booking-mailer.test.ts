import { deliveries, setFailure } from './fixtures/nodemailer-mock.ts';
import { bookingMail } from '../supabase/functions/booking-mailer/templates.mjs';
function assert(value: unknown, label = 'Assertion failed'): asserts value { if (!value) throw new Error(label); }
let handler: (request: Request) => Promise<Response>;
Object.defineProperty(Deno, 'serve', { value: (fn: typeof handler) => { handler = fn; return {}; } });
await import('../supabase/functions/booking-mailer/index.ts');
const payload = { name: '<img src=x onerror=alert(1)>', service: 'Facial', email: 'ana@example.com', phone: '123456789', address: 'Calle 123', commune: 'Ovalle', booking_id: 'booking', token: 'random-token', starts_at: '2099-01-06T15:00:00Z', ends_at: '2099-01-06T16:20:00Z', status: 'pending' };
Deno.test('plantillas: confirma con enlace, datos y ambos plazos; escapa HTML', () => {
  const mail = bookingMail({ kind: 'booked', payload }, 'https://mbglowy.com/app/');
  assert(mail.text.includes('3 horas antes'));
  assert(mail.text.includes('2 horas y 30 minutos'));
  assert(mail.text.includes('#confirm/random-token'));
  assert(mail.html.includes('&lt;img'));
  assert(!mail.html.includes('<img'));
  assert(mail.text.includes('Ovalle'));
  const confirmed = bookingMail({ kind: 'reminder', payload: { ...payload, status: 'confirmed' } }, 'https://mbglowy.com/app/');
  assert(!confirmed.text.includes('#confirm/'));
  const expired = bookingMail({ kind: 'unconfirmed', payload: { ...payload, status: 'unconfirmed' } }, 'https://mbglowy.com/app/');
  assert(expired.text.includes('tiempo quedó disponible'));
  assert(!expired.html.includes('#confirm/'));
});
Deno.test('worker: autentica, no usa el navegador y envía por SMTP con resultados en la cola', async () => {
  const secret = 'test-only-worker-secret-32-characters-long';
  for (const [k, v] of Object.entries({ MB_MAIL_WORKER_SECRET: secret, SMTP_USER: 'm.valenzuela@mbglowy.com', SMTP_PASSWORD: 'test-only', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' })) Deno.env.set(k, v);
  let calls = 0;
  const finished: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = String(input);
    if (url.endsWith('/claim_booking_emails')) return Response.json([{ id: 'job1', kind: 'booked', recipient: 'ana@example.com', payload }]);
    finished.push(JSON.parse(String(init?.body)));
    return Response.json(null);
  };
  try {
    assert((await handler(new Request('https://worker', { method: 'POST' }))).status === 401);
    assert(calls === 0);
    const request = () => new Request('https://worker', { method: 'POST', headers: { 'x-worker-secret': secret } });
    assert((await handler(request())).status === 200);
    assert(deliveries.length === 1);
    assert(deliveries[0].to === 'ana@example.com');
    assert(deliveries[0].messageId === '<job1@mbglowy.com>');
    assert(finished[0].p_success === true);
    setFailure(true);
    assert((await handler(request())).status === 200);
    assert(finished[1].p_success === false && finished[1].p_error === 'EAUTH');
    assert(!JSON.stringify(finished).includes('private SMTP detail'));
  } finally { globalThis.fetch = originalFetch; setFailure(false); }
});
