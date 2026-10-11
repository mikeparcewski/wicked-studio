import { useState } from 'react';
import { SectionTitle } from './ui/PageFrame.js';
import { Switch } from './ui/Switch.js';
import { Segmented } from './ui/Segmented.js';
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
 * --ink-body`; permission messages use the shared field-note style.
 */

type PermState = NotificationPermission | 'unsupported';

function permissionNow(): PermState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function NotificationSettings(): React.ReactElement {
  const prefs = useNotifPrefsStore((s) => s.prefs);
  const update = useNotifPrefsStore((s) => s.update);
  const [permission, setPermission] = useState<PermState>(permissionNow);
  // studio#513: the operator asked, and the browser did not grant — a dismissed prompt (the
  // permission stays `default`). Said until the operator picks Off or asks again.
  const [dismissed, setDismissed] = useState(false);

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
    // studio#513: a decisive answer (granted / denied) is the state. An answer of "default" is not
    // one — with the permission already DENIED, `requestPermission()` resolves "default" (no prompt
    // is shown) while `Notification.permission` stays "denied" — so the browser's state is read
    // then: still denied = blocked (the reason stays on screen); default = a dismissed prompt.
    const now: NotificationPermission = result === 'default' ? Notification.permission : result;
    setPermission(now);
    if (now === 'granted') {
      setDismissed(false);
      update({ desktop: true });
    } else {
      // The radio reverts to Off; the reason is named below — blocked, or not granted this time.
      setDismissed(now === 'default');
      update({ desktop: false });
    }
  }

  const statusLine = ((): { text: string; state: string } | null => {
    if (permission === 'unsupported') {
      return { text: 'This browser does not support desktop notifications.', state: 'unsupported' };
    }
    if (permission === 'denied') {
      return {
        text: 'Notifications are blocked in browser settings. Allow them there to receive desktop notifications.',
        state: 'denied',
      };
    }
    if (permission === 'granted') return { text: 'Desktop notifications are allowed.', state: 'granted' };
    if (dismissed) {
      return {
        text: 'The browser did not grant permission. Pick Desktop again to be asked.',
        state: 'dismissed',
      };
    }
    if (prefs.desktop) {
      // §7.10 (slice X2): the on-load truth. The crew-persisted pref says
      // desktop-on, but THIS browser has never granted (state 'default') —
      // notifications will not fire here until re-enabled, so say so with the
      // next step instead of silently rendering an On radio that does nothing.
      return {
        text: 'This browser needs permission. Choose Desktop to allow notifications.',
        state: 'ungranted',
      };
    }
    return null; // 'default' + off: nothing to report until the operator opts in
  })();

  return (
    <section data-testid="notif-settings" className="wk-card wk-pg-set-stack">
      <SectionTitle>Notifications</SectionTitle>
      <p className="wk-field-note">Desktop notifications let you know when your work needs attention while this tab is hidden; in-app notices are always available.</p>
      {/* studio#725: two choices shown at once = the Segmented primitive (UI contract §4.2), never bare
          browser radios. Choosing Off again still clears a dismissed line (Segmented calls onChange). */}
      <div style={{ display: 'flex' }}>
      <Segmented
        label="Notifications"
        value={prefs.desktop ? 'desktop' : 'off'}
        options={[
          { value: 'off', label: 'Off', testId: 'notif-off' },
          { value: 'desktop', label: 'Desktop notifications', testId: 'notif-desktop', disabled: permission === 'unsupported' },
        ]}
        onChange={(mode) => {
          if (mode === 'desktop') void chooseDesktop();
          else { setDismissed(false); update({ desktop: false }); }
        }}
      />
      </div>
      <Switch label="Also play a chime" data-testid="notif-chime" checked={prefs.chime}
        disabled={!prefs.desktop ? 'Choose Desktop notifications before enabling a chime.' : null}
        onChange={(chime) => update({ chime })} />
      {statusLine !== null && <p data-testid="notif-permission" data-state={statusLine.state} className="wk-field-note" role="status">{statusLine.text}</p>}
    </section>
  );
}
