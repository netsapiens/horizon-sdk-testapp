# horizon-sdk-testapp

A deliberately minimal Module Federation remote, used to validate the Horizon
**bundle-verification build contract** without the noise of a full application.

It exists because the reference demo is too large to reason about when something
goes wrong: it has React, MUI, four shared dependencies and a standalone page, so
a build failure has many possible causes. This app has one shared dependency and
one async chunk — the minimum that reproduces the mechanics that matter — so a
failure here has exactly one explanation.

That property already paid for itself once. A confident root-cause analysis of an
integrity build failure ("shared-module fallback chunks break the SRI plugin") was
**wrong**, and this app is what disproved it: it compiled cleanly in every
configuration that theory predicted would fail. The real cause turned out to be
specific to one package. A test bed that behaves correctly when you expect
breakage is evidence, not a dead end.

## Usage

```bash
npm install
npm run build                 # emits dist/v1.0.0/
npm run verify                # runs the platform's own preflight checks
```

`npm run verify` invokes `horizon-verify-bundle` from `@netsapiens/horizon-sdk` —
the same checks the platform runs when a version is submitted, so a pass here
means a pass there.

## The SRI tamper test

Proves the browser *enforces* chunk integrity rather than merely that webpack
emitted the values.

```bash
npm run build
npm run harness               # portal on :4101, CDN on :4102
```

Then open <http://localhost:4101>. Two origins deliberately: SRI's `crossorigin`
requirement only bites cross-origin, so a same-origin test would prove less than
the real deployment. The portal computes the `remoteEntry` pin **once at startup
and caches it**, mirroring the API hashing at submission time — so bytes can then
change on disk while the pin stays fixed, which is precisely the attack.

To tamper:

```bash
# Append a byte to a chunk that carries an integrity value, then reload the page.
printf '\n//tampered\n' >> dist/v1.0.0/<chunk>.js
```

Expected: `remoteEntry.js` still executes (its own pin still matches) while the
**chunk is refused** — which is the transitive claim the whole design rests on.
Tampering `remoteEntry.js` instead refuses the script outright and leaves no
container global.

Note the failure surfaces to the page as a bare `script error event`: the browser
gives no way to distinguish an integrity failure from a network failure, which is
why the host does a deliberate fetch-and-hash on the error path.

## What this app is not

Not a reference for partners — that is `horizon-sdk-demo`, which is a realistic
application. This one is a test fixture, and its `shared` block is intentionally
smaller than any real extension's.
