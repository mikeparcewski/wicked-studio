import type { CoreEvent } from '../api/types.js';
import { useMembershipStore } from '../store/membership.js';
import { useNotifPrefsStore } from '../store/notifPrefs.js';
import { gateOpenPath } from './gateActions.js';

/**
 * The desktop-notification trigger (DES-FEEDBACK-002 §8.2, P2-8, slice L) —
 * one function folded into the app's existing `/ws` ingest (App.tsx), beside
 * the in-app stores. Additive and hidden-tab-only: the in-app
 * GateNotifications toasts own the visible tab, this layer exists ONLY for
 * the operator who tabbed away.
 *
 * Fires iff ALL hold:
 *   - the frame is `awaitingHuman` (exactly that — §8.2 "no invented events");
 *   - the tab is unfocused: `document.visibilityState === 'hidden'` OR
 *     `document.hasFocus() === false` (the visible-but-unfocused window);
 *   - the operator opted in (`studio.notifications.desktop`) AND the browser
 *     permission is `granted` — NEVER prompts here (EC25: the one
 *     `requestPermission` call in the app lives on the settings toggle);
 *   - this exact gate (runId + ord) has not already fired — a reconnect
 *     replaying the same `awaitingHuman` must not re-notify; a LATER gate on
 *     the same run (new ord) is a new question and may. The OS `tag` (the run
 *     id) additionally collapses same-run notifications at the OS level.
 *
 * Body: the prompt's first line, `· <project name>` when the membership
 * mirror knows it. Click focuses the window and lands on the run's gate —
 * `…/build/<run>#gate` when the run's project is known (the same one-shot
 * `#gate` intent the triage cursor uses), else the legacy `/runs/:id` route,
 * which resolves the project itself.
 *
 * The chime (§8.2): ~0.4s two-tone (sine, 880→1175 Hz, gain-enveloped) built
 * with the Web Audio API — zero asset bytes, no `<audio>`, CSP-clean. Played
 * only when a notification actually fires (same guards), and skipped under
 * `prefers-reduced-motion: reduce` (the OS-level "calm down" preference).
 */

/** (runId → ord) of gates that already raised a notification this session. */
const fired = new Map<string, number>();

/** Test-only: forget the per-gate de-dupe state. */
export function resetDesktopNotify(): void {
  fired.clear();
}

/** The tab-unfocused test (§8.2): hidden, or visible but not the focused window. */
function tabUnfocused(): boolean {
  return document.visibilityState === 'hidden' || !document.hasFocus();
}

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The synthesized two-tone chime — created per fire, closed when done. */
function playChime(): void {
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (Ctor === undefined) return;
  try {
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    for (const [freq, at] of [[880, 0], [1175, 0.18]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0 + at);
      osc.connect(gain);
      osc.start(t0 + at);
      osc.stop(t0 + 0.4);
    }
    setTimeout(() => { void ctx.close().catch(() => undefined); }, 600);
  } catch {
    /* no audio device / autoplay refusal — the notification already fired */
  }
}

/** Navigation from a Notification.onclick — no React tree in scope, so push
 *  the path the way the app's own `navigate` does and let useRoute's popstate
 *  listener pick it up. */
function goTo(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Fold one CoreEvent (App.tsx's ingest). Never throws; never prompts (EC25).
 */
export function notifyGateIfUnfocused(event: CoreEvent): void {
  if (event.type !== 'awaitingHuman') return;
  const runId = typeof event.session === 'string' ? event.session : undefined;
  if (runId === undefined) return;
  const ord = typeof event.ord === 'number' ? event.ord : 0;

  if (typeof Notification === 'undefined') return;
  const { prefs } = useNotifPrefsStore.getState();
  if (!prefs.desktop || Notification.permission !== 'granted') return;
  if (!tabUnfocused()) return;
  if (fired.get(runId) === ord) return; // a replayed frame, not a new gate

  const { projectNameByRun, projectIdByRun } = useMembershipStore.getState();
  const prompt = typeof event.prompt === 'string' && event.prompt !== ''
    ? event.prompt
    : 'A run is awaiting your review';
  const firstLine = prompt.split('\n', 1)[0] ?? prompt;
  const projectName = projectNameByRun[runId];
  const body = projectName !== undefined ? `${firstLine} · ${projectName}` : firstLine;

  try {
    const n = new Notification('Gate needs you', { body, tag: runId });
    fired.set(runId, ord);
    n.onclick = () => {
      window.focus();
      const pid = useMembershipStore.getState().projectIdByRun[runId] ?? projectIdByRun[runId];
      goTo(pid !== undefined ? gateOpenPath(pid, runId) : `/runs/${runId}`);
      n.close();
    };
  } catch {
    return; // a refusing constructor must not block the ingest fold
  }

  if (prefs.chime && !reducedMotion()) playChime();
}
