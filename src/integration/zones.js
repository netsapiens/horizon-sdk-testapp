// Every surface this app contributes, built from zones.manifest.json.
//
// ⚠️ THE MANIFEST IS THE SOURCE OF TRUTH, and it is shared. The Playwright suite
// in netsapiens-horizon-testing keeps a synced copy as
// fixtures/data/horizon-sdk-testapp.zones.json and asserts every testId in it
// mounts. Adding a zone here without adding it there means the coverage silently
// does not exist; changing a testId here without syncing breaks the suite with a
// "not found" that looks like a host regression. Change both, in one commit.
//
// ⚠️ NO JSX, deliberately — see the note at the top of App.js. React.createElement
// aliased to `h` is the whole compromise, so this file reads a little denser than
// a partner's app would.
import React from 'react';
import log from 'loglevel';

import manifest from './zones.manifest.json';

const h = React.createElement;

export { manifest };

/**
 * The live SDK instance, set by App.js once useRemoteApp() has produced it.
 *
 * Something has to OPEN THE SIDE TRAY, and it cannot get at the SDK any other
 * way: the host mounts the `sidetray` zone only inside a panel that something
 * has opened (SdkSidePanel.tsx — "the zone has no fixed mount point"), and
 * neither the extension context passed to a component (route/user/ui/theme) nor
 * the `ExtensionActionContext` passed to a declared action (route/params/user/
 * pageContext) carries an SDK handle. That is by design in both: they are page
 * state, not capability. The alternative is emitting `side-panel:open` on the
 * event bus directly, which is the HOST's contract rather than a partner's — the
 * exact shortcut the registration comment in App.js exists to forbid.
 *
 * The opener is now the DECLARED header action (see actionsFor), not a component
 * — moving it did not change this, which is the point: the handle a partner
 * needs is the same on both registration paths.
 *
 * A ref rather than an import because the widgets and actions are built at
 * module load, before any SDK exists.
 */
export const sdkRef = { current: null };

/** Look up a manifest entry by id, across all three collections. */
function entry(id) {
  const all = [].concat(manifest.extensions, manifest.routes, manifest.columns);
  const found = all.find(function (e) {
    return e.id === id;
  });
  if (!found) {
    // Loud rather than a silent undefined: a typo here produces a widget with no
    // marker, which the suite reports as a missing zone — the most misleading
    // failure this app can produce.
    throw new Error('[minimal-remote] no manifest entry for "' + id + '"');
  }
  return found;
}

/**
 * The marker props the test suite locates a zone by.
 *
 * They ride on the widget's OWN root element — there is no wrapper — so layout
 * is untouched and the marker sits on a real, visible box. A component that
 * renders null has no marker, which is the accurate signal for an inactive zone.
 */
function marker(id) {
  const e = entry(id);
  return { 'data-testid': e.testId, 'data-zone': e.zone };
}

/** Shared visual treatment so an injected widget is obvious to a human too. */
const CHIP = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px',
  border: '1px solid currentColor',
  borderRadius: 4,
  font: 'inherit',
  fontSize: 12,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

/**
 * One factory for every button-shaped zone.
 *
 * The zones differ in WHERE the host mounts them, not in what they render, and
 * this app's job is to prove the mount happened. Eleven near-identical component
 * bodies would obscure that; the interesting per-zone detail lives in the
 * manifest.
 */
function chipWidget(id, label, tag) {
  function Widget(props) {
    const ctx = props.context || {};
    return h(
      tag || 'button',
      Object.assign(
        {
          type: tag ? undefined : 'button',
          title: 'Injected by ' + manifest.appId + ' into ' + entry(id).zone,
          onClick: function () {
            log.info('[' + manifest.appId + '] ' + id + ' fired', ctx.params || {});
          },
          style: CHIP,
        },
        marker(id),
      ),
      label,
    );
  }
  Widget.displayName = 'TestApp(' + id + ')';
  return Widget;
}

