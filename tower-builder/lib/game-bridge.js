/* Classroom Game Bridge 1.0.0 — copy unchanged. Load in game.html AFTER sdk.js, as a classic script.
 * Gives game.js one small API so every game talks to the room the same way:
 *
 *   const cg = ClassroomGameBridge.create({ gameId: 'meo-leo-cau', version: '1.0.0' });
 *   cg.on('content',  ({questions}) => ...)   // learner-safe questions, no answers
 *   cg.on('start',    () => ...)
 *   cg.on('state',    state => ...)           // status, me, question{id,index,answered}, players, leaderboard
 *   cg.on('result',   result => ...)          // authority verdict for MY answer: status, correctOptionId, delta, score
 *   cg.on('settings', ({muted, reducedMotion}) => ...)
 *   cg.on('error',    ({code, message}) => ...)
 *   cg.on('end',      () => ...)
 *   cg.attempt(questionId, optionId)          // lock input first; wait for 'result'
 *   cg.timeout(questionId)                    // ran out of time on screen (server also enforces)
 *   cg.advance(questionId)                    // after the feedback animation, ask for the next question
 *
 * The game NEVER decides isCorrect and NEVER adds points itself: move/animate only from 'result'.
 * Do not use localStorage/sessionStorage/cookies here — the sandbox blocks them. */
(function (global) {
  'use strict';
  const parentOrigin = new URL(global.location.href).origin; // real page origin (our own frame is opaque)
  function create({ gameId, version }) {
    const sdk = global.ClassroomGameSDK.create({ parentOrigin });
    const handlers = {};
    const emit = (k, v) => (handlers[k] || []).forEach(fn => { try { fn(v); } catch (e) { console.error(e); } });
    let state = null, lastQuestionId = null;
    const post = (type, payload) => global.parent.postMessage({ cgBridge: 1, type, payload }, parentOrigin);

    sdk.onMessage(m => {
      if (m.type === 'loadContent') emit('content', m.payload);
      else if (m.type === 'startGame') emit('start');
      else if (m.type === 'endGame') {
        emit('end');
        if (state?.me) sdk.send({ type: 'gameEnd', payload: { roomCode: '', leaderboard: (state.leaderboard || []).map(r => ({ playerId: r.playerId, name: r.name, score: r.score, rank: r.rank })) } });
      }
    });
    global.addEventListener('message', e => {
      if (e.source !== global.parent || e.origin !== parentOrigin) return;
      const m = e.data;
      if (!m || m.cgBridge !== 1) return;
      if (m.type === 'settings') acked = true;
      if (m.type === 'state') { state = m.payload; emit('state', state); }
      else if (m.type === 'result') {
        const r = m.payload;
        emit('result', r);
        if (r.questionId !== lastQuestionId && state?.me) {
          lastQuestionId = r.questionId;
          sdk.send({ type: 'submitAnswer', payload: { playerId: state.me.playerId, questionId: r.questionId, answer: r.answer ?? '', isCorrect: r.isCorrect, timeMs: r.timeMs } });
          sdk.send({ type: 'updateScore', payload: { playerId: state.me.playerId, score: r.score, delta: r.delta } });
        }
      } else if (m.type === 'settings') emit('settings', m.payload);
      else if (m.type === 'error') emit('error', m.payload);
    });

    const api = Object.freeze({
      on(k, fn) { (handlers[k] ||= []).push(fn); return () => { handlers[k] = handlers[k].filter(f => f !== fn); }; },
      attempt: (questionId, answer) => post('attempt', { questionId, answer: String(answer) }),
      timeout: questionId => post('attempt', { questionId, answer: null }),
      advance: questionId => post('advance', { questionId }),
      get state() { return state; }
    });
    // Handshake: the host page may attach its listener after we load, so repeat 'ready'
    // (with a per-load nonce) until the host answers with 'settings'.
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let acked = false, tries = 0;
    handlers.settings = [() => { acked = true; }];
    sdk.send({ type: 'gameReady', payload: { gameId, version } });
    (function hello() { if (acked || tries++ > 150) return; post('ready', { nonce }); global.setTimeout(hello, 300); })();
    return api;
  }
  global.ClassroomGameBridge = Object.freeze({ VERSION: '1.0.0', create });
})(window);
