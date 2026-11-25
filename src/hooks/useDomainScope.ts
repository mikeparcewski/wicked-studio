/**
 * (J6 S1) The scope card of a domain model launch, asked of crew (`POST /runs/preview` with the scope and the
 * repository) for exactly the words, phrases and repository on screen. A change makes the card read as loading at
 * once (never an older card under newer words), and the ask follows after a short pause; an answer for older inputs is
 * dropped. Garden reads the code to answer (CardDemo under 5 s, a large repository about half a minute).
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { DomainScopeCard } from '../api/domainModel-wire.js';
import { DOMAIN_EXTRACTION_ID } from '../board/requirementsState.js';

export type DomainScopeState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; card: DomainScopeCard; refresh?: () => void }
  | { status: 'failed'; error: string; refresh?: () => void };

const PAUSE_MS = 400;

/** The inputs a card answers for, as one comparable key. */
export function domainScopeKey(repoRef: string | null, intent: string, phrases: readonly string[] | null): string {
  return JSON.stringify([repoRef, intent.trim(), phrases]);
}

export function useDomainScope(opts: { enabled: boolean; repoRef: string | null; intent: string; phrases: readonly string[] | null }): DomainScopeState {
  const { enabled, repoRef, intent, phrases } = opts;
  // codex S1 r1: an answer is kept for its inputs, so a failed one (or a card whose code has since moved) is asked
  // again only by a person's "Read the code again", which counts as new inputs.
  const [attempt, setAttempt] = useState(0);
  const key = `${domainScopeKey(repoRef, intent, phrases)}#${attempt}`;
  const [answer, setAnswer] = useState<{ key: string; state: DomainScopeState } | null>(null);
  const asked = useRef<string | null>(null);
  const live = enabled && repoRef !== null && intent.trim() !== '';
  useEffect(() => {
    if (!live || repoRef === null) return;
    if (answer !== null && answer.key === key) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      asked.current = key;
      api
        .previewDomainScope(
          {
            workflow: DOMAIN_EXTRACTION_ID,
            repoRef,
            domainScope: { intent: intent.trim(), ...(phrases !== null ? { phrases: [...phrases] } : {}) },
          },
          { signal: ctl.signal },
        )
        .then((r) => {
          if (asked.current !== key) return;
          const state: DomainScopeState = r.scopeCard !== undefined ? { status: 'ready', card: r.scopeCard }
            : { status: 'failed', error: r.scopeError ?? 'this service shows no scope card: update wicked-crew to map a domain' };
          setAnswer({ key, state });
        })
        .catch((e: unknown) => {
          if (ctl.signal.aborted || asked.current !== key) return;
          setAnswer({ key, state: { status: 'failed', error: e instanceof Error ? e.message : String(e) } });
        });
    }, PAUSE_MS);
    return () => { clearTimeout(t); ctl.abort(); };
    // `key` carries repoRef, intent and phrases.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, key]);
  if (!live) return { status: 'off' };
  if (answer === null || answer.key !== key) return { status: 'loading' };
  return answer.state.status === 'ready' || answer.state.status === 'failed' ? { ...answer.state, refresh: () => setAttempt((n) => n + 1) } : answer.state;
}
