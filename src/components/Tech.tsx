import type { AgentSession } from '../api/types.js';
import { useTechDetails } from '../hooks/useTechDetails.js';

/**
 * An engineer's handle (DES-studio-rebuild S3, DESIGN-simple §3-§4): ids, shas and helper names
 * in small grey type, shown only while Settings › "Show technical details" is on. Off (the
 * default) it renders NOTHING — no hidden span, no layout — so a surface reads exactly as it
 * did. Handles are display only: they never carry a secret and never act.
 */

type Part = string | null | undefined | false;

interface Props {
  /** Passed as `data-testid` at the call site so the testid inventory scanner sees each handle. */
  'data-testid': string;
  parts: readonly Part[];
  /** On its own line (a header's sub-line) rather than inline after the text it follows. */
  block?: boolean;
  className?: string;
}

export function Tech({ 'data-testid': testId, parts, block = false, className = '' }: Props): React.ReactElement | null {
  const on = useTechDetails();
  const shown = parts.filter((p): p is string => typeof p === 'string' && p !== '');
  if (!on || shown.length === 0) return null;
  return (
    <span
      data-testid={testId}
      data-tech="on"
      className={`font-mono text-[11px] leading-snug tabular-nums truncate ${block ? 'block' : 'inline'} ${className}`}
      style={{ color: 'var(--ink-dim)' }}
    >
      {shown.join(' · ')}
    </span>
  );
}

/** The 7-char short sha the design uses (`sha a41c9e2`). */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** A run's handles: its id, the commit its worktree was minted from, and its seats. A field the
 *  wire did not send is skipped, never invented. */
export function runTechParts(session: Pick<AgentSession, 'id'> & { clis?: readonly string[] | null; base_commit?: string | null | undefined }): string[] {
  const parts = [`run ${session.id}`];
  if (typeof session.base_commit === 'string' && session.base_commit !== '') parts.push(`base ${shortSha(session.base_commit)}`);
  const seats = seatPart(session.clis);
  if (seats !== null) parts.push(seats);
  return parts;
}

/** `seat pi` / `seats claude, codex`; null for an empty pool. */
export function seatPart(clis: readonly string[] | null | undefined): string | null {
  const names = (clis ?? []).filter((c) => typeof c === 'string' && c !== '');
  if (names.length === 0) return null;
  return `${names.length === 1 ? 'seat' : 'seats'} ${names.join(', ')}`;
}
