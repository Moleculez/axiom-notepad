/** Trusted bootstrap only. Untrusted package bytes never enter this document's
 * JavaScript realm. The classic Blob worker inherits the opaque frame's CSP. */
export const pluginWorkerBootstrap = `
const send = globalThis.postMessage.bind(globalThis);
const listen = globalThis.addEventListener.bind(globalThis);
const interval = globalThis.setInterval.bind(globalThis);
// Opaque workers are not secure contexts: randomUUID/subtle are unavailable.
// getRandomValues remains available and does not expand origin authority.
const random = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
// API v1 has no streaming network or child-worker capability. Make these
// unavailable before package evaluation, including in older browser engines
// with incomplete EventSource CSP enforcement. A package cannot replace them.
for(const name of ['EventSource','WebTransport','Worker','SharedWorker'])
 Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false});
const createId=()=>{const b=random(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};
const importBundle = (url) => import(url);
const pending = new Map(); let seq=0, definition, api, context, busy=false;
const request=(type,value)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});send({type,id,...value});});
interval(()=>send({type:'heartbeat'}),1000);
listen('message',async(event)=>{
 const m=event.data;
 if(m?.type==='response') {const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result);return;}
 try {
  if(m?.type==='init' && !definition) {
   context=m.context; api=Object.freeze({createId,request:(method,args={})=>request('call',{method,args}),render:(panel)=>request('render',{panel})});
   // WebKit rejects blob:null module loads inside opaque workers. A local data
   // module preserves the same origin/network boundary, without server eval.
   definition=(await importBundle('data:text/javascript;charset=utf-8,'+encodeURIComponent(m.bundle))).default;
   if(!definition || typeof definition.run!=='function')throw new Error('Package must export a default plugin with run(api, context).');
   if(definition.activate)await definition.activate(api,context);
   send({type:'loaded'});return;
  }
  if(m?.type==='run' && definition) {
   if(busy)throw new Error('A command is already running.');busy=true;
   try{context=m.context;await definition.run(api,context);send({type:'done'});}finally{busy=false;}
  }
 }catch(error){send({type:'error',message:String(error?.message||'Extension failed.').slice(0,2000)});}
});
`;

export function pluginSandboxDocument(
  nonce: string,
  parentOrigin: string,
  scriptNonce: string,
) {
  const bootstrap = `
const nonce=${JSON.stringify(nonce)}, origin=${JSON.stringify(parentOrigin)}, source=${JSON.stringify(pluginWorkerBootstrap)};
let port,worker,last=0,watchdog,started=false;
function stop(){clearInterval(watchdog);worker?.terminate();worker=undefined;port?.close();}
addEventListener('message',(event)=>{
 if(started||event.source!==parent||event.origin!==origin||event.data?.type!=='axiom-plugin-connect'||event.data?.nonce!==nonce||event.ports.length!==1)return;
 started=true;port=event.ports[0];
 try {
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  worker=new Worker(url,{name:'Axiom isolated extension'});URL.revokeObjectURL(url);last=performance.now();
  worker.onmessage=(e)=>{if(e.data?.type==='heartbeat')last=performance.now();port.postMessage(e.data);};
  worker.onerror=(event)=>{port.postMessage({type:'error',message:'Extension worker failed. No changes were applied.'+(event.message?' '+String(event.message).slice(0,300):'')});stop();};
  port.onmessage=(e)=>{if(e.data?.type==='stop'){stop();return;}worker?.postMessage(e.data);};port.start();
  watchdog=setInterval(()=>{if(performance.now()-last>6000){port.postMessage({type:'error',message:'Extension stopped responding and was terminated.'});stop();}},1000);
  port.postMessage({type:'connected'});
 }catch(error){port.postMessage({type:'error',message:'Isolated extension workers are unavailable in this browser.'});stop();}
});
addEventListener('pagehide',stop);
parent.postMessage({type:'axiom-plugin-ready',nonce},origin);
`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Isolated Axiom extension</title></head><body><script nonce="${scriptNonce}">${bootstrap.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
export function pluginSandboxCsp(scriptNonce: string) {
  return `default-src 'none'; script-src 'nonce-${scriptNonce}' blob: data:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
}
