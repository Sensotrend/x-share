// Small DOM and encoding helpers. Every DOM node is created with h(), which
// sets text through textContent, so data from links or servers is never parsed as HTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// --- base64url ---------------------------------------------------------------
export function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}
export function stringToB64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- formatting --------------------------------------------------------------
const dtf = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const df = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export const fmtDateTime = (epochSec) => (epochSec ? dtf.format(new Date(epochSec * 1000)) : '—');
export const fmtDate = (iso) => (iso ? df.format(new Date(iso)) : '—');

export function fmtRelative(epochSec) {
  const diff = epochSec - Date.now() / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, s] of units) {
    if (abs >= s) return rtf.format(Math.round(diff / s), unit);
  }
  return rtf.format(Math.round(diff), 'second');
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// --- feedback ----------------------------------------------------------------
let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

export async function copyText(text, what = 'Link') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied to clipboard`);
  } catch {
    toast('Copying failed. Select the text and copy it manually.');
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
