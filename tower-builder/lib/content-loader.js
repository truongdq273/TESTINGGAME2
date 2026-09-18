/* Classroom Content Loader 1.0.0 — copy unchanged. LOCAL DEMO ONLY, runs in the teacher tab.
 * In server mode the server loads content; student pages never fetch a question bank. */
import { validateBank, readCapped } from './question-bank.js';

let latest = 0;

export function checkSourceUrl(rawUrl, allowedHosts = []) {
  let url;
  try { url = new URL(rawUrl, location.href); } catch { throw new Error('Địa chỉ nguồn không hợp lệ.'); }
  if (url.username || url.password) throw new Error('Không đặt tài khoản/mật khẩu trong URL.');
  if (url.origin === location.origin) return url;
  if (url.protocol !== 'https:') throw new Error('Nguồn ngoài phải dùng HTTPS.');
  if (!allowedHosts.includes(url.hostname)) throw new Error(`Máy chủ "${url.hostname}" chưa nằm trong danh sách cho phép.`);
  return url;
}

/** Returns a validated bank or throws. Stale responses (older request) are rejected. */
export async function loadQuestionBank(source, { signal, timeoutMs = 10_000 } = {}) {
  const ticket = ++latest;
  const url = checkSourceUrl(source.url, source.allowedHosts);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const relay = () => ctl.abort(signal.reason);
  signal?.addEventListener('abort', relay, { once: true });
  try {
    let res;
    try {
      res = await fetch(url, { signal: ctl.signal, cache: 'no-cache', redirect: 'error', credentials: 'omit', mode: 'cors' });
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'Hết thời gian tải (10 giây).' : 'Không tải được nguồn: kiểm tra mạng, quyền đọc hoặc CORS.');
    }
    if (res.status === 401 || res.status === 403) throw new Error('Nguồn từ chối quyền đọc.');
    if (!res.ok) throw new Error(`Nguồn trả về lỗi HTTP ${res.status}.`);
    const text = await readCapped(res);
    let raw;
    try { raw = JSON.parse(text); } catch { throw new Error('Nguồn không trả về JSON hợp lệ.'); }
    const bank = await validateBank(raw);
    if (ticket !== latest) throw Object.assign(new Error('Đã có yêu cầu tải mới hơn.'), { stale: true });
    return bank;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}
