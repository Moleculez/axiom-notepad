import { pluginLimits } from "./plugins";

/** Trusted code, embedded in the opaque relay, never in a package's realm.
 * The first worker→frame structured clone cannot be prevented by application
 * JavaScript. This bounds validation and the second clone into the application. */
export const pluginTransportSource = `function createTransport(limits) {
 let total=0; const times=[]; const pending=new Set(),requests=new Set();
 const size=(text)=>new TextEncoder().encode(text).byteLength;
 const stringSize=(text)=>{
  let bytes=2;
  for(let at=0;at<text.length;at++){
   const code=text.charCodeAt(at);
   if(code===34||code===92)bytes+=2;
   else if(code<32)bytes+=[8,9,10,12,13].includes(code)?2:6;
   else if(code<128)bytes++;
   else if(code<2048)bytes+=2;
   else if(code>=0xd800&&code<=0xdbff&&text.charCodeAt(at+1)>=0xdc00&&text.charCodeAt(at+1)<=0xdfff){bytes+=4;at++;}
   else bytes+=code>=0xd800&&code<=0xdfff?6:3;
   if(bytes>limits.messageBytes)throw new Error('Extension message is too large.');
  }
  return bytes;
 };
 return {
  reset(){total=0;},
  serialize(value,workerMessage=false){
   const now=performance.now();
   while(times.length&&times[0]<=now-1000)times.shift();
   if(times.length>=limits.protocolMessagesPerSecond)throw new Error('Extension message rate exceeded. Restart explicitly after reviewing the package.');
   times.push(now);
   const stack=[{v:value,d:0}],seen=new Set();let nodes=0,estimate=0;
   while(stack.length){
    const {v,d,leave}=stack.pop();if(leave){seen.delete(v);continue;}
    if(++nodes>limits.protocolNodes||d>limits.protocolDepth)throw new Error('Extension message structure exceeds its budget.');
    if(v===null||typeof v==='boolean')estimate+=5;
    else if(typeof v==='number'){if(!Number.isFinite(v))throw new Error('Extension messages require finite JSON values.');estimate+=24;}
    else if(typeof v==='string'){estimate+=stringSize(v);}
    else if(typeof v==='object'){
     if(seen.has(v))throw new Error('Extension messages cannot contain cyclic objects.');seen.add(v);stack.push({v,d,leave:true});
     const proto=Object.getPrototypeOf(v);
     if(!Array.isArray(v)&&proto!==Object.prototype&&proto!==null)throw new Error('Extension messages require plain JSON objects.');
     if(Array.isArray(v)&&v.length>limits.protocolNodes-nodes)throw new Error('Extension array exceeds its structure budget.');
     const keys=Object.keys(v);estimate+=(Array.isArray(v)?v.length*5:keys.length*2)+2;
     if(keys.length>limits.protocolNodes-nodes)throw new Error('Extension message structure exceeds its budget.');
     for(const key of keys){
      const descriptor=Object.getOwnPropertyDescriptor(v,key);
      if(!descriptor||!('value' in descriptor))throw new Error('Extension messages cannot contain accessors.');
      if(key==='__proto__'||key==='prototype'||key==='constructor')throw new Error('Unsafe extension message key.');
      estimate+=Array.isArray(v)?0:stringSize(key);if(descriptor.value!==undefined)stack.push({v:descriptor.value,d:d+1});
     }
    }else throw new Error('Extension messages require JSON values.');
    if(estimate>limits.messageBytes)throw new Error('Extension message is too large.');
   }
   const wire=JSON.stringify(value),bytes=size(wire);
   if(bytes>limits.messageBytes)throw new Error('Extension message is too large.');
   const heartbeat=workerMessage&&value?.type==='heartbeat';
   if(heartbeat&&(Array.isArray(value)||Object.keys(value).length!==1))throw new Error('Extension heartbeats cannot contain payloads.');
   if(!heartbeat&&total+bytes>limits.commandTransferBytes)throw new Error('Extension command transfer budget exceeded. Your files and drafts remain unchanged.');
   if(workerMessage){
    if(!value||!['heartbeat','loaded','done','error','call','render'].includes(value.type))throw new Error('Invalid extension protocol message.');
    if(value.type==='call'||value.type==='render'){
     if(!Number.isSafeInteger(value.id)||value.id<1||requests.has(value.id))throw new Error('Invalid or repeated extension request.');
     if(requests.size>=1000)throw new Error('Extension lifetime request budget exceeded.');
     if(pending.size>=limits.concurrentCalls)throw new Error('Extension concurrent request budget exceeded.');
     pending.add(value.id);requests.add(value.id);
    }
   }else if(value?.type==='response')pending.delete(value.id);
   if(!heartbeat)total+=bytes;return wire;
  }
 };
}`;

/** Only the trusted relay sends strings. Reject objects before app validation. */
export function decodePluginMessage(raw: unknown): Record<string, unknown> {
  if (
    typeof raw !== "string" ||
    raw.length > pluginLimits.messageBytes ||
    new TextEncoder().encode(raw).byteLength > pluginLimits.messageBytes
  )
    throw new Error("Extension sent an invalid or oversized relay message.");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Extension sent an invalid relay message.");
  return value as Record<string, unknown>;
}
