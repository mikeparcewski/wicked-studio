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

/** How long a Start's checks (the daemon's capabilities, then the setting) may take before it starts nothing. */
export const START_LIMITS = { checkWaitMs: 15_000 };

/**
 * (api-types 0.196.0) The `power` a chat job's Start sends, for a job crew says can choose (`powerChoice`), decided at
 * the press like the `/` start's: the daemon's capabilities and the Power-mode setting are read NOW, and Review plan
 * must be offered (or not) as the passage showed it (`shownOffer`). A change since (the setting, power mode, crew's
 * `chatJobPower`), a choice flipped meanwhile, a failed read or one slower than {@link START_LIMITS} starts nothing (the
 * stores are updated, so the passage redraws with what was read). Where it was not offered and still is not:
 * `undefined` (no `power`: it stops at its plan, exactly the body of before).
 */
export async function jobStartPower(shownOffer: boolean, reviewAsked: boolean, reviewNow: () => boolean): Promise<boolean | undefined> {
  const check = async (): Promise<boolean | undefined> => {
    let caps: Record<string, unknown>;
    try {
      caps = ((await api.getHealth()) as unknown as { capabilities?: Record<string, unknown> }).capabilities ?? {};
    } catch (e) {
      throw new Error(`Not started: the daemon did not say what it can do (${e instanceof Error ? e.message : String(e)}). Press Start again.`);
    }
    const powerNow = caps['powerMode'] === true;
    const fieldNow = caps['chatJobPower'] === true;
    const st = useCapabilities.getState();
    if (st.powerMode !== powerNow || st.chatJobPower !== fieldNow) useCapabilities.setState({ powerMode: powerNow, chatJobPower: fieldNow });
    let defaultNow = false;
    if (powerNow && fieldNow) {
      try { defaultNow = await readPowerDefault({ fresh: true }); } catch (e) {
        throw new Error(`Not started: the Power-mode setting could not be read (${e instanceof Error ? e.message : String(e)}). Press Start again.`);
      }
    }
    const offerNow = powerNow && fieldNow && defaultNow;
    if (offerNow !== shownOffer) {
      throw new Error(offerNow
        ? 'Not started: Power mode for new jobs is on now. Choose Review plan, then press Start again.'
        : 'Not started: power runs are off for this job now, so it reviews its plan. Press Start again.');
    }
    // Not offered, as shown: no `power` (it stops at its plan; exactly the body of before).
    if (!offerNow) return undefined;
    if (reviewNow() !== reviewAsked) throw new Error('Not started: Review plan changed while the job was being checked. Press Start again.');
    return !reviewAsked;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Not started: no answer from the daemon in ${Math.round(START_LIMITS.checkWaitMs / 1000)} s. Press Start again.`)), START_LIMITS.checkWaitMs);
  });
  try {
    return await Promise.race([check(), giveUp]);
  } finally {
    clearTimeout(timer);
  }
}
