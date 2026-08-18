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

export const S = {
  card:   '#161b22',
  border: 'rgba(230,237,243,0.1)',
  ink:    '#e6edf3',
  muted:  'rgba(230,237,243,0.55)',
  accent: '#ffda19',
  label:  'rgba(230,237,243,0.3)',
};

export const PANEL: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.border}`, borderRadius: '10px',
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
      style={{ padding: '32px', color: S.muted, fontSize: '13px' }}
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
    <div data-testid={`${surface}-canvas-error`} style={{ padding: '32px' }}>
      <div style={PANEL}>
        <p style={{ fontSize: '13px', color: S.ink, margin: '0 0 10px' }}>Could not load {subject}.</p>
        <p
          data-testid={failure.hint ? `${surface}-bridge-hint` : `${surface}-error-detail`}
          style={{
            fontSize: '13px', color: failure.hint ? S.ink : S.muted, margin: '0 0 14px',
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
            background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '6px',
            color: S.ink, cursor: 'pointer', fontSize: '12px', padding: '6px 12px',
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
