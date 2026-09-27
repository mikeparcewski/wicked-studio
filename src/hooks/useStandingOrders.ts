import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/errors.js';
import {
  standingOrdersApi,
  type ParsedStandingOrder,
  type StandingOrdersState,
} from '../api/standingOrders.js';
import { ruleWords } from '../board/standingOrders.js';
import { useProjectsStore } from '../store/projects.js';

/** The add flow: words → the seat's parse → the person confirms the rule said back. */
export type StandingOrderDraft =
  | { step: 'idle' }
  | { step: 'parsing'; text: string }
  | { step: 'confirm'; text: string; parsed: ParsedStandingOrder; words: string }
  | { step: 'failed'; text: string; error: string; answer?: string };

export interface StandingOrders {
  /** `null` while the first read is in flight; `'unavailable'` = the daemon predates the surface. */
  state: StandingOrdersState | null | 'unavailable';
  error: string | null;
  draft: StandingOrderDraft;
  /** Plain words for a rule, with project names resolved. */
  words: (rule: ParsedStandingOrder['rule']) => string;
  setAway: (away: boolean) => Promise<void>;
  parse: (text: string) => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => void;
  remove: (id: string) => Promise<void>;
}

/**
 * STANDING ORDERS (behaviour 10) — the behaviour; `StandingOrdersPanel` is a skin over it.
 * The daemon is the store: every action writes through crew and re-reads its answer. Only a
 * rule the person CONFIRMED is ever sent to be stored; a rule the invariant refuses cannot be
 * confirmed (the refusal is said instead).
 */
export function useStandingOrders(): StandingOrders {
  const projects = useProjectsStore((s) => s.projects);
  const [state, setState] = useState<StandingOrdersState | null | 'unavailable'>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StandingOrderDraft>({ step: 'idle' });

  const words = useCallback(
    (rule: ParsedStandingOrder['rule']) => ruleWords(rule, (id) => projects.find((p) => p.id === id)?.name),
    [projects],
  );

  /** Re-read the daemon's answer. `keepError`: a write just failed — the read must not erase it. */
  const refresh = useCallback(async (keepError = false) => {
    try {
      setState(await standingOrdersApi.get());
      if (!keepError) setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState('unavailable');
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      let failed = false;
      try {
        await fn();
      } catch (e) {
        failed = true;
        setError(e instanceof Error ? e.message : String(e));
      }
      // A refused write stays said after the re-read (codex on #347).
      await refresh(failed);
    },
    [refresh],
  );

  const parse = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (t === '') return;
      setDraft({ step: 'parsing', text: t });
      try {
        const parsed = await standingOrdersApi.parse(t);
        setDraft({ step: 'confirm', text: t, parsed, words: words(parsed.rule) });
      } catch (e) {
        const answer = e instanceof ApiError ? (e.body as { answer?: unknown } | undefined)?.answer : undefined;
        setDraft({
          step: 'failed',
          text: t,
          error: e instanceof Error ? e.message : String(e),
          ...(typeof answer === 'string' ? { answer } : {}),
        });
      }
    },
    [words],
  );

  const confirm = useCallback(async () => {
    if (draft.step !== 'confirm' || draft.parsed.refused !== undefined) return;
    const { text, parsed } = draft;
    await act(() => standingOrdersApi.create(text, parsed.rule));
    setDraft({ step: 'idle' });
  }, [draft, act]);

  return {
    state,
    error,
    draft,
    words,
    setAway: (away) => act(() => standingOrdersApi.setAway(away)),
    parse,
    confirm,
    cancel: () => setDraft({ step: 'idle' }),
    remove: (id) => act(() => standingOrdersApi.remove(id)),
  };
}
