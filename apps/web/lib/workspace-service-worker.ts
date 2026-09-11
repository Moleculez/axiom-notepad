export const workspaceServiceWorker = String.raw`
importScripts('/workspace-offline-assets.js');
const CACHE = 'axiom-shell-' + self.AXIOM_BUILD_ID;
function synthetic(response) {
  if (!response) return new Response('Open Axiom online once before using it offline.', {status: 503});
  const headers = new Headers(response.headers);
  headers.delete('content-encoding'); headers.delete('content-length');
  return new Response(response.body, {status: response.status, headers});
}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([
    '/', '/workbench', '/icon.svg', '/manifest.webmanifest', ...self.AXIOM_ASSETS
  ])));
  // Updates wait until the user confirms that device journals are durable.
});
self.addEventListener('message', event => { if (event.data?.type === 'axiom:activate-update') self.skipWaiting(); });
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('axiom-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/v1/')) {
    // Never automatically cache an authenticated response. On a network failure
    // only, serve explicitly downloaded entries for this window's active account.
    event.respondWith(fetch(event.request).catch(() => offlineResponse(event, url)));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sync') || url.pathname === '/mcp') return;
  if (event.request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/workbench' || url.pathname.startsWith('/workbench/'))) {
    // Only the two deliberately account-neutral shells are stored. Never put
    // authentication callbacks, arbitrary HTML, RSC payloads or API data here.
    event.respondWith(fetch(event.request).catch(async () => synthetic(await caches.match(url.pathname.startsWith('/workbench') ? '/workbench' : '/'))));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || self.AXIOM_ASSETS.includes(url.pathname) || ['/icon.svg', '/icons/192.png', '/icons/512.png', '/manifest.webmanifest'].includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
      return response;
    })).then(response => ['worker','sharedworker'].includes(event.request.destination) ? synthetic(response) : response));
  }
});
async function offlineResponse(event, url) {
  const missing = () => new Response(JSON.stringify({error:'This item was not downloaded for offline use. Reconnect to open it.'}), {status:503,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
  const client = await self.clients.get(event.clientId);
  if (!client) return missing();
  const userId = await new Promise(resolve => {
    const channel = new MessageChannel(), timer = setTimeout(() => {channel.port1.close();resolve(null);},1500);
    channel.port1.onmessage = e => {clearTimeout(timer);channel.port1.close();resolve(typeof e.data === 'string' && e.data.length < 200 ? e.data : null);};
    client.postMessage({type:'axiom:offline-account-query'},[channel.port2]);
  });
  if (!userId) return missing();
  let db;
  try {
    db = await new Promise((resolve,reject)=>{const req=indexedDB.open('axiom:'+userId+':offline-files',1);req.onupgradeneeded=()=>{req.transaction.abort();reject(new Error('No offline data'));};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    url.searchParams.sort(); const key=url.pathname.slice('/api/v1/'.length)+url.search;
    const get=key=>new Promise((resolve,reject)=>{const tx=db.transaction('entries','readonly'),req=tx.objectStore('entries').get(key);tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error);});
    let entry=await get(key); if(entry?.assetKey)entry=await get(entry.assetKey);
    if(!entry)return missing();
    const headers={'cache-control':'private, no-store','x-axiom-offline':'1','content-type':entry.mime||'application/json'};
    if(entry.body){
      const range=event.request.headers.get('range');
      if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416,headers:{'content-range':'bytes */'+entry.body.size}});const start=match[1]?Number(match[1]):Math.max(0,entry.body.size-Number(match[2])),end=match[2]&&match[1]?Math.min(Number(match[2]),entry.body.size-1):entry.body.size-1;if(start>end||start>=entry.body.size)return new Response(null,{status:416,headers:{'content-range':'bytes */'+entry.body.size}});return new Response(entry.body.slice(start,end+1),{status:206,headers:{...headers,'accept-ranges':'bytes','content-range':'bytes '+start+'-'+end+'/'+entry.body.size,'content-length':String(end-start+1)}});}
      return new Response(entry.body,{headers:{...headers,'content-length':String(entry.body.size),'accept-ranges':'bytes'}});
    }
    if(entry.value!==undefined)return new Response(JSON.stringify(entry.value),{headers});
    return missing();
  }catch{return missing();}finally{db?.close();}
}
`;
