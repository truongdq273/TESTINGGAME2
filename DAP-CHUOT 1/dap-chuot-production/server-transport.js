import {runtimeConfig} from './runtime-config.js';
import {MAX_MESSAGE_BYTES,isId} from './security.js';
// Browser requests contain intent only; the server authenticates cookie/session and role.
export class ServerTransport{
 constructor({onEvent=()=>{},onPresence=()=>{}}={}){this.onEvent=onEvent;this.onPresence=onPresence;this.pending=new Map();this.stopped=false;this.reconnects=0;this.resume=null;this.ready=false;this.connect()}
 connect(){
  const url=new URL(runtimeConfig.socketPath,location.href);if(url.origin!==location.origin)throw Error('Cổng lớp học phải cùng origin qua reverse proxy.');
  url.protocol=location.protocol==='https:'?'wss:':'ws:';
  this.socket=new WebSocket(url,'classroom.v1');this.ready=false;
  this.socket.onopen=async()=>{
   if(this.stopped)return;this.reconnects=0;
   try{if(this.resume){const result=await this.transmit('resumeSession',this.resume,null,true);this.onEvent({type:'resumed',payload:result})}this.ready=true;this.onPresence(true);for(const entry of this.pending.values())if(!entry.internal)this.write(entry)}catch{this.socket.close()}
  };
  this.socket.onmessage=e=>{
   if(typeof e.data!=='string'||new TextEncoder().encode(e.data).byteLength>MAX_MESSAGE_BYTES)return this.socket.close(1009,'Message too large');
   let m;try{m=JSON.parse(e.data)}catch{return}
   if(m.v!==1)return;
   if(m.type==='response'&&isId(m.requestId)){
    const entry=this.pending.get(m.requestId);if(!entry)return;clearTimeout(entry.timer);this.pending.delete(m.requestId);
    if(m.ok===true)entry.resolve(m.payload);else{const error=new Error(typeof m.error?.message==='string'?m.error.message.slice(0,300):'Máy chủ từ chối yêu cầu.');error.code=m.error?.code;entry.reject(error)}
   }else if(m.type==='snapshot')this.onEvent(m);
  };
  this.socket.onerror=()=>this.onPresence(false);
  this.socket.onclose=()=>{this.ready=false;this.onPresence(false);if(!this.stopped)this.retry=setTimeout(()=>this.connect(),Math.min(1000*2**this.reconnects++,10000))};
 }
 write(entry){if(this.socket.readyState===WebSocket.OPEN&&(this.ready||entry.internal))this.socket.send(JSON.stringify(entry.message))}
 transmit(operation,payload={},roundId=null,internal=false){
  if(this.stopped)return Promise.reject(Error('Kết nối đã đóng.'));
  return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const message={v:1,type:'request',requestId,operation,roundId,payload};const entry={message,resolve,reject,internal,timer:setTimeout(()=>{this.pending.delete(requestId);reject(Error('Chưa nhận được phản hồi máy chủ. Kiểm tra kết nối rồi thử lại.'))},15000)};this.pending.set(requestId,entry);this.write(entry)});
 }
 setResume({roomCode,sessionId}){this.resume={roomCode,sessionId}}
 close(){this.stopped=true;clearTimeout(this.retry);this.socket.close();for(const e of this.pending.values()){clearTimeout(e.timer);e.reject(Error('Kết nối đã đóng.'))}this.pending.clear()}
}
