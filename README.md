# horizon-sdk-testapp

A deliberately minimal Module Federation remote, used to validate the Flow
**bundle-verification build contract** without the noise of a full application,
to check `sdk.streams` end to end, and to round-trip `sdk.sendNotification`. Built on `@netsapiens/flow-sdk`.

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

`npm run verify` invokes `flow-verify-bundle` from `@netsapiens/flow-sdk` —
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

## The streams bench

The `/apps/sdk-testapp` page carries a live-data bench, driven by the `streams`
section of `src/integration/zones.manifest.json`:

1. **SDK checks** — the bundle was built against the Flow SDK version the manifest
   names (`sdkVersion`, 0.3.7), every `sdk.streams` method of the 0.3.x contract
   is present, `sdk.sendNotification` is there, and the 0.2.x stream API is gone.
2. **Subscribe** opens seven streams covering every grant a normal user can hold:
   presence, own user record, device registration, own extension's calls, own
   softphone, notifications, and domain queue stats. Each row shows its status
   (`pending` → `live`, or `refused` with the reason) and counts the events it
   receives.
3. **Trigger an update** writes a marker into the signed-in user's own status
   message and puts the original back, so the presence and own-user rows receive
   data without anyone having to make a call. Calls and softphone rows count
   when you place a call.
4. **Unsubscribe** closes every handle. The rows report closed; whether the host
   really let go is shown on the host's **SDK Diagnostics** page, which lists
   every live stream subscription by app — this app's rows must disappear. (The
   SDK drops anything delivered to a closed handle, so the app alone cannot see
   a leak.)

Leaving the page closes anything still open.

Rows carry `data-state`, `data-events`, `data-open` and `data-closed` for the
Playwright suite, plus `data-reason` and `data-message` once a stream is refused
(the reason is one of `not-granted`, `scope`, `no-source` or `invalid`; the
message is the host's own text). Each row's status cell is `<row testId>-status`. `refused` is a correct result where the user's scope or the
app's approved grants do not allow a stream — a Basic User is refused domain
queue stats.

The app only gets the grants the platform derived from its bundle when it was
submitted, so register a new version after changing which streams it opens.

## The notifications panel

The `/home/sdk-testapp` page carries the `sdk.sendNotification` round trip,
driven by the `notifications` section of the manifest:

1. **Send** raises a real Flow notification for the signed-in user, with the
   title, body, severity, link and optional id from the form. The link defaults
   to `/apps/sdk-testapp`, another page this app registers, so clicking the
   entry in the notification center has somewhere observable to go.
2. **Received** subscribes to `sdk.streams.notifications` while the page is
   open. Each arrival is a row carrying `data-notification-id` (the same id the
   host's bell uses, `notification-center-notification-<id>`), `data-category`
   (`app` for one an app raised), `data-severity`, `data-title` and `data-link`.

It sits on `/home` rather than beside the streams bench on purpose: its feed
holds a subscription for as long as the page is open, and the bench's teardown
check expects the host to hold none for this app after Unsubscribe.

`sdk.sendNotification({ … })` is a plain call in `src/integration/notifications.js`.
The platform finds it in the bundle when a version is submitted; behind a helper
or a computed name it would not be found. Sending is fire-and-forget: if the
host refuses it (the capability switched off in SDK Settings, or a host or
server without app notifications), the browser console says why and
nothing arrives.

## What this app is not

Not a reference for partners — that is `flow-sdk-demo` (formerly `horizon-sdk-demo`), which is a realistic
application. This one is a test fixture, and its `shared` block is intentionally
smaller than any real extension's.
