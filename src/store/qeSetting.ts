import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { qeAcceptanceSetting } from '../board/assuranceModel.js';
import type { QeSetting } from '../board/qeRefusal.js';

/**
 * The daemon's QE acceptance setting for a refusal's warning (`GET /health.capabilities.qeAcceptance`).
 * Read FRESH whenever a warning appears: the switch can be flipped in Settings at any time, and the
 * warning must not offer to turn off what is already off. Concurrent reads share one request.
 * `loaded` stays false until the first answer, so the warning never guesses the advice.
 */
interface QeSettingStore {
  loaded: boolean;
  setting: QeSetting;
  read: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useQeSettingStore = create<QeSettingStore>((set) => ({
  loaded: false,
  setting: null,
  read: () => {
    // The client is reached lazily, as the capabilities store does, so a store never pulls the
    // HTTP client into every importer's module graph.
    inflight ??= import('../api/client.js').then(({ api }) => api.getHealth())
      .then((h) => {
        const caps = (h as unknown as { capabilities?: Record<string, unknown> }).capabilities;
        set({ loaded: true, setting: qeAcceptanceSetting(caps) });
      })
      // A failed read says nothing about the setting: no advice to turn anything off.
      .catch(() => { set({ loaded: true, setting: null }); })
      .finally(() => { inflight = null; });
    return inflight;
  },
}));

/**
 * The setting for one refusal's warning, read afresh whenever `key` names a new refusal (a run, a
 * launch attempt) and whenever the window regains focus (the switch may have been flipped in another
 * tab; `refreshOnFocus: false` for a surface that lives only seconds and must not pull a focused link
 * from under the keyboard). Until the read for the current key answers, `loaded` is false, so advice from before the switch
 * was flipped is never shown. `key: null` reads nothing.
 */
export function useQeSetting(key: string | null, opts: { refreshOnFocus?: boolean } = {}): { loaded: boolean; setting: QeSetting } {
  const refreshOnFocus = opts.refreshOnFocus !== false;
  // Each warning shows what ITS OWN read answered (a snapshot), never another warning's later read:
  // a toast that reads once keeps its link even when a card beside it re-reads on focus.
  const [answer, setAnswer] = useState<{ key: string; setting: QeSetting } | null>(null);
  useEffect(() => {
    setAnswer(null);
    if (key === null) return;
    let live = true;
    const read = (): void => {
      void useQeSettingStore.getState().read().then(() => {
        if (live) setAnswer({ key, setting: useQeSettingStore.getState().setting });
      });
    };
    read();
    // Back from another tab: the old answer is not shown while the new one is read.
    const onFocus = (): void => { setAnswer(null); read(); };
    if (refreshOnFocus) window.addEventListener('focus', onFocus);
    return () => { live = false; window.removeEventListener('focus', onFocus); };
  }, [key, refreshOnFocus]);
  const loaded = key !== null && answer !== null && answer.key === key;
  return { loaded, setting: loaded ? answer.setting : null };
}

/** Tests: forget the last answer. */
export function resetQeSettingForTests(): void {
  inflight = null;
  useQeSettingStore.setState({ loaded: false, setting: null });
}
