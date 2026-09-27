import { useCallback, useMemo, useState } from 'react';
import type { SessionView } from '../api/types.js';
import { teamPlanApi, type Preset } from '../api/teamPlan.js';
import { defaultPresetName, presetStepsOf, reuseConsequence, type ReuseConsequence } from '../board/runReuse.js';

/**
 * "Reuse as preset" on a finished run (Wave C, idea 11). Opening it reads the daemon's presets
 * (so the consequence can say what a save replaces) and proposes a name; nothing is written until
 * `save`, which `PUT`s the run's plan as a global preset. The result replaces the move in place.
 */
export type ReuseState =
  | { phase: 'closed' }
  | { phase: 'open'; name: string; existing: Preset[] | 'loading' | null }
  | { phase: 'saving'; name: string; existing: Preset[] | 'loading' | null }
  | { phase: 'saved'; name: string }
  | { phase: 'error'; name: string; existing: Preset[] | 'loading' | null; message: string };

export interface ReusePreset {
  state: ReuseState;
  /** The run's plan as preset steps — empty means there is nothing to reuse (no move drawn). */
  steps: ReturnType<typeof presetStepsOf>;
  consequence: ReuseConsequence | null;
  open: () => void;
  close: () => void;
  setName: (name: string) => void;
  save: () => Promise<void>;
}

export function useReusePreset(view: SessionView): ReusePreset {
  const steps = useMemo(() => presetStepsOf(view), [view]);
  const [state, setState] = useState<ReuseState>({ phase: 'closed' });

  const open = useCallback(() => {
    const name = defaultPresetName(view);
    setState({ phase: 'open', name, existing: 'loading' });
    teamPlanApi.presets()
      .then(({ presets }) => setState((s) => (s.phase === 'open' ? { ...s, existing: presets } : s)))
      // Unknown: the consequence says a same-named preset would be replaced.
      .catch(() => setState((s) => (s.phase === 'open' ? { ...s, existing: null } : s)));
  }, [view]);

  const close = useCallback(() => setState({ phase: 'closed' }), []);
  const setName = useCallback((name: string) => {
    setState((s) => (s.phase === 'open' || s.phase === 'error' ? { phase: 'open', name, existing: s.existing } : s));
  }, []);

  const consequence = state.phase === 'open' || state.phase === 'saving' || state.phase === 'error'
    ? reuseConsequence(steps, state.name, state.existing)
    : null;

  const save = useCallback(async () => {
    if (state.phase !== 'open' && state.phase !== 'error') return;
    const c = reuseConsequence(steps, state.name, state.existing);
    if (c.blocked) return;
    const name = state.name.trim();
    const existing = state.existing;
    setState({ phase: 'saving', name, existing });
    try {
      const { preset } = await teamPlanApi.putPreset(name, { steps: steps.map((s) => ({ catalog: s.catalog, id: s.id })) });
      setState({ phase: 'saved', name: preset?.name ?? name });
    } catch (e) {
      setState({ phase: 'error', name, existing, message: e instanceof Error ? e.message : String(e) });
    }
  }, [state, steps]);

  return { state, steps, consequence, open, close, setName, save };
}
