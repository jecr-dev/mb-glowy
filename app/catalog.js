// El catálogo público comparte los servicios de la agenda, sin datos personales.
const cfg=window.MB_CONFIG;
if(cfg?.url&&cfg?.anonKey){
 const root=document.querySelector('.services');
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 fetch(cfg.url+'/rest/v1/services?active=eq.true&order=name',{headers:{apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey}})
 .then(r=>{if(!r.ok)throw Error('Catálogo no disponible');return r.json();})
 .then(rows=>{root.innerHTML=rows.map(s=>`<article class="service"><h3>${escape(s.name)}</h3><p>${escape(s.description)}</p><p>${s.duration_minutes} min · ${Number(s.price).toLocaleString('es-CL',{style:'currency',currency:'CLP'})}</p><a class="btn" href="/app/">Reservar hora</a></article>`).join('')||'<p>No hay tratamientos disponibles por el momento.</p>';})
 .catch(()=>{root.textContent='No pudimos cargar los tratamientos. Escríbenos a contacto@mbglowy.com.';});
}