/**
 * A DECLARED ACTION, for the zones where the host owns the rendering.
 *
 * ⚠️ THE SUPPORTED PATH FOR ACTION ZONES since SDK 0.2.6, and the reason it
 * exists is worth keeping: contributing a button as a `component` means knowing
 * that a secondary action is `variant="soft" color="neutral"`, and the raw MUI
 * variants stay reachable — so it is easy to ship a header button that does not
 * match the page it sits on. Declaring an `intent` moves that decision to the
 * host, which has one implementation of it.
 *
 * `component` and `actions` are mutually exclusive: the host REJECTS and logs a
 * registration carrying both or neither (DynamicExtensionSystem.ts) rather than
 * silently rendering nothing. So the manifest names which path each zone takes
 * and EXTENSIONS below sets exactly one.
 *
 * ⚠️ `data-testid` IS SET EXPLICITLY, and it has to be. The host defaults it to
 * `sdk-action-<appId>-<action id>`, which would silently break the suite's
 * marker contract; passing the manifest's testId through keeps a migrated zone
 * assertable by the same id it always had. This is the documented reason the
 * field is overridable.
 *
 * ⚠️ NO `data-zone` on these. The host draws the button, and it emits only
 * `data-testid` — so the "every injected extension is also tagged with
 * data-zone" rule now holds for component zones only. Nothing asserts data-zone
 * (the suite locates by test id), but the manifest comment says so plainly
 * rather than leaving a reader to discover it.
 */
function actionsFor(id, label, options) {
  const e = entry(id);
  const opts = options || {};
  return [
    {
      id: id,
      label: label,
      intent: opts.intent || 'secondary',
      icon: opts.icon,
      tooltip: 'Declared by ' + manifest.appId + ' into ' + e.zone,
      'data-testid': e.testId,
      onClick: function (context) {
        // The context the host hands a declared action: route, params, user and
        // whatever the page published as pageContext. Logged so a human driving
        // the app can see the shape actually arrived.
        log.info('[' + manifest.appId + '] action ' + id + ' fired', {
          route: context && context.route,
          params: (context && context.params) || {},
        });
        // The header action doubles as the side-tray opener — see sdkRef. An
        // action's context carries no SDK handle (by design: it is page state,
        // not capability), so this still goes through the module-level ref.
        if (id === 'testapp-header-action' && sdkRef.current) {
          sdkRef.current.openSidePanel({ title: 'SDK Test App' });
        }
      },
    },
  ];
}

/** A non-interactive panel, for the content/sidetray/banner zones. */
function panelWidget(id, label) {
  function Panel() {
    return h(
      'div',
      Object.assign(
        {
          style: {
            padding: 12,
            margin: '8px 0',
            border: '1px dashed currentColor',
            borderRadius: 4,
            font: 'inherit',
            fontSize: 12,
          },
        },
        marker(id),
      ),
      label,
    );
  }
  Panel.displayName = 'TestApp(' + id + ')';
  return Panel;
}

/** Checkbox for the form-section-after zone — a real input, not a chip. */
function checkboxWidget(id, label) {
  function Check() {
    const [on, setOn] = React.useState(false);
    return h(
      'label',
      Object.assign({ style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 } }, marker(id)),
      h('input', {
        type: 'checkbox',
        checked: on,
        onChange: function (e) {
          setOn(e.target.checked);
        },
      }),
      label,
    );
  }
  Check.displayName = 'TestApp(' + id + ')';
  return Check;
}

// Per-zone components, for the manifest entries whose `render` is "component".
// Keyed by manifest id so the registration below cannot drift from the manifest
// without throwing in entry().
const COMPONENTS = {
  'testapp-header-badge': chipWidget('testapp-header-badge', 'testapp', 'span'),
  'testapp-content-panel': panelWidget('testapp-content-panel', 'Test App — page-content-after'),
  'testapp-sidetray-panel': panelWidget('testapp-sidetray-panel', 'Test App — sidetray'),
  'testapp-table-filter': chipWidget('testapp-table-filter', 'Filter'),
  'testapp-row-action': chipWidget('testapp-row-action', '★'),
  'testapp-caller-card': panelWidget('testapp-caller-card', 'Test App — inbound call'),
  'testapp-form-before': panelWidget('testapp-form-before', 'Test App — before form section'),
  'testapp-form-after': checkboxWidget('testapp-form-after', 'Test App consent'),
};

