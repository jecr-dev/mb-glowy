// Run against local server with Playwright available: node tests/booking-ui.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/app/config.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.MB_CONFIG={url:"https://test.supabase.co",anonKey:"public-test"};' }));
    const services = [
      { id: 'long', name: 'Tratamiento de cinco horas', description: 'Duración completa', duration_minutes: 300, price: 50000, active: true },
      { id: 'short', name: 'Facial', duration_minutes: 60, price: 20000, active: true }
    ];
    let available = [{ slot_id: 'block', service_id: 'long', starts_at: '2099-01-06T10:00:00Z', ends_at: '2099-01-06T15:00:00Z' }];
    let bookingBody;
    await page.route('https://test.supabase.co/**', async r => {
      const path = new URL(r.request().url()).pathname;
      let data = [];
      if (path.endsWith('/services')) data = services;
      if (path.endsWith('/available_slots')) data = available;
      if (path.endsWith('/book_slot')) {
        bookingBody = r.request().postDataJSON();
        available = [];
        data = 'booking-confirmed';
      }
      if (path.endsWith('/token')) data = { access_token: 'admin-token' };
      if (path.endsWith('/admins')) data = [{ user_id: 'admin' }];
      if (path.endsWith('/slots')) data = [{ id: 'block', starts_at: '2099-01-06T10:00:00Z', ends_at: '2099-01-06T16:00:00Z', blocked: false }];
      if (path.endsWith('/bookings')) data = [{ id: 'booking-confirmed', slot_id: 'block', customer_name: 'Ana Prueba', customer_email: 'ana@example.com', customer_phone: '123456789', starts_at: '2099-01-06T10:00:00Z', ends_at: '2099-01-06T15:00:00Z', status: 'confirmed', services: { name: services[0].name } }];
      await r.fulfill({ json: data });
    });
    await page.goto((process.env.MB_BASE_URL || 'http://127.0.0.1:8000') + '/app/', { waitUntil: 'domcontentloaded' });
    await page.locator('[name=service_id]').selectOption('long');
    await page.locator('[name=slot_choice]').selectOption('block|2099-01-06T10:00:00Z');
    assert.match(await page.locator('[name=slot_choice] option:checked').innerText(), /→/);
    await page.locator('[name=customer_name]').fill('Ana Prueba');
    await page.locator('[name=customer_email]').fill('ana@example.com');
    await page.locator('[name=customer_phone]').fill('123456789');
    await page.locator('#booking input[type=checkbox]').check();
    await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Reserva confirmada.' }).waitFor();
    assert.equal(bookingBody.appointment_start, '2099-01-06T10:00:00Z');
    assert.equal(bookingBody.slot_id, 'block');
    assert.equal(bookingBody.service_id, 'long');
    assert.ok(!('slot_choice' in bookingBody));
    await page.locator('[name=service_id]').selectOption('long');
    assert.equal(await page.locator('[name=slot_choice]').innerText(), 'Sin horarios disponibles');
    await page.getByRole('link', { name: 'Administración', exact: true }).click();
    await page.locator('#login [name=email]').fill('admin@example.com');
    await page.locator('#login [name=password]').fill('test-password');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await page.getByRole('heading', { name: 'Reservas', exact: true }).waitFor();
    await page.getByText('60 min sin reservar', { exact: false }).waitFor();
    assert.ok((await page.getByRole('heading', { name: 'Ana Prueba' }).locator('..').innerText()).includes('→'));
    assert.deepEqual(errors, []);
    console.log('PASS: reserva de 300 minutos envía inicio exacto, se actualizan opciones y el panel muestra una hora restante e intervalo reservado (API simulada).');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
