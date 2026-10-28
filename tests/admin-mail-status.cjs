const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  const page=await context.newPage();let delivered=false,pages=[];
  await page.addInitScript(()=>sessionStorage.setItem('mb-token','test-admin'));
  await page.route('**/app/config.js',r=>r.fulfill({contentType:'application/javascript',body:'window.MB_CONFIG={url:"https://test.supabase.co",anonKey:"public-test"};'}));
  await page.route('https://test.supabase.co/**',r=>{
   const url=new URL(r.request().url()),path=url.pathname;let data=[];
   if(path.endsWith('/admins'))data=[{user_id:'admin'}];
   if(path.endsWith('/bookings'))data=[{id:'booking1',slot_id:'slot',customer_name:'Ana Prueba',customer_email:'ana@example.com',customer_phone:'123456789',customer_address:'Calle Prueba 123',commune:'Ovalle',starts_at:'2099-01-06T12:00:00Z',ends_at:'2099-01-06T13:00:00Z',status:'cancelled',services:{name:'Facial'}}];
   if(path.endsWith('/booking_email_jobs')){
    const offset=Number(url.searchParams.get('offset'));pages.push(offset);
    data=offset===0?Array.from({length:200},(_,i)=>({id:'reminder'+i,booking_id:'other',kind:'reminder',state:'pending',attempts:0,due_at:'2099-01-01T10:00:00Z'})):[{id:'customer',booking_id:'booking1',kind:'cancelled',state:delivered?'sent':'sending',attempts:1,due_at:'2026-10-28T03:06:00Z',sent_at:delivered?'2026-10-28T03:07:00Z':null},{id:'admin',booking_id:'booking1',kind:'admin_cancelled',state:'sent',attempts:1,due_at:'2026-10-28T03:06:00Z',sent_at:'2026-10-28T03:06:10Z'}];
   }
   return r.fulfill({json:data});
  });
  await page.goto((process.env.MB_BASE_URL||'http://127.0.0.1:8005')+'/app/#admin');
  const emails=page.locator('[data-mail-booking="booking1"]');
  await emails.getByText('Enviando',{exact:true}).waitFor();
  await emails.getByText('Enviado',{exact:true}).waitFor();
  assert.deepEqual(pages,[0,200]);
  await page.getByRole('heading',{name:'Estado de los correos',exact:true}).waitFor();
  assert.match(await page.locator('#mail-summary').innerText(),/Programado: 200/);
  await page.locator('#service [name=name]').fill('Edición sin guardar');
  delivered=true;
  await page.getByRole('button',{name:'Actualizar correos',exact:true}).click();
  await page.locator('#mail-updated').filter({hasText:'Correos actualizados'}).waitFor();
  assert.equal(await emails.getByText('Enviado',{exact:true}).count(),2);
  assert.equal(await page.locator('#service [name=name]').inputValue(),'Edición sin guardar');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS: estados visibles por reserva, paginación más de 200 correos, refresco de Enviando a Enviado sin perder ediciones y diseño móvil.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
