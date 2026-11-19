import { h, $, clear, toast, copyText, downloadBlob, fmtDateTime, fmtDate, fmtRelative, fmtBytes } from './util.js';
import { parseShlink, withViewer, describeFlags } from './shlink.js';
import { createLink, getStatus, revokeLink, fetchManifest, fetchLocation } from './api.js';
import { decryptJwe } from './jwe.js';
import * as store from './storage.js';
import { loadCatalog, loadBundle, entryFromUserJson, countResources, narrativeText } from './bundles.js';
import { renderQR, canvasToBlob } from './qr.js';

const state = {
  catalog: [],
  selected: null, // catalog entry
  own: null, // user-provided entry
};

// ============================================================================
// Tabs
// ============================================================================
function showView(name, { focus = false } = {}) {
  for (const tab of document.querySelectorAll('[role=tab]')) {
    const on = tab.dataset.view === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`#${tab.getAttribute('aria-controls')}`).hidden = !on;
    if (on && focus) tab.focus();
  }
  if (name === 'links') renderLinks({ refresh: true });
  window.scrollTo({ top: 0 });
}

function initTabs() {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
    tab.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) showView(tabs[(i + d + tabs.length) % tabs.length].dataset.view, { focus: true });
    });
  });
}

// ============================================================================
// Step 1: bundle selection
// ============================================================================
function bundleCard(entry, checked) {
  const chips = Object.entries(entry.resources || {})
    .filter(([t]) => !['Composition', 'Provenance'].includes(t))
    .slice(0, 6)
    .map(([t, n]) => h('span', { class: 'chip' }, `${n} × ${t}`));
  const input = h('input', { type: 'radio', name: 'bundle', value: entry.id, checked, 'aria-describedby': `desc-${entry.id}` });
  input.addEventListener('change', () => selectBundle(entry));
  return h('label', { class: 'bundle-card' },
    input,
    h('span', { class: 'check', 'aria-hidden': 'true' }),
    h('span', { class: 'bundle-title' }, entry.title),
    h('p', { class: 'bundle-desc', id: `desc-${entry.id}` }, entry.description),
    h('p', { class: 'bundle-meta' },
      [entry.patient, entry.date && fmtDate(entry.date), entry.size && fmtBytes(entry.size)].filter(Boolean).join(' · ')),
    entry.originalTitle ? h('p', { class: 'bundle-meta' }, `Original title: “${entry.originalTitle}”`) : null,
    h('span', { class: 'chips' }, chips),
  );
}

function renderBundles() {
  const list = $('#bundle-list');
  const entries = state.own ? [...state.catalog, state.own] : state.catalog;
  clear(list, entries.map((e) => bundleCard(e, state.selected?.id === e.id)));
}

function selectBundle(entry) {
  state.selected = entry;
  updateSummary();
}

async function initBundles() {
  try {
    state.catalog = await loadCatalog();
    state.selected = state.catalog[0];
    renderBundles();
  } catch (e) {
    clear($('#bundle-list'), h('p', { class: 'error' }, e.message));
  }

  const msg = $('#own-msg');
  $('#own-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    $('#own-text').value = await f.text();
    useOwn();
  });
  $('#own-use').addEventListener('click', useOwn);

  function useOwn() {
    msg.className = 'field-msg';
    try {
      const entry = entryFromUserJson($('#own-text').value);
      state.own = entry;
      state.selected = entry;
      renderBundles();
      msg.classList.add('ok');
      const n = Object.values(entry.resources).reduce((a, b) => a + b, 0);
      msg.textContent = `Loaded “${entry.title}” (${n} resource${n === 1 ? '' : 's'}). It is now selected.`;
      updateSummary();
    } catch (err) {
      msg.classList.add('bad');
      msg.textContent = err.message;
    }
  }
}

// ============================================================================
// Step 2: options
// ============================================================================
function computeExp() {
  const preset = $('#opt-exp-preset').value;
  if (!preset) return null;
  if (preset === 'custom') {
    const v = $('#opt-exp-custom').value;
    return v ? Math.floor(new Date(v).getTime() / 1000) : undefined;
  }
  return Math.floor(Date.now() / 1000) + Number(preset);
}

