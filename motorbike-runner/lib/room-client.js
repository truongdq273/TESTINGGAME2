/* Classroom Room Client 1.0.0 — copy unchanged.
 * Host pages (teacher.html, student.html) talk to the room ONLY through this API.
 * config.transport = 'local'  -> teacher tab is the authority (same-browser demo)
 * config.transport = 'server' -> WebSocket to the classroom server (real online class)
 *
 * API: const room = await connectRoom(config, { role: 'teacher'|'student', teacherKey? })
 *   room.onSnapshot(fn) / room.onStatus(fn) / room.onError(fn)  -> unsubscribe()
 *   teacher: room.createRoom() room.resume() room.reloadContent() room.start({allowStale}) room.next() room.end() room.restart()
 *   student: room.join(roomCode, name) room.resume() room.roundContent() room.answer(questionId, answer) room.advance(questionId)
 *   room.leave()
 * Every method returns a Promise; failures reject with Error{code, message}. */
import {
  ROOM_PROTOCOL, createRoomState, apply, tick, teacherView, studentView, learnerRound
} from './room-core.js';
import { loadQuestionBank } from './content-loader.js';

const rid = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''));
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newRoomCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
export const normalizeRoomCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const err = (code, message) => Object.assign(new Error(message), { code });

function emitter() {
  const sets = { snapshot: new Set(), status: new Set(), error: new Set() };
  return {
    on: (k, fn) => { sets[k].add(fn); return () => sets[k].delete(fn); },
    emit: (k, v) => sets[k].forEach(fn => { try { fn(v); } catch (e) { console.error(e); } })
  };
}
const idKey = (cfg, role) => `cg:${cfg.gameId}:${role}`;
const readId = (cfg, role) => { try { return JSON.parse(sessionStorage.getItem(idKey(cfg, role)) || 'null'); } catch { return null; } };
const writeId = (cfg, role, v) => { try { v ? sessionStorage.setItem(idKey(cfg, role), JSON.stringify(v)) : sessionStorage.removeItem(idKey(cfg, role)); } catch {} };

export async function connectRoom(cfg, opts) {
  if (!cfg?.gameId || !/^[a-z0-9-]{2,40}$/.test(cfg.gameId)) throw err('BAD_CONFIG', 'gameId không hợp lệ trong game-config.js');
  if (!['teacher', 'student'].includes(opts?.role)) throw err('BAD_CONFIG', 'role phải là teacher hoặc student');
  if (cfg.transport === 'server') return serverBackend(cfg, opts);
  if (cfg.transport === 'local') return localBackend(cfg, opts);
  throw err('BAD_CONFIG', 'transport phải là local hoặc server');
}

function facade(cfg, role, ev, request, extra = {}) {
  const common = {
    role, config: cfg,
    onSnapshot: fn => ev.on('snapshot', fn), onStatus: fn => ev.on('status', fn), onError: fn => ev.on('error', fn),
    leave: () => extra.leave?.()
  };
  if (role === 'teacher') return Object.freeze({
    ...common,
    createRoom: () => request('createRoom', { gameId: cfg.gameId, pace: cfg.pace, maxPlayers: cfg.maxPlayers }),
    resume: () => request('resumeTeacher', {}),
    reloadContent: () => request('reloadContent', {}),
    start: ({ allowStale = false } = {}) => request('start', { allowStale }),
    next: () => request('next', {}), end: () => request('end', {}), restart: () => request('restart', {})
  });
  let lastRound = null;
  return Object.freeze({
    ...common,
    join: (roomCode, name) => request('join', { roomCode: normalizeRoomCode(roomCode), name: String(name || '').slice(0, 60), gameId: cfg.gameId }),
    resume: () => request('resumeStudent', {}),
    roundContent: async () => (lastRound = await request('roundContent', {})),
    answer: (questionId, answer) => request('answer', { questionId, answer, roundId: lastRound?.roundId }),
    advance: questionId => request('advance', { questionId, roundId: lastRound?.roundId })
  });
}

