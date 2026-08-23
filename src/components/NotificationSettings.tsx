import { useState } from 'react';
import { useNotifPrefsStore } from '../store/notifPrefs.js';

/**
 * The Notifications group of the `/system` settings surface (DES-FEEDBACK-002
 * §8.2, slice L; placed per DES-FEEDBACK-003 §8.6 — the route is unchanged,
 * it is reached under the rail's Settings heading).
 *
 * Opt-in and permission-gated IN THE RIGHT ORDER (EC25): the browser's
 * permission prompt fires only on the desktop option's own click — never on
 * app load, never from the ingest fold. `denied` renders the state honestly
 * ("blocked in browser settings — the studio cannot re-ask") and the radio
 * reverts to Off. Persistence is `studio.notifications` on the crew settings
 * wire — the appearance pattern verbatim (`useNotifPrefsStore`).
 *
 * Tokens (§8.3): the existing settings dress — labels `--text-sm --font-sans
 * --ink-body`; the permission state line `--text-xs --font-mono`, in
 * `--status-run` when granted, `--status-fail` when denied. No other visual
 * surface: the feature's output is the OS's, not ours.
 */

type PermState = NotificationPermission | 'unsupported';

function permissionNow(): PermState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

const CSS = {
  row: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 0' },
  label: {
    fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)',
    color: 'var(--ink-body)', cursor: 'pointer',
  },
  status: { fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', margin: '8px 0 0' },
} as const satisfies Record<string, React.CSSProperties>;

export function NotificationSettings(): React.ReactElement {
  const prefs = useNotifPrefsStore((s) => s.prefs);
  const update = useNotifPrefsStore((s) => s.update);
  const [permission, setPermission] = useState<PermState>(permissionNow);
  const [denied, setDenied] = useState(false);

  /** EC25: THE one requestPermission call site in the app — this click. */
  async function chooseDesktop(): Promise<void> {
    if (typeof Notification === 'undefined') return;
    let result: NotificationPermission = Notification.permission;
    if (result !== 'granted') {
      try {
        result = await Notification.requestPermission();
      } catch {
        result = Notification.permission;
      }
    }
    setPermission(result);
    if (result === 'granted') {
      setDenied(false);
      update({ desktop: true });
    } else {
      // The radio reverts to Off; a `denied` is named honestly below.
      setDenied(result === 'denied');
      update({ desktop: false });
    }
  }

  const statusLine = ((): { text: string; color: string } | null => {
    if (permission === 'unsupported') {
      return { text: 'this browser does not support desktop notifications', color: 'var(--ink-dim)' };
    }
    if (permission === 'denied' || denied) {
      return {
        text: 'permission blocked in browser settings — the studio cannot re-ask',
        color: 'var(--status-fail)',
      };
    }
    if (permission === 'granted') return { text: 'permission granted ✓', color: 'var(--status-run)' };
    if (prefs.desktop) {
      // §7.10 (slice X2): the on-load truth. The crew-persisted pref says
      // desktop-on, but THIS browser has never granted (state 'default') —
      // notifications will not fire here until re-enabled, so say so with the
      // next step instead of silently rendering an On radio that does nothing.
      return {
        text: 'permission not granted in this browser — click the desktop option to grant it',
        color: 'var(--status-gate)',
      };
    }
    return null; // 'default' + off: nothing to report until the operator opts in
  })();

  return (
    <section
      data-testid="notif-settings"
      className="rounded-xl px-5 mb-6 pb-4"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
    >
      <h2
        className="text-xs font-semibold uppercase tracking-wide pt-4 pb-2 font-mono"
        style={{ color: 'var(--ink-dim)' }}
      >
        Notifications
      </h2>

      <div style={CSS.row}>
        <input
          type="radio"
          id="notif-off"
          name="notif-mode"
          data-testid="notif-off"
          checked={!prefs.desktop}
          onChange={() => { setDenied(false); update({ desktop: false }); }}
          style={{ accentColor: 'var(--accent)', marginTop: '2px' }}
        />
        <label htmlFor="notif-off" style={CSS.label}>Off — in-app toasts only</label>
      </div>

      <div style={CSS.row}>
        <input
          type="radio"
          id="notif-desktop"
          name="notif-mode"
          data-testid="notif-desktop"
          checked={prefs.desktop}
          disabled={permission === 'unsupported'}
          onChange={() => { void chooseDesktop(); }}
          style={{ accentColor: 'var(--accent)', marginTop: '2px' }}
        />
        <label htmlFor="notif-desktop" style={CSS.label}>
          Desktop notification when a gate needs you and this tab is hidden
        </label>
      </div>

      <div style={{ ...CSS.row, paddingLeft: '24px' }}>
        <input
          type="checkbox"
          id="notif-chime"
          data-testid="notif-chime"
          checked={prefs.chime}
          disabled={!prefs.desktop}
          onChange={(e) => update({ chime: e.target.checked })}
          style={{ accentColor: 'var(--accent)', marginTop: '2px' }}
        />
        <label
          htmlFor="notif-chime"
          style={{ ...CSS.label, color: prefs.desktop ? 'var(--ink-body)' : 'var(--ink-dim)' }}
        >
          Also play a chime
        </label>
      </div>

      {statusLine !== null && (
        <p data-testid="notif-permission" style={{ ...CSS.status, color: statusLine.color }}>
          {statusLine.text}
        </p>
      )}
    </section>
  );
}