function updateSummary() {
  const label = $('#opt-label').value.trim();
  $('#label-counter').textContent = `${label.length}/80`;
  const pass = $('#opt-passcode').value;
  const exp = computeExp();
  const longTerm = $('#opt-longterm').checked;

  const what = state.selected ? `can view “${state.selected.title}”` : 'can view the selected document';
  const until = exp === undefined ? '(pick an expiration date and time)'
    : exp ? `until ${fmtDateTime(exp)}` : 'until you revoke the link';
  clear($('#share-summary'),
    'Anyone who has the link or QR code ',
    pass ? [h('b', {}, 'and the passcode'), ' '] : null,
    `${what} ${until}.`,
    longTerm ? ' Their app may keep the link and check it again for updates.' : null,
    longTerm && !exp ? ' ⚠ Long-term without an expiry: remember to revoke the link when it is no longer needed.' : null);
}

function initOptions() {
  const form = $('#share-form');
  form.addEventListener('input', updateSummary);
  form.addEventListener('change', updateSummary);

  const preset = $('#opt-exp-preset');
  const custom = $('#opt-exp-custom');
  preset.addEventListener('change', () => {
    custom.hidden = preset.value !== 'custom';
    if (!custom.hidden) {
      const d = new Date(Date.now() + 7 * 86400e3);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      custom.value ||= d.toISOString().slice(0, 16);
      custom.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
      custom.focus();
    }
    updateSummary();
  });

  const toggle = $('#toggle-passcode');
  toggle.addEventListener('click', () => {
    const input = $('#opt-passcode');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(show));
  });

  form.addEventListener('submit', onShare);
  updateSummary();
}

