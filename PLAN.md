# SMART Health Links Utility – Implementation Plan (draft)

## 1. What the server actually does (probed 2026-11-19)

`shl.sensotrend.com` serves HTTPS with HSTS and sends `Access-Control-Allow-Origin: *`, so a static page on any origin can call it. Use **https://**: plain `http://` gets redirected, and an HTTPS-hosted page (for example on GitHub Pages) can't call http at all because browsers block mixed content.

| Call | Request | Response |
|---|---|---|
| Create | `POST /api/shl` JSON: `files: [{contentType, data}]` (required), `label?: string`, `passcode?: string`, `exp?: number` (epoch seconds), `longTerm?: boolean` | `201 {id, shlink, viewerShlink, managementToken, exp}` |
| Status | `GET /api/shl/:id` + `Authorization: Bearer <managementToken>` | `{id, label, flags, exp, createdAt, burnedAt, passcodeAttemptsRemaining, fileCount, accessLog:[{recipient, ip, outcome, createdAt}]}` |
| Revoke | `DELETE /api/shl/:id` + Bearer | `204`; after this, `burnedAt` is set and the manifest returns 404 |
| Manifest (receiver side) | `POST /manifest/:id` `{recipient, passcode?}` | `{files:[{contentType, embedded: <JWE>}]}`, or `401 {remainingAttempts}` |

Points that affect the design:
- **The server does the encryption.** The client sends the Bundle as plain JSON over TLS, and the server generates the key and returns it inside `shlink`. So the server sees the plaintext once. The app should say this honestly. Client-side encryption would need server changes (see Open questions).
- Per the spec, the passcode is never part of the link. The server allows 5 attempts before the link is locked.
- `viewerShlink` came back `null`. Maybe the server can be configured with a viewer prefix, or maybe the client is expected to add one.
- There's no PATCH or PUT, so a link's label, expiry and passcode can't be changed after creation. "Managing" a link means viewing its status and access log, and revoking it.
- I didn't see support for the `U` (direct-file) flag.

(While probing I created one test link with a 10-minute expiry and revoked it right away.)

## 2. Architecture

- **Plain static site with no build step**: `index.html`, ES modules under `js/`, one `styles.css`. It runs from any static host (GitHub Pages, nginx) or `python3 -m http.server`.
- **Third-party code is vendored into `vendor/`**, not loaded from a CDN, so the app works offline and under a strict CSP. The only dependency is a QR encoder, e.g. `qrcode-generator` (MIT, about 20 KB). Decryption for the self-test viewer uses native WebCrypto (AES-GCM, `dir`), so no JOSE library is needed.
- No framework. A small hand-written render layer is enough for about 4 views.

```
index.html
styles.css
js/
  app.js          // routing between views, wiring
  api.js          // createLink, getStatus, revokeLink, fetchManifest
  shlink.js       // parse/encode shlink:/ payload, viewer-prefix handling
  storage.js      // localStorage repository (versioned schema)
  bundles.js      // catalog of included bundles
  qr.js           // QR rendering (canvas/SVG) + PNG download
  viewer.js       // optional: decrypt & preview a link (self-test)
bundles/
  index.json      // [{id, title, description, file}]
  *.json          // synthetic FHIR Bundles
vendor/qrcode-generator.js
```

## 3. UI / flows

**A. Choose data.** A card list of the included Bundles, each with a title, a short description, and its resource counts by type (e.g. "1 Patient, 4 Observations, 2 Conditions"). Each card has a **Preview** button that opens the raw JSON in a collapsible panel.

**B. Sharing options.** All are optional, and each field has inline help text:
- **Label**: a short description the receiver sees before opening the link, e.g. "Sugar levels for Dr. Smith". At most 80 characters (spec limit), with a character counter.
- **Passcode**: the receiver must type it before the data is released. It isn't stored in the link or QR code, so you share it some other way (in person, by phone). The server locks the link after 5 wrong attempts. There will be a show/hide toggle.
- **Expiration**: after this time the link stops working. It is shown to the receiver and enforced by the server. Presets (1 hour, 1 day, 1 week, 30 days, custom) plus a date/time picker in local time, converted to epoch seconds.
- **Long-term (`L` flag)**: tells the receiving app it may keep polling the link for updates, rather than fetching the data once. The help text will note that this utility can't push updates to a link, so the flag only signals intent. The UI will warn when "Long-term" is set with no expiry ("this link works until you revoke it").
- A one-line summary of what the receiver will experience, e.g. "Anyone with this QR + passcode can view until 26 Nov 2026."

