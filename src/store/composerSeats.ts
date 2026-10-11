import { create } from 'zustand';

/**
 * studio#631: the seats a composer send uses, per viewer. Stored as the seats the operator DROPPED
 * (localStorage, this browser), so a seat the daemon adds later is on until it is dropped — the
 * launch form's rule (every eligible seat, minus what you turned off). The Desk / session composer's
 * helper row writes it; the Ask's first send (`POST /chats {clis}`) and a `/workflow-<key>` launch
 * (`POST /runs {clisJson}`) both read it, so what the row shows is what is sent.
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

/** Whether `key` is OFF for a send: dropped, or an opt-in seat the operator has not picked. */
export function seatOff(key: string, dropped: readonly string[], picked: readonly string[]): boolean {
  return isOptInKey(key) ? !picked.includes(key) : dropped.includes(key);
}

function load(storeKey: string = KEY): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(storeKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function save(dropped: readonly string[], storeKey: string = KEY): void {
  try { globalThis.localStorage?.setItem(storeKey, JSON.stringify(dropped)); } catch { /* private mode: this tab only */ }
}

interface ComposerSeatsStore {
  dropped: string[];
  /** The opt-in seats turned ON. */
  picked: string[];
  /** Turn one seat off (or back on); an opt-in seat toggles its explicit pick. */
  toggle: (key: string) => void;
}

export const useComposerSeats = create<ComposerSeatsStore>((set) => ({
  dropped: load(),
  picked: load(PICK_KEY),
  toggle: (key) => {
    // Re-read the stored choice first: another tab may have changed it since this one loaded
    // (codex r2 on #631) — a toggle applies to the latest choice, never overwrites it.
    if (isOptInKey(key)) {
      const cur = load(PICK_KEY);
      const picked = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      save(picked, PICK_KEY);
      set({ picked });
      return;
    }
    const cur = load();
    const dropped = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    save(dropped);
    set({ dropped });
  },
}));

// Another tab's toggle lands here too, so every tab sends the same choice.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) useComposerSeats.setState({ dropped: load() });
    if (e.key === PICK_KEY) useComposerSeats.setState({ picked: load(PICK_KEY) });
  });
}

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

/** Test hook: back to nothing dropped. */
export function resetComposerSeats(): void {
  save([]);
  save([], PICK_KEY);
  useComposerSeats.setState({ dropped: [], picked: [] });
}