// ============================================================================
// Step 3: create
// ============================================================================
async function onShare(e) {
  e.preventDefault();
  const errEl = $('#share-error');
  errEl.hidden = true;
  const fail = (m) => { errEl.textContent = m; errEl.hidden = false; };

  if (!state.selected) return fail('Choose a document to share first.');
  const exp = computeExp();
  if (exp === undefined) return fail('Pick an expiration date and time, or choose another expiry option.');
  if (exp && exp <= Date.now() / 1000 + 30) return fail('The expiration time must be in the future.');

  const label = $('#opt-label').value.trim();
  const passcode = $('#opt-passcode').value;
  const longTerm = $('#opt-longterm').checked;
  const { server } = store.getSettings();

  const btn = $('#share-btn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Creating link…';
  try {
    const bundle = await loadBundle(state.selected);
    const res = await createLink(server, { bundle, label, passcode, exp, longTerm });
    const { payload } = parseShlink(res.shlink);
    const record = {
      id: res.id,
      server,
      shlink: res.shlink,
      managementToken: res.managementToken,
      label: payload.label || label || '',
      exp: res.exp ?? payload.exp ?? null,
      flag: payload.flag || '',
      longTerm,
      hasPasscode: Boolean(passcode),
      bundleId: state.selected.id,
      bundleTitle: state.selected.title,
      createdAt: Math.floor(Date.now() / 1000),
    };
    store.addLink(record);
    $('#opt-passcode').value = '';
    updateSummary();
    const out = $('#share-result');
    clear(out, h('h2', {}, 'Your SMART Health Link is ready'), linkDetail(record, { fresh: true }));
    out.hidden = false;
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    out.focus({ preventScroll: true });
  } catch (err) {
    fail(err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Create SMART Health Link';
  }
}

// ============================================================================
// Link detail (shared by result view and My links)
// ============================================================================
function computeStatus(rec) {
  const s = rec.status;
  const now = Date.now() / 1000;
  if (s?.burnedAt) return { key: 'revoked', text: 'Revoked' };
  if (s && s.passcodeAttemptsRemaining === 0) return { key: 'locked', text: 'Locked' };
  if (rec.exp && rec.exp < now) return { key: 'expired', text: 'Expired' };
  if (rec.statusError) return { key: 'unknown', text: 'Unknown' };
  return { key: 'active', text: 'Active' };
}

function statusBadge(rec) {
  const st = computeStatus(rec);
  return h('span', { class: `status status-${st.key}` }, st.text);
}

const OUTCOME_TEXT = { ok: 'Opened', bad_passcode: 'Wrong passcode', expired: 'Expired', locked: 'Locked', revoked: 'Revoked' };

function linkDetail(rec, { fresh = false } = {}) {
  const { viewer } = store.getSettings();
  const full = withViewer(rec.shlink, viewer);
  const container = h('div', { class: 'link-detail' });

  function render() {
    const status = computeStatus(rec);
    const usable = status.key === 'active' || status.key === 'unknown';
    const canvas = renderQR(full);
    canvas.setAttribute('aria-label', `QR code for ${rec.label || rec.bundleTitle}`);
    const fileBase = `shl-${(rec.label || rec.bundleTitle || 'link').replace(/[^\w-]+/g, '-').slice(0, 40)}`;

    const s = rec.status;
    const log = s?.accessLog || [];

    clear(container,
      h('div', { class: 'link-detail-head' },
        h('h3', {}, rec.label || rec.bundleTitle || 'SMART Health Link'),
        statusBadge(rec)),
      h('div', { class: 'link-grid' },
        h('div', { class: 'qr-box' },
          h('div', { class: 'qr-frame' }, canvas),
          h('p', { class: 'qr-caption' }, usable ? 'Show this QR code to the receiver, or send them the link.' : 'This link no longer works.'),
          h('div', { class: 'row wrap-row' },
            h('button', { type: 'button', class: 'btn btn-small', onclick: async () => downloadBlob(await canvasToBlob(canvas), `${fileBase}.png`) }, 'Download QR'),
            navigator.share ? h('button', {
              type: 'button', class: 'btn btn-small',
              onclick: () => navigator.share(full.startsWith('http')
                ? { title: rec.label || 'SMART Health Link', url: full }
                : { title: rec.label || 'SMART Health Link', text: full }).catch(() => {}),
            }, 'Share…') : null)),
        h('div', {},
          h('label', { class: 'section-title', for: `lt-${rec.id}` }, viewer ? 'Link (opens in viewer)' : 'Link'),
          h('div', { class: 'link-text' },
            h('input', { id: `lt-${rec.id}`, readonly: true, value: full, onfocus: (e) => e.target.select() }),
            h('button', { type: 'button', class: 'btn', onclick: () => copyText(full) }, 'Copy')),
          viewer ? h('div', { class: 'row wrap-row' },
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => copyText(rec.shlink, 'shlink') }, 'Copy plain shlink:/'),
            h('a', { class: 'btn btn-small', href: full, target: '_blank', rel: 'noopener noreferrer' }, 'Open in viewer ↗')) : null,
          rec.hasPasscode && fresh ? h('p', { class: 'note' }, '🔑 Remember to give the receiver the passcode separately. It is not part of the link, and this app has not saved it.') : null,
          h('dl', { class: 'kv' },
            h('dt', {}, 'Data'), h('dd', {}, rec.bundleTitle || '—'),
            h('dt', {}, 'Created'), h('dd', {}, fmtDateTime(rec.createdAt)),
            h('dt', {}, 'Expires'), h('dd', {}, rec.exp ? `${fmtDateTime(rec.exp)} (${fmtRelative(rec.exp)})` : 'Never (until revoked)'),
            h('dt', {}, 'Passcode'), h('dd', {}, rec.hasPasscode || rec.flag?.includes('P')
              ? `Required${s?.passcodeAttemptsRemaining != null ? ` · ${s.passcodeAttemptsRemaining} wrong attempts left` : ''}`
              : 'None'),
            h('dt', {}, 'Flags'), h('dd', {}, rec.flag ? describeFlags(rec.flag).join('; ') : 'None'),
            s?.burnedAt ? [h('dt', {}, 'Revoked'), h('dd', {}, fmtDateTime(s.burnedAt))] : null,
            h('dt', {}, 'Server'), h('dd', {}, new URL(rec.server).host)),
          h('div', { class: 'section-title' }, 'Access log'),
          rec.statusError ? h('p', { class: 'error' }, rec.statusError)
            : !s ? h('p', { class: 'muted' }, 'Not loaded yet. Click “Refresh status”.')
            : !log.length ? h('p', { class: 'muted' }, 'Nobody has opened this link yet.')
            : h('div', { class: 'log-wrap' }, h('table', { class: 'log' },
              h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Recipient'), h('th', {}, 'Result'))),
              h('tbody', {}, [...log].reverse().map((a) => h('tr', {},
                h('td', {}, fmtDateTime(a.createdAt)),
                h('td', {}, a.recipient || '—'),
                h('td', {}, OUTCOME_TEXT[a.outcome] || a.outcome)))))),
          rec.statusCheckedAt ? h('p', { class: 'checked-at' },`Status checked ${fmtRelative(rec.statusCheckedAt)}.`) : null,
          h('div', { class: 'actions' },
            h('button', { type: 'button', class: 'btn', onclick: refresh }, 'Refresh status'),
            h('button', { type: 'button', class: 'btn', onclick: () => openInTester(rec) }, 'Test open'),
            usable && status.key !== 'revoked' ? h('button', { type: 'button', class: 'btn btn-danger', onclick: revoke }, 'Revoke…') : null,
            h('button', { type: 'button', class: 'btn btn-ghost', onclick: forget }, 'Forget')))));
  }

  async function refresh() {
    rec = { ...rec, ...(await refreshStatus(rec)) };
    render();
  }

  async function revoke() {
    if (!confirm(`Revoke “${rec.label || rec.bundleTitle}”?\n\nThe link and QR code stop working immediately, for everyone. This cannot be undone.`)) return;
    try {
      await revokeLink(rec.server, rec.id, rec.managementToken);
      toast('Link revoked');
      await refresh();
    } catch (e) {
      alert(`Revoking failed: ${e.message}`);
    }
  }

  function forget() {
    const st = computeStatus(rec).key;
    const warn = st === 'active' || st === 'unknown'
      ? '\n\nThe link itself keeps working. Without the management token you can no longer revoke it or see its access log.'
      : '';
    if (!confirm(`Remove “${rec.label || rec.bundleTitle}” from this browser?${warn}`)) return;
    store.removeLink(rec.id);
    container.closest('.link-item')?.remove();
    if (container.parentElement?.id === 'share-result') $('#share-result').hidden = true;
    toast('Link removed from this browser');
  }

  render();
  if (fresh) refresh();
  return container;
}