**C. Result** (after **Generate**):
- The `shlink:/…` text in a read-only field with a **Copy** button. If a viewer prefix is set, the full `https://viewer…#shlink:/…` link is shown too.
- A QR code (error-correction level M, as the spec recommends), with **Download PNG** and, where supported, **Share** via the Web Share API.
- The decoded payload (url, flags, exp, label) for transparency.
- A management panel: status, access log and **Revoke**. The same panel appears in D.

**D. My links.** A list read from localStorage showing label, bundle title, created, expires, flags, and a status badge (Active / Expired / Revoked / Locked).
- Per link: **Show QR/link**, **Refresh status** (GET, which also shows the access log), **Revoke** (with a confirmation step), and **Forget** (removes it from this browser only; the link itself keeps working).
- **Refresh all** button.
- **Export / Import** of the list as JSON. This is a backup, because clearing the browser deletes the management tokens and there's no way to recover them.

## 4. Local storage

The key is `shl-utility:v1`, holding `{version:1, links:[…]}`. Each entry looks like:

```
{ id, shlink, viewerShlink, managementToken, label, exp, flags, longTerm,
  hasPasscode, bundleId, bundleTitle, createdAt, lastStatus, lastCheckedAt }
```

- **The passcode is not stored by default**, because it's a separate secret. An opt-in toggle can change that.
- The UI will warn that whoever has access to this browser profile can revoke the links and also open them, since the `shlink` contains the decryption key.
- All access is wrapped in try/catch, and the page falls back to in-memory storage with a banner if localStorage isn't available.

## 5. Included FHIR Bundles (synthetic data only)

These are 3–4 small, clearly fictional Bundles:
1. A minimal Patient-only bundle, for smoke tests.
2. An IPS-style patient summary: a `document` Bundle with Composition, Patient, Conditions, Medications and Allergies.
3. A diabetes data bundle: CGM/glucose Observations, HbA1c and Device. This one fits Sensotrend.
4. An immunization record bundle.

They're sent with `contentType: application/fhir+json`.

## 6. Additional features I propose

| # | Feature | Why |
|---|---|---|
| 1 | **Configurable server URL** (default `https://shl.sensotrend.com`) in a Settings panel | lets you test against local or staging servers |
| 2 | **Viewer prefix** setting (e.g. `https://viewer.example/#`) | turns a bare `shlink:/` into something a phone camera opens directly; the spec explicitly supports this |
| 3 | **"Test this link" self-viewer**: fetch the manifest, decrypt the JWE with WebCrypto and show the resources | proves the link works end to end without a third-party viewer. Note: each test shows up in the access log as recipient "SHL Utility self-test" |
| 4 | **Upload / paste your own Bundle** (JSON validated as `resourceType: "Bundle"`) | makes the tool useful beyond the demo data |
| 5 | Recipient field for the self-test | the spec requires `recipient` in manifest requests |
| 6 | Status auto-refresh when "My links" opens | keeps the badges accurate |
| 7 | Dark mode, mobile layout, accessible labels | |
| 8 | Content-Security-Policy meta tag with `connect-src` set to the configured server | defense in depth, since the page handles tokens |

## 7. Error handling

- Network or CORS failure: a clear message showing the server URL that failed.
- 400 from the server: show the `details[].message` text from the server's validation errors next to the relevant field.
- 401/404 on status or revoke: mark the entry "Unknown / token invalid" and offer **Forget**.
- An expiry time in the past is blocked on the client side.

## 8. Implementation steps

1. Scaffold the files, layout and styles, and vendor the QR library.
2. Write `api.js` and `shlink.js`, and check them against the live server from the browser console.
3. Build the bundle catalog and its 4 synthetic Bundles.
4. Build the sharing-options form with help text and validation.
5. Build the generate flow and result view (copy, QR, download, share).
6. Write the storage layer and the My links list with refresh and revoke.
7. Add settings (server URL, viewer prefix) and export/import.
8. Add the self-test viewer (WebCrypto decrypt).
9. Polish (a11y, mobile, dark mode, CSP) and write the README.
10. Verify end to end in a browser: create links with each combination of options, decode the QR, revoke, and confirm the manifest returns 404.

## 9. Decisions (2026-11-19)

1. Server-side encryption is acceptable.
2. The default viewer prefix is `https://ips.sensotrend.com/view/` and can be changed in Settings. It is mainly meant for IPS documents, so it may change.
3. Hosting: GitHub Pages under `x-share.sensotrend.com` (see `CNAME`).
4. Example Bundles: the user-supplied EEHRxF documents in `bundles/`.
5. The self-test viewer is in v1 (the "Open a link" tab, and `#shlink:/` deep links).
6. English only. xShare Yellow Button branding and the EU co-funding emblem are used.
7. Passcodes are never stored. The self-test asks for the passcode.
8. Large files: the server returns them as a `location` URL instead of `embedded`, and the viewer handles both.
