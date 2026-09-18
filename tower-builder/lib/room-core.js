/* Classroom Room Core 1.0.0 — copy unchanged. Pure logic, no I/O.
 * Runs as the authority inside the teacher tab (local demo) AND inside the
 * Node server (production). Games never import this file directly. */
export const ROOM_PROTOCOL = 1;
export const LIMITS = Object.freeze({ maxPlayers: 4, nameMax: 24, graceMs: 1500 });

const clone = v => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export function cleanName(raw) {
  const s = String(raw ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, LIMITS.nameMax).join('');
}

export function createRoomState({ roomCode, gameId, pace = 'self', maxPlayers = LIMITS.maxPlayers, now }) {
  if (!['self', 'teacher'].includes(pace)) throw new Error('pace must be self|teacher');
  return {
    v: ROOM_PROTOCOL, roomCode, gameId, pace, maxPlayers: Math.min(Math.max(1, maxPlayers | 0), 40),
    createdAt: now, touchedAt: now, revision: 0, status: 'lobby', teacherConnected: true,
    content: { status: 'empty', bank: null, error: null, loadedAt: null },
    round: null, players: []
  };
}

function freshStats(p) {
  Object.assign(p, { score: 0, index: 0, correct: 0, incorrect: 0, timeout: 0, results: {}, pending: null, servedAt: null });
}

export function ranks(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
  return sorted.map(p => ({ playerId: p.playerId, name: p.name, score: p.score, rank: sorted.findIndex(x => x.score === p.score) + 1 }));
}

const qs = s => s.round?.content.questions || [];
const currentIndex = (s, p) => (s.pace === 'teacher' ? s.round.sharedIndex : p.index);
const servedAt = (s, p) => (s.pace === 'teacher' ? s.round.sharedServedAt : p.servedAt);

function finishIfDone(s) {
  if (s.pace === 'self' && s.players.length && s.players.every(p => p.index >= qs(s).length)) s.status = 'ended';
}

function record(s, p, q, answer, now, kind) {
  const isCorrect = kind === 'answer' && answer === q.correctOptionId;
  const delta = isCorrect ? q.points : 0;
  p.score += delta;
  if (kind === 'timeout') p.timeout++; else if (isCorrect) p.correct++; else p.incorrect++;
  const correct = q.options.find(o => o.id === q.correctOptionId);
  const result = {
    questionId: q.id, answer: kind === 'answer' ? answer : null, status: kind === 'timeout' ? 'timeout' : isCorrect ? 'correct' : 'incorrect',
    isCorrect, correctOptionId: q.correctOptionId, correctText: correct.text, explanation: q.explanation || '',
    timeMs: Math.max(0, Math.min(now - (servedAt(s, p) ?? now), 86_400_000)), score: p.score, delta
  };
  p.results[q.id] = result;
  p.pending = result;
  return result;
}

/** apply(state, actor, op, payload, now) -> { ok, error?, code? }  (mutates state)
 * actor: { role: 'teacher'|'student'|'system', playerId? } — set by the transport
 * layer from the authenticated connection, NEVER from the message body. */
