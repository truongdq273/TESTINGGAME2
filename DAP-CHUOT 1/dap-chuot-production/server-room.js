import {ServerTransport} from './server-transport.js';
import {validSnapshot,validAttempt,validAdvance,validQuestion,isCode,isId,parseStored} from './security.js';
function checkSession(result,role){if(!result||!isCode(result.roomCode)||!isId(result.sessionId)||!isId(result.playerId)||!validSnapshot(result.snapshot,role)||result.snapshot.roomCode!==result.roomCode)throw Error('Phản hồi máy chủ không đúng giao thức classroom.v1.');return result}
export class ServerTeacherRoom{
 static async open(identity,onChange,onPresence){
  const room=new ServerTeacherRoom(onChange,onPresence);
  try{const saved=identity.serverSession;const result=await room.bus.transmit(saved?'resumeSession':'createRoom',saved?{roomCode:saved.roomCode,sessionId:saved.sessionId}:{gameId:'dap-chuot-mcq'});checkSession(result,'teacher');room.code=result.roomCode;room.id=result.playerId;room.bus.setResume(result);room.state=result.snapshot;identity.code=result.roomCode;identity.id=result.playerId;identity.serverSession={roomCode:result.roomCode,sessionId:result.sessionId};sessionStorage.setItem('dap-teacher',JSON.stringify(identity));room.accept(result.snapshot);return room}catch(e){room.bus.close();throw e}
 }
 constructor(onChange,onPresence){this.onChange=onChange;this.state=null;this.bus=new ServerTransport({onPresence,onEvent:m=>{if(m.type==='resumed'){checkSession(m.payload,'teacher');this.accept(m.payload.snapshot)}else this.accept(m.payload)}})}
 accept(s){if(validSnapshot(s,'teacher')&&(!this.code||s.roomCode===this.code)&&(!this.state||s.revision>=this.state.revision)){this.state=s;this.onChange(s)}}
 async command(operation,payload={}){const result=await this.bus.transmit(operation,payload,this.state.roundId);if(result?.snapshot)this.accept(result.snapshot);return result}
 async refreshContent(){const result=await this.command('refreshContent');const bank=result?.bank;if(!bank||!Array.isArray(bank.questions)||!bank.questions.length||bank.questions.length>100||!bank.questions.every(q=>validQuestion(q,true))||typeof bank.contentVersion!=='string'||bank.contentVersion.length>100||typeof bank.title!=='string'||bank.title.length>100||!Number.isFinite(bank.fetchedAt))throw Error('Máy chủ chưa trả bộ câu hỏi hợp lệ đã được cấp.');return bank}
 start(bank){return this.command('startRound',{expectedContentVersion:bank.contentVersion})}
 end(){return this.command('endRound')}
 lobby(){return this.command('prepareRound')}
 destroy(){this.bus.close()}
}
export class ServerStudentRoom{
 constructor(code,player,onSnapshot,onError,onPresence){
  this.code=code;this.state=null;this.destroyed=false;this.onSnapshot=onSnapshot;this.onError=onError;
  this.bus=new ServerTransport({onPresence,onEvent:m=>{try{if(m.type==='resumed'){checkSession(m.payload,'student');this.accept(m.payload.snapshot)}else this.accept(m.payload)}catch(e){onError(e.message)}}});
  const saved=parseStored(sessionStorage,'dap-student-server');
  this.bus.transmit(saved?.roomCode===code?'resumeSession':'joinRoom',saved?.roomCode===code?saved:{roomCode:code,name:player.name}).then(result=>{if(this.destroyed)return;checkSession(result,'student');this.playerId=result.playerId;this.bus.setResume(result);sessionStorage.setItem('dap-student-server',JSON.stringify({roomCode:result.roomCode,sessionId:result.sessionId}));this.accept(result.snapshot)}).catch(e=>{if(!this.destroyed)onError(e.message)});
 }
 accept(s){if(validSnapshot(s)&&s.roomCode===this.code&&(!this.playerId||s.me.playerId===this.playerId)&&(!this.state||s.revision>=this.state.revision)){this.state=s;this.onSnapshot(s)}}
 send(type,payload){if(!this.state||!['answerAttempt','advance'].includes(type)||type==='answerAttempt'&&!validAttempt(payload)||type==='advance'&&!validAdvance(payload))return;this.bus.transmit(type,payload,this.state.roundId).then(result=>{if(result?.snapshot)this.accept(result.snapshot)}).catch(e=>this.onError(e.message))}
 destroy(){this.destroyed=true;this.bus.close()}
}
