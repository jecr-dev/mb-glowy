const CACHE='mb-glowy-v7';
const FILES=['./','./index.html','./style.css','./app.js','./calendar.js','./logo.jpg','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mb-glowy-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 // Nunca guardar sesiones, configuración ni datos de reservas/clientas.
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!FILES.some(f=>new URL(f,self.registration.scope).pathname===url.pathname))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));
});
