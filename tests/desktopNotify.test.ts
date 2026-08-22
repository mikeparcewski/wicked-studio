import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';

/**
 * The desktop-notification trigger (DES-FEEDBACK-002 §8.2/§8.4, slice L):
 * fires ONLY for `awaitingHuman` + unfocused tab + opted-in + `granted` —
 * and NEVER calls `Notification.requestPermission` itself (EC25: the one
 * prompt call site is the settings toggle). De-dupes per gate (runId + ord):
 * a reconnect replaying the same frame must not re-notify; a LATER gate on
 * the same run may (same OS `tag`, so no unbounded stack either way). The
 * click focuses the window and lands on the run's gate; the chime is Web
 * Audio, played only when a notification actually fired and the chime pref
 * is on.
 */

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static instances: FakeNotification[] = [];
  title: string;
  body: string | undefined;
  tag: string | undefined;
  onclick: (() => void) | null = null;
  closed = false;
  constructor(title: string, opts?: { body?: string; tag?: string }) {
    this.title = title;
    this.body = opts?.body;
    this.tag = opts?.tag;
    FakeNotification.instances.push(this);
  }
  close(): void { this.closed = true; }
}

class FakeAudioContext {
  static created = 0;
  currentTime = 0;
  destination = {};
  constructor() { FakeAudioContext.created += 1; }
  createGain() {
    return {
      connect: () => undefined,
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
    };
  }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: () => undefined },
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    };
  }
  close(): Promise<void> { return Promise.resolve(); }
}

vi.stubGlobal('Notification', FakeNotification);
vi.stubGlobal('AudioContext', FakeAudioContext);

const { notifyGateIfUnfocused, resetDesktopNotify } = await import('../src/board/desktopNotify.js');
const { useNotifPrefsStore, DEFAULT_NOTIF_PREFS } = await import('../src/store/notifPrefs.js');
const { useMembershipStore } = await import('../src/store/membership.js');

let visibility: DocumentVisibilityState = 'hidden';
let focused = false;
let reducedMotion = false;

const gateEvent = (runId: string, ord = 0, prompt = 'Approve the deck outline?\nmore detail'): CoreEvent =>
  ({ type: 'awaitingHuman', session: runId, ord, prompt } as unknown as CoreEvent);

beforeEach(() => {
  visibility = 'hidden';
  focused = false;
  reducedMotion = false;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true, get: () => visibility,
  });
  document.hasFocus = () => focused;
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-motion') ? reducedMotion : false,
  }));
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission.mockClear();
  FakeNotification.instances = [];
  FakeAudioContext.created = 0;
  resetDesktopNotify();
  useNotifPrefsStore.setState({ prefs: { desktop: true, chime: false }, loaded: true });
  useMembershipStore.setState({
    projectNameByRun: { 'r-q3': 'q3-review-deck' },
    projectIdByRun: { 'r-q3': 'q3-review-deck' },
  });
});

afterEach(() => {
  useNotifPrefsStore.setState({ prefs: DEFAULT_NOTIF_PREFS, loaded: false });
  useMembershipStore.setState({ projectNameByRun: {}, projectIdByRun: {} });
});

describe('the guard set (§8.2)', () => {
  it('fires one Notification for a hidden-tab awaitingHuman — tag = run id, body = prompt first line · project', () => {
    notifyGateIfUnfocused(gateEvent('r-q3'));
    expect(FakeNotification.instances).toHaveLength(1);
    const n = FakeNotification.instances[0]!;
    expect(n.title).toBe('Gate needs you');
    expect(n.tag).toBe('r-q3');
    expect(n.body).toBe('Approve the deck outline? · q3-review-deck');
    // EC25: this path NEVER prompts.
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('a visible, focused tab fires nothing — the in-app toasts own it', () => {
    visibility = 'visible';
    focused = true;
    notifyGateIfUnfocused(gateEvent('r-q3'));
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('visible but UNFOCUSED window still fires (the OR-condition, §8.2)', () => {
    visibility = 'visible';
    focused = false;
    notifyGateIfUnfocused(gateEvent('r-q3'));
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it('pref off / permission not granted / other events fire nothing', () => {
    useNotifPrefsStore.setState({ prefs: { desktop: false, chime: false } });
    notifyGateIfUnfocused(gateEvent('r-q3'));

    useNotifPrefsStore.setState({ prefs: { desktop: true, chime: false } });
    FakeNotification.permission = 'denied';
    notifyGateIfUnfocused(gateEvent('r-q3'));

    FakeNotification.permission = 'granted';
    notifyGateIfUnfocused({ type: 'sessionFailed', session: 'r-q3' } as unknown as CoreEvent);

    expect(FakeNotification.instances).toHaveLength(0);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('an unfiled run still notifies — body is the bare prompt line', () => {
    notifyGateIfUnfocused(gateEvent('r-orphan'));
    expect(FakeNotification.instances[0]?.body).toBe('Approve the deck outline?');
  });
});

describe('per-gate de-dupe (§8.4 + the reconnect-replay rule)', () => {
  it('a replayed frame (same runId + ord) does not re-fire', () => {
    notifyGateIfUnfocused(gateEvent('r-q3', 0));
    notifyGateIfUnfocused(gateEvent('r-q3', 0));
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it('a LATER gate on the same run (new ord) fires again, with the SAME tag', () => {
    notifyGateIfUnfocused(gateEvent('r-q3', 0));
    notifyGateIfUnfocused(gateEvent('r-q3', 1, 'Second question'));
    expect(FakeNotification.instances).toHaveLength(2);
    expect(FakeNotification.instances[1]?.tag).toBe('r-q3'); // OS-level collapse
  });
});

describe('the click (§8.2: focus + land on the gate)', () => {
  it('focuses the window and navigates to the run thread at #gate', () => {
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    notifyGateIfUnfocused(gateEvent('r-q3'));
    FakeNotification.instances[0]?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(window.location.pathname + window.location.hash).toBe('/p/q3-review-deck/build/r-q3#gate');
    expect(FakeNotification.instances[0]?.closed).toBe(true);
    focus.mockRestore();
  });

  it('falls back to the legacy /runs/:id route when the project is unknown', () => {
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    notifyGateIfUnfocused(gateEvent('r-orphan'));
    FakeNotification.instances[0]?.onclick?.();
    expect(window.location.pathname).toBe('/runs/r-orphan');
    focus.mockRestore();
  });
});

describe('the chime (§8.2)', () => {
  it('creates an AudioContext only when the chime pref is on', () => {
    notifyGateIfUnfocused(gateEvent('r-a'));
    expect(FakeAudioContext.created).toBe(0);

    useNotifPrefsStore.setState({ prefs: { desktop: true, chime: true } });
    notifyGateIfUnfocused(gateEvent('r-b'));
    expect(FakeAudioContext.created).toBe(1);
  });

  it('never chimes without a notification, and yields to prefers-reduced-motion', () => {
    useNotifPrefsStore.setState({ prefs: { desktop: true, chime: true } });
    visibility = 'visible';
    focused = true;
    notifyGateIfUnfocused(gateEvent('r-c')); // no notification ⇒ no chime
    expect(FakeAudioContext.created).toBe(0);

    visibility = 'hidden';
    reducedMotion = true;
    notifyGateIfUnfocused(gateEvent('r-d'));
    expect(FakeNotification.instances).toHaveLength(1); // notification still fires
    expect(FakeAudioContext.created).toBe(0);           // …the chime yields
  });
});
