/* Classroom Safe DOM 1.0.0 — copy unchanged.
 * Rule: any string that came from a person (student name) or a content source
 * (prompt, option, explanation, title, error message) goes through these helpers. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
}

/** Tagged template: html`<b>${name}</b>` escapes every interpolation.
 * Use raw(trustedMarkup) only for markup written in the game code itself. */
const RAW = Symbol('raw');
export const raw = s => ({ [RAW]: String(s) });
export function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    const part = v && v[RAW] !== undefined ? v[RAW] : Array.isArray(v) ? v.map(x => (x && x[RAW] !== undefined ? x[RAW] : escapeHtml(x))).join('') : escapeHtml(v);
    return out + part + s;
  }, '');
}

/** Builds an element. Text is always set via textContent. No on* attributes allowed. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (/^on/i.test(k)) throw new Error('Use addEventListener, not inline handlers');
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'src' || k === 'href') node.setAttribute(k, safeUrl(v));
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export const setText = (node, value) => { node.textContent = String(value ?? ''); return node; };

/** Only same-folder assets or https. Blocks javascript:, data:, attribute injection. */
export function safeUrl(u) {
  const s = String(u ?? '');
  if (/^(\.\/)?assets\/[A-Za-z0-9_./-]+$/.test(s) && !s.includes('..')) return s;
  try { const url = new URL(s, location.href); if (url.protocol === 'https:' || url.origin === location.origin) return url.href; } catch {}
  return 'about:blank';
}

/** Pick an avatar from a fixed whitelist — never interpolate a filename from data. */
export function pickAvatar(list, playerId) {
  let h = 0; for (const ch of String(playerId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function downloadCsv(filename, rows) {
  const text = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const a = el('a', { download: filename });
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
