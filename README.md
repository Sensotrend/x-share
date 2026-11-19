# xShare SHL Utility

A static web app for creating, sharing and managing [SMART Health Links](https://build.fhir.org/ig/HL7/smart-health-cards-and-links/links-specification.html). It is a demonstrator of the [xShare](https://xshare-project.eu/) Yellow Button.

- Choose an included EEHRxF FHIR document (synthetic data) or load your own Bundle.
- Optionally set a label, passcode, expiration time and the long-term (`L`) flag.
- Create the link on the SHL server (default `https://shl.sensotrend.com`).
- Get the link as text (copy, share) and as a QR code (PNG download).
- Manage links: status, access log and revoke. Links and management tokens are kept in `localStorage`, with JSON export and import.
- Open any SHL ("Open a link"): fetch the manifest, decrypt the JWE in the browser with WebCrypto, and preview the document. Opening `index.html#shlink:/…` goes straight to this view.

There is no build step and no server code. The only third-party code is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), vendored as an ES module in `vendor/`.

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. ES modules don't load from `file://`, so the page must be served over HTTP.

## Deploy (GitHub Pages)

Publish the repository root with GitHub Pages. `CNAME` sets the custom domain to `x-share.sensotrend.com`. Add a DNS `CNAME` record pointing to `<owner>.github.io` and enable "Enforce HTTPS". `.nojekyll` stops Jekyll from processing the files.

## Layout

```
index.html, styles.css
js/app.js        UI and flows
js/api.js        SHL server client (create, status, revoke, manifest)
js/shlink.js     shlink:/ parsing, viewer prefix, flags
js/jwe.js        JWE (dir + A256GCM, optional DEF) decryption
js/storage.js    localStorage for settings and links
js/bundles.js    example catalog and Bundle helpers
js/qr.js         QR rendering (ECL M)
bundles/         example Bundles + index.json catalog
assets/          xShare / Yellow Button / EU emblem images
```

To add an example document, put the Bundle in `bundles/` and add an entry to `bundles/index.json`. The fields are `id`, `file`, `title`, `description`, `patient`, `date`, `size` and `resources`.

## SHL server API used

| Call | Purpose |
|---|---|
| `POST /api/shl` `{files:[{contentType,data}], label?, passcode?, exp?, longTerm?}` | create; returns `{id, shlink, managementToken, exp}` |
| `GET /api/shl/:id` (Bearer token) | status: `flags`, `exp`, `burnedAt`, `passcodeAttemptsRemaining`, `accessLog` |
| `DELETE /api/shl/:id` (Bearer token) | revoke |
| `POST /manifest/:id` `{recipient, passcode?}` | receiver: files as `embedded` JWE or `location` URL |

The server does the encryption: it generates the key and returns it inside the `shlink`.
