// The sdk.sendNotification round trip: raise a notification for the signed-in
// user, and watch it come back on sdk.streams.notifications.
//
// Driven by the `notifications` section of zones.manifest.json, which the
// Playwright suite in netsapiens-horizon-testing reads for the same testIds.
//
// ⚠️ ON THE /home PAGE, NOT THE STREAMS BENCH. The feed below holds a
// notifications subscription for as long as the panel is mounted. The bench's
// teardown check expects the host to hold NO subscriptions for this app after
// Unsubscribe, so sharing a page would fail it for a reason that is not a leak.
//
// ⚠️ `sdk.sendNotification({ … })` IS A PLAIN CALL ON PURPOSE. The platform
// finds the `sendNotification(` call in the bundle when a version is submitted,
// the way stream grants are found. Behind a helper or a computed property name
// it would not be found, and every send would be dropped.
//
// ⚠️ NO JSX — see the note at the top of App.js.
import React from 'react';
import log from 'loglevel';

import manifest from './zones.manifest.json';
import { contextRef } from './streams.js';

const h = React.createElement;
const ids = manifest.notifications;
const TAG = '[' + manifest.appId + ']';

const SEVERITIES = ['info', 'success', 'warning', 'error'];

/** The link a received notification carries, if the platform passed it through. */
function linkOf(n) {
  const link = n.payload && n.payload.link;
  return typeof link === 'string' ? link : '';
}

/**
 * Send on the left, receive on the right. Every row carries what it received as
 * data attributes so the suite can assert without parsing text.
 */
export function NotificationsPanel() {
  const ctx = contextRef.current;
  const [title, setTitle] = React.useState('SDK test app notification');
  const [body, setBody] = React.useState('');
  const [severity, setSeverity] = React.useState('info');
  const [link, setLink] = React.useState(ids.defaultLink);
  const [id, setId] = React.useState('');
  const [sent, setSent] = React.useState({ count: 0, lastTitle: '' });
  const [feed, setFeed] = React.useState({ state: 'idle', detail: '' });
  const [received, setReceived] = React.useState([]);

  // Open the feed on mount, close it on unmount. Rows are keyed by the
  // platform's id, so a redelivery replaces its row rather than adding one.
  React.useEffect(
    function () {
      if (!ctx) return undefined;
      let sub;
      try {
        sub = ctx.sdk.streams.notifications.onNotification(
          function (n) {
            setReceived(function (prev) {
              const rest = prev.filter(function (p) {
                return p.id !== n.id;
              });
              return [n].concat(rest).slice(0, 50);
            });
          },
          {
            onStatus: function (status) {
              setFeed({
                state: status.state,
                detail: status.state === 'refused' ? status.reason + ': ' + status.message : '',
              });
            },
          },
        );
        setFeed({ state: sub.status.state, detail: '' });
      } catch (err) {
        log.error(TAG + ' opening the notifications feed threw', err);
        setFeed({ state: 'error', detail: String(err && err.message) });
      }
      return function () {
        if (sub) sub.unsubscribe();
      };
    },
    [ctx],
  );

  if (!ctx) {
    return h('p', { 'data-testid': ids.panel }, 'SDK not ready.');
  }

  const trimmed = title.trim();
  const send = function () {
    // A plain call, so the bundle scan finds `sendNotification(`.
    ctx.sdk.sendNotification({
      title: trimmed,
      body: body.trim() || undefined,
      severity: severity,
      link: link.trim() || undefined,
      id: id.trim() || undefined,
    });
    log.info(TAG + ' sent notification "' + trimmed + '"');
    setSent(function (prev) {
      return { count: prev.count + 1, lastTitle: trimmed };
    });
  };

  const field = function (label, testId, value, onChange) {
    return h(
      'label',
      { style: { display: 'block', marginBottom: 8 } },
      label + ' ',
      h('input', {
        'data-testid': testId,
        value: value,
        onChange: function (e) {
          onChange(e.target.value);
        },
        style: { width: 360 },
      }),
    );
  };

  return h(
    'section',
    { 'data-testid': ids.panel, style: { marginTop: 24 } },
    h('h3', null, 'Notifications (sdk.sendNotification)'),
    h(
      'p',
      null,
      'Raises a real Flow notification for you. It shows in the notification center ' +
        'and arrives in the received list below.',
    ),
    field('Title', ids.title, title, function (v) {
      setTitle(v.slice(0, 120));
    }),
    field('Body', ids.body, body, function (v) {
      setBody(v.slice(0, 1000));
    }),
    h(
      'label',
      { style: { display: 'block', marginBottom: 8 } },
      'Severity ',
      h(
        'select',
        {
          'data-testid': ids.severity,
          value: severity,
          onChange: function (e) {
            setSeverity(e.target.value);
          },
        },
        SEVERITIES.map(function (s) {
          return h('option', { key: s, value: s }, s);
        }),
      ),
    ),
    field('Link', ids.link, link, setLink),
    field('Id (the same id again raises nothing new)', ids.id, id, setId),
    h(
      'div',
      { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' } },
      h('button', { 'data-testid': ids.send, onClick: send, disabled: !trimmed }, 'Send notification'),
      h(
        'code',
        { 'data-testid': ids.sent, 'data-count': String(sent.count), 'data-last-title': sent.lastTitle },
        sent.count ? 'sent ' + sent.count + ' (last: ' + sent.lastTitle + ')' : '',
      ),
    ),
    h(
      'p',
      { 'data-testid': ids.feed, 'data-state': feed.state },
      'Received (notifications.onNotification): ' + feed.state + (feed.detail ? ' (' + feed.detail + ')' : ''),
    ),
    h(
      'table',
      { style: { borderCollapse: 'collapse' } },
      h(
        'thead',
        null,
        h('tr', null, ['Time', 'Category', 'Severity', 'Title', 'Link'].map(function (t) {
          return h('th', { key: t, style: { textAlign: 'left', paddingRight: 16 } }, t);
        })),
      ),
      h(
        'tbody',
        null,
        received.map(function (n) {
          return h(
            'tr',
            {
              key: n.id,
              'data-testid': ids.row,
              'data-notification-id': n.id,
              'data-category': n.category,
              'data-severity': n.severity,
              'data-title': n.title || '',
              'data-link': linkOf(n),
            },
            h('td', null, new Date(n.createdAt).toLocaleTimeString()),
            h('td', null, n.category),
            h('td', null, n.severity),
            h('td', null, n.title || '—'),
            h('td', null, linkOf(n) || '—'),
          );
        }),
      ),
    ),
  );
}
