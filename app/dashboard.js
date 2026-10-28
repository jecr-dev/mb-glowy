let currentTab = 'reservas';
let resizeObserver;
const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chile = (value, options) => new Date(value).toLocaleString('es-CL', {timeZone:'America/Santiago',hourCycle:'h23',...options});
const dayKey = value => chile(value,{year:'numeric',month:'2-digit',day:'2-digit'});
export function resetDashboard(){
 document.body.classList.remove('admin-dashboard');
 resizeObserver?.disconnect();
 currentTab='reservas';
}
export function showDashboardEditor(node){
 const dialog=node.closest('dialog');
 if(!dialog)return;
 dialog.querySelector('.dialog-status')?.remove();
 document.querySelectorAll('.dashboard-dialog[open]').forEach(d=>{if(d!==dialog)d.close();});
 if(!dialog.open)dialog.showModal();
 dialog.scrollTop=0;
}
function dialogFor(root,node,title){
 const dialog=document.createElement('dialog');dialog.className='dashboard-dialog';
 const head=document.createElement('div');head.className='dialog-heading';
 const heading=document.createElement('h2');heading.textContent=title;
 const close=document.createElement('button');close.type='button';close.className='secondary';close.textContent='Cerrar';close.setAttribute('aria-label','Cerrar '+title.toLowerCase());close.onclick=()=>dialog.close();
 head.append(heading,close);dialog.append(head,node);root.append(dialog);
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
 return dialog;
}
export function updateDashboardMail(jobs){
 const brief=document.getElementById('overview-mail-summary');
 if(brief)brief.textContent=`${jobs.filter(j=>j.state==='pending'||j.state==='sending').length} en cola · ${jobs.filter(j=>j.state==='failed').length} con error · ${jobs.filter(j=>j.state==='sent').length} enviados`;
 document.querySelectorAll('[data-mail-summary-booking]').forEach(node=>{
  const rows=jobs.filter(j=>j.booking_id===node.dataset.mailSummaryBooking);
  const state=rows.some(j=>j.state==='failed')?'Error de correo':rows.some(j=>j.state==='sending')?'Correos enviando':rows.some(j=>j.state==='pending'&&new Date(j.due_at)<=new Date())?'Correos pendientes':rows.some(j=>j.state==='sent')?'Correos enviados':rows.length?'Correos programados':'Sin correos';
  node.textContent=state;node.className='row-mail '+(state==='Error de correo'?'mail-error':'');
 });
}
export function mountDashboard(root,{bookings,slots,services,jobs}){
 resizeObserver?.disconnect();document.body.classList.add('admin-dashboard');
 const toolbar=root.querySelector('.toolbar'),mailOverview=root.querySelector('.mail-overview');
 const serviceForm=root.querySelector('#service'),serviceGrid=serviceForm.previousElementSibling;
 const slotForm=root.querySelector('#slot'),slotHeading=[...root.children].find(n=>n.tagName==='H2'&&n.textContent==='Horarios');
 const slotCards=[];let next=slotHeading.nextElementSibling;
 while(next&&next.tagName!=='H2'){slotCards.push(next);next=next.nextElementSibling;}
 const filter=root.querySelector('#booking-filter').closest('label'),bookingList=root.querySelector('#booking-list'),bookingEditor=root.querySelector('#booking-editor');
 const mailHistory=root.querySelector('#mail-history'),installation=root.querySelector('details');
 const shell=document.createElement('div');shell.className='admin-shell';
 shell.innerHTML=`<div class="dashboard-heading"><div><p class="eyebrow">MB GLOWY · ADMINISTRACIÓN</p><h1>Tu agenda, en orden</h1></div></div><nav class="dashboard-nav" aria-label="Secciones de administración"></nav><div class="dashboard-metrics"></div><div class="dashboard-content"></div>`;
 shell.querySelector('.dashboard-heading').append(toolbar);
 const nav=shell.querySelector('.dashboard-nav'),metrics=shell.querySelector('.dashboard-metrics'),content=shell.querySelector('.dashboard-content');
 const mark=document.createElement('img');mark.className='dashboard-mark';mark.src='logo.jpg';mark.alt='MB Glowy';nav.append(mark);
 const today=dayKey(new Date());
 const counts=[['Citas de hoy',bookings.filter(b=>['pending','confirmed'].includes(b.status)&&dayKey(b.starts_at)===today).length],['Por confirmar',bookings.filter(b=>b.status==='pending'&&new Date(b.starts_at)>=new Date(Date.now()+150*60000)).length],['Confirmadas',bookings.filter(b=>b.status==='confirmed'&&new Date(b.ends_at)>new Date()).length],['Bloques abiertos',slots.filter(s=>!s.blocked&&new Date(s.ends_at)>new Date()).length]];
 metrics.innerHTML=counts.map(([label,count])=>`<div class="metric"><span>${label}</span><strong>${count}</strong></div>`).join('');
 const panels=new Map(),pagers=[];
 function panel(id,title,action){
  const section=document.createElement('section');section.className='dashboard-pane';section.dataset.panel=id;section.setAttribute('aria-label',title);section.hidden=true;
  const header=document.createElement('div');header.className='pane-heading';const h=document.createElement('h2');h.textContent=title;header.append(h);if(action)header.append(action);
  const body=document.createElement('div');body.className='pane-body';section.append(header,body);content.append(section);panels.set(id,section);return {section,header,body};
 }
 function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;}
 function activate(id){
  currentTab=id;panels.forEach((p,key)=>p.hidden=key!==id);
  content.classList.toggle('overview-visible',id==='reservas');
  nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-current',b.dataset.tab===id?'page':'false'));
  requestAnimationFrame(()=>pagers.forEach(p=>p()));
 }
 const reserve=panel('reservas','Reservas');
 const tools=document.createElement('div');tools.className='booking-tools';
 const search=document.createElement('input');search.type='search';search.placeholder='Buscar clienta, comuna o tratamiento';search.setAttribute('aria-label','Buscar reservas');
 const dateInput=document.createElement('input');dateInput.type='date';dateInput.setAttribute('aria-label','Filtrar reservas por fecha');
 const clear=button('Limpiar filtros',()=>{search.value='';dateInput.value='';filter.querySelector('select').value='all';filterBookings();});clear.className='secondary';
 tools.append(search,dateInput,filter,clear);reserve.section.insertBefore(tools,reserve.body);reserve.section.classList.add('with-filters');reserve.body.append(bookingList);
 // Próximas primero; las pasadas quedan al final. Se conservan los datos y acciones originales.
 const records=new Map(bookings.map(b=>[b.id,b]));
 const cards=[...bookingList.querySelectorAll('[data-booking]')].sort((a,b)=>{
  const x=records.get(a.dataset.booking),y=records.get(b.dataset.booking),pastX=new Date(x.ends_at)<new Date(),pastY=new Date(y.ends_at)<new Date();
  return Number(pastX)-Number(pastY)||new Date(x.starts_at)-new Date(y.starts_at);
 });
 cards.forEach(card=>{
  const b=records.get(card.dataset.booking),detail=document.createElement('div');
  while(card.firstChild)detail.append(card.firstChild);
  const modal=dialogFor(shell,detail,'Detalle de reserva');
  const edit=detail.querySelector('[data-edit-booking]');
  card.classList.add('booking-row');
  card.innerHTML=`<div class="row-date"><strong>${escape(chile(b.starts_at,{weekday:'short',day:'numeric',month:'short'}))}</strong><span>${escape(chile(b.starts_at,{hour:'2-digit',minute:'2-digit'}))} – ${escape(chile(b.ends_at,{hour:'2-digit',minute:'2-digit'}))}</span></div><div class="row-client"><h3>${escape(b.customer_name)}</h3><span>${escape(b.services?.name)} · ${escape(b.commune||'Sin comuna')}</span><small class="compact-date">${escape(chile(b.starts_at,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</small><small data-mail-summary-booking="${b.id}"></small></div><div class="row-state"></div><div class="row-actions"></div>`;
  card.querySelector('.row-state').append(detail.querySelector('.badge').cloneNode(true));
  card.querySelector('.row-actions').append(button('Ver detalle',()=>showDashboardEditor(detail)),button('Editar reserva',()=>edit.click()));
  bookingList.append(card);
 });
 const servicesPanel=panel('servicios','Servicios',button('Añadir servicio',()=>{serviceForm.reset();serviceForm.elements.id.value='';serviceForm.querySelector('h3').textContent='Añadir servicio';showDashboardEditor(serviceForm);}));servicesPanel.body.append(serviceGrid);
 const slotPanel=panel('horarios','Disponibilidad',button('Abrir disponibilidad',()=>{slotForm.reset();slotForm.elements.id.value='';slotForm.querySelector('h3').textContent='Abrir disponibilidad';showDashboardEditor(slotForm);}));
 const slotGrid=document.createElement('div');slotGrid.className='dashboard-slot-grid';slotGrid.append(...slotCards);slotPanel.body.append(slotGrid);
 const mailPanel=panel('correos','Correos');mailPanel.body.append(mailOverview,mailHistory);
 const oldShow=root.querySelector('#show-mail-history');if(oldShow)oldShow.onclick=()=>mailHistory.scrollIntoView({behavior:'smooth'});
 dialogFor(shell,serviceForm,'Servicio');dialogFor(shell,slotForm,'Disponibilidad');dialogFor(shell,bookingEditor,'Editar reserva');
 for(const [id,label] of [['reservas','Reservas'],['horarios','Horarios'],['servicios','Servicios'],['correos','Correos']]){const b=button(label,()=>activate(id));b.dataset.tab=id;nav.append(b);}
 if(installation){installation.classList.add('dashboard-install');nav.append(installation);}
 function paginate(container,items,section,layout='rows'){
  let page=0,filtered=items;
  const footer=document.createElement('div');footer.className='dashboard-pagination';
  const previous=button('Anterior',()=>{page--;render();}),next=button('Siguiente',()=>{page++;render();}),label=document.createElement('span');label.setAttribute('aria-live','polite');footer.append(previous,label,next);section.append(footer);
  function render(){
   if(section.hidden)return;
   const body=section.querySelector('.pane-body');
   const height=body.clientHeight||300,width=body.clientWidth||500;
   const size=layout==='rows'?Math.max(1,Math.floor(height/(innerWidth<650?155:innerHeight<550?80:106))):Math.max(1,Math.floor(height/260))*Math.max(1,Math.floor(width/280));
   page=Math.min(page,Math.max(0,Math.ceil(filtered.length/size)-1));
   const visible=new Set(filtered.slice(page*size,(page+1)*size));items.forEach(n=>n.hidden=!visible.has(n));
   previous.disabled=page===0;next.disabled=(page+1)*size>=filtered.length;
   label.textContent=filtered.length?`${page*size+1}–${Math.min((page+1)*size,filtered.length)} de ${filtered.length}`:'Sin resultados';
  }
  pagers.push(render);return {filter(items){filtered=items;page=0;render();}};
 }
 const historic=cards.filter(card=>card.dataset.past==='true'||['cancelled','unconfirmed'].includes(card.dataset.state));
 const upcoming=cards.filter(card=>!historic.includes(card));
 const history=document.createElement('details');history.className='reservation-history';
 const historySummary=document.createElement('summary');historySummary.textContent=`Historial de reservas (${historic.length})`;
 const historyBody=document.createElement('div');historyBody.className='pane-body';
 const historyList=document.createElement('div');historyList.append(...historic);historyBody.append(historyList);history.append(historySummary,historyBody);
 reserve.section.append(history);
 const bookingPager=paginate(bookingList,upcoming,reserve.section);
 const historyPager=paginate(historyList,historic,history);
 history.addEventListener('toggle',()=>requestAnimationFrame(()=>pagers.forEach(p=>p())));
 const overview=document.createElement('aside');overview.className='dashboard-overview';overview.setAttribute('aria-label','Resumen de administración');
 function overviewCard(title,lines,actions){
  const card=document.createElement('section');card.className='overview-card';
  const heading=document.createElement('h2');heading.textContent=title;card.append(heading);
  for(const line of lines){const p=document.createElement('p');p.textContent=line;card.append(p);}
  const bar=document.createElement('div');bar.className='overview-actions';
  for(const [label,fn] of actions)bar.append(button(label,fn));card.append(bar);overview.append(card);
 }
 const futureSlots=slots.filter(s=>!s.blocked&&new Date(s.ends_at)>new Date()).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
 const nextSlot=futureSlots[0];
 overviewCard('Disponibilidad',[`${futureSlots.length} bloques abiertos`,nextSlot?`${chile(nextSlot.starts_at,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} · ${nextSlot.commune||'Comuna por definir'}`:'Sin próximos horarios'],[['Ver horarios',()=>activate('horarios')],['Añadir',()=>slotPanel.header.querySelector('button').click()]]);
 overviewCard('Servicios',[`${services.filter(s=>s.active).length} tratamientos disponibles`,services.filter(s=>s.active).slice(0,2).map(s=>`${s.name} · ${s.duration_minutes} min`).join(' / ')||'Añade tu primer tratamiento'],[['Ver servicios',()=>activate('servicios')],['Añadir',()=>servicesPanel.header.querySelector('button').click()]]);
 const mailBrief=document.createElement('p');mailBrief.id='overview-mail-summary';
 overviewCard('Correos',[],[['Ver envíos',()=>activate('correos')],['Actualizar',()=>mailOverview.querySelector('#refresh-mails').click()]]);
 overview.lastElementChild.insertBefore(mailBrief,overview.lastElementChild.lastElementChild);
 content.append(overview);
 const mailDetails=document.createElement('details');mailDetails.className='mail-history-disclosure';
 const mailSummary=document.createElement('summary');mailSummary.textContent='Historial de correos';
 mailHistory.replaceWith(mailDetails);mailDetails.append(mailSummary,mailHistory);
 if(oldShow)oldShow.onclick=()=>{mailDetails.open=!mailDetails.open;};
 function filterBookings(){
  const value=filter.querySelector('select').value,q=search.value.toLocaleLowerCase('es');
  const chosen=dateInput.value?new Date(dateInput.value+'T12:00:00Z'):null;
  const matches=card=>{const b=records.get(card.dataset.booking);return (value==='all'||(value==='past'?card.dataset.past==='true':card.dataset.state===value))&&(!q||[b.customer_name,b.customer_email,b.commune,b.services?.name].join(' ').toLocaleLowerCase('es').includes(q))&&(!chosen||dayKey(b.starts_at)===dayKey(chosen));};
  bookingPager.filter(upcoming.filter(matches));historyPager.filter(historic.filter(matches));
  if(['past','cancelled','unconfirmed'].includes(value))history.open=true;
 }
 search.oninput=filterBookings;dateInput.onchange=filterBookings;filter.querySelector('select').onchange=filterBookings;
 paginate(serviceGrid,[...serviceGrid.children],servicesPanel.section,'cards');paginate(slotGrid,slotCards,slotPanel.section,'cards');
 root.replaceChildren(shell);updateDashboardMail(jobs);
 resizeObserver=new ResizeObserver(()=>pagers.forEach(p=>p()));resizeObserver.observe(content);
 activate(panels.has(currentTab)?currentTab:'reservas');
}
