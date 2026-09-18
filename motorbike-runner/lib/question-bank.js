/* Classroom Question Bank 1.0.0 — copy unchanged. Used by browser loader and Node server. */
export const BANK_LIMITS = Object.freeze({ maxBytes: 1_000_000, maxQuestions: 100, promptMax: 600, optionMax: 240, explanationMax: 400, titleMax: 100, minOptions: 2, maxOptions: 4, maxPoints: 100, maxTimeLimitMs: 300_000 });
const SUPPORTED_TYPES = ['single-choice'];

async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(n => n.toString(16).padStart(2, '0')).join('');
}
const str = v => (typeof v === 'string' ? v.normalize('NFC').trim() : '');

/** Throws Error with a Vietnamese message pointing to the broken question. Never drops questions silently. */
export async function validateBank(raw, { fetchedAt = Date.now() } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Dữ liệu không phải JSON object.');
  if (raw.schemaVersion !== 1) throw new Error('schemaVersion phải là 1.');
  if (!Array.isArray(raw.questions) || !raw.questions.length) throw new Error('Chưa có câu hỏi nào.');
  if (raw.questions.length > BANK_LIMITS.maxQuestions) throw new Error(`Tối đa ${BANK_LIMITS.maxQuestions} câu hỏi.`);
  const ids = new Set();
  const questions = raw.questions.map((q, i) => {
    const fail = m => { throw new Error(`Câu ${i + 1}: ${m}`); };
    if (!q || typeof q !== 'object') fail('không đúng cấu trúc.');
    const id = str(q.id);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || ids.has(id)) fail('id trống, sai ký tự hoặc bị trùng.');
    ids.add(id);
    if (!SUPPORTED_TYPES.includes(q.type)) fail(`dạng "${String(q.type).slice(0, 30)}" chưa được hỗ trợ (chỉ single-choice).`);
    const prompt = str(q.prompt);
    if (!prompt || prompt.length > BANK_LIMITS.promptMax) fail(`nội dung câu hỏi cần 1–${BANK_LIMITS.promptMax} ký tự.`);
    if (!Array.isArray(q.options) || q.options.length < BANK_LIMITS.minOptions || q.options.length > BANK_LIMITS.maxOptions) fail(`cần ${BANK_LIMITS.minOptions}–${BANK_LIMITS.maxOptions} lựa chọn.`);
    const optIds = new Set();
    const options = q.options.map(o => {
      const oid = str(o?.id), text = str(o?.text);
      if (!/^[A-Za-z0-9_-]{1,10}$/.test(oid) || optIds.has(oid)) fail('id lựa chọn trống hoặc trùng.');
      if (!text || text.length > BANK_LIMITS.optionMax) fail(`lựa chọn cần 1–${BANK_LIMITS.optionMax} ký tự.`);
      optIds.add(oid);
      return { id: oid, text };
    });
    if (!optIds.has(q.correctOptionId)) fail('đáp án đúng không khớp lựa chọn nào.');
    const points = q.points ?? 10;
    if (!Number.isInteger(points) || points < 0 || points > BANK_LIMITS.maxPoints) fail(`điểm phải là số nguyên 0–${BANK_LIMITS.maxPoints}.`);
    const out = { id, type: q.type, prompt, options, correctOptionId: q.correctOptionId, points };
    const explanation = str(q.explanation);
    if (explanation) { if (explanation.length > BANK_LIMITS.explanationMax) fail('giải thích quá dài.'); out.explanation = explanation; }
    if (q.timeLimitMs != null) {
      if (!Number.isInteger(q.timeLimitMs) || q.timeLimitMs < 3000 || q.timeLimitMs > BANK_LIMITS.maxTimeLimitMs) fail('timeLimitMs phải từ 3000 đến 300000.');
      out.timeLimitMs = q.timeLimitMs;
    }
    if (q.media != null) {
      const src = str(q.media?.src);
      if (!/^(assets\/[A-Za-z0-9_./-]+|https:\/\/[^\s"'<>]+)$/.test(src) || src.includes('..')) fail('media.src phải là assets/... hoặc https://');
      out.media = { kind: ['image', 'audio'].includes(q.media.kind) ? q.media.kind : 'image', src, alt: str(q.media.alt).slice(0, 200) };
    }
    return out;
  });
  const title = str(raw.title).slice(0, BANK_LIMITS.titleMax) || 'Bộ câu hỏi';
  const contentVersion = (await sha256Hex(JSON.stringify({ title, questions }))).slice(0, 12);
  return { schemaVersion: 1, title, questions, contentVersion, fetchedAt };
}

/** Plain-text format for Google Docs (export?format=txt):
 *   # Tiêu đề bộ câu hỏi        (optional, first line)
 *   1. Nội dung câu hỏi
 *   a. Lựa chọn
 *   b. Lựa chọn đúng ✅
 *   Giải thích: ...             (optional)
 *   Thời gian: 20               (optional, seconds)
 *   Điểm: 10                    (optional)
 */
export function parseDocText(text) {
  const questions = [];
  let title = '', cur = null;
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((rawLine, n) => {
    const line = rawLine.trim();
    if (!line) return;
    const where = `Dòng ${n + 1}`;
    let m;
    if (!questions.length && !title && (m = line.match(/^#\s*(.+)$/))) { title = m[1]; return; }
    if ((m = line.match(/^(\d{1,3})\s*[.)]\s*(.+)$/))) {
      cur = { id: 'q-' + m[1].padStart(3, '0'), type: 'single-choice', prompt: m[2], options: [], points: 10 };
      questions.push(cur); return;
    }
    if (!cur) throw new Error(`${where}: cần bắt đầu bằng "1. Nội dung câu hỏi".`);
    if ((m = line.match(/^([a-dA-D])\s*[.)]\s*(.+)$/))) {
      const id = m[1].toLowerCase(), marked = /✅|\(đúng\)|\*$/i.test(m[2]);
      if (marked && cur.correctOptionId) throw new Error(`${where}: câu ${cur.id} có hơn một đáp án đánh dấu ✅.`);
      cur.options.push({ id, text: m[2].replace(/✅|\(đúng\)|\*$/gi, '').trim() });
      if (marked) cur.correctOptionId = id;
      return;
    }
    if ((m = line.match(/^giải thích\s*:\s*(.+)$/i))) { cur.explanation = m[1]; return; }
    if ((m = line.match(/^thời gian\s*:\s*(\d{1,3})\s*(giây|s)?$/i))) { cur.timeLimitMs = Number(m[1]) * 1000; return; }
    if ((m = line.match(/^điểm\s*:\s*(\d{1,3})$/i))) { cur.points = Number(m[1]); return; }
    throw new Error(`${where}: chưa đúng định dạng → "${line.slice(0, 60)}"`);
  });
  questions.forEach(q => { if (!q.correctOptionId) throw new Error(`Câu ${q.id}: cần đánh dấu ✅ sau một đáp án đúng.`); });
  return { schemaVersion: 1, title, questions };
}

/** Streams a fetch Response body with a hard byte cap (does not buffer an unbounded body first). */
export async function readCapped(response, maxBytes = BANK_LIMITS.maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) throw new Error('Dữ liệu vượt 1 MB.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('Dữ liệu vượt 1 MB.'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size); let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}