async function refreshStatus(rec) {
  let patch;
  try {
    const status = await getStatus(rec.server, rec.id, rec.managementToken);
    patch = { status, statusError: null, statusCheckedAt: Math.floor(Date.now() / 1000) };
    if (status?.exp !== undefined) patch.exp = status.exp;
  } catch (e) {
    patch = { statusError: e.status === 401 || e.status === 403 || e.status === 404
      ? `${e.message} You can remove this entry with “Forget”.`
      : e.message, statusCheckedAt: Math.floor(Date.now() / 1000) };
  }
  store.updateLink(rec.id, patch);
  return patch;
}

// ============================================================================
// My links
// ============================================================================
let lastAutoRefresh = 0;
function renderLinks({ refresh = false } = {}) {
  const links = store.getLinks();
  const list = $('#links-list');
  if (!links.length) {
    clear(list, h('div', { class: 'empty' },
      h('img', { src: 'assets/yellow-button.svg', alt: '' }),
      h('p', {}, 'You have not created any links in this browser yet.'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => showView('share') }, 'Share health data')));
    return;
  }
  clear(list, links.map((rec) => {
    const item = h('details', { class: 'link-item', dataset: { id: rec.id } },
      h('summary', {},
        h('span', { class: 'link-item-title' }, rec.label || rec.bundleTitle || rec.id),
        statusBadge(rec),
        h('span', { class: 'link-item-meta' }, [
          rec.label ? rec.bundleTitle : null,
          `created ${fmtDateTime(rec.createdAt)}`,
          rec.exp ? `expires ${fmtDateTime(rec.exp)}` : 'no expiry',
          rec.hasPasscode || rec.flag?.includes('P') ? 'passcode' : null,
          rec.flag?.includes('L') ? 'long-term' : null,
          rec.status ? `opened ${rec.status.accessLog?.filter((a) => a.outcome === 'ok').length || 0}×` : null,
        ].filter(Boolean).join(' · '))));
    item.addEventListener('toggle', () => {
      if (item.open && !item.querySelector('.link-detail')) {
        const current = store.getLinks().find((l) => l.id === rec.id) || rec;
        item.append(linkDetail(current));
      }
    }, { once: false });
    return item;
  }));

  if (refresh && Date.now() - lastAutoRefresh > 60e3) {
    lastAutoRefresh = Date.now();
    refreshAll({ quiet: true });
  }
}

async function refreshAll({ quiet = false } = {}) {
  const links = store.getLinks();
  if (!links.length) return;
  const btn = $('#refresh-all');
  btn.disabled = true;
  await Promise.all(links.map((l) => refreshStatus(l)));
  btn.disabled = false;
  const openIds = [...document.querySelectorAll('.link-item[open]')].map((d) => d.dataset.id);
  renderLinks();
  for (const id of openIds) {
    const d = document.querySelector(`.link-item[data-id="${CSS.escape(id)}"]`);
    if (d) d.open = true;
  }
  if (!quiet) toast('Status updated');
}

