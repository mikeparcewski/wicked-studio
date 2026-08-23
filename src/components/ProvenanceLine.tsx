import type { Provenance } from '../store/provenance.js';

/**
 * The one provenance line (DES-UX-001 §3.3/§3.4): "launched by {actor.id} ·
 * {actor.kind} via {channel}", degrading to the brief's own words — "launched
 * via API (actor unknown)" — when no audit entry matches. The line always
 * renders; only its content degrades. Lineage cross-links (§4.3, CREW-UX-3)
 * ride inside it: "retry of {short-id}" back to the original, "retried as
 * {short-id}" forward where the loaded index shows a child.
 *
 * Token usage (§3.4): `--ink-muted` sans with the actor kind as a `--text-2xs`
 * uppercase badge on `--surface-raised`; "actor unknown" in `--ink-dim`; the
 * lineage cross-links are `--accent`. No status colors — provenance is
 * context, not signal.
 */

const short = (id: string): string => id.slice(0, 8);

function LineageLink({
  label,
  runId,
  testId,
  onSelectRun,
}: {
  label: string;
  runId: string;
  testId: string;
  onSelectRun?: ((id: string) => void) | undefined;
}): React.ReactElement {
  const text = `${label} ${short(runId)}`;
  if (onSelectRun === undefined) {
    return (
      <span data-testid={testId} data-run-id={runId} style={{ color: 'var(--accent)' }}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid={testId}
      data-run-id={runId}
      onClick={() => onSelectRun(runId)}
      className="underline transition-opacity hover:opacity-70"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', font: 'inherit' }}
      title={`Open run ${runId}`}
    >
      {text}
    </button>
  );
}

interface Props {
  /** `null`/`undefined` = not (yet) derived — renders the degraded copy, never nothing. */
  provenance: Provenance | null | undefined;
  /** Back lineage from the run DTO (`AgentSession.retry_of`, CREW-UX-3). */
  retryOf?: string | undefined;
  /** Forward lineage — run ids the loaded index shows as retries of this run. */
  retriedAs?: readonly string[] | undefined;
  onSelectRun?: ((id: string) => void) | undefined;
  testId: 'run-provenance' | 'notif-provenance';
}

export function ProvenanceLine({ provenance, retryOf, retriedAs, onSelectRun, testId }: Props): React.ReactElement {
  const known = provenance != null && provenance.state === 'known';
  // Lineage prefers the DTO echo (present even when the audit trail degraded);
  // the audit detail's retryOf is the same record read from the other side.
  const backLink = retryOf ?? (known && provenance.retryOf !== undefined ? provenance.retryOf : undefined);
  return (
    <div
      data-testid={testId}
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]"
      style={{ color: 'var(--ink-muted)' }}
    >
      {known ? (
        <>
          <span>launched by {provenance.actorId}</span>
          <span
            className="rounded px-1 py-px font-mono uppercase tracking-wider"
            style={{ fontSize: 'var(--text-2xs)', background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}
          >
            {provenance.actorKind}
          </span>
          <span>via {provenance.channel}</span>
        </>
      ) : (
        <span style={{ color: 'var(--ink-dim)' }}>launched via API (actor unknown)</span>
      )}
      {backLink !== undefined && (
        <>
          <span aria-hidden style={{ color: 'var(--ink-dim)' }}>·</span>
          <LineageLink label="retry of" runId={backLink} testId="lineage-retry-of" onSelectRun={onSelectRun} />
        </>
      )}
      {(retriedAs ?? []).map((id) => (
        <span key={id} className="flex items-center gap-x-1.5">
          <span aria-hidden style={{ color: 'var(--ink-dim)' }}>·</span>
          <LineageLink label="retried as" runId={id} testId="lineage-retried-as" onSelectRun={onSelectRun} />
        </span>
      ))}
    </div>
  );
}
