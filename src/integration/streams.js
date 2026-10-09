// The sdk.streams test bench: open a set of live data streams, show that data
// arrives on each, and close them again.
//
// Driven by the `streams` section of zones.manifest.json, which the Playwright
// suite in netsapiens-horizon-testing reads for the same testIds — see the note
// at the top of zones.js about keeping the two in sync.
//
// ⚠️ WHAT THE PAGE CAN AND CANNOT PROVE ABOUT TEARDOWN. The SDK drops anything
// the host delivers to a closed subscription before it reaches a handler, so an
// app-side "late delivery" counter could never move and would prove nothing.
// What this page shows is the app half: every handle reports closed, and its
// count stops. The host half — that the subscription really left the host — is
// the SDK Diagnostics page (/platform/ui-sdk/diagnostics), whose table lists
// every live stream subscription by app; the suite asserts this app's rows
// appear on subscribe and disappear on unsubscribe.
//
// ⚠️ NO JSX — see the note at the top of App.js.
import React from 'react';
import log from 'loglevel';
import { VERSION, isStreamLive, useStream } from '@netsapiens/flow-sdk';

import manifest from './zones.manifest.json';

const h = React.createElement;

/**
 * The SDK and the host context, set by App.js. Pages are mounted by the host
 * long after App rendered, and nothing passes either to a route component.
 */
export const contextRef = { current: null };

const TAG = '[' + manifest.appId + ']';

// ---------------------------------------------------------------------------
// The streams under test
// ---------------------------------------------------------------------------

/**
 * How each manifest stream is opened. `count` is called once per delivered
 * event with the event name, so a method with several handlers counts them all.
 *
 * Chosen so that every grant kind a normal user can hold is exercised, plus one
 * (queues) that a Basic User is refused — a refusal is a valid outcome and is
 * shown as one, not as a failure.
 */
const OPENERS = {
  presence: function (streams, count, onStatus) {
    return streams.presence.onDomain(function (p) {
      count('update', p);
    }, { onStatus: onStatus });
  },
  'own-user': function (streams, count, onStatus, user) {
    return streams.subscribers.onUser(user.extension, function (u) {
      count('update', u);
    }, { onStatus: onStatus });
  },
  'own-devices': function (streams, count, onStatus) {
    return streams.devices.onDomain(function (d) {
      count('update', d);
    }, { onStatus: onStatus });
  },
  'own-calls': function (streams, count, onStatus, user) {
    return streams.calls.onExtension(user.extension, {
      updated: function (c) {
        count('updated', c);
      },
      ended: function (c) {
        count('ended', c);
      },
    }, { onStatus: onStatus });
  },
  softphone: function (streams, count, onStatus) {
    // Two methods, one row: a softphone call should produce both.
    const started = streams.softphone.onCallStarted(function (e) {
      count('call-started', e);
    }, { onStatus: onStatus });
    const ended = streams.softphone.onCallEnded(function (e) {
      count('call-ended', e);
    });
    return combine([started, ended]);
  },
  notifications: function (streams, count, onStatus) {
    return streams.notifications.onNotification(function (n) {
      count('update', n);
    }, { onStatus: onStatus });
  },
  queues: function (streams, count, onStatus) {
    return streams.queues.onDomainQueues({
      stats: function (q) {
        count('stats', q);
      },
    }, { onStatus: onStatus });
  },
};

/**
 * Streams about the user's own extension. A session without one (a system
 * Super User, say) shows these as `skipped`, not as an error.
 */
const NEEDS_EXTENSION = ['own-user', 'own-calls'];

