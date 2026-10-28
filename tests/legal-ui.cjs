const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();let calls=[],ready=true;
 await page.route('**/app/config.js',r=>r.fulfill({contentType:'application/javascript',body:'window.MB_CONFIG={url:"https://test.supabase.co",anonKey:"public-test"};'}));
 await page.route('https://test.supabase.co/**',r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/legal_bundle'))return r.fulfill({json:{ready,version:'2026-10-28.v1'}});
  if(path.endsWith('/services'))return r.fulfill({json:[{id:'service',name:'Facial',duration_minutes:60,price:10000}]});
  if(path.endsWith('/available_slots'))return r.fulfill({json:[{slot_id:'slot',service_id:'service',starts_at:'2099-01-06T12:00:00Z',ends_at:'2099-01-06T13:00:00Z'}]});
  if(path.endsWith('/book_slot')||path.endsWith('/contact_legal_acceptance')){calls.push({path,body:r.request().postDataJSON()});return r.fulfill({json:'acceptance-receipt'});}
  return r.fulfill({json:[]});
 });
 const base=process.env.MB_BASE_URL||'http://127.0.0.1:8013';
 await page.goto(base+'/app/');
 await page.locator('[name=service_id]').selectOption('service');await page.locator('[name=customer_commune]').selectOption('Ovalle');await page.locator('.time-option').first().click();
 for(const [name,value] of Object.entries({customer_name:'Ana Prueba',customer_email:'ana@example.com',customer_phone:'123456789',customer_address:'Calle Prueba 123'}))await page.locator(`[name=${name}]`).fill(value);
 await page.locator('[name=terms_accepted]:enabled').waitFor();
 assert.equal(await page.locator('.legal-consent input:checked').count(),0);
 assert.equal(await page.locator('.legal-consent input[required]').count(),2);
 assert.equal(await page.locator('.legal-consent a[target=_blank]').count(),3);
 await page.locator('[name=terms_accepted]').check();await page.getByRole('button',{name:'Reservar · por confirmar',exact:true}).click();assert.equal(calls.length,0);
 await page.locator('[name=privacy_accepted]').check();await page.getByRole('button',{name:'Reservar · por confirmar',exact:true}).click();await page.locator('#booking-success').waitFor();
 assert.equal(calls.length,1);assert.equal(calls[0].body.terms_accepted,true);assert.equal(calls[0].body.privacy_accepted,true);assert.equal(calls[0].body.legal_version,'2026-10-28.v1');assert.ok(!('accepted_at' in calls[0].body));
 await page.goto(base+'/');await page.locator('#contact-form [name=nombre]').fill('Ana');await page.locator('#contact-form [name=correo]').fill('ana@example.com');
 await page.locator('[name=terms_accepted]').check();await page.locator('[name=privacy_accepted]').check();await page.locator('#contact-form button[type=submit]').click();await page.locator('#contact-status a[href^="mailto:"]').waitFor();assert.equal(calls.length,2);assert.match(await page.locator('#contact-status').innerText(),/todavía no se ha enviado/);assert.deepEqual(Object.keys(calls[1].body).sort(),['p_email','p_privacy','p_terms','p_version']);
 ready=false;await page.reload();await page.locator('.legal-form-status').filter({hasText:'aún no están habilitados'}).waitFor();assert.equal(await page.locator('.legal-consent input:disabled').count(),2);
 console.log('PASS: dos casillas separadas sin premarcar, enlaces, bloqueo de envíos incompletos, evidencia sin hora del cliente, contacto con recibo y bloqueo de borradores.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
