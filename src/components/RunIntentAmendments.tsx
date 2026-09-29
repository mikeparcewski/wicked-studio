import type { AgentSession } from '../api/types.js';
import { intentAmendmentsOf } from '../api/wave6-wire.js';

/**
 * "Intent amended: …" on the run head (wicked-core#555 studio half).
 *
 * An `amend_intent` at a gate changes the acceptance list EVERY LATER PHASE is judged against —
 * the evaluator above all. That is the most consequential thing a human can say to a live run, and
 * without this line the run page still showed only the launch intent: an operator reading a later
 * verdict had no way to see that an item had been withdrawn, and the run record's own FAIL named a
 * requirement a human had already dropped.
 *
 * A pure view over the run record (`AgentSession.intent_amendments`, engine-recorded, durable
 * past a reload — not an event fold, so it survives a page that missed the frame). Nothing at all
 * on an unamended run, and on a daemon or engine before the field.
 */
export function RunIntentAmendments({ session }: { session: AgentSession }): React.ReactElement | null {
  const amendments = intentAmendmentsOf(session);
  if (amendments.length === 0) return null;
  return (
    <div
      data-testid="run-intent-amendments"
      data-count={amendments.length}
      className="px-6 py-1.5 text-[11px] font-mono shrink-0 flex flex-col gap-0.5"
      style={{
        color: 'var(--status-gate)',
        background: 'var(--status-gate-dim)',
        borderBottom: '1px solid var(--surface-raised)',
        overflowWrap: 'anywhere',
      }}
      title="A human approved a gate and amended this run's acceptance list. Every phase from that gate on — the evaluator included — is judged against the amendment, not the withdrawn launch item."
    >
      {amendments.map((a, i) => (
        <p key={`${a.at}-${i}`} data-testid="run-intent-amendment">
          <span style={{ fontWeight: 600 }}>Intent amended</span>
          {a.ord > 0 && <span style={{ color: 'var(--ink-muted)' }}> at unit #{a.ord}</span>}
          {a.at > 0 && (
            <span style={{ color: 'var(--ink-muted)' }}> · {new Date(a.at).toLocaleString()}</span>
          )}
          <span style={{ color: 'var(--ink-muted)' }}>: </span>
          {a.text}
        </p>
      ))}
    </div>
  );
}