/** Several handles behaving as one. */
function combine(subs) {
  return {
    get status() {
      return subs[0].status;
    },
    unsubscribe: function () {
      subs.forEach(function (s) {
        s.unsubscribe();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The SDK self-check
// ---------------------------------------------------------------------------

/** Every `sdk.streams` method the 0.3.0 contract promises. */
const CONTRACT = {
  calls: ['onDomainCalls', 'onExtension'],
  queues: ['onQueue', 'onDomainQueues'],
  agents: ['onAgent'],
  presence: ['onDomain'],
  contacts: ['onDomain', 'onUser'],
  notifications: ['onNotification'],
  subscribers: ['onDomain', 'onUser'],
  devices: ['onDomain'],
  softphone: ['onCallStarted', 'onCallAnswered', 'onCallEnded', 'onCallMissed'],
};

/**
 * Checks that the package this bundle was built against is the Flow SDK this
 * app expects. Pure reads: nothing here opens a stream.
 */
function sdkChecks(sdk) {
  const checks = [];
  const add = function (name, ok, detail) {
    checks.push({ name: name, ok: !!ok, detail: detail || '' });
  };
  add('package version', VERSION === manifest.sdkVersion, 'built against ' + VERSION + ', manifest expects ' + manifest.sdkVersion);
  add('useStream export', typeof useStream === 'function');
  add('isStreamLive export', typeof isStreamLive === 'function');
  add('sdk.streams present', sdk && typeof sdk.streams === 'object');
  const missing = [];
  Object.keys(CONTRACT).forEach(function (subject) {
    CONTRACT[subject].forEach(function (method) {
      const ns = sdk && sdk.streams && sdk.streams[subject];
      if (!ns || typeof ns[method] !== 'function') missing.push(subject + '.' + method);
    });
  });
  add('every streams method', missing.length === 0, missing.length ? 'missing: ' + missing.join(', ') : '');
  // The 0.2.x surface must be gone: an app still able to call it would be on
  // the wrong package, or the wrong version of it.
  add(
    '0.2.x stream API removed',
    sdk && typeof sdk.subscribeToStream !== 'function' && typeof sdk.subscribeToCallEvents !== 'function',
  );
  return checks;
}

// ---------------------------------------------------------------------------
// The trigger
// ---------------------------------------------------------------------------

/**
 * Make the platform produce an event, so "data received" does not wait for
 * somebody to happen to change something.
 *
 * Writes a marker into the signed-in user's own status message and then puts
 * the original back. That one write lands on the presence feed and on the
 * user's own record, so both streams have something to receive. Nothing else is
 * touched, and the restore runs even if reading the marker back fails.
 */
async function triggerUpdate(ctx) {
  const path = '/domains/' + ctx.user.domain + '/users/' + ctx.user.extension;
  const current = await ctx.api.get(path);
  const original = (current && current['status-message']) || '';
  const marker = 'sdk-testapp ' + new Date().toISOString();
  try {
    await ctx.api.put(path, { 'status-message': marker });
    await new Promise(function (resolve) {
      setTimeout(resolve, 3000);
    });
  } finally {
    await ctx.api.put(path, { 'status-message': original });
  }
  return marker;
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function initialRows() {
  return manifest.streams.map(function (s) {
    return { id: s.id, open: false, state: 'idle', detail: '', events: 0, lastEvent: '', closed: null };
  });
}

/**
 * The bench. Subscribe opens every manifest stream; Unsubscribe closes them;
 * Trigger makes the platform emit something. Rows carry their state as data
 * attributes so the suite can assert without parsing text.
 */
export function StreamsPanel() {
  const ctx = contextRef.current;
  const [rows, setRows] = React.useState(initialRows);
  const [trigger, setTrigger] = React.useState('');
  const handles = React.useRef({});
  const checks = React.useMemo(function () {
    return sdkChecks(ctx && ctx.sdk);
  }, [ctx]);

  const patch = React.useCallback(function (id, fn) {
    setRows(function (prev) {
      return prev.map(function (r) {
        return r.id === id ? Object.assign({}, r, fn(r)) : r;
      });
    });
  }, []);

  const subscribeAll = React.useCallback(function () {
    if (!ctx) return;
    manifest.streams.forEach(function (s) {
      if (handles.current[s.id]) return;
      if (NEEDS_EXTENSION.indexOf(s.id) !== -1 && !(ctx.user && ctx.user.extension)) {
        patch(s.id, function () {
          return { state: 'skipped', detail: 'signed-in user has no extension' };
        });
        return;
      }
      const count = function (event) {
        patch(s.id, function (r) {
          return { events: r.events + 1, lastEvent: event };
        });
      };
      const onStatus = function (status) {
        patch(s.id, function () {
          return {
            state: status.state,
            detail: status.state === 'refused' ? status.reason + ': ' + status.message
              : status.state === 'live' ? (status.snapshot ? 'snapshot' : 'no snapshot')
              : '',
          };
        });
      };
      try {
        handles.current[s.id] = OPENERS[s.id](ctx.sdk.streams, count, onStatus, ctx.user);
        patch(s.id, function () {
          return { open: true, closed: false, state: handles.current[s.id].status.state };
        });
      } catch (err) {
        log.error(TAG + ' opening ' + s.id + ' threw', err);
        patch(s.id, function () {
          return { state: 'error', detail: String(err && err.message) };
        });
      }
    });
    log.info(TAG + ' opened ' + manifest.streams.length + ' streams');
  }, [ctx, patch]);

  const unsubscribeAll = React.useCallback(function () {
    Object.keys(handles.current).forEach(function (id) {
      const sub = handles.current[id];
      delete handles.current[id];
      // Only the public contract: unsubscribe, then unsubscribe again, which
      // the SDK promises is safe. Whether the host let go is the Diagnostics
      // page's to show — see the note at the top of this file.
      let closed = true;
      try {
        sub.unsubscribe();
        sub.unsubscribe();
      } catch (err) {
        closed = false;
        log.error(TAG + ' closing ' + id + ' threw', err);
      }
      patch(id, function () {
        return { open: false, closed: closed };
      });
    });
    log.info(TAG + ' closed every stream');
  }, [patch]);

  // Leaving the page must not leave streams open: that is the leak this bench
  // exists to catch in partner code, so it had better not have one itself.
  React.useEffect(function () {
    return function () {
      Object.keys(handles.current).forEach(function (id) {
        handles.current[id].unsubscribe();
      });
      handles.current = {};
    };
  }, []);

  const runTrigger = React.useCallback(function () {
    if (!ctx) return;
    setTrigger('running');
    triggerUpdate(ctx)
      .then(function (marker) {
        setTrigger('done: ' + marker);
      })
      .catch(function (err) {
        setTrigger('failed: ' + (err && err.message));
      });
  }, [ctx]);

  if (!ctx) {
    return h('p', { 'data-testid': 'sdk-testapp-streams' }, 'SDK not ready.');
  }

  const anyOpen = rows.some(function (r) {
    return r.open;
  });

  return h(
    'section',
    { 'data-testid': 'sdk-testapp-streams', style: { marginTop: 24 } },
    h('h3', null, 'Live data (sdk.streams)'),
    h(
      'ul',
      { 'data-testid': 'sdk-testapp-sdk-checks' },
      checks.map(function (c) {
        return h(
          'li',
          { key: c.name, 'data-check': c.name, 'data-ok': c.ok ? 'yes' : 'no' },
          (c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? ' — ' + c.detail : ''),
        );
      }),
    ),
    h(
      'div',
      { style: { display: 'flex', gap: 8, margin: '12px 0' } },
      h('button', { 'data-testid': 'sdk-testapp-streams-subscribe', onClick: subscribeAll, disabled: anyOpen }, 'Subscribe'),
      h('button', { 'data-testid': 'sdk-testapp-streams-unsubscribe', onClick: unsubscribeAll, disabled: !anyOpen }, 'Unsubscribe'),
      h(
        'button',
        { 'data-testid': 'sdk-testapp-streams-trigger', onClick: runTrigger, disabled: !anyOpen || trigger === 'running' || !(ctx.user && ctx.user.extension) },
        'Trigger an update',
      ),
      h('code', { 'data-testid': 'sdk-testapp-streams-trigger-result' }, trigger),
    ),
    h(
      'table',
      { style: { borderCollapse: 'collapse' } },
      h(
        'thead',
        null,
        h('tr', null, ['Stream', 'Call', 'State', 'Events', 'Last event', 'Handle'].map(function (t) {
          return h('th', { key: t, style: { textAlign: 'left', paddingRight: 16 } }, t);
        })),
      ),
      h(
        'tbody',
        null,
        rows.map(function (r) {
          const s = manifest.streams.find(function (m) {
            return m.id === r.id;
          });
          return h(
            'tr',
            {
              key: r.id,
              'data-testid': s.testId,
              'data-state': r.state,
              'data-events': String(r.events),
              'data-open': r.open ? 'yes' : 'no',
              'data-closed': r.closed === null ? '' : r.closed ? 'yes' : 'no',
            },
            h('td', null, s.label),
            h('td', null, h('code', null, s.call)),
            h('td', null, r.state + (r.detail ? ' (' + r.detail + ')' : '')),
            h('td', null, String(r.events)),
            h('td', null, r.lastEvent),
            h('td', null, r.open ? 'open' : r.closed ? 'closed' : '—'),
          );
        }),
      ),
    ),
  );
}
