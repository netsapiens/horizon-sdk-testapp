# Publishing a remote for Horizon bundle verification

The process, verified end to end on this repo. A partner publishing their own
extension follows the same five steps.

Live: <https://netsapiens.github.io/horizon-sdk-testapp/v1.0.2/remoteEntry.js>

---

## The five requirements, and where each is satisfied

| # | Requirement | Where |
|---|---|---|
| 1 | Immutable, version-specific URL | `output.path: dist/v<version>` + `keep_files: true` + the CI guard |
| 2 | CORS on the CDN | GitHub Pages sends `Access-Control-Allow-Origin: *` |
| 3 | Chunk integrity values | `webpack-subresource-integrity` **and** `output.crossOriginLoading: 'anonymous'` |
| 4 | Source maps with `sourcesContent` | `devtool: 'source-map'`, and do **not** set `noSources` |
| 5 | Submit through the API | Automatic — the Registered Apps UI submits on save |
| 6 | Expose the module as `./App` | `exposes: { './App': ... }` — the host requests this exact name |

3, 4 and 6 are checked before publishing (`npm run verify`, and CI). 1 is enforced
by the guard. 2 cannot be checked from a local build.

5 is no longer a manual step: saving an app in Registered Apps submits the version
by itself whenever the version or remote entry URL changes. A `curl` is only needed
when there is no UI to hand — the form at the end of this file still works.

⚠️ **Requirement 6 is not hypothetical.** v1.0.1 exposed `'./mod'`, passed every
check here, and could never render: the host asks the container for `'./App'` and
nothing else. A bundle can be perfectly verified and still be unloadable.

---

## One-time setup

1. **Create the repo** (public — Pages needs it unless the org plan allows private Pages):
   ```bash
   gh repo create <org>/<name> --public --source=. --remote=origin
   git push -u origin main
   ```
2. **Let the first workflow run finish.** It creates the `gh-pages` branch. Pages
   cannot be pointed at a branch that does not exist yet, so this must come first.
3. **Enable Pages on that branch** — a repo setting, outside git:
   ```bash
   gh api repos/<org>/<name>/pages -X POST -f "source[branch]=gh-pages" -f "source[path]=/"
   ```
   Or Settings → Pages → Source: *Deploy from a branch* → `gh-pages` / `/`.
4. **Wait for the Pages build**: `gh api repos/<org>/<name>/pages --jq .status` → `built`.

---

## Releasing a version

```bash
npm version 1.0.2 --no-git-tag-version
git commit -am "release: v1.0.2"
git push origin main
```

That is the whole release. The workflow builds, checks the contract, and publishes
`dist/v1.0.2/` alongside every previously published version.

⚠️ **Bump the version, every time.** Pushing to `main` without one fails the build
at the guard step, before anything is built or published.

---

## Why `gh-pages` and not `actions/deploy-pages`

The official Pages action uploads an artifact that **replaces the entire site** on
every deploy. Webpack's `output.clean` empties `dist/` each build, so the artifact
only ever contains the current version — every previously published version would
404 the moment a new one shipped.

That breaks more than a link. The platform pins a SHA-384 of the exact bytes at a
URL, so a host still pointing at the old version gets a 404 where a verified
bundle used to be. `keep_files: true` on a `gh-pages` publish accumulates version
directories instead.

The sibling `horizon-sdk-demo` still uses the official action and has this problem.

## Why the guard exists on top of that

`keep_files: true` stops directories being **deleted**, not **overwritten**. A push
without a version bump republishes over `v1.0.0` in place — silently changing bytes
that hosts have already pinned, which is the exact failure immutable URLs prevent.
The workflow probes `gh-pages` for the target version before doing any work and
fails if it is already there.

---

## Verified on this repo

| Check | Result |
|---|---|
| Bundle serves over HTTPS | `HTTP 200`, `content-type: application/javascript` |
| CORS | `access-control-allow-origin: *` |
| Chunk integrity values in `remoteEntry.js` | 3 present |
| Every runtime-referenced chunk resolves | 3 / 3 fetched from the live URL |
| Source maps carry `sourcesContent` | 4 maps fetched, all populated |
| **Platform verdict** (real analyser, live bytes) | **`approved`, 0 findings** |
| Re-push without a version bump | CI **fails** at the guard; build and publish skipped |
| Publish v1.0.1 | v1.0.0 still resolves, SHA-384 **byte-identical** |

---

## Local checks before pushing

```bash
npm run build
npm run verify     # the full contract checker
```

`npm run verify` runs the checker shipped in `@netsapiens/horizon-sdk`, so it
needs no path outside this repo.

⚠️ It invokes the script with `node` rather than `npx horizon-verify-bundle`.
In 0.2.0 the packaged bin silently no-ops — its main-module guard compared the
basename of `argv[1]` against `verify-bundle`, which is false when npm links it
as `horizon-verify-bundle`, so the CLI never ran and exited 0. Fixed in 0.2.1;
once this repo is on 0.2.1 the script and the CI step can both become
`npx horizon-verify-bundle ./dist/v<version>`.

---

## Then submit

```bash
curl -X POST "https://<portal>/ns-api/v2/ui-extensions/<id>/versions" \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"version":"1.0.2",
       "remote_entry_url":"https://netsapiens.github.io/horizon-sdk-testapp/v1.0.2/remoteEntry.js"}'
```

The origin must be on the platform's `approved_cdn_origins` allowlist —
`*.github.io` is **not** seeded by default and has to be added deliberately.

Do not send an `integrity_hash`. The platform computes it from the bytes it
fetched; a caller-supplied value is ignored.