function initLinks() {
  $('#refresh-all').addEventListener('click', () => refreshAll());
  $('#export-links').addEventListener('click', () => {
    if (!store.getLinks().length) return toast('There are no links to export');
    downloadBlob(new Blob([store.exportLinks()], { type: 'application/json' }), `shl-links-${new Date().toISOString().slice(0, 10)}.json`);
  });
  $('#import-links').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const n = store.importLinks(await f.text());
      toast(n ? `Imported ${n} link${n === 1 ? '' : 's'}` : 'All links in the file were already here');
      renderLinks({ refresh: true });
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });
  const updateCount = () => { $('#links-count').textContent = store.getLinks().length || ''; };
  window.addEventListener('links-changed', updateCount);
  updateCount();
}

// ============================================================================
// Open / test a link (receiver view)
// ============================================================================
function openInTester(rec) {
  $('#test-link').value = rec.shlink;
  $('#test-passcode').value = '';
  clear($('#test-result'));
  showView('test');
  if (rec.hasPasscode || rec.flag?.includes('P')) $('#test-passcode').focus();
  else $('#test-btn').focus();
}

async function onTest(e) {
  e.preventDefault();
  const out = $('#test-result');
  const btn = $('#test-btn');
  let parsed;
  try {
    parsed = parseShlink($('#test-link').value);
  } catch (err) {
    return clear(out, h('p', { class: 'error' }, err.message));
  }
  const p = parsed.payload;
  const header = h('div', { class: 'viewer-card' },
    h('h3', {}, p.label || 'SMART Health Link'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Server'), h('dd', {}, new URL(p.url).host),
      h('dt', {}, 'Expires'), h('dd', {}, p.exp ? `${fmtDateTime(p.exp)} (${fmtRelative(p.exp)})` : 'Not specified'),
      h('dt', {}, 'Flags'), h('dd', {}, p.flag ? describeFlags(p.flag).join('; ') : 'None'),
      h('dt', {}, 'Version'), h('dd', {}, String(p.v ?? 1))));
  clear(out, header);

  if (p.exp && p.exp < Date.now() / 1000) {
    out.append(h('p', { class: 'error' }, 'This link has expired.'));
    return;
  }
  const passcode = $('#test-passcode').value;
  if (p.flag?.includes('P') && !passcode) {
    out.append(h('p', { class: 'error' }, 'This link needs a passcode. Enter it above and try again.'));
    $('#test-passcode').focus();
    return;
  }
  if (p.flag?.includes('U')) {
    out.append(h('p', { class: 'error' }, 'Direct-file (U flag) links are not supported by this tester.'));
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Opening…';
  const progress = h('p', { class: 'muted' }, 'Fetching the manifest…');
  out.append(progress);
  try {
    const manifest = await fetchManifest(p.url, { recipient: $('#test-recipient').value.trim(), passcode });
    const files = manifest?.files || [];
    progress.textContent = `Decrypting ${files.length} file${files.length === 1 ? '' : 's'}…`;
    for (const [i, f] of files.entries()) {
      const jwe = f.embedded || (f.location ? await fetchLocation(f.location) : null);
      if (!jwe) throw new Error('A file in the manifest has no content.');
      const { text } = await decryptJwe(jwe, p.key);
      out.append(renderFile(f.contentType, text, i, Boolean(f.location)));
    }
    progress.textContent = `✓ Decrypted ${files.length} file${files.length === 1 ? '' : 's'} in your browser.`;
    progress.className = 'field-msg ok';
    // Keep a stored record's status in sync after a self-test.
    const rec = store.getLinks().find((l) => l.shlink === parsed.shlink);
    if (rec) refreshStatus(rec);
  } catch (err) {
    progress.remove();
    out.append(h('p', { class: 'error' }, err.message));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Open link';
  }
}

function renderFile(contentType, text, index, viaLocation) {
  let json;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const card = h('div', { class: 'viewer-card' });
  const dl = () => downloadBlob(new Blob([text], { type: contentType }), `shl-file-${index + 1}.json`);

  if (json?.resourceType === 'Bundle') {
    const entries = json.entry || [];
    const byRef = new Map(entries.map((e) => [e.fullUrl, e.resource]));
    const comp = entries.find((e) => e.resource?.resourceType === 'Composition')?.resource;
    const patient = entries.find((e) => e.resource?.resourceType === 'Patient')?.resource;
    const name = patient?.name?.[0];
    const counts = countResources(json);
    card.append(
      h('h3', {}, comp?.title || `FHIR Bundle (${json.type || 'unknown type'})`),
      h('dl', { class: 'kv' },
        comp?.type?.coding?.[0] ? [h('dt', {}, 'Document'), h('dd', {}, comp.type.coding[0].display || comp.type.coding[0].code)] : null,
        comp?.date ? [h('dt', {}, 'Date'), h('dd', {}, fmtDate(comp.date))] : null,
        patient ? [h('dt', {}, 'Patient'), h('dd', {},
          [[...(name?.given || []), name?.family].filter(Boolean).join(' ') || '—', patient.birthDate && `born ${fmtDate(patient.birthDate)}`].filter(Boolean).join(', '))] : null,
        h('dt', {}, 'Content'), h('dd', {}, `${contentType}, ${fmtBytes(new Blob([text]).size)}${viaLocation ? ', downloaded from file location' : ', embedded in manifest'}`)),
      h('div', { class: 'chips' }, Object.entries(counts).map(([t, n]) => h('span', { class: 'chip' }, `${n} × ${t}`))),
    );
    for (const sec of comp?.section || []) {
      const txt = narrativeText(sec.text?.div);
      const refs = (sec.entry || []).map((r) => byRef.get(r.reference)).filter(Boolean);
      card.append(h('div', { class: 'doc-section' },
        h('h4', {}, sec.title || sec.code?.coding?.[0]?.display || 'Section'),
        txt ? h('div', { class: 'narrative' }, txt)
          : refs.length ? h('div', { class: 'narrative' }, refs.map((r) => `${r.resourceType}`).join(', '))
          : h('p', { class: 'muted' }, 'No narrative.')));
    }
  } else {
    card.append(h('h3', {}, `File ${index + 1}`), h('p', { class: 'muted' }, contentType));
  }
  card.append(
    h('details', { class: 'plain' }, h('summary', {}, 'Show decrypted JSON'),
      h('pre', { class: 'json' }, json ? JSON.stringify(json, null, 2) : text)),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-small', onclick: dl }, 'Download decrypted file')));
  return card;
}

function initTester() {
  $('#test-form').addEventListener('submit', onTest);
  // Act as a viewer too: index.html#shlink:/… opens straight into the tester.
  const fromHash = () => {
    if (location.hash.includes('shlink:/')) {
      $('#test-link').value = decodeURIComponent(location.hash.slice(1));
      history.replaceState(null, '', location.pathname + location.search);
      showView('test');
      try {
        if (parseShlink($('#test-link').value).payload.flag?.includes('P')) $('#test-passcode').focus();
        else $('#test-form').requestSubmit();
      } catch { /* error is shown on submit */ }
    }
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();
}

// ============================================================================
// Settings
// ============================================================================
function initSettings() {
  const dlg = $('#settings-dialog');
  const server = $('#set-server');
  const viewer = $('#set-viewer');
  const updateServerName = () => {
    const s = store.getSettings().server;
    document.querySelectorAll('.server-name').forEach((el) => { try { el.textContent = new URL(s).host; } catch { el.textContent = s; } });
  };
  $('#open-settings').addEventListener('click', () => {
    const s = store.getSettings();
    server.value = s.server;
    viewer.value = s.viewer;
    dlg.showModal();
  });
  $('#settings-reset').addEventListener('click', () => {
    server.value = store.DEFAULT_SETTINGS.server;
    viewer.value = store.DEFAULT_SETTINGS.viewer;
  });
  $('#settings-form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'save') return;
    const valid = (v, allowEmpty) => (allowEmpty && !v) || /^https:\/\//i.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(v);
    if (!valid(server.value.trim()) || !valid(viewer.value.trim(), true)) {
      e.preventDefault();
      alert('Addresses must start with https:// (http:// is allowed only for localhost).');
      return;
    }
    store.saveSettings({ server: server.value.trim().replace(/\/+$/, ''), viewer: viewer.value.trim() });
    updateServerName();
    toast('Settings saved');
  });
  updateServerName();
}

// ============================================================================
async function main() {
  if (!store.isPersistent()) $('#storage-banner').hidden = false;
  initTabs();
  initSettings();
  initOptions();
  initLinks();
  initTester();
  await initBundles();
  updateSummary();
}

main();
