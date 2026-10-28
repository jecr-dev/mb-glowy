import {mountConsent,readConsent,legalLinks} from './consent.js';
const form=document.getElementById('contact-form'),status=document.getElementById('contact-status');
document.querySelector('footer').insertAdjacentHTML('beforeend','<p class="wrap legal-links">'+legalLinks+'</p>');
mountConsent(form);form.querySelector('button[type=submit]').disabled=false;
form.onsubmit=async e=>{
 e.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;status.textContent='Registrando aceptación…';
 try{
  const fd=new FormData(form),consent=readConsent(form,fd),cfg=window.MB_CONFIG;
  const r=await fetch(cfg.url+'/rest/v1/rpc/contact_legal_acceptance',{method:'POST',headers:{apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_email:fd.get('correo'),p_version:consent.legal_version,p_terms:consent.terms_accepted,p_privacy:consent.privacy_accepted})});
  const receipt=await r.json();if(!r.ok)throw Error(receipt.message||'No se pudo registrar la aceptación. No se ha enviado el mensaje.');
  const body=`Nombre: ${fd.get('nombre')}\nCorreo: ${fd.get('correo')}\nServicio: ${fd.get('servicio')}\nMensaje: ${fd.get('mensaje')}\nReferencia de aceptación: ${receipt}`;
  status.textContent='Aceptación registrada. El mensaje todavía no se ha enviado. Abre tu correo y pulsa Enviar allí: ';
  const link=document.createElement('a');link.href='mailto:contacto@mbglowy.com?subject='+encodeURIComponent('Consulta MB Glowy')+'&body='+encodeURIComponent(body);link.textContent='Abrir mi correo para enviar';status.append(link);
 }catch(err){status.textContent=err.message;}finally{button.disabled=false;}
};
