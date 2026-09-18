import config from './lib/game-config.js';
import { connectRoom } from './lib/room-client.js';
import { el, setText, downloadCsv } from './lib/safe-dom.js';

const $ = id => document.getElementById(id);
const views = ['v-auth', 'v-create', 'v-room'];
const show = id => views.forEach(v => { $(v).hidden = v !== id; });
const CONN = { connecting: 'Đang kết nối…', online: 'Đã kết nối', offline: 'Mất kết nối — đang thử lại', replaced: 'Phòng đang mở ở tab khác' };
let room, view, renderTimer = null, selected = null;

async function boot(teacherKey) {
  room = await connectRoom(config, { role: 'teacher', teacherKey });
  room.onStatus(s => { setText($('conn'), CONN[s] || s); $('conn').dataset.state = s; if (s === 'replaced') lockAll('Phòng này đang được điều khiển ở tab khác. Hãy dùng tab đó.'); });
  room.onError(e => { if (e.code === 'AUTH_REQUIRED') { sessionStorage.removeItem('cg-teacher-key'); show('v-auth'); } else msg(e.message); });
  room.onSnapshot(v => { view = v; if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 300); });
  try { const r = await room.resume(); show(r ? 'v-room' : 'v-create'); }
  catch { show('v-create'); }
}

function msg(t) { setText($('action-msg'), t || ''); }
function lockAll(t) { document.querySelectorAll('#v-room button').forEach(b => { b.disabled = true; }); msg(t); }
async function act(fn) { msg(''); try { await fn(); } catch (e) { msg(e.message); if (e.code === 'STALE_CONTENT') $('start-stale').hidden = false; } }

$('auth-form').addEventListener('submit', e => { e.preventDefault(); const k = $('auth-key').value; sessionStorage.setItem('cg-teacher-key', k); boot(k); });
$('create').addEventListener('click', () => act(async () => { await room.createRoom(); show('v-room'); }));
$('start').addEventListener('click', () => act(() => room.start()));
$('start-stale').addEventListener('click', () => act(async () => { await room.start({ allowStale: true }); $('start-stale').hidden = true; }));
$('next').addEventListener('click', () => act(() => room.next()));
$('end').addEventListener('click', () => { if (confirm('Kết thúc vòng chơi cho cả lớp?')) act(() => room.end()); });
$('restart').addEventListener('click', () => act(() => room.restart()));
$('reload').addEventListener('click', () => act(() => room.reloadContent()));
$('sort').addEventListener('change', render);
$('csv').addEventListener('click', exportCsv);

function fmtTime(ms) { return ms ? new Date(ms).toLocaleTimeString('vi-VN') : '—'; }

