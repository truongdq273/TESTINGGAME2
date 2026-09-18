/* Classroom Game Host 1.0.0 — copy unchanged. Used by student.html only.
 * The game iframe MUST be: <iframe src="game.html" sandbox="allow-scripts" ...>
 * (no allow-same-origin) so game code can never read the page's storage or the room.
 * A sandboxed frame has the opaque origin "null", so we accept only messages whose
 * event.source is that exact iframe window, and we only ever send learner-safe data.
 *
 * Two channels share postMessage:
 *   - SDK 1.0.0 (sdk.js): gameReady / submitAnswer / updateScore / gameEnd  <->  loadContent / startGame / endGame
 *   - Bridge (this file): { cgBridge: 1, type, payload }  attempt / advance  <->  state / result / settings
 * Scores in SDK submitAnswer/updateScore are informational echoes; the authority already scored. */
const BRIDGE_IN = new Set(['attempt', 'advance', 'ready']); // 'ready' {nonce} is the handshake; SDK gameReady is informational

export function createGameHost(iframe, room, { onSdkEvent = () => {}, getSettings = () => ({ muted: false, reducedMotion: false }) } = {}) {
  let ready = false, nonce = null, roundId = null, lastRev = -1, lastResultKey = '', started = false, ended = false, view = null;
  const post = msg => iframe.contentWindow?.postMessage(msg, '*'); // opaque-origin sandbox; payloads are learner-safe
  const bridge = (type, payload) => post({ cgBridge: 1, type, payload });

  async function syncRound(v) {
    if (!ready || v.status === 'lobby' || !v.roundId || v.roundId === roundId) return;
    const round = await room.roundContent();
    if (!round || round.roundId !== v.roundId) return;
    roundId = round.roundId; started = false; ended = false; lastResultKey = '';
    post({ type: 'loadContent', payload: { questions: round.questions } });
  }

  function onSnapshot(v) {
    if (v.revision === lastRev && v.teacherConnected === view?.teacherConnected) return;
    lastRev = v.revision; view = v;
    syncRound(v).then(() => {
      if (!ready || v.roundId !== roundId) return;
      if (v.status !== 'lobby' && !started) { started = true; post({ type: 'startGame' }); } // start before the first state
      bridge('state', {
        status: v.status, teacherConnected: v.teacherConnected, pace: v.pace, total: v.total,
        me: v.me && { playerId: v.me.playerId, name: v.me.name, score: v.me.score, index: v.me.index },
        question: v.question && { id: v.question.id, index: v.question.index, answered: !!v.question.answered, servedAt: v.question.servedAt, timeLimitMs: v.question.timeLimitMs || 0 },
        players: v.players.map(p => ({ playerId: p.playerId, name: p.name, score: p.score, answered: p.answered, connected: p.connected })),
        leaderboard: v.leaderboard
      });
      const r = v.me?.lastResult;
      if (r && `${roundId}:${r.questionId}` !== lastResultKey) { lastResultKey = `${roundId}:${r.questionId}`; bridge('result', r); }
      if (v.status === 'ended' && !ended) { ended = true; post({ type: 'endGame' }); }
    }).catch(e => console.warn('[game-host]', e.message));
  }

  async function onMessage(e) {
    if (e.source !== iframe.contentWindow || e.origin !== 'null') return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.cgBridge === 1) {
      if (!BRIDGE_IN.has(m.type)) return;
      if (m.type === 'ready') {
        const n = String(m.payload?.nonce || '').slice(0, 64);
        if (n !== nonce) { nonce = n; ready = true; roundId = null; started = false; ended = false; if (view) { lastRev = -1; onSnapshot(view); } }
        bridge('settings', getSettings());
        return;
      }
      const p = m.payload || {};
      if (typeof p.questionId !== 'string' || p.questionId.length > 40) return;
      try {
        if (m.type === 'attempt') {
          if (!(p.answer === null || (typeof p.answer === 'string' && p.answer.length <= 10))) return;
          await room.answer(p.questionId, p.answer);
        } else await room.advance(p.questionId);
      } catch (err) { bridge('error', { code: err.code || 'ERROR', message: String(err.message).slice(0, 200) }); }
      return;
    }
    if (!globalThis.ClassroomGameSDK?.validateGameToHost(m)) return;
    onSdkEvent(m); // analytics / logging only — never use it to change scores
  }

  window.addEventListener('message', onMessage);
  const off = room.onSnapshot(onSnapshot);
  return {
    pushSettings: () => bridge('settings', getSettings()),
    destroy() { off(); window.removeEventListener('message', onMessage); }
  };
}
