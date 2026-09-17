export const MAX_MESSAGE_BYTES=1_000_000;
export const isId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
export const isCode=v=>typeof v==='string'&&/^[A-Z2-9]{6}$/.test(v);
const integer=(n,max=100000)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const text=(s,max)=>typeof s==='string'&&s.length<=max;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function validQuestion(q,answerKey=false){
 if(!object(q)||!isId(q.id)||q.type!=='single-choice'||!text(q.prompt,600)||!q.prompt.trim()||!Array.isArray(q.options)||q.options.length<2||q.options.length>4)return false;
 const ids=new Set();for(const o of q.options){if(!object(o)||!isId(o.id)||ids.has(o.id)||!text(o.text,240)||!o.text.trim())return false;ids.add(o.id)}
 return answerKey?ids.has(q.correctOptionId)&&q.points===10:!('correctOptionId' in q);
}
export function validResult(r){return object(r)&&isId(r.questionId)&&isId(r.answer)&&typeof r.isCorrect==='boolean'&&isId(r.correctOptionId)&&text(r.correctText,240)&&Number.isFinite(r.timeMs)&&r.timeMs>=0&&r.timeMs<=86400000&&integer(r.score)&&[0,10].includes(r.delta)}
export function validPlayer(p){return object(p)&&isId(p.playerId)&&text(p.name,24)&&!!p.name.trim()&&integer(p.score)&&integer(p.index??p.done,100)&&integer(p.correct,100)&&integer(p.incorrect,100)}
export function validSnapshot(s,role='student'){
 if(!object(s)||!isCode(s.roomCode)||!isId(s.roundId)||!integer(s.revision,Number.MAX_SAFE_INTEGER)||!['lobby','playing','ended'].includes(s.status)||!Array.isArray(s.players)||s.players.length>4||!s.players.every(validPlayer)||new Set(s.players.map(p=>p.playerId)).size!==s.players.length)return false;
 if(role==='teacher')return (s.bank===null||(object(s.bank)&&Array.isArray(s.bank.questions)&&s.bank.questions.length<=100&&s.bank.questions.every(q=>validQuestion(q,true))))&&s.players.every(p=>object(p.results)&&Object.keys(p.results).length<=100&&Object.values(p.results).every(validResult)&&(p.pending===null||validResult(p.pending)));
 if(!integer(s.total,100)||!validPlayer(s.me)||!s.players.some(p=>p.playerId===s.me.playerId)||!(s.question===null||validQuestion(s.question))||!(s.me.pending===null||validResult(s.me.pending))||!object(s.me.results)||Object.keys(s.me.results).length>100||!Object.values(s.me.results).every(validResult))return false;
 if('bank' in s||'questions' in s||'correctOptionId' in s)return false;
 return Array.isArray(s.leaderboard)&&s.leaderboard.length===s.players.length&&s.leaderboard.every(p=>isId(p.playerId)&&text(p.name,24)&&integer(p.score)&&integer(p.rank,4)&&p.rank>0);
}
export function validAttempt(p){return object(p)&&Object.keys(p).length===3&&isId(p.questionId)&&isId(p.answer)&&Number.isFinite(p.timeMs)&&p.timeMs>=0&&p.timeMs<=86400000}
export function validAdvance(p){return object(p)&&Object.keys(p).length===1&&isId(p.questionId)}
export function parseStored(storage,key,fallback=null){try{return JSON.parse(storage.getItem(key)||'null')??fallback}catch{return fallback}}
