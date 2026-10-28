// Verifica que una reserva guardada se anuncie aunque falle la recarga posterior.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  for(const scenario of ['normal','refresh-failure','missing-schema']){
   const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
   let saved=false,calls=0;
   await page.route('**/app/config.js',r=>r.fulfill({contentType:'application/javascript',body:'window.MB_CONFIG={url:"https://test.supabase.co",anonKey:"public-test"};'}));
   await page.route('https://test.supabase.co/**',r=>{
    const path=new URL(r.request().url()).pathname;
    if(path.endsWith('/legal_bundle'))return r.fulfill({json:{ready:true,version:'2026-10-28.v1'}});
    if(saved&&scenario==='refresh-failure')return r.fulfill({status:500,json:{message:'Refresh failed'}});
    if(path.endsWith('/services'))return r.fulfill({json:[{id:'service',name:'Facial',duration_minutes:60,price:10000}]});
    if(path.endsWith('/available_slots'))return r.fulfill({json:[{slot_id:'slot',service_id:'service',starts_at:'2099-01-06T12:00:00Z',ends_at:'2099-01-06T13:00:00Z'}]});
    if(path.endsWith('/book_slot')){
     calls++;
     if(scenario==='missing-schema')return r.fulfill({status:404,json:{code:'PGRST202',message:'Function missing'}});
     saved=true;return r.fulfill({json:'test-booking'});
    }
    return r.fulfill({json:[]});
   });
   await page.goto((process.env.MB_BASE_URL||'http://127.0.0.1:8003')+'/app/');
   await page.locator('[name=service_id]').selectOption('service');
   await page.locator('[name=customer_commune]').selectOption('Ovalle');
   await page.locator('.time-option').first().click();
   for(const [name,value] of Object.entries({customer_name:'Ana Prueba',customer_email:'ana@example.com',customer_phone:'123456789',customer_address:'Calle Prueba 123'}))await page.locator(`[name=${name}]`).fill(value);
   await page.locator('#booking [name=terms_accepted]').check();await page.locator('#booking [name=privacy_accepted]').check();
   await page.getByRole('button',{name:'Reservar · por confirmar',exact:true}).click();
   if(scenario==='missing-schema'){
    await page.getByRole('status').filter({hasText:'temporalmente en mantenimiento'}).waitFor();
    assert.equal(await page.locator('#booking-success').count(),0);
   }else{
    await page.getByRole('heading',{name:'¡Hora reservada con éxito!',exact:true}).waitFor();
    assert.match(await page.locator('#booking-success').innerText(),/por confirmar/);
    if(scenario==='refresh-failure')assert.equal(await page.locator('#booking').count(),0);
   }
   assert.equal(calls,1);
   await context.close();
   console.log('PASS:',scenario);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
