import { useCallback, useEffect, useState } from 'react';
import { BridgeUnavailableError } from '../api/interactive.js';

// The two legal status kinds (DES-MERGE-001 §3.3), as the mode surfaces render them.
//
// Extracted from `DocumentCanvas` when Video mode landed (slice 13): both surfaces load
// project-scoped state through the same client, fail the same two ways (a
// `bridge_unavailable` 503 with a named command, or anything else), and owe the user the
// same thing — a subject while loading, a next action on failure. One copy, so the rule
// cannot drift between modes.
//
// `surface` prefixes every test id (`doc-canvas-error`, `video-canvas-error`), so the two
// modes stay independently addressable from Playwright.

// The shared style constants under the token contract (DES-VISION-001 §2.11,
// vision slice 4): both mode surfaces read these, so converting them converts
// every consumer at a stroke. `accent` deliberately maps to the GATE status
// token, not the brand accent — everywhere these files use it, it marks an
// actionable "this needs you" hint (§3.3), which is the §2.6 amber layer.
export const S = {
  card:   'var(--surface-card)',
  border: 'var(--surface-raised)',
  ink:    'var(--ink-high)',
  muted:  'var(--ink-muted)',
  accent: 'var(--status-gate)',
  label:  'var(--ink-dim)',
};

export const PANEL: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.border}`, borderRadius: 'var(--radius-lg)',
  padding: '20px 22px', maxWidth: '640px',
};

/** What the client failed with, flattened to the two things the UI renders (§3.3). */
export interface Failure { message: string; hint?: string }

export function asFailure(e: unknown): Failure {
  return e instanceof BridgeUnavailableError
    ? { message: e.message, hint: e.hint }
    : { message: e instanceof Error ? e.message : String(e) };
}

/** §3.3: a working state names its subject. Never a bare spinner, never "Loading…". */
export function Loading({ surface, subject }: { surface: string; subject: string }): React.ReactElement {
  return (
    <div
      data-testid={`${surface}-canvas-loading`}
      style={{ padding: '32px', color: S.muted, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)' }}
    >
      Loading {subject}…
    </div>
  );
}

/**
 * §3.3: an error with no next action is banned. A `bridge_unavailable` 503 carries a
 * named install/fix command (§7.12) and it is shown VERBATIM — retyping it would be
 * retyping a command the user has to run. Everything else at least offers Retry.
 */
export function Failed({
  surface, subject, failure, onRetry,
}: {
  surface: string; subject: string; failure: Failure; onRetry: () => void;
}): React.ReactElement {
  return (
    <div data-testid={`${surface}-canvas-error`} style={{ padding: '32px', fontFamily: 'var(--font-sans)' }}>
      <div style={PANEL}>
        <p style={{ fontSize: 'var(--text-sm)', color: S.ink, margin: '0 0 10px' }}>Could not load {subject}.</p>
        <p
          data-testid={failure.hint ? `${surface}-bridge-hint` : `${surface}-error-detail`}
          style={{
            fontSize: 'var(--text-sm)', color: failure.hint ? S.ink : S.muted, margin: '0 0 14px',
            lineHeight: 1.5, borderLeft: `2px solid ${S.accent}`, paddingLeft: '10px',
          }}
        >
          {failure.hint ? <><strong>To fix:</strong> {failure.hint}</> : failure.message}
        </p>
        <button
          type="button"
          data-testid={`${surface}-canvas-retry`}
          onClick={onRetry}
          style={{
            background: 'transparent', border: `1px solid ${S.border}`, borderRadius: 'var(--radius-sm)',
            color: S.ink, cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '6px 12px',
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}

/** One async load, re-runnable by Retry. Returns `[value, failure, retry]`. */
export function useLoad<T>(
  load: () => Promise<T>, deps: React.DependencyList,
): [T | null, Failure | null, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState<T | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  useEffect(() => {
    let cancelled = false;
    setValue(null);
    setFailure(null);
    load().then(
      (v) => { if (!cancelled) setValue(v); },
      (e: unknown) => { if (!cancelled) setFailure(asFailure(e)); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is re-created per render; the caller declares the real deps
  }, [...deps, attempt]);
  return [value, failure, useCallback(() => setAttempt((n) => n + 1), [])];
}
