import config from './lib/game-config.js';
import { connectRoom, normalizeRoomCode } from './lib/room-client.js';
import { createGameHost } from './lib/game-host.js';
import { el, setText } from './lib/safe-dom.js';

const $ = id => document.getElementById(id);
const views = ['v-join', 'v-wait', 'v-play', 'v-end'];
const show = id => views.forEach(v => { $(v).hidden = v !== id; });
const banner = t => { $('banner').hidden = !t; setText($('banner'), t || ''); };
const prefs = { muted: readMuted(), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
function readMuted() { try { return localStorage.getItem('cg-muted') === '1'; } catch { return false; } }

const room = await connectRoom(config, { role: 'student' });
const host = createGameHost($('game'), room, { getSettings: () => prefs });

const params = new URLSearchParams(location.search);
$('room').value = normalizeRoomCode(params.get('room')); // only the room code is prefilled — never the name

room.onStatus(s => {
  setText($('conn'), { online: 'Đã kết nối', connecting: 'Đang kết nối…', offline: 'Mất kết nối', teacherAway: 'Giáo viên tạm vắng', replaced: 'Đã mở ở tab khác' }[s] || '');
  banner(s === 'offline' ? 'Mất kết nối, đang thử lại…' : s === 'teacherAway' ? 'Giáo viên tạm vắng, em chờ một chút nhé.' : s === 'replaced' ? 'Em đang mở trò chơi ở tab khác. Hãy dùng tab đó.' : '');
});
room.onError(e => banner(e.message));
room.onSnapshot(v => {
  if (!v.me) return;
  setText($('me-name'), v.me.name); setText($('me-room'), v.roomCode);
  $('mates').replaceChildren(...v.players.map(p => el('li', { class: p.connected ? '' : 'away' }, p.name, p.playerId === v.me.playerId ? ' (em)' : '')));
  setText($('my-score'), v.me.score);
  $('board-list').replaceChildren(...v.leaderboard.map(r => el('li', { class: r.playerId === v.me.playerId ? 'me' : '' }, el('span', {}, `${r.rank}. ${r.name}`), el('strong', {}, r.score))));
  if (v.status === 'lobby') show('v-wait');
  else if (v.status === 'playing') show('v-play');
  else {
    show('v-end');
    $('podium').replaceChildren(...v.leaderboard.slice(0, 4).map(r => el('li', { class: `place place-${Math.min(r.rank, 4)}` }, el('span', { class: 'rank' }, `Hạng ${r.rank}`), el('span', { class: 'who' }, r.name), el('span', { class: 'pts' }, `${r.score} điểm`))));
    setText($('end-note'), `Em được ${v.me.score} điểm · đúng ${v.me.correct} câu.`);
  }
});

$('join-form').addEventListener('submit', async e => {
  e.preventDefault();
  setText($('join-error'), '');
  const btn = e.submitter; if (btn) btn.disabled = true;
  try { await room.join($('room').value, $('name').value); show('v-wait'); }
  catch (err) { setText($('join-error'), err.message); }
  finally { if (btn) btn.disabled = false; }
});
$('mute').addEventListener('click', () => {
  prefs.muted = !prefs.muted;
  try { localStorage.setItem('cg-muted', prefs.muted ? '1' : '0'); } catch {}
  $('mute').setAttribute('aria-pressed', String(prefs.muted)); setText($('mute'), prefs.muted ? '🔇' : '🔊');
  host.pushSettings();
});
$('mute').setAttribute('aria-pressed', String(prefs.muted)); setText($('mute'), prefs.muted ? '🔇' : '🔊');
$('board-toggle').addEventListener('click', () => { const open = $('board').classList.toggle('open'); $('board-toggle').setAttribute('aria-expanded', String(open)); });

try { if (await room.resume()) show('v-wait'); } catch { /* no saved session */ }
