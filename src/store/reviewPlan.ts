import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../api/client.js';
import { useCapabilities } from './capabilities.js';

/**
 * A CHAT START FOLLOWS THE POWER-MODE DEFAULT (operator ruling 2026-11-06: "Follow the setting, but when power mode is
 * set, inside the chat box we need a 'review plan' toggle so the power user can decide"; DES-POWER-MODE §2). Where the
 * daemon has power mode (`capabilities.powerMode`) and the setting "Power mode for new jobs" (`powerModeDefault`,
 * absent = on) is on, the chat box shows Review plan: off = a power run (no plan gate), on = phased, held at its plan.
 * The person's choice is remembered on this browser.
 */

const KEY = 'studio.chatReviewPlan';

function read(): boolean {
  try { return window.localStorage.getItem(KEY) === 'true'; } catch { return false; }
}

export const useReviewPlan = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: read(),
  set: (on) => {
    try { window.localStorage.setItem(KEY, on ? 'true' : 'false'); } catch { /* private mode: this session only */ }
    set({ on });
  },
}));

/** The setting as last read (`null` = not read), shared: every read updates what every chat box shows. */
export const usePowerDefaultStore = create<{ value: boolean | null }>(() => ({ value: null }));
let pending: Promise<boolean> | null = null;

/** The power-mode default read NOW (a start reads it before it launches): `powerModeDefault`, absent = on. A failed
 *  read rejects, so a start never guesses. */
export function readPowerDefault(opts: { fresh?: boolean } = {}): Promise<boolean> {
  const read = (): Promise<boolean> => api.getSettings().then((r) => {
    const on = (r.settings as { powerModeDefault?: unknown }).powerModeDefault !== false;
    usePowerDefaultStore.setState({ value: on });
    return on;
  });
  // A start's own check is a request made after the press, never one begun before it (a display read may share).
  if (opts.fresh === true) return read();
  pending ??= read().finally(() => { pending = null; });
  return pending;
}

/** Tests: forget the setting read. */
export function resetPowerDefault(): void { usePowerDefaultStore.setState({ value: null }); pending = null; }

/** Whether the chat box offers Review plan: the daemon has power mode and the default is on (`null` while unknown). */
export function usePowerDefaultOn(): boolean | null {
  const cap = useCapabilities((s) => s.powerMode);
  const on = usePowerDefaultStore((s) => s.value);
  useEffect(() => {
    if (cap) void readPowerDefault().catch(() => undefined);
  }, [cap]);
  return cap ? on : false;
}

/** The launch's `power` word for a chat start: `null` without the capability (today's body), else the setting with the
 *  person's Review plan choice: default off → `false` (phased, as today); default on → `!reviewPlan`. */
export function chatStartPower(powerCap: boolean, defaultOn: boolean, reviewPlan: boolean): boolean | null {
  if (!powerCap) return null;
  return defaultOn ? !reviewPlan : false;
}

/** How long a Start waits for the daemon to say what it can do before it starts nothing. */
export const START_LIMITS = { healthWaitMs: 15_000 };

/** A job proposal can run as a power run (crew 0.196.0's rule): a workflow run on a repository. Crew also requires a
 *  preset workflow and refuses otherwise (409 `power_unavailable`, its words shown), never runs it phased. */
export function proposalPowerFits(p: { launch?: string | null; repoRefs?: readonly string[] | null }): boolean {
  return (p.launch === 'run' || p.launch === undefined || p.launch === null) && (p.repoRefs?.length ?? 0) > 0;
}

/**
 * (api-types 0.196.0) The `power` a chat job's Start sends, decided at the press like the `/` start's: the daemon's
 * capabilities and the Power-mode setting are read NOW, and must be the ones the passage showed (`shownOn`: the Review
 * plan choice was drawn). Review plan on sends `false` at once. A power run (Review plan off) is sent only when the
 * fresh reads still say power mode is on: a setting or capability that changed since, a choice flipped meanwhile, or a
 * read that fails starts nothing (the passage redraws with what was read). `undefined` = send no `power` (the job stops
 * at its plan, as on an older daemon).
 */
export async function jobStartPower(shownOn: boolean, reviewAsked: boolean, reviewNow: () => boolean): Promise<boolean | undefined> {
  if (!shownOn) return undefined;
  // Review plan on: it stops at its plan whatever was changed since (`false` holds on every daemon that took the field).
  if (reviewAsked) return false;
  let caps: Record<string, unknown>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const giveUp = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${Math.round(START_LIMITS.healthWaitMs / 1000)} s`)), START_LIMITS.healthWaitMs); });
    caps = ((await Promise.race([api.getHealth(), giveUp])) as unknown as { capabilities?: Record<string, unknown> }).capabilities ?? {};
  } catch (e) {
    throw new Error(`Not started: the daemon did not say what it can do (${e instanceof Error ? e.message : String(e)}). Press Start again.`);
  } finally {
    clearTimeout(timer);
  }
  const powerNow = caps['powerMode'] === true;
  const fieldNow = caps['chatJobPower'] === true;
  // What the passage draws from: a fresh answer that differs updates it, so the refusal's redraw shows what was read.
  const s = useCapabilities.getState();
  if (s.powerMode !== powerNow || s.chatJobPower !== fieldNow) useCapabilities.setState({ powerMode: powerNow, chatJobPower: fieldNow });
  if (!powerNow || !fieldNow) throw new Error('Not started: power runs are off on this daemon now, so this job reviews its plan. Press Start again.');
  let defaultNow: boolean;
  try { defaultNow = await readPowerDefault({ fresh: true }); } catch (e) {
    throw new Error(`Not started: the Power-mode setting could not be read (${e instanceof Error ? e.message : String(e)}). Press Start again.`);
  }
  if (!defaultNow) throw new Error('Not started: Power mode for new jobs is off now, so this job reviews its plan. Press Start again.');
  if (reviewNow() !== reviewAsked) throw new Error('Not started: Review plan changed while the job was being checked. Press Start again.');
  return true;
}
