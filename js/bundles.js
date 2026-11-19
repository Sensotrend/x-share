// The catalog of included example documents, and helpers for FHIR Bundles.

let catalogPromise;
export function loadCatalog() {
  catalogPromise ??= fetch('bundles/index.json').then((r) => {
    if (!r.ok) throw new Error('Could not load the list of example documents.');
    return r.json();
  });
  return catalogPromise;
}

const cache = new Map();
export async function loadBundle(entry) {
  if (entry.bundle) return entry.bundle; // the user's own Bundle
  if (!cache.has(entry.file)) {
    cache.set(entry.file, fetch(`bundles/${encodeURIComponent(entry.file)}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${entry.title}.`);
      return r.json();
    }));
  }
  try {
    return await cache.get(entry.file);
  } catch (e) {
    cache.delete(entry.file);
    throw e;
  }
}

export function countResources(bundle) {
  const counts = {};
  for (const e of bundle.entry || []) {
    const t = e.resource?.resourceType;
    if (t) counts[t] = (counts[t] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

/** Validate user-provided JSON text and turn it into a catalog-like entry. */
export function entryFromUserJson(text) {
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch (e) {
    throw new Error(`This is not valid JSON: ${e.message}`);
  }
  if (bundle?.resourceType !== 'Bundle') throw new Error('The JSON is not a FHIR Bundle (resourceType must be “Bundle”).');
  const comp = bundle.entry?.find((e) => e.resource?.resourceType === 'Composition')?.resource;
  const patient = bundle.entry?.find((e) => e.resource?.resourceType === 'Patient')?.resource;
  const name = patient?.name?.[0];
  return {
    id: `own-${bundle.id || Date.now()}`,
    own: true,
    title: comp?.title || `My ${bundle.type || ''} Bundle`.replace(/\s+/g, ' '),
    description: 'Your own FHIR Bundle, loaded in this browser.',
    documentType: comp?.type?.coding?.[0]?.display,
    patient: name ? [...(name.given || []), name.family].filter(Boolean).join(' ') : undefined,
    date: comp?.date || bundle.timestamp,
    size: new Blob([text]).size,
    resources: countResources(bundle),
    bundle,
  };
}

/** Plain-text narrative from a FHIR XHTML div, without rendering any HTML. */
export function narrativeText(div) {
  if (!div) return '';
  const doc = new DOMParser().parseFromString(div, 'text/html');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, li, tr, h1, h2, h3, h4, h5, h6, div').forEach((el) => el.append('\n'));
  doc.querySelectorAll('td, th').forEach((el) => el.append('  '));
  return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
