const BUILD_VERSION = '15.01';
const CACHE_NAME = 'pokemon-binder-v15-01';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css?v=15.01',
  '/v8.css?v=15.01',
  '/v11fix.css?v=15.01',
  '/v12.css?v=15.01',
  '/v122.css?v=15.01',
  '/v140.css?v=15.01',
  '/script.js?v=15.01',
  '/v8.js?v=15.01',
  '/v11fix.js?v=15.01',
  '/v12.js?v=15.01',
  '/v122.js?v=15.01',
  '/v140.js?v=15.01',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL.map(url=>new Request(url,{cache:'reload'})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    const oldBuild=keys.some(key=>key.startsWith('pokemon-binder-v')&&key!==CACHE_NAME);
    await Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();

    // PWA/mobile browsers often resume the previous JS process instead of doing
    // a true navigation. After a real build upgrade, navigate each open client
    // once so the newly activated worker cannot leave an old UI alive.
    if(oldBuild){
      const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      await Promise.all(clients.map(async client=>{
        try{
          const url=new URL(client.url);
          url.searchParams.set('pbv',BUILD_VERSION);
          await client.navigate(url.href);
        }catch{}
      }));
    }
  })());
});

self.addEventListener('message', event => {
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/api/'))return;

  const isCode=
    request.mode==='navigate' ||
    request.destination==='document' ||
    request.destination==='script' ||
    request.destination==='style' ||
    /\.(?:html?|js|css)$/.test(url.pathname);

  if(isCode){
    event.respondWith((async()=>{
      try{
        // Absolutely bypass both browser HTTP cache and the old SW cache for
        // executable app assets whenever the network is available.
        const fresh=await fetch(request,{cache:'no-store'});
        if(fresh.ok){
          const cache=await caches.open(CACHE_NAME);
          await cache.put(request,fresh.clone());
        }
        return fresh;
      }catch{
        const cached=await caches.match(request,{ignoreSearch:true});
        if(cached)return cached;
        if(request.mode==='navigate')return caches.match('/index.html',{ignoreSearch:true});
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(request);
    if(cached)return cached;
    try{
      const response=await fetch(request);
      if(response.ok){
        const cache=await caches.open(CACHE_NAME);
        cache.put(request,response.clone());
      }
      return response;
    }catch{
      return Response.error();
    }
  })());
});
