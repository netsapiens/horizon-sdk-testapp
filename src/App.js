// The exposed entry point the Horizon host mounts for this extension.
//
// ⚠️ THE EXPOSE MUST BE NAMED './App'. The host hardcodes `module="./App"` when
// it builds the <RemoteComponent> for every registered extension
// (HorizonAppsLoader.tsx). An earlier version of this app exposed './mod', which
// verified perfectly and then failed at runtime with "Module ./mod does not
// exist in container" — the bundle was fine, the contract was not.
//
// ⚠️ NO JSX. This project has no babel/ts loader, deliberately: the point of the
// testapp is to exercise the bundle-verification contract with the smallest
// possible toolchain, so nothing here should need a transform. React.createElement
// aliased to `h` is the whole compromise.
//
// Registration goes through @netsapiens/horizon-sdk, the same path a partner
// uses. Emitting on the event bus directly would test the host's internal
// contract rather than the one anybody actually writes against.
import React from 'react';
import log from 'loglevel';
import { useRemoteApp } from '@netsapiens/horizon-sdk';

const h = React.createElement;

// ⚠️ The MODULE FEDERATION NAME, not the app id.
//
// useRemoteApp() takes this and derives the app id itself (deriveAppId:
// `minimalRemote` → `minimal-remote`), using the same rule the platform applies
// when it derives an extension's id from webpack_module. Passing the raw MF name
// is what puts that derivation under test — hardcoding the derived id would let
// the two drift apart silently, which is precisely the kind of mismatch this app
// exists to catch.
const MF_NAME = 'minimalRemote';

// For log lines only. Anything authorization-shaped uses the id the host stamps.
const APP_ID = 'minimal-remote';

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * Shared body for both registered pages.
 *
 * Pulls in ./heavy.js on demand. That dynamic import is the reason this app has
 * more than one chunk, which is what makes it a real test of chunk integrity:
 * pinning only remoteEntry.js would verify a loader and nothing it loads.
 */
function TestPage(props) {
  const [heavyResult, setHeavyResult] = React.useState('not loaded');
  const [busy, setBusy] = React.useState(false);

  const runHeavy = React.useCallback(() => {
    setBusy(true);
    import('./heavy.js')
      .then((m) => setHeavyResult(String(m.heavy())))
      .catch((err) => setHeavyResult('failed: ' + err.message))
      .finally(() => setBusy(false));
  }, []);

  return h(
    'div',
    { style: { padding: 24 } },
    h('h2', null, props.title),
    h(
      'p',
      null,
      'Registered by ' + APP_ID + ' at ' + props.where + '. If you can read this, the ',
      'remote loaded, the SRI pin matched, and the route registration reached the host.',
    ),
    h(
      'button',
      { onClick: runHeavy, disabled: busy },
      busy ? 'Loading chunk…' : 'Load the lazy chunk',
    ),
    h(
      'p',
      null,
      'Lazy chunk result: ',
      h('code', null, heavyResult),
    ),
  );
}

function HomePage() {
  return h(TestPage, { title: 'SDK Test App — My Account', where: '/home' });
}

function ManagePage() {
  return h(TestPage, { title: 'SDK Test App — Manage', where: '/manage' });
}

// ---------------------------------------------------------------------------
// Zone extensions
// ---------------------------------------------------------------------------

/**
 * Row action for a datagrid. `props.context` carries the row the host is
 * rendering this against.
 */
function RowActionButton(props) {
  const ctx = props.context || {};
  return h(
    'button',
    {
      type: 'button',
      title: 'Injected by ' + APP_ID,
      onClick: function () {
        log.info('[' + APP_ID + '] row action fired', ctx.params || {});
      },
      style: { cursor: 'pointer' },
    },
    '★',
  );
}

