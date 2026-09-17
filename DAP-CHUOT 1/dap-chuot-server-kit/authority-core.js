// Pure authority logic: reusable by IT on the server, never trusted when run in a browser.
import {isId,isCode,validQuestion,validAttempt,validAdvance} from './security.js';
export function ranks(players){const sorted=[...players].sort((a,b)=>b.score-a.score||a.playerId.localeCompare(b.playerId));return sorted.map(p=>({playerId:p.playerId,name:p.name,score:p.score,rank:sorted.findIndex(x=>x.score===p.score)+1}))}
export function createRoom(roomCode,roundId){if(!isCode(roomCode)||!isId(roundId))throw Error('Invalid room identity');return {roomCode,roundId,revision:0,status:'lobby',players:[],bank:null}}
export function applyCommand(state,principal,operation,payload={},options={}){
 if(!principal||!isId(principal.playerId)||!['teacher','student'].includes(principal.role))throw Error('UNAUTHENTICATED');
 if(['startRound','endRound','prepareRound'].includes(operation)){
  if(principal.role!=='teacher')throw Error('FORBIDDEN');
  if(operation==='startRound'){
   if(state.status!=='lobby'||!state.players.length)throw Error('ROOM_NOT_READY');
   const bank=options.bank;
   if(!bank||!Array.isArray(bank.questions)||!bank.questions.length||bank.questions.length>100||!bank.questions.every(q=>validQuestion(q,true))||new Set(bank.questions.map(q=>q.id)).size!==bank.questions.length||!isId(options.roundId))throw Error('INVALID_CONTENT');
   state.bank=structuredClone(bank);state.roundId=options.roundId;state.status='playing';state.players.forEach(p=>Object.assign(p,{score:0,index:0,correct:0,incorrect:0,results:{},pending:null}));
  }else if(operation==='endRound'){state.status='ended'}else{if(state.status!=='ended')throw Error('ROUND_NOT_ENDED');state.status='lobby'}
 }else{
  if(principal.role!=='student')throw Error('FORBIDDEN');
  let player=state.players.find(p=>p.playerId===principal.playerId);
  if(operation==='joinRoom'){
   if(player)return state;
   if(state.players.length>=4)throw Error('ROOM_FULL');if(state.status==='ended')throw Error('ROUND_ENDED');
   if(typeof payload.name!=='string'||!payload.name.trim())throw Error('INVALID_NAME');
   state.players.push({playerId:principal.playerId,name:payload.name.trim().slice(0,24),score:0,index:0,correct:0,incorrect:0,results:{},pending:null});
  }else{
   if(!player)throw Error('NOT_A_MEMBER');
   if(state.status!=='playing'||options.roundId!==state.roundId)throw Error('STALE_ROUND');
   if(operation==='answerAttempt'){
    if(!validAttempt(payload))throw Error('INVALID_ANSWER');
    const q=state.bank.questions[player.index];if(!q||q.id!==payload.questionId)throw Error('STALE_QUESTION');
    if(Object.hasOwn(player.results,q.id))return state;
    if(!q.options.some(o=>o.id===payload.answer))throw Error('INVALID_OPTION');
    const correct=payload.answer===q.correctOptionId;player.score+=correct?10:0;player.correct+=correct?1:0;player.incorrect+=correct?0:1;
    const result={questionId:q.id,answer:payload.answer,isCorrect:correct,correctOptionId:q.correctOptionId,correctText:q.options.find(o=>o.id===q.correctOptionId).text,timeMs:payload.timeMs,score:player.score,delta:correct?10:0};
    player.results[q.id]=result;player.pending=result;
   }else if(operation==='advance'){
    if(!validAdvance(payload))throw Error('INVALID_ADVANCE');
    if(!player.pending||player.pending.questionId!==payload.questionId)return state;
    player.index++;player.pending=null;if(state.players.every(p=>p.index>=state.bank.questions.length))state.status='ended';
   }else throw Error('UNKNOWN_OPERATION');
  }
 }
 state.revision++;return state;
}
export function learnerSnapshot(state,playerId){
 const me=state.players.find(p=>p.playerId===playerId);if(!me)throw Error('NOT_A_MEMBER');
 const q=state.status==='playing'?state.bank.questions[me.index]:null;
 return {roomCode:state.roomCode,roundId:state.roundId,revision:state.revision,status:state.status,players:state.players.map(p=>({playerId:p.playerId,name:p.name,score:p.score,done:p.index,correct:p.correct,incorrect:p.incorrect})),leaderboard:ranks(state.players),total:state.bank?.questions.length||0,title:state.bank?.title||'',me:structuredClone(me),question:q?{id:q.id,type:q.type,prompt:q.prompt,options:structuredClone(q.options)}:null};
}
