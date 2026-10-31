// SPDX-License-Identifier: MIT
// Bump VERSION for EVERY runtime asset change; never mix release assets.
const VERSION='r1';
const OWNED='fit3-shell:'+encodeURIComponent(self.registration.scope)+':';
const CACHE=OWNED+VERSION;
const FILES=['index.html','style.css','ui.mjs','archive.mjs','hrs.mjs','probe.mjs','session.mjs','pwa.mjs','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png','LICENSE'];
const URLS=FILES.map(file=>new URL(file,self.registration.scope).href);
const HOME=URLS[0];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 try{const cache=await caches.open(CACHE);await cache.addAll(URLS.map(url=>new Request(url,{cache:'reload'})));}
 catch(error){await caches.delete(CACHE);throw error;}
 // Deliberately no skipWaiting: a waiting update needs an explicit idle action.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(OWNED)&&name!==CACHE)await caches.delete(name);
 // No clients.claim: initial activation must not reset a running BLE page.
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);
 if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 // Only app-root/index navigation gets canonical HTML. Never persist a query.
 const homePath=new URL(HOME).pathname;
 if(request.mode==='navigate'&&(url.pathname===scope.pathname||url.pathname===homePath)){
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(HOME)).then(response=>response||fetch(request)));return;
 }
 if(url.search||!URLS.includes(url.href))return;
 event.respondWith(caches.open(CACHE).then(cache=>cache.match(request)).then(response=>response||fetch(request)));
});
self.addEventListener('message',event=>{
 if(event.data?.type==='ACTIVATE')event.waitUntil((async()=>{
  // Refuse even an idle second app view: this worker cannot infer its BLE state.
  const views=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(client=>client.url.startsWith(self.registration.scope));
  if(views.length!==1||views[0].id!==event.source?.id){event.source?.postMessage({type:'ACTIVATION_BLOCKED'});return;}
  await self.skipWaiting();
 })());
 if(event.data?.type==='STATUS')event.waitUntil((async()=>{
  const cache=await caches.open(CACHE),matches=await Promise.all(URLS.map(url=>cache.match(url)));
  event.ports[0]?.postMessage({ready:matches.every(Boolean),version:VERSION});
 })());
});