/* ------------------------------------------------------------------ server */
function serverBackend(cfg, { role, teacherKey }) {
  if (!/^wss?:\/\//.test(cfg.serverUrl || '')) throw err('BAD_CONFIG', 'serverUrl phải bắt đầu bằng wss:// (hoặc ws:// khi thử trong mạng nội bộ)');
  const ev = emitter();
  const pending = new Map();
  let ws, closed = false, retry = 0, ready, readyResolve;
  const newReady = () => { ready = new Promise(r => (readyResolve = r)); };
  newReady();

  function open() {
    ev.emit('status', 'connecting');
    ws = new WebSocket(cfg.serverUrl);
    ws.onopen = () => {
      retry = 0;
      ws.send(JSON.stringify({ v: ROOM_PROTOCOL, id: 'hello', op: 'hello', payload: { role, gameId: cfg.gameId, gameVersion: cfg.gameVersion, teacherKey: teacherKey || undefined } }));
    };
    ws.onmessage = async e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'reply' && m.id === 'hello') {
        if (!m.ok) { ev.emit('error', err(m.error?.code, m.error?.message)); closed = true; ws.close(); return; }
        ev.emit('status', 'online'); readyResolve();
        const saved = readId(cfg, role);
        if (saved) request(role === 'teacher' ? 'resumeTeacher' : 'resumeStudent', {}).catch(e2 => ev.emit('error', e2));
        return;
      }
      if (m.type === 'reply') {
        const p = pending.get(m.id); if (!p) return;
        pending.delete(m.id); clearTimeout(p.timer);
        m.ok ? p.resolve(m.data) : p.reject(err(m.error?.code || 'ERROR', m.error?.message || 'Lỗi máy chủ'));
      } else if (m.type === 'snapshot') ev.emit('snapshot', m.data);
      else if (m.type === 'event' && m.data?.kind === 'replaced') { ev.emit('status', 'replaced'); closed = true; ws.close(); }
    };
    ws.onclose = () => {
      pending.forEach(p => { clearTimeout(p.timer); p.reject(err('OFFLINE', 'Mất kết nối, đang thử lại…')); });
      pending.clear();
      if (closed) return;
      newReady();
      ev.emit('status', 'offline');
      setTimeout(open, Math.min(15000, 500 * 2 ** retry++) + Math.random() * 300);
    };
  }

  async function request(op, payload) {
    await ready;
    const saved = readId(cfg, role);
    if (op === 'resumeTeacher' || op === 'resumeStudent') { if (!saved) return null; payload = saved; }
    const id = rid();
    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(err('TIMEOUT', 'Máy chủ không phản hồi.')); }, 8000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ v: ROOM_PROTOCOL, id, op, payload }));
    }).catch(e => { if (['resumeTeacher', 'resumeStudent'].includes(op) && ['ROOM_NOT_FOUND', 'BAD_TOKEN'].includes(e.code)) writeId(cfg, role, null); throw e; });
    if (res?.identity) writeId(cfg, role, res.identity);
    return res;
  }
  open();
  return facade(cfg, role, ev, request, { leave: () => { closed = true; writeId(cfg, role, null); ws?.close(); } });
}