export function apply(s, actor, op, payload = {}, now = Date.now()) {
  const fail = (code, error) => ({ ok: false, code, error });
  const done = () => { s.revision++; s.touchedAt = now; return { ok: true }; };
  const role = actor?.role;

  if (role === 'system') {
    if (op === 'contentLoaded') { s.content = { status: 'ok', bank: clone(payload.bank), error: null, loadedAt: now }; return done(); }
    if (op === 'contentError') { s.content = { ...s.content, status: s.content.bank ? 'stale' : 'error', error: String(payload.message || 'Lỗi nguồn').slice(0, 300) }; return done(); }
    if (op === 'presence') {
      if (payload.role === 'teacher') s.teacherConnected = !!payload.connected;
      else { const p = s.players.find(x => x.playerId === payload.playerId); if (p) p.connected = !!payload.connected; }
      return done();
    }
    if (op === 'addPlayer') {
      const existing = s.players.find(p => p.playerId === payload.playerId);
      if (existing) { existing.connected = true; return done(); }
      if (s.status === 'ended') return fail('ROUND_ENDED', 'Vòng chơi đã kết thúc.');
      if (s.players.length >= s.maxPlayers) return fail('ROOM_FULL', `Phòng đã đủ ${s.maxPlayers} bạn.`);
      const name = cleanName(payload.name);
      if (!name) return fail('BAD_NAME', 'Em hãy nhập tên (tối đa 24 ký tự).');
      const p = { playerId: payload.playerId, name, joinedAt: now, connected: true };
      freshStats(p);
      if (s.status === 'playing') p.servedAt = now;
      s.players.push(p);
      return done();
    }
    return fail('BAD_OP', 'Thao tác hệ thống không hợp lệ.');
  }

  if (role === 'teacher') {
    if (op === 'start') {
      if (s.status === 'playing') return fail('ALREADY_PLAYING', 'Vòng đang chạy.');
      if (!s.players.length) return fail('NO_PLAYERS', 'Cần ít nhất 1 học sinh trong phòng.');
      if (!s.content.bank) return fail('NO_CONTENT', s.content.error || 'Chưa tải được bộ câu hỏi.');
      if (s.content.status !== 'ok' && payload.allowStale !== true)
        return fail('STALE_CONTENT', 'Nguồn câu hỏi đang lỗi. Giáo viên có thể chọn rõ ràng dùng bản đã tải trước đó.');
      s.round = { roundId: payload.roundId, startedAt: now, content: clone(s.content.bank), sharedIndex: 0, sharedServedAt: now, usedStale: s.content.status !== 'ok' };
      s.players.forEach(p => { freshStats(p); p.servedAt = now; });
      s.status = 'playing';
      return done();
    }
    if (op === 'next') {
      if (s.status !== 'playing' || s.pace !== 'teacher') return fail('BAD_STATE', 'Chỉ dùng khi giáo viên điều khiển nhịp câu hỏi.');
      s.round.sharedIndex++; s.round.sharedServedAt = now;
      s.players.forEach(p => { p.pending = null; p.index = s.round.sharedIndex; });
      if (s.round.sharedIndex >= qs(s).length) s.status = 'ended';
      return done();
    }
    if (op === 'end') {
      if (s.status !== 'playing') return fail('BAD_STATE', 'Không có vòng nào đang chạy.');
      s.status = 'ended'; s.players.forEach(p => { p.pending = null; });
      return done();
    }
    if (op === 'restart') {
      if (s.status === 'playing') return fail('BAD_STATE', 'Hãy kết thúc vòng hiện tại trước.');
      s.status = 'lobby'; s.round = null; s.players.forEach(freshStats);
      return done();
    }
    return fail('BAD_OP', 'Thao tác không hợp lệ.');
  }

  if (role === 'student') {
    const p = s.players.find(x => x.playerId === actor.playerId);
    if (!p) return fail('NOT_IN_ROOM', 'Em chưa ở trong phòng.');
    if (s.status !== 'playing') return fail('NOT_PLAYING', 'Vòng chơi chưa bắt đầu hoặc đã kết thúc.');
    if (payload.roundId !== s.round.roundId) return fail('OLD_ROUND', 'Sự kiện thuộc vòng cũ.');
    const idx = currentIndex(s, p);
    const q = qs(s)[idx];
    if (!q || q.id !== payload.questionId) return fail('WRONG_QUESTION', 'Câu hỏi không còn hiện hành.');
    if (op === 'answer') {
      if (p.results[q.id]) return { ok: true, duplicate: true };
      if (payload.answer !== null && !q.options.some(o => o.id === payload.answer)) return fail('BAD_ANSWER', 'Lựa chọn không hợp lệ.');
      const late = q.timeLimitMs && now > servedAt(s, p) + q.timeLimitMs + LIMITS.graceMs;
      record(s, p, q, payload.answer, now, payload.answer === null || late ? 'timeout' : 'answer');
      return done();
    }
    if (op === 'advance') {
      if (s.pace === 'teacher') return fail('BAD_OP', 'Giáo viên điều khiển chuyển câu.');
      if (!p.results[q.id]) return fail('NOT_ANSWERED', 'Chưa có kết quả cho câu này.');
      p.index++; p.pending = null; p.servedAt = now;
      finishIfDone(s);
      return done();
    }
    return fail('BAD_OP', 'Thao tác không hợp lệ.');
  }
  return fail('FORBIDDEN', 'Không có quyền.');
}

