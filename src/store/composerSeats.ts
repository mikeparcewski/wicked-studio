import { create } from 'zustand';

/**
 * studio#631: the seats a composer send uses, per viewer. Stored as the seats the operator DROPPED
 * (localStorage, this browser), so a seat the daemon adds later is on until it is dropped — the
 * launch form's rule (every eligible seat, minus what you turned off). The Desk / session composer's
 * helper row writes it; the Ask's first send (`POST /chats {clis}`) and a `/workflow-<key>` launch
 * (`POST /runs {clisJson}`) both read it, so what the row shows is what is sent.
 */
const KEY = 'wicked_composer_dropped_seats';

function load(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function save(dropped: readonly string[]): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(dropped)); } catch { /* private mode: this tab only */ }
}

interface ComposerSeatsStore {
  dropped: string[];
  /** Turn one seat off (or back on). */
  toggle: (key: string) => void;
}

export const useComposerSeats = create<ComposerSeatsStore>((set, get) => ({
  dropped: load(),
  toggle: (key) => {
    const cur = get().dropped;
    const dropped = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    save(dropped);
    set({ dropped });
  },
}));

/** The seats a send uses: the eligible ones, in roster order, minus the dropped. */
export function chosenSeats(eligible: readonly string[], dropped: readonly string[]): string[] {
  return eligible.filter((k) => !dropped.includes(k));
}

/** The refusal when every eligible seat is dropped — the send would otherwise fall back to them all. */
export const NO_SEAT_PICKED = 'No helper is picked for this send — turn one on in the helpers row.';

/** Test hook: back to nothing dropped. */
export function resetComposerSeats(): void {
  save([]);
  useComposerSeats.setState({ dropped: [] });
}