/** Button injected into a page's header action area. */
function HeaderButton() {
  return h(
    'button',
    {
      type: 'button',
      onClick: function () {
        log.info('[' + APP_ID + '] header action fired');
      },
    },
    'Test App Action',
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Everything this app contributes to the host, in one table so a reviewer can
 * see the whole surface without reading the effect below.
 *
 * Registered through @netsapiens/horizon-sdk, exactly as a partner would. The
 * SDK is a normal bundled dependency and must NEVER appear in webpack `shared`
 * — the host does not register it as a shared module, and the verifier rejects
 * a bundle that declares it.
 */
const ROUTES = [
  {
    id: APP_ID + '.home-page',
    parentPath: '/home',
    path: 'sdk-testapp',
    label: 'SDK Test App',
    icon: 'mdi:test-tube',
    component: HomePage,
  },
  {
    id: APP_ID + '.manage-page',
    parentPath: '/manage',
    path: 'sdk-testapp',
    label: 'SDK Test App',
    icon: 'mdi:test-tube',
    component: ManagePage,
  },
];

const EXTENSIONS = [
  {
    id: APP_ID + '.row-action',
    zone: 'table-row-actions',
    // Prefix match: any /manage page carrying a datagrid. Broad on purpose —
    // this is a probe for whether row-action injection works at all, not a
    // feature aimed at one table.
    routes: [{ pattern: '/manage' }],
    component: RowActionButton,
  },
  {
    id: APP_ID + '.header-action',
    zone: 'page-header-actions',
    routes: [{ pattern: '/home' }],
    component: HeaderButton,
  },
];

/**
 * Force the lazy chunk to load, and return a stable marker.
 *
 * Exists for harness/index.html — the SRI TAMPER TEST, which loads a chunk, flips
 * a byte, and confirms the browser REFUSES the modified copy. That is the only
 * check that integrity is ENFORCED rather than merely emitted, and it needs a
 * plain callable rather than a React component.
 *
 * A named export rather than a second federated expose, because
 * webpack-subresource-integrity cannot resolve integrity for two exposes in this
 * config — see the note in webpack.config.js.
 */
export async function run() {
  log.info('[' + APP_ID + '] run() invoked — loading lazy chunk');
  const { heavy } = await import('./heavy.js');
  return heavy();
}

/**
 * The component the host mounts. It renders nothing visible: its job is to
 * register contributions and then stay mounted for the life of the session,
 * which is the documented shape for a Horizon extension entry point.
 */
export default function App(horizonContext) {
  // ⚠️ REGISTER THROUGH THE SDK, NOT BY EMITTING ON THE EVENT BUS.
  //
  // The raw `eventBus.emit('route:register', ...)` calls this used to make are
  // the HOST's contract, not the partner's — no real extension is written that
  // way. Going straight to the bus skips everything the SDK does on the way
  // past: validateRouteConfig() refusing a malformed route with a log instead of
  // an emit, appId derivation, unregister bookkeeping. A test app that bypasses
  // that layer can pass while every partner's code fails, and the reverse.
  const { sdk } = useRemoteApp(horizonContext, MF_NAME);

  React.useEffect(
    function register() {
      let cancelled = false;

      // registerRoute is async — it validates before emitting. Sequenced rather
      // than fired in parallel so the log reads in registration order when
      // something is rejected.
      (async function registerAll() {
        for (const route of ROUTES) {
          if (cancelled) return;
          await sdk.registerRoute(route);
        }
        EXTENSIONS.forEach(function (ext) {
          if (!cancelled) sdk.registerDynamicExtension(ext);
        });
        if (!cancelled) {
          log.info(
            '[' + APP_ID + '] registered ' + ROUTES.length + ' routes, ' +
              EXTENSIONS.length + ' zone extensions via SDK',
          );
        }
      })();

      // Unregister on unmount, or a remount duplicates every menu entry.
      return function cleanup() {
        cancelled = true;
        ROUTES.forEach(function (route) {
          sdk.unregisterRoute(route.id);
        });
        EXTENSIONS.forEach(function (ext) {
          sdk.unregisterDynamicExtension(ext.id);
        });
      };
    },
    [sdk],
  );

  return null;
}
