// Parsing and formatting of SMART Health Links (shlink:/ URIs).
import { b64urlToString } from './util.js';

const SHLINK_RE = /shlink:\/([A-Za-z0-9_-]+)/;

/** Extract and decode the payload from a bare shlink:/ or a viewer URL (…#shlink:/…). */
export function parseShlink(text) {
  const m = SHLINK_RE.exec((text || '').trim());
  if (!m) throw new Error('This is not a SMART Health Link. A link contains “shlink:/” followed by encoded data.');
  let payload;
  try {
    payload = JSON.parse(b64urlToString(m[1]));
  } catch {
    throw new Error('The link is damaged: its payload could not be decoded.');
  }
  if (!payload || typeof payload.url !== 'string' || typeof payload.key !== 'string') {
    throw new Error('The link is missing required information (url and key).');
  }
  if (payload.key.length !== 43) throw new Error('The link contains an invalid decryption key.');
  return { shlink: `shlink:/${m[1]}`, payload };
}

/** Prepend a viewer address, as the SHL spec allows: https://viewer.example/#shlink:/… */
export function withViewer(shlink, viewer) {
  if (!viewer) return shlink;
  const base = viewer.includes('#') ? viewer.slice(0, viewer.indexOf('#')) : viewer;
  return `${base}#${shlink}`;
}

export const FLAG_TEXT = {
  L: 'Long-term: the receiver may check the link again for updates',
  P: 'Passcode required',
  U: 'Direct file access (single file, no passcode)',
};

export function describeFlags(flag = '') {
  return [...flag].map((f) => FLAG_TEXT[f] || `Unknown flag “${f}”`);
}