/** Server-side timer: records timeouts. Returns true if state changed. */
export function tick(s, now = Date.now()) {
  if (s.status !== 'playing') return false;
  let changed = false;
  for (const p of s.players) {
    const q = qs(s)[currentIndex(s, p)];
    if (q?.timeLimitMs && !p.results[q.id] && now > servedAt(s, p) + q.timeLimitMs + LIMITS.graceMs) { record(s, p, q, null, now, 'timeout'); changed = true; }
  }
  if (changed) { s.revision++; s.touchedAt = now; }
  return changed;
}

function publicPlayers(s) {
  const total = qs(s).length;
  return s.players.map(p => ({ playerId: p.playerId, name: p.name, connected: p.connected !== false, score: p.score, answered: Object.keys(p.results).length, total, correct: p.correct, incorrect: p.incorrect, timeout: p.timeout }));
}
const learnerQuestion = q => q && ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options.map(o => ({ id: o.id, text: o.text })), ...(q.media ? { media: q.media } : {}), ...(q.timeLimitMs ? { timeLimitMs: q.timeLimitMs } : {}) });
const contentInfo = s => ({ status: s.content.status, error: s.content.error, loadedAt: s.content.loadedAt, title: s.content.bank?.title || '', contentVersion: s.content.bank?.contentVersion || '', fetchedAt: s.content.bank?.fetchedAt || null, count: s.content.bank?.questions.length || 0 });

/** Learner-safe list of the running round's questions (no answer keys). Sent once per roundId. */
export function learnerRound(s) {
  if (!s.round) return null;
  return { roundId: s.round.roundId, title: s.round.content.title, contentVersion: s.round.content.contentVersion, questions: qs(s).map(learnerQuestion) };
}

/** Full view for the teacher only — contains answer keys. Never send to students. */
export function teacherView(s) {
  const total = qs(s).length;
  return {
    role: 'teacher', v: s.v, roomCode: s.roomCode, gameId: s.gameId, pace: s.pace, revision: s.revision, status: s.status, maxPlayers: s.maxPlayers,
    content: contentInfo(s), preview: s.content.bank ? clone(s.content.bank.questions) : [],
    round: s.round && { roundId: s.round.roundId, title: s.round.content.title, contentVersion: s.round.content.contentVersion, usedStale: s.round.usedStale, total, sharedIndex: s.round.sharedIndex, questions: clone(s.round.content.questions) },
    players: s.players.map(p => ({ ...publicPlayers(s).find(x => x.playerId === p.playerId), currentIndex: s.round ? currentIndex(s, p) : 0, unanswered: Math.max(0, total - Object.keys(p.results).length), results: clone(p.results) })),
    leaderboard: ranks(s.players)
  };
}

/** Learner-safe view: no answer keys except the player's own graded results. */
export function studentView(s, playerId) {
  const p = s.players.find(x => x.playerId === playerId);
  const idx = p && s.round ? currentIndex(s, p) : 0;
  const q = s.status === 'playing' && p ? qs(s)[idx] : null;
  return {
    role: 'student', v: s.v, roomCode: s.roomCode, gameId: s.gameId, pace: s.pace, revision: s.revision, status: s.status, teacherConnected: s.teacherConnected,
    roundId: s.round?.roundId || null, title: s.round?.content.title || s.content.bank?.title || '', total: qs(s).length,
    players: publicPlayers(s).map(({ correct, incorrect, timeout, ...rest }) => rest),
    leaderboard: ranks(s.players),
    me: p ? { playerId: p.playerId, name: p.name, score: p.score, index: idx, correct: p.correct, incorrect: p.incorrect, timeout: p.timeout, lastResult: p.pending ? clone(p.pending) : null } : null,
    question: q && !p.results[q.id] ? { ...learnerQuestion(q), index: idx, servedAt: servedAt(s, p) } : q ? { ...learnerQuestion(q), index: idx, servedAt: servedAt(s, p), answered: true } : null
  };
}
