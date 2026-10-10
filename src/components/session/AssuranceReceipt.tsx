import type { SessionView } from '../../api/types.js';
import { REDUCED_ASSURANCE_LABEL, REDUCED_OPT_IN_DISCLOSURE, REDUCED_OPT_IN_LABEL, isReduced, receiptWords, sessionAssurance, type AssuranceReceipt as Receipt } from '../../board/assuranceModel.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';

/**
 * The assurance receipt, compact (wicked-core#850): one lead line — how the decision was assured
 * (passed: "Independently accepted" / "Floor-only approval" / …; otherwise "Checked independently" /
 * "Floor checks only" / …) and the Reduced assurance label on a reduced run — then what was
 * required and what ran, who built and checked it (and whether they were separate seats), what was
 * skipped and why, and the tree and attempt. The engine's detail for each skip rides the hover.
 */
export function AssuranceReceipt({ receipt, passed = null, testId = 'assurance-receipt' }: {
  receipt: Receipt;
  /** The decision passed (an approval, a delivery), did not, or is not known. */
  passed?: boolean | null;
  testId?: string;
}): React.ReactElement {
  const w = receiptWords(receipt, passed);
  return (
    <div data-testid={testId} data-kind={w.kind} data-mode={receipt.mode} className="wk-assurance" role="group" aria-label="Assurance receipt">
      <p className="wk-assurance-lead">
        <span data-testid="assurance-kind" className={`wk-assurance-kind wk-assurance-kind--${w.kind}`}>{w.label}</span>
        {w.reduced && <ReducedAssuranceLabel />}
        <span className="wk-assurance-dim"> · {w.required} · {w.ran}</span>
      </p>
      {w.who !== null && <p data-testid="assurance-who" className="wk-assurance-line">{w.who}</p>}
      {(w.skipped !== null || w.where !== null) && (
        <p className="wk-assurance-line">
          {w.skipped !== null && (
            <span data-testid="assurance-skipped" {...(w.skippedDetail.length > 0 ? { title: w.skippedDetail.join('\n') } : {})}>{w.skipped}</span>
          )}
          {w.skipped !== null && w.where !== null && ' · '}
          {w.where !== null && <span data-testid="assurance-where">{w.where}</span>}
        </p>
      )}
    </div>
  );
}

/** The one spelling of the reduced-assurance label (session header, gate, delivery). */
export function ReducedAssuranceLabel({ testId = 'assurance-reduced' }: { testId?: string }): React.ReactElement {
  return (
    <span
      data-testid={testId}
      className="wk-assurance-reduced"
      title="Launched with reduced assurance: the creator's seat may evaluate its own work and a missing judge does not hold a gate. Every receipt says so."
    >
      {REDUCED_ASSURANCE_LABEL}
    </span>
  );
}

/** The session's label: a run launched with reduced assurance says so in its header. */
export function RunAssuranceLabel({ view }: { view: SessionView }): React.ReactElement | null {
  const { events } = useRunEvents(view.session.id);
  return isReduced(sessionAssurance(view, events)) ? <ReducedAssuranceLabel testId="session-run-reduced" /> : null;
}

/**
 * EX-01's explicit opt-in on a one-seat launch (the launch form, the composer's `/workflow` row):
 * a checkbox that says what it means before it is ticked. Never ticked by studio on its own — only
 * the dead-seat gate's "Run with reduced assurance" opens the form with it ticked, and the operator
 * still launches.
 */
export function ReducedAssuranceOptIn({ checked, onChange, testId = 'launch-reduced-assurance' }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  testId?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} data-checked={checked ? 'true' : 'false'} className="wk-assurance-optin">
      <label className="wk-assurance-optin-label">
        <input type="checkbox" data-testid={`${testId}-toggle`} checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {' '}{REDUCED_OPT_IN_LABEL}
      </label>
      <p data-testid={`${testId}-disclosure`} className="wk-assurance-optin-why">{REDUCED_OPT_IN_DISCLOSURE}</p>
    </div>
  );
}
