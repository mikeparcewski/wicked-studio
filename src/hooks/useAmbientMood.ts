import { useEffect, useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { ambientMood } from '../board/ambient.js';
import { effectiveAppearance, useAppearanceStore } from '../theming/appearance.js';

/**
 * Ambient's mood on <html data-mood>, from what the app already holds (the runs over /ws and the settled needs-you
 * count): no poll of its own. The only timer is the one wake-up when a failure or a delivery ages out.
 */
export function useAmbientMood(runs: readonly SessionView[], needs: number): void {
  // What the tab shows: a theme proposal previewed with Ambient on gets its mood too (DES-CHAT-ARTIFACTS-001 §9).
  const on = useAppearanceStore((s) => effectiveAppearance(s).ambient === true);
  const [tick, setTick] = useState(0);
  const result = useMemo(() => ambientMood({ runs, needs, now: Date.now() }), [runs, needs, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = document.documentElement;
    if (!on) { root.removeAttribute('data-mood'); return undefined; }
    root.setAttribute('data-mood', result.mood);
    if (result.until === null) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, result.until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [on, result]);
}