/* ------------------------------------------------------------------- local */
function localBackend(cfg, { role }) {
  if (!('BroadcastChannel' in window)) throw err('UNSUPPORTED', 'Trình duyệt không hỗ trợ BroadcastChannel cho bản demo.');
  const ev = emitter();
  const tabId = rid();
  let chan = null, roomCode = null;
  const chanName = code => `cg:${cfg.gameId}:${code}`;
  return role === 'teacher' ? localAuthority(cfg, ev, tabId) : localStudent(cfg, ev, tabId);

  /* ---- teacher tab = authority ---- */
  function localAuthority() {
    let state = null, secrets = null, session = null, startedAt = Date.now(), timers = [], stepDown = false;
    const tabs = new Map(); // tabId -> { playerId, lastSeen }
    const stateKey = code => `cg:${cfg.gameId}:authority:${code}`; // sessionStorage: never readable by student tabs
    const persist = () => { try { sessionStorage.setItem(stateKey(roomCode), JSON.stringify({ state, secrets, session })); } catch {} };
    let loadAbort = null;

    async function refreshContent() {
      loadAbort?.abort(); loadAbort = new AbortController();
      try { apply(state, { role: 'system' }, 'contentLoaded', { bank: await loadQuestionBank(cfg.localContent, { signal: loadAbort.signal }) }); }
      catch (e) { if (e.stale || loadAbort.signal.aborted) return; apply(state, { role: 'system' }, 'contentError', { message: e.message }); }
      publish();
    }
    function publish() {
      if (!state || stepDown) return;
      persist();
      ev.emit('snapshot', teacherView(state));
      for (const [t, info] of tabs) chan.postMessage({ kind: 'snap', session, to: t, data: studentView(state, info.playerId) });
    }
    function send(m) { chan.postMessage({ ...m, session }); }
    function attach(code) {
      roomCode = code;
      chan = new BroadcastChannel(chanName(code));
      chan.onmessage = e => onMessage(e.data);
      timers.push(setInterval(() => {
        send({ kind: 'beat', tabId, startedAt });
        const now = Date.now();
        for (const [t, info] of tabs) if (now - info.lastSeen > 7000) {
          tabs.delete(t);
          if (![...tabs.values()].some(x => x.playerId === info.playerId)) apply(state, { role: 'system' }, 'presence', { playerId: info.playerId, connected: false });
          publish();
        }
      }, 2000));
      timers.push(setInterval(() => { if (tick(state)) publish(); }, 500));
    }
    function onMessage(m) {
      if (!m || typeof m !== 'object' || stepDown) return;
      if (m.kind === 'beat' && m.session === session && m.tabId !== tabId && m.startedAt < startedAt) {
        stepDown = true; timers.forEach(clearInterval); ev.emit('status', 'replaced'); return;
      }
      if (m.kind === 'ping') {
        if (tabs.has(m.from)) tabs.get(m.from).lastSeen = Date.now();
        else if (typeof m.from === 'string') send({ kind: 'who', to: m.from }); // e.g. after a teacher reload: ask the tab to resume
        return;
      }
      if (m.kind !== 'req' || typeof m.from !== 'string') return;
      const reply = (ok, data) => send({ kind: 'res', to: m.from, id: m.id, ok, ...(ok ? { data } : { error: data }) });
      const p = m.payload || {};
      if (m.op === 'join' || m.op === 'resumeStudent') {
        let playerId, resumeToken;
        if (m.op === 'join') {
          if (normalizeRoomCode(p.roomCode) !== roomCode || p.gameId !== cfg.gameId) return;
          playerId = rid(); resumeToken = rid();
          const r = apply(state, { role: 'system' }, 'addPlayer', { playerId, name: p.name });
          if (!r.ok) return reply(false, { code: r.code, message: r.error });
          secrets[playerId] = resumeToken;
        } else {
          if (p.roomCode !== roomCode) return;
          if (!p.playerId || secrets[p.playerId] !== p.resumeToken) return reply(false, { code: 'BAD_TOKEN', message: 'Phiên cũ không còn hợp lệ, em hãy vào lại.' });
          playerId = p.playerId; resumeToken = p.resumeToken;
          apply(state, { role: 'system' }, 'addPlayer', { playerId });
        }
        for (const [t, info] of tabs) if (info.playerId === playerId && t !== m.from) { tabs.delete(t); send({ kind: 'replaced', to: t }); }
        tabs.set(m.from, { playerId, lastSeen: Date.now() });
        reply(true, { identity: { roomCode, playerId, resumeToken }, session });
        return publish();
      }
      const info = tabs.get(m.from);
      if (!info) return reply(false, { code: 'NOT_IN_ROOM', message: 'Em chưa ở trong phòng.' });
      info.lastSeen = Date.now();
      if (m.op === 'roundContent') return reply(true, learnerRound(state));
      if (m.op !== 'answer' && m.op !== 'advance') return reply(false, { code: 'FORBIDDEN', message: 'Không có quyền.' });
      const r = apply(state, { role: 'student', playerId: info.playerId }, m.op, p);
      if (!r.ok) return reply(false, { code: r.code, message: r.error });
      reply(true, {}); publish();
    }

    async function request(op, p) {
      if (op === 'createRoom') {
        if (roomCode) throw err('ALREADY_IN_ROOM', 'Tab này đã mở một phòng.');
        const code = newRoomCode();
        state = createRoomState({ roomCode: code, gameId: cfg.gameId, pace: cfg.pace, maxPlayers: cfg.maxPlayers, now: Date.now() });
        secrets = {}; session = rid();
        writeId(cfg, 'teacher', { roomCode: code });
        attach(code); publish(); refreshContent();
        return { roomCode: code };
      }
      if (op === 'resumeTeacher') {
        const saved = readId(cfg, 'teacher');
        const blob = saved && JSON.parse(sessionStorage.getItem(stateKey(saved.roomCode)) || 'null');
        if (!blob) return null;
        ({ state, secrets, session } = blob);
        apply(state, { role: 'system' }, 'presence', { role: 'teacher', connected: true });
        state.players.forEach(pl => { pl.connected = false; });
        attach(saved.roomCode); publish();
        if (state.status !== 'playing') refreshContent();
        return { roomCode: saved.roomCode };
      }
      if (!state) throw err('NO_ROOM', 'Chưa tạo phòng.');
      if (op === 'reloadContent') { await refreshContent(); return teacherView(state).content; }
      if (op === 'start') {
        if (!p.allowStale) await refreshContent(); // always re-read the source right before a new round
        const r = apply(state, { role: 'teacher' }, 'start', { allowStale: p.allowStale, roundId: rid() });
        if (!r.ok) throw err(r.code, r.error);
        publish(); return {};
      }
      const r = apply(state, { role: 'teacher' }, op, p);
      if (!r.ok) throw err(r.code, r.error);
      publish();
      if (op === 'restart') refreshContent();
      return {};
    }
    ev.emit('status', 'online');
    return facade(cfg, 'teacher', ev, request, { leave: () => { timers.forEach(clearInterval); chan?.close(); writeId(cfg, 'teacher', null); } });
  }

  /* ---- student tab ---- */
  function localStudent() {
    const waiting = new Map();
    let session = null, lastBeat = 0, awayShown = false, timers = [], resuming = false;
    function attach(code) {
      if (roomCode === code) return;
      chan?.close(); roomCode = code;
      chan = new BroadcastChannel(chanName(code));
      chan.onmessage = e => {
        const m = e.data; if (!m || typeof m !== 'object') return;
        if (m.kind === 'beat') { if (!session || m.session === session) { lastBeat = Date.now(); if (awayShown) { awayShown = false; ev.emit('status', 'online'); } } return; }
        if (m.to !== tabId) return;
        if (m.kind === 'res') {
          const w = waiting.get(m.id); if (!w) return;
          waiting.delete(m.id); clearTimeout(w.timer);
          m.ok ? w.resolve(m.data) : w.reject(err(m.error.code, m.error.message));
        } else if (m.kind === 'snap' && m.session === session) ev.emit('snapshot', { ...m.data, teacherConnected: Date.now() - lastBeat < 6000 });
        else if (m.kind === 'who' && m.session === session && !resuming) {
          resuming = true;
          const saved = readId(cfg, 'student');
          (saved ? call('resumeStudent', saved, 2500) : Promise.reject(err('NOT_IN_ROOM', 'Em hãy vào lại phòng.')))
            .catch(e2 => ev.emit('error', e2)).finally(() => { resuming = false; });
        }
        else if (m.kind === 'replaced') { ev.emit('status', 'replaced'); timers.forEach(clearInterval); chan.close(); }
      };
      timers.forEach(clearInterval);
      timers = [
        setInterval(() => chan.postMessage({ kind: 'ping', from: tabId }), 2000),
        setInterval(() => { if (session && Date.now() - lastBeat > 6000 && !awayShown) { awayShown = true; ev.emit('status', 'teacherAway'); } }, 1000)
      ];
    }
    function call(op, payload, timeoutMs = 4000) {
      if (op !== 'join' && op !== 'resumeStudent' && session && Date.now() - lastBeat > 6000 && (op === 'answer' || op === 'advance'))
        return Promise.reject(err('TEACHER_AWAY', 'Giáo viên tạm vắng, em chờ một chút nhé.'));
      const id = rid();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(op === 'join' || op === 'resumeStudent'
            ? err('ROOM_NOT_FOUND', 'Không tìm thấy phòng. Kiểm tra lại mã. (Bản demo chỉ chạy khi giáo viên mở phòng trên cùng máy, cùng trình duyệt.)')
            : err('TIMEOUT', 'Giáo viên không phản hồi.'));
        }, timeoutMs);
        waiting.set(id, { resolve, reject, timer });
        chan.postMessage({ kind: 'req', from: tabId, id, op, payload });
      });
    }
    async function request(op, p) {
      if (op === 'join') {
        if (!/^[A-Z0-9]{4,8}$/.test(p.roomCode)) throw err('BAD_CODE', 'Mã phòng gồm 4–8 chữ và số.');
        attach(p.roomCode);
        const res = await call('join', p, 2500);
        session = res.session; lastBeat = Date.now(); writeId(cfg, 'student', res.identity);
        chan.postMessage({ kind: 'ping', from: tabId });
        return res;
      }
      if (op === 'resumeStudent') {
        const saved = readId(cfg, 'student'); if (!saved) return null;
        attach(saved.roomCode);
        try { const res = await call('resumeStudent', saved, 2500); session = res.session; lastBeat = Date.now(); return res; }
        catch (e) { if (e.code === 'BAD_TOKEN') writeId(cfg, 'student', null); throw e; }
      }
      if (!session) throw err('NOT_IN_ROOM', 'Em chưa vào phòng.');
      return call(op, p);
    }
    ev.emit('status', 'online');
    return facade(cfg, 'student', ev, request, { leave: () => { timers.forEach(clearInterval); chan?.close(); writeId(cfg, 'student', null); } });
  }
}
