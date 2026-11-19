// Client for the SHL server API (shl.sensotrend.com).
//
//   POST   /api/shl            create; the server encrypts the files and returns the shlink
//   GET    /api/shl/:id        status + access log        (Bearer managementToken)
//   DELETE /api/shl/:id        revoke                      (Bearer managementToken)
//   POST   /manifest/:id       receiver: {recipient, passcode?} → {files:[{contentType, embedded|location}]}

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const ERROR_TEXT = {
  missing_bearer_token: 'The management token is missing.',
  invalid_token: 'The management token was not accepted.',
  not_found: 'The server does not know this link (it may have been revoked or deleted).',
  invalid_request: 'The server rejected the request.',
};

async function request(url, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch (e) {
    throw new ApiError(`Could not reach ${new URL(url).host}. Check your connection and the server address in Settings.`, { status: 0 });
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const code = data?.error;
    let msg = ERROR_TEXT[code] || `The server returned an error (HTTP ${res.status}${code ? `, ${code}` : ''}).`;
    if (Array.isArray(data?.details) && data.details.length) {
      msg += ' ' + data.details.map((d) => (d.path?.length ? `${d.path.join('.')}: ` : '') + d.message).join('; ');
    }
    throw new ApiError(msg, { status: res.status, code, details: data });
  }
  return data;
}

const trimSlash = (s) => s.replace(/\/+$/, '');

/** Create a link. All options are optional; `bundle` is the FHIR Bundle object. */
export function createLink(server, { bundle, label, passcode, exp, longTerm }) {
  const body = { files: [{ contentType: 'application/fhir+json', data: bundle }] };
  if (label) body.label = label;
  if (passcode) body.passcode = passcode;
  if (exp) body.exp = exp;
  if (longTerm) body.longTerm = true;
  return request(`${trimSlash(server)}/api/shl`, { method: 'POST', body });
}

export function getStatus(server, id, token) {
  return request(`${trimSlash(server)}/api/shl/${encodeURIComponent(id)}`, { token });
}

export function revokeLink(server, id, token) {
  return request(`${trimSlash(server)}/api/shl/${encodeURIComponent(id)}`, { method: 'DELETE', token });
}

/** Receiver side: fetch the manifest given the URL from the shlink payload. */
export async function fetchManifest(manifestUrl, { recipient, passcode }) {
  const body = { recipient: recipient || 'Anonymous' };
  if (passcode) body.passcode = passcode;
  try {
    return await request(manifestUrl, { method: 'POST', body });
  } catch (e) {
    if (e.status === 401) {
      const left = e.details?.remainingAttempts;
      const msg = body.passcode ? 'Wrong passcode.' : 'This link needs a passcode.';
      throw new ApiError(left != null ? `${msg} ${left} attempt${left === 1 ? '' : 's'} left before the link is locked.` : msg, e);
    }
    if (e.status === 404) throw new ApiError('The link is no longer valid: it has expired, been revoked or been locked.', e);
    throw e;
  }
}

/** Receiver side: download a file given by `location` in the manifest (returns compact JWE). */
export async function fetchLocation(location) {
  let res;
  try {
    res = await fetch(location, { cache: 'no-store' });
  } catch {
    throw new ApiError('Could not download the encrypted file.');
  }
  if (!res.ok) throw new ApiError(`Downloading the encrypted file failed (HTTP ${res.status}).`, { status: res.status });
  return (await res.text()).trim();
}

/** Derive the server origin (where the management API lives) from a manifest URL. */
export function serverFromManifestUrl(url) {
  const u = new URL(url);
  const i = u.pathname.indexOf('/manifest/');
  return u.origin + (i > 0 ? u.pathname.slice(0, i) : '');
}
