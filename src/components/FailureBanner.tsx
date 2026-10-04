import type { SessionView } from '../api/types.js';
import type { LoggedEvent } from '../store/runtime.js';
import { useProvenanceStore } from '../store/provenance.js';
import { denialAdvice, denialHeadline, parseDenial, type StructuredDenial } from './denialCopy.js';

interface Props {
  view: SessionView;
  log: LoggedEvent[];
  /** When provided, the banner carries the §7.4 failure-context "All runs ›"
   *  link (DES-UX-001 slice Y): it lands on /work with the Failed filter
   *  active — arriving FROM a failure keeps the failure lens. */
  navigate?: (path: string) => void;
}

/** The failure-context all-runs entry (§7.4): /work with the banner's own filter active — Failed for
 *  a halted run, Cancelled for a cancelled one (studio#478: a rejected plan ends cancelled, and the
 *  Failed list does not hold it). */
function AllRunsLink({ navigate, filter }: { navigate: (path: string) => void; filter: 'failed' | 'cancelled' }): React.ReactElement {
  const href = `/work?filter=${filter}`;
  return (
    <a
      href={href}
      data-testid="failure-all-runs"
      onClick={(e) => { e.preventDefault(); navigate(href); }}
      className="mt-2 inline-block transition-opacity hover:opacity-80"
      style={{ color: 'var(--accent)', textDecoration: 'none' }}
    >
      All runs ›
    </a>
  );
}

export function FailureBanner({ view, log, navigate }: Props): React.ReactElement | null {
  const { status } = view.session;
  // studio#478: the note the operator rejected with (crew's gate audit; the run page loads it once).
  const rejectNote = useProvenanceStore((s) => s.rejectNotes[view.session.id] ?? null);
  if (status !== 'failed' && status !== 'cancelled') return null;

  const lastError = [...log].reverse().find((e) => e.type === 'error');
  const denied = view.units.filter((u) => u.denial_reason || u.status === 'rejected');

  if (status === 'cancelled') {
    return (
      <div
        data-testid="failure-banner"
        data-kind="cancelled"
        className="rounded-lg p-3 text-xs font-mono"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--surface-raised)',
          color: 'var(--ink-muted)',
        }}
      >
        Run cancelled.
        {rejectNote !== null && (
          <p data-testid="failure-reject-note" className="mt-1" style={{ color: 'var(--ink-body)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            You rejected it: “{rejectNote}”
          </p>
        )}
        {navigate !== undefined && <div><AllRunsLink navigate={navigate} filter="cancelled" /></div>}
      </div>
    );
  }

  return (
    <div
      data-testid="failure-banner"
      data-kind="failed"
      className="rounded-lg p-3 text-xs font-mono"
      style={{
        background: 'var(--status-fail-dim)',
        border: '1px solid var(--status-fail-dim)',
        color: 'var(--status-fail)',
      }}
    >
      <p className="font-semibold">Run halted.</p>
      {lastError && <p className="mt-1" style={{ color: 'var(--ink-muted)' }}>{lastError.detail}</p>}
      {denied.length > 0 && (
        <div className="mt-1 flex flex-col gap-2">
          {denied.map((u) => {
            // 0.7.6+ engines attach a structured denial to the rejected unit; older engines
            // leave only the prose — parseDenial reads whichever this daemon serves.
            const facts = parseDenial(
              u.denial_reason,
              (u as unknown as { denial?: StructuredDenial }).denial ?? null,
            );
            return (
              <div key={u.id} data-testid="failure-plain">
                <p style={{ color: 'var(--ink)' }}>{denialHeadline(facts, u.ord)}</p>
                <p className="mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {denialAdvice(facts)}
                  {navigate !== undefined &&
                    facts.ruleIds.map((id) => (
                      <a
                        key={id}
                        href={`/steering/policies?rule=${id}`}
                        data-testid="failure-rule-link"
                        className="ml-2 transition-opacity hover:opacity-80"
                        style={{ color: 'var(--accent)', textDecoration: 'none' }}
                        onClick={(e) => { e.preventDefault(); navigate(`/steering/policies?rule=${id}`); }}
                      >
                        Review {id} ›
                      </a>
                    ))}
                </p>
                {facts.raw.length > 0 && (
                  <p className="mt-0.5 opacity-70" style={{ color: 'var(--ink-muted)' }} data-testid="failure-engine-detail">
                    engine detail: {facts.raw}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {navigate !== undefined && <AllRunsLink navigate={navigate} filter="failed" />}
    </div>
  );
}
