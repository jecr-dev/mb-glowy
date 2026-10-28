// Aceptaciones explícitas. No se guarda evidencia en localStorage ni se confía en la hora del dispositivo.
const base='/legal/2026-10-28/';
export const legalLinks=`<a href="${base}terminos.html">Términos y condiciones</a> · <a href="${base}privacidad.html">Privacidad</a> · <a href="${base}cookies.html">Cookies</a> · <a href="${base}reembolsos.html">Cancelaciones y reembolsos</a>`;
async function legalRequest(name,body,token){
 const cfg=window.MB_CONFIG;
 if(!cfg?.url||!cfg?.anonKey)throw Error('No se puede registrar la aceptación. Contacta a MB Glowy.');
 const r=await fetch(cfg.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:cfg.anonKey,Authorization:'Bearer '+(token||cfg.anonKey),'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw Error(data.message||'No se pudo registrar la aceptación.');return data;
}
let bundle;
export function mountConsent(form){
 if(form.querySelector('.legal-consent'))return;
 const field=document.createElement('fieldset');field.className='legal-consent';
 field.innerHTML=`<legend>Condiciones y datos personales</legend><label><input type="checkbox" name="terms_accepted" required disabled> He leído y acepto los <a href="${base}terminos.html" target="_blank" rel="noopener">términos y condiciones</a>, incluida la <a href="${base}reembolsos.html" target="_blank" rel="noopener">política de cancelaciones y reembolsos</a>.</label><label><input type="checkbox" name="privacy_accepted" required disabled> He leído la <a href="${base}privacidad.html" target="_blank" rel="noopener">política de privacidad</a> y autorizo el tratamiento de mis datos para gestionar esta solicitud y sus comunicaciones operativas.</label><p class="legal-form-status" role="status">Cargando documentos…</p>`;
 form.querySelector('button[type=submit]')?.before(field);
 bundle??=legalRequest('legal_bundle',{}).catch(e=>{bundle=null;throw e;});
 bundle.then(data=>{
  if(!data?.ready||data.version!=='2026-10-28.v1')throw Error('Los documentos legales aún no están habilitados. Contacta a MB Glowy antes de enviar datos.');
  field.dataset.version=data.version;field.querySelectorAll('input').forEach(i=>i.disabled=false);
  field.querySelector('.legal-form-status').textContent='Dos aceptaciones separadas, sin autorización publicitaria. Versión '+data.version+'. Los enlaces se abren en otra pestaña.';
 }).catch(e=>{field.querySelector('.legal-form-status').textContent=e.message;});
}
export function readConsent(form,fd){
 const field=form.querySelector('.legal-consent');
 if(!field?.dataset.version||fd.get('terms_accepted')!=='on'||fd.get('privacy_accepted')!=='on')throw Error('Revisa y acepta por separado los términos y la política de privacidad.');
 fd.delete('terms_accepted');fd.delete('privacy_accepted');
 return {legal_version:field.dataset.version,terms_accepted:true,privacy_accepted:true};
}
export function recordAdminConsent(consent,form,token){
 return legalRequest('admin_legal_acceptance',{p_version:consent.legal_version,p_terms:consent.terms_accepted,p_privacy:consent.privacy_accepted,p_form:form},token);
}
export function watchConsent(root){
 const mount=()=>root.querySelectorAll('form').forEach(mountConsent);mount();
 const observer=new MutationObserver(mutations=>{if(mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('form')||n.querySelector?.('form')))))mount();});
 observer.observe(root,{childList:true,subtree:true});
}
export async function exportLegalEvidence(token){
 const cfg=window.MB_CONFIG,headers={apikey:cfg.anonKey,Authorization:'Bearer '+token};
 async function rows(table){const all=[];for(let offset=0;;offset+=200){const r=await fetch(cfg.url+'/rest/v1/'+table+'?select=*&order='+ (table==='legal_acceptances'?'accepted_at,id':'version,kind')+'&limit=200&offset='+offset,{headers});if(!r.ok)throw Error('No se pudo exportar la evidencia. Revisa tus permisos.');const page=await r.json();all.push(...page);if(page.length<200)return all;}}
 const [acceptances,documents]=await Promise.all([rows('legal_acceptances'),rows('legal_documents')]);
 const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),notice:'Fecha de exportación del dispositivo. Las aceptaciones usan fecha del servidor. Correos declarados no equivalen a identidad verificada. Exportación confidencial.',acceptances,documents},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mb-glowy-aceptaciones.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