function render() {
  const v = view; if (!v) return;
  show('v-room');
  setText($('code'), v.roomCode);
  setText($('count'), v.players.length); setText($('max'), v.maxPlayers);
  $('roster').replaceChildren(...v.players.map(p => el('li', { class: p.connected ? '' : 'away' }, p.name, p.connected ? '' : ' (mất kết nối)')));

  const c = v.content;
  const statusText = c.status === 'ok' ? `✅ ${c.title} · ${c.count} câu · phiên bản ${c.contentVersion} · tải lúc ${fmtTime(c.loadedAt)}`
    : c.status === 'stale' ? `⚠️ Không tải được bản mới: ${c.error}. Đang giữ bản ${c.contentVersion} (tải lúc ${fmtTime(c.loadedAt)}).`
    : c.status === 'error' ? `❌ ${c.error}` : 'Đang tải bộ câu hỏi…';
  setText($('content-status'), statusText);
  $('preview').replaceChildren(...v.preview.map(q => el('li', {}, q.prompt, el('ul', {}, q.options.map(o => el('li', { class: o.id === q.correctOptionId ? 'correct' : '' }, o.text, o.id === q.correctOptionId ? ' ✓' : ''))))));

  const lobby = v.status === 'lobby', playing = v.status === 'playing', ended = v.status === 'ended';
  $('start').hidden = !lobby; $('start').disabled = !v.players.length || !c.count;
  $('start-stale').hidden = !(lobby && c.status === 'stale');
  $('next').hidden = !(playing && v.pace === 'teacher');
  $('end').hidden = !playing; $('restart').hidden = !ended; $('csv').hidden = lobby;
  $('reload').disabled = playing;

  $('dash').hidden = lobby;
  const byName = $('sort').value === 'name';
  const rows = [...v.players].sort((a, b) => byName ? a.name.localeCompare(b.name, 'vi') || a.playerId.localeCompare(b.playerId) : b.score - a.score || a.playerId.localeCompare(b.playerId));
  $('dash-body').replaceChildren(...rows.map(p => {
    const finished = p.answered >= p.total;
    const curId = v.round?.questions[p.currentIndex]?.id;
    const state = !p.connected ? '🔌 Mất kết nối' : finished || ended ? '🏁 Xong' : curId && p.results[curId] ? '✅ Đã nộp câu này' : '✏️ Đang làm';
    const tr = el('tr', { class: selected === p.playerId ? 'selected' : '', tabindex: 0 },
      el('td', {}, p.name), el('td', {}, p.score), el('td', {}, `${p.answered}/${p.total}`),
      el('td', {}, `${p.correct} · ${p.incorrect} · ${p.timeout}`), el('td', {}, state));
    tr.addEventListener('click', () => { selected = p.playerId; render(); });
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') { selected = p.playerId; render(); } });
    return tr;
  }));
  renderQuestionPanel(v);

  $('summary').hidden = !ended;
  if (ended) renderPodium($('podium'), v.leaderboard);
}

function renderQuestionPanel(v) {
  const panel = $('question-panel');
  if (!v.round) return panel.replaceChildren();
  let idx, who = '';
  if (v.pace === 'teacher') idx = v.round.sharedIndex;
  else {
    const p = v.players.find(x => x.playerId === selected) || v.players[0];
    if (!p) return panel.replaceChildren();
    selected = p.playerId; idx = p.currentIndex; who = ` của ${p.name}`;
  }
  const q = v.round.questions[idx];
  const stats = v.round.questions.map(qq => {
    const rs = v.players.map(p => p.results[qq.id]).filter(Boolean);
    const right = rs.filter(r => r.isCorrect).length;
    return el('li', {}, `${qq.prompt.slice(0, 60)} — ${rs.length ? Math.round((right / rs.length) * 100) : 0}% đúng trên ${rs.length} bài đã nộp · ${v.players.length - rs.length} chưa nộp`);
  });
  panel.replaceChildren(
    el('h3', {}, q ? `Câu hiện tại${who}: ${idx + 1}/${v.round.total}` : `Đã hết câu hỏi${who}`),
    q ? el('p', {}, q.prompt) : '',
    q ? el('ul', {}, q.options.map(o => el('li', { class: o.id === q.correctOptionId ? 'correct' : '' }, o.text))) : '',
    el('h3', {}, 'Thống kê từng câu'), el('ol', {}, stats)
  );
}

export function renderPodium(list, board) {
  list.replaceChildren(...board.slice(0, 4).map(r => el('li', { class: `place place-${Math.min(r.rank, 4)}` }, el('span', { class: 'rank' }, `Hạng ${r.rank}`), el('span', { class: 'who' }, r.name), el('span', { class: 'pts' }, `${r.score} điểm`))));
}

function exportCsv() {
  const v = view; if (!v?.round) return;
  const qsList = v.round.questions;
  const header = ['playerId', 'name', 'score', 'correct', 'incorrect', 'timeout', 'unanswered', 'rank', ...qsList.map(q => `ket_qua_${q.id}`)];
  const rank = Object.fromEntries(v.leaderboard.map(r => [r.playerId, r.rank]));
  const rows = v.players.map(p => [p.playerId, p.name, p.score, p.correct, p.incorrect, p.timeout, p.unanswered, rank[p.playerId], ...qsList.map(q => p.results[q.id]?.status || 'unanswered')]);
  downloadCsv(`ket-qua-${v.roomCode}.csv`, [header, ...rows]);
}

boot(sessionStorage.getItem('cg-teacher-key') || undefined).catch(e => msg(e.message));
