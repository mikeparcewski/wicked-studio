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
export function readPowerDefault(): Promise<boolean> {
  pending ??= api.getSettings().then((r) => {
    const on = (r.settings as { powerModeDefault?: unknown }).powerModeDefault !== false;
    usePowerDefaultStore.setState({ value: on });
    return on;
  }).finally(() => { pending = null; });
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
