# Publishing a remote for Horizon bundle verification

The process, verified end to end on this repo. A partner publishing their own
extension follows the same steps.

Live: <https://netsapiens.github.io/horizon-sdk-testapp/remoteEntry.js>

---

## ⚠️ Bump the version every time the bytes change

Read this before anything else. It is the single rule that, if broken, produces a
failure nothing in the UI explains.

The remote entry URL is **stable** — it does not carry the version — and the
platform pins a SHA-384 of the exact bytes at that URL. So:

- Publishing new bytes **with** a version bump: the admin updates the version
  field, verification re-runs, a new hash is pinned, everything works.
- Publishing new bytes **without** one: nothing re-verifies. The platform keeps
  enforcing the hash of the *previous* bytes against the *new* ones served at the
  same URL. Every host fails the SRI check on next page load and the extension
  simply does not appear — no verdict, no finding, no error an admin can see.

CI refuses to publish changed bundle inputs under an unchanged version, which is
the only thing standing between a forgotten bump and that outcome. Do not work
around it.

---

## The requirements, and where each is satisfied

| # | Requirement | Where |
|---|---|---|
| 1 | Stable URL, bytes re-verified on change | `output.path: dist` + the CI version guard |
| 2 | CORS on the CDN | GitHub Pages sends `Access-Control-Allow-Origin: *` |
| 3 | Chunk integrity values | `webpack-subresource-integrity` **and** `output.crossOriginLoading: 'anonymous'` |
| 4 | Source maps with `sourcesContent` | `devtool: 'source-map'`, and do **not** set `noSources` |
| 5 | Submit through the API | Automatic — the Registered Apps UI submits on save |
| 6 | Expose the module as `./App` | `exposes: { './App': ... }` — the host requests this exact name |
| 7 | SDK bundled, not shared | never put `@netsapiens/horizon-sdk` in webpack `shared` |

3, 4, 6 and 7 are checked before publishing (`npm run verify`, and CI). 1 is
enforced by the CI version guard. 2 cannot be checked from a local build.

⚠️ **Requirement 6 is not hypothetical.** An earlier version of this app exposed
`'./mod'`, passed every check, and could never render: the host asks the container
for `'./App'` and nothing else. A bundle can be perfectly verified and still be
unloadable.

---

## Why the URL is stable, and what that costs

Earlier revisions published to `dist/v<version>/` on a `gh-pages` branch with
`keep_files: true`, plus a guard that compared bytes to refuse overwriting a
published version. All of that existed to keep previously published versions
resolving forever, which is what an immutable-URL scheme requires.

It was dropped deliberately. It meant an admin hand-editing the remote entry URL
in the portal on every single release — a manual step, on a security-relevant
field, one typo away from an outage. That was not hypothetical either: a trailing
comma survived a copy-paste and the bundle came back `rejected` with
`fetch-failed`.

The cost of a stable URL is an exposure window: from the moment new bytes go live
until the new version is submitted and promoted, hosts holding the old pin fail
their SRI check. That is accepted because:

- releases happen in maintenance windows;
- already-loaded sessions never re-fetch their bundles, so only someone starting a
  fresh session inside the window is affected;
- the failure is benign — the loader logs and renders nothing, so the extension is
  absent for that session and a reload after promotion fixes it.

Note the window is bounded by how long verification takes, and verification
fetches the remote entry, every chunk and every source map. `max_fetch_seconds`
(default 60) applies **per fetch, not in total**, so a slow CDN stretches it.

A partner who wants the old guarantees can still publish to versioned paths — the
platform only ever fetches the URL it is given, so either model works. They then
own the URL update on every release.

---

## One-time setup

1. **Create the repo** (public — Pages needs it unless the org plan allows private Pages):
   ```bash
   gh repo create <org>/<name> --public --source=. --remote=origin
   git push -u origin main
   ```
2. **Set Pages to deploy from GitHub Actions** (not from a branch):
   ```bash
   gh api repos/<org>/<name>/pages -X PUT -f "build_type=workflow"
   ```
   Or Settings → Pages → Source: *GitHub Actions*.
3. **Push to `main`.** The workflow builds, verifies, guards the version, deploys.

---

## Releasing

```bash
npm version 1.0.4 --no-git-tag-version
git commit -am "release: v1.0.4"
git push origin main
```

Then in Horizon → Registered Apps, update the app's **version** field to match and
save. Submission is automatic; the URL never changes, so that field is left alone.

---

## Local checks before pushing

```bash
npm run build
npm run verify
```

`npm run verify` runs the checker shipped in `@netsapiens/horizon-sdk`, so it needs
no path outside this repo.

⚠️ It invokes the script with `node` rather than `npx horizon-verify-bundle`. In
0.2.0 the packaged bin silently no-ops — its main-module guard compared the
basename of `argv[1]` against `verify-bundle`, which is false when npm links it as
`horizon-verify-bundle`, so the CLI never ran and exited 0. Fixed in 0.2.1; once
this repo is on 0.2.1 both this script and the CI step can become
`npx horizon-verify-bundle ./dist`.

---

## Verified on this repo

| Check | Result |
|---|---|
| Bundle serves over HTTPS | `HTTP 200`, `content-type: application/javascript` |
| CORS | `access-control-allow-origin: *` |
| Chunk integrity values in `remoteEntry.js` | 4 present |
| Source maps carry `sourcesContent` | all maps populated |
| Platform hash matches local bytes | identical, across separate builds and a rebuilt analyser |
| **Platform verdict** (real analyser, live bytes) | **`approved`**, then **`flagged`** on `size-delta` once the SDK was bundled — both promote and load |

---

## Then submit

Submission is automatic from the Registered Apps UI. The API form, if you need it
without a UI:

```bash
curl -X POST "https://<portal>/ns-api/v2/ui-extensions/<id>/versions" \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"version":"1.0.4",
       "remote_entry_url":"https://netsapiens.github.io/horizon-sdk-testapp/remoteEntry.js"}'
```

The origin must be on the platform's `approved_cdn_origins` allowlist —
`*.github.io` is **not** seeded by default and has to be added deliberately.

Do not send an `integrity_hash`. The platform computes it from the bytes it
fetched; a caller-supplied value is ignored.