// Per-zone declared actions, for the entries whose `render` is "actions" — the
// three zones the SDK names as action zones (page-header-actions, table-toolbar,
// topbar-actions). Both paths stay covered on purpose: eight component zones
// above, three declared here, so a regression in either is visible.
const ACTIONS = {
  'testapp-header-action': actionsFor('testapp-header-action', 'Test App', {
    intent: 'primary',
    icon: 'mdi:test-tube',
  }),
  'testapp-table-toolbar': actionsFor('testapp-table-toolbar', 'Toolbar', {
    icon: 'material-symbols:download',
  }),
  'testapp-topbar-help': actionsFor('testapp-topbar-help', 'Help', {
    icon: 'material-symbols:help-outline',
  }),
};

/**
 * Zone extensions, ready for sdk.registerDynamicExtension().
 *
 * `routes` come from the manifest as bare patterns and are widened into the
 * SDK's `{ pattern }` shape here, so the manifest stays readable and the suite
 * can consume the same strings when it decides which page to visit.
 *
 * ⚠️ EXACTLY ONE OF `component` / `actions`, chosen by the manifest's `render`.
 * The host rejects a registration with both or neither and logs it, so the key
 * is set conditionally rather than passed as undefined — an explicit
 * `component: undefined` alongside `actions` reads as "both" to anything that
 * checks with `in`, and this contract is worth being unambiguous about.
 */
export const EXTENSIONS = manifest.extensions.map(function (e) {
  const config = {
    id: manifest.appId + '.' + e.id,
    zone: e.zone,
    routes: e.routes.map(function (pattern) {
      return { pattern: pattern };
    }),
  };

  if (e.render === 'actions') {
    config.actions = ACTIONS[e.id];
  } else {
    config.component = COMPONENTS[e.id];
  }

  // Declared only where the manifest says so — see the note there. Omitted
  // means "inherit the gate of the page I render on", which is the right
  // default and not the same as declaring something permissive.
  if (e.requiredScopes) config.requiredScopes = e.requiredScopes;

  return config;
});

/** Full-page routes, one per navigation zone an app may extend. */
export const ROUTES = manifest.routes.map(function (r) {
  const route = {
    id: manifest.appId + '.' + r.id,
    parentPath: r.parentPath,
    path: r.path,
    label: 'SDK Test App',
    icon: 'mdi:test-tube',
    // Assigned by App.js, which owns the page component.
    component: null,
    testId: r.testId,
  };
  if (r.requiredScopes) route.requiredScopes = r.requiredScopes;
  return route;
});

/**
 * The dynamic column, ready for sdk.registerDynamicColumn().
 *
 * Deliberately trivial: it renders a constant marker rather than deriving
 * anything from the row. The question under test is whether a registered column
 * reaches the grid at all, and a value that depends on tenant data would fail on
 * a tenant that has none — which is a data problem reported as a zone failure.
 */
export function buildColumn() {
  const c = manifest.columns[0];
  const Cell = chipWidget(c.id, 'testapp', 'span');
  return {
    id: manifest.appId + '.' + c.id,
    zone: c.zone,
    routes: c.routes.map(function (pattern) {
      return { pattern: pattern };
    }),
    column: {
      field: c.field,
      headerName: 'Test App',
      width: 120,
      sortable: false,
      filterable: false,
      type: 'string',
      renderCell: function (params, context) {
        return h(Cell, { params: params, context: context });
      },
      valueGetter: function () {
        return 'ok';
      },
    },
  };
}
