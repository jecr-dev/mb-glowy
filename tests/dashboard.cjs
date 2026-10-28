const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>sessionStorage.setItem('mb-token','test-admin'));
  await page.route('**/app/config.js',r=>r.fulfill({contentType:'application/javascript',body:'window.MB_CONFIG={url:"https://test.supabase.co",anonKey:"public-test"};'}));
  await page.route('https://test.supabase.co/**',r=>{
   const p=new URL(r.request().url()).pathname;let data=[];
   if(p.endsWith('/admins'))data=[{user_id:'admin'}];
   if(p.endsWith('/services')&&r.request().method()==='POST')return r.fulfill({status:400,json:{message:'Error de prueba: revisa el nombre.'}});
   if(p.endsWith('/services'))data=[{id:'service',name:'Limpieza facial',description:'Cuidado facial',duration_minutes:60,price:25000,active:true}];
   if(p.endsWith('/slots'))data=[{id:'slot',starts_at:'2099-01-06T12:00:00Z',ends_at:'2099-01-06T18:00:00Z',gap_minutes:20,commune:'Coquimbo',blocked:false,slot_services:[{service_id:'service'}]}];
   if(p.endsWith('/bookings'))data=Array.from({length:30},(_,i)=>({id:'booking'+i,slot_id:'slot',service_id:'service',services:{name:'Limpieza facial'},customer_name:'Clienta '+String(i).padStart(2,'0'),customer_email:'ana@example.com',customer_phone:'123456789',customer_address:'Calle Prueba 123',commune:'Coquimbo',starts_at:'2099-01-06T12:00:00Z',ends_at:'2099-01-06T13:00:00Z',status:i>=24?'cancelled':i%2?'confirmed':'pending'}));
   return r.fulfill({json:data});
  });
  const base=process.env.MB_BASE_URL||'http://127.0.0.1:8007';
  for(const [w,h] of [[1440,900],[1024,768],[844,390],[390,844]]){
   await page.setViewportSize({width:w,height:h});await page.goto(base+'/app/#admin');
   await page.locator('.dashboard-nav button[data-tab=reservas]').waitFor();
   await page.waitForTimeout(100);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),`Body overflows vertically at ${w}x${h}`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Body overflows horizontally at ${w}x${h}`);
   const pane=page.locator('[data-panel=reservas]');
   assert.ok(await pane.isVisible());
   assert.equal(await page.locator('.reservation-history').getAttribute('open'),null);
   assert.equal(await pane.locator('[data-booking=booking24]').isVisible(),false);
   if(w>=650){
    const overview=await page.locator('.dashboard-overview').boundingBox(),reservations=await pane.boundingBox();
    assert.ok(overview.x>=reservations.x+reservations.width,'Resumen al lado de reservas');
    assert.ok(overview.y+overview.height<=h,'Resumen dentro de pantalla');
    assert.equal(await page.locator('.overview-card:visible').count(),3);
    for(const card of await page.locator('.overview-card').all()){
     assert.ok(await card.evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Resumen sin contenido recortado');
    }
   }
   await page.locator('.reservation-history>summary').click();
   assert.ok(await pane.locator('[data-booking=booking24]').isVisible());
   await page.locator('.reservation-history>summary').click();
   const first=pane.locator('[data-booking]:visible').first();
   assert.ok(await first.isVisible());
   const rect=await first.boundingBox();assert.ok(rect.y+rect.height<h,`First reservation outside viewport ${w}x${h}`);
   await pane.getByRole('button',{name:'Siguiente',exact:true}).click();
   assert.ok(!(await pane.locator('[data-booking="booking0"]').isVisible()));
   await page.getByRole('searchbox',{name:'Buscar reservas'}).fill('Clienta 23');
   assert.equal(await pane.locator('[data-booking]:visible').count(),1);
   await pane.getByRole('button',{name:'Ver detalle',exact:true}).click();
   await page.getByRole('dialog').waitFor();
   await page.getByRole('dialog').getByRole('button',{name:'Editar reserva',exact:true}).click();
   assert.ok(await page.locator('#edit-booking').isVisible());
   assert.equal(await page.locator('#edit-booking [name=customer_name]').inputValue(),'Clienta 23');
   await page.getByRole('button',{name:'Cerrar editar reserva',exact:true}).click();
   await page.locator('.dashboard-nav [data-tab=horarios]').click();
   await page.getByRole('button',{name:'Editar horario',exact:true}).click();
   assert.equal(await page.locator('#slot [name=gap_minutes]').inputValue(),'20');
   await page.getByRole('button',{name:'Cerrar disponibilidad',exact:true}).click();
   await page.locator('.dashboard-nav [data-tab=servicios]').click();
   await page.getByRole('button',{name:'Añadir servicio',exact:true}).click();
   assert.ok(await page.locator('#service').isVisible());
   await page.locator('#service [name=name]').fill('Servicio de prueba');
   await page.getByRole('button',{name:'Guardar servicio',exact:true}).click();
   await page.getByRole('dialog').getByRole('alert').filter({hasText:'revisa el nombre'}).waitFor();
   await page.getByRole('button',{name:'Cerrar servicio',exact:true}).click();
   await page.locator('.dashboard-nav [data-tab=correos]').click();
   assert.equal(await page.locator('#mail-history').isVisible(),false);
   await page.locator('.mail-history-disclosure>summary').click();
   assert.ok(await page.locator('#mail-history').isVisible());
   await page.getByRole('button',{name:'Actualizar correos',exact:true}).click();
   await page.locator('#mail-updated').filter({hasText:'Correos actualizados'}).waitFor();
   await page.locator('.dashboard-nav [data-tab=reservas]').click();
   await page.getByRole('button',{name:'Limpiar filtros',exact:true}).click();
   if(w===1440)await page.screenshot({path:'/tmp/mb-dashboard-desktop.png'});
   await page.getByRole('link',{name:'Reservar',exact:true}).click();
   assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('admin-dashboard')),false);
   console.log(`PASS: dashboard ${w}x${h}, sin scroll exterior, filtros, paginación, detalle/edición, secciones y salida a agenda pública.`);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
