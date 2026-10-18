import { create } from 'zustand';

/**
 * studio#631: the seats a composer send uses, per viewer. Stored as the seats the operator DROPPED
 * (localStorage, this browser), so a seat the daemon adds later is on until it is dropped — the
 * launch form's rule (every eligible seat, minus what you turned off). The Desk / session composer's
 * helper row and the Ask drawer's write it; the Ask's first send (`POST /chats {clis}`) and a
 * `/workflow-<key>` launch (`POST /runs {clisJson}`) both read it, so what the row shows is what is
 * sent. The New job wizard keeps its own choice ([`useLaunchSeats`], studio#840).
 */
const KEY = 'wicked_composer_dropped_seats';
/** (operator ruling 2026-10-11) The OPT-IN seats the operator turned ON (opencode): off unless picked. */
const PICK_KEY = 'wicked_composer_picked_optin_seats';

/** The opt-in CLIs — never in a default pick (opencode keeps stalling); an instance is its CLI's. */
export const OPT_IN_SEAT_KEYS: readonly string[] = ['opencode'];
/** The one-line note shown beside an opt-in seat. */
export const OPT_IN_NOTE = 'opt-in: known to stall';

export function isOptInKey(key: string): boolean {
  return OPT_IN_SEAT_KEYS.includes(key.split('#')[0] ?? key);
}

/** Whether a seat is in a DEFAULT pick: every seat but an opt-in one the operator has not picked. */
export function defaultOn(key: string, picked: readonly string[] = useComposerSeats.getState().picked): boolean {
  return !isOptInKey(key) || picked.includes(key);
}

/** Whether `key` is OFF for a send: dropped, or an opt-in seat the operator has not picked. */
export function seatOff(key: string, dropped: readonly string[], picked: readonly string[]): boolean {
  return isOptInKey(key) ? !picked.includes(key) : dropped.includes(key);
}

function load(storeKey: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(storeKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function save(dropped: readonly string[], storeKey: string): void {
  try { globalThis.localStorage?.setItem(storeKey, JSON.stringify(dropped)); } catch { /* private mode: this tab only */ }
}

interface ComposerSeatsStore {
  dropped: string[];
  /** The opt-in seats turned ON. */
  picked: string[];
  /** Turn one seat off (or back on); an opt-in seat toggles its explicit pick. */
  toggle: (key: string) => void;
}

/** One composer's saved helper choice, under its own storage keys (studio#840). */
function createSeatChoice(droppedKey: string, pickedKey: string) {
  const store = create<ComposerSeatsStore>((set) => ({
    dropped: load(droppedKey),
    picked: load(pickedKey),
    toggle: (key) => {
      // Re-read the stored choice first: another tab may have changed it since this one loaded
      // (codex r2 on #631) — a toggle applies to the latest choice, never overwrites it.
      if (isOptInKey(key)) {
        const cur = load(pickedKey);
        const picked = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
        save(picked, pickedKey);
        set({ picked });
        return;
      }
      const cur = load(droppedKey);
      const dropped = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      save(dropped, droppedKey);
      set({ dropped });
    },
  }));
  // Another tab's toggle lands here too, so every tab sends the same choice.
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === droppedKey) store.setState({ dropped: load(droppedKey) });
      if (e.key === pickedKey) store.setState({ picked: load(pickedKey) });
    });
  }
  const reset = (): void => {
    save([], droppedKey);
    save([], pickedKey);
    store.setState({ dropped: [], picked: [] });
  };
  return { store, reset };
}

const composerChoice = createSeatChoice(KEY, PICK_KEY);
/** The Desk / session composer's and the Ask drawer's helper choice: both show a helpers row. */
export const useComposerSeats = composerChoice.store;

/**
 * studio#840: the New job wizard's own helper choice. It used to share the composer's, so helpers
 * turned off for one job stayed off for every later Ask — whose drawer then refused the send with
 * nothing left to pick. A job's pick is the job's; it never changes who answers an Ask.
 */
export const LAUNCH_DROPPED_KEY = 'wicked_launch_dropped_seats';
export const LAUNCH_PICKED_KEY = 'wicked_launch_picked_optin_seats';
const launchChoice = createSeatChoice(LAUNCH_DROPPED_KEY, LAUNCH_PICKED_KEY);
export const useLaunchSeats = launchChoice.store;

/** The seats a send uses: the eligible ones, in roster order, minus the dropped — and an opt-in
 *  seat only when the operator picked it. */
export function chosenSeats(
  eligible: readonly string[],
  dropped: readonly string[],
  picked: readonly string[] = useComposerSeats.getState().picked,
): string[] {
  return eligible.filter((k) => !seatOff(k, dropped, picked));
}

/** The refusal when every eligible seat is dropped — the send would otherwise fall back to them all. */
export const NO_SEAT_PICKED = 'No helper is picked for this send — turn one on in the helpers row.';

/** A helper that is ON for a send but the daemon will not seat in it (out of quota, benched, not
 *  signed in): its name and the daemon's reason, when it gave one. */
export interface UnavailableSeat {
  name: string;
  reason?: string | undefined;
}

/**
 * studio#840: the refusal when no helper is left for a send, saying why when a helper that is ON
 * cannot answer (the E2E's case: Copilot, the only one left on, was out of quota, so "no helper is
 * picked" read as wrong — one was).
 */
export function noSeatPickedMessage(unavailable: readonly UnavailableSeat[]): string {
  if (unavailable.length === 0) return NO_SEAT_PICKED;
  const said = unavailable.map((u) => (u.reason !== undefined && u.reason !== '' ? `${u.name} (${u.reason})` : u.name)).join(', ');
  const verb = unavailable.length === 1 ? 'is on but can’t answer right now' : 'are on but can’t answer right now';
  return `No helper can take this send — ${said} ${verb}. Turn another one on in the helpers row.`;
}

/** Test hook: back to nothing dropped, in every composer's choice. */
export function resetComposerSeats(): void {
  composerChoice.reset();
  launchChoice.reset();
}
