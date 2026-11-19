// Local persistence for settings and created links. If localStorage is
// unavailable (private mode, blocked site data), it falls back to memory.

const LINKS_KEY = 'shl-utility:links:v1';
const SETTINGS_KEY = 'shl-utility:settings:v1';

export const DEFAULT_SETTINGS = Object.freeze({
  server: 'https://shl.sensotrend.com',
  viewer: 'https://ips.sensotrend.com/view/',
});

const memory = new Map();
let persistent = true;

function read(key) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? memory.get(key) ?? null : v;
  } catch {
    persistent = false;
    return memory.get(key) ?? null;
  }
}
function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    persistent = false;
  }
}

export function isPersistent() {
  read(LINKS_KEY);
  try {
    const probe = '__shl_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    persistent = false;
  }
  return persistent;
}

// --- settings ----------------------------------------------------------------
export function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(read(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(s) {
  write(SETTINGS_KEY, JSON.stringify(s));
}

// --- links -------------------------------------------------------------------
/**
 * Link record:
 * { id, server, shlink, managementToken, label, exp, flag, longTerm, hasPasscode,
 *   bundleTitle, bundleId, createdAt, status?, statusCheckedAt? }
 */
export function getLinks() {
  try {
    const data = JSON.parse(read(LINKS_KEY) || '{"links":[]}');
    return Array.isArray(data.links) ? data.links : [];
  } catch {
    return [];
  }
}
function saveLinks(links) {
  write(LINKS_KEY, JSON.stringify({ version: 1, links }));
  window.dispatchEvent(new CustomEvent('links-changed'));
}
export function addLink(link) {
  saveLinks([link, ...getLinks().filter((l) => l.id !== link.id)]);
}
export function updateLink(id, patch) {
  saveLinks(getLinks().map((l) => (l.id === id ? { ...l, ...patch } : l)));
}
export function removeLink(id) {
  saveLinks(getLinks().filter((l) => l.id !== id));
}

export function exportLinks() {
  return JSON.stringify({ format: 'shl-utility-links', version: 1, exportedAt: new Date().toISOString(), links: getLinks() }, null, 2);
}

/** Merge imported links; returns the number of new entries. */
export function importLinks(text) {
  const data = JSON.parse(text);
  const incoming = Array.isArray(data) ? data : data.links;
  if (!Array.isArray(incoming)) throw new Error('The file does not contain a list of links.');
  const valid = incoming.filter((l) => l && typeof l.id === 'string' && typeof l.shlink === 'string' && typeof l.managementToken === 'string');
  if (!valid.length) throw new Error('No valid links found in the file.');
  const existing = getLinks();
  const ids = new Set(existing.map((l) => l.id));
  const added = valid.filter((l) => !ids.has(l.id));
  saveLinks([...existing, ...added].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  return added.length;
}
