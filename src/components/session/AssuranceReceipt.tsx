import type { SessionView } from '../../api/types.js';
import { QE_FORCE_DISCLOSURE, QE_FORCE_LABEL, QE_SKIP_DISCLOSURE, QE_SKIP_LABEL, REDUCED_ASSURANCE_LABEL, REDUCED_OPT_IN_DISCLOSURE, REDUCED_OPT_IN_LABEL, isReduced, qeWords, sessionQe, unverifiedDeliveryLine, type DeliveryAssuranceView, type QeDecision, receiptWords, sessionAssurance, type AssuranceReceipt as Receipt } from '../../board/assuranceModel.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { useDisplayText } from '../../hooks/useHomePath.js';

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
      {receipt.qe !== undefined && <p className="wk-assurance-line"><QeAcceptanceLabel qe={receipt.qe} testId="assurance-qe" /></p>}
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

/** The session's label: a run launched with reduced assurance says so in its header, and a run
 *  that requires QE acceptance says where its decision stands (required / waived / skipped). */
export function RunAssuranceLabel({ view }: { view: SessionView }): React.ReactElement | null {
  const { events } = useRunEvents(view.session.id);
  const reduced = isReduced(sessionAssurance(view, events));
  const qe = sessionQe(view, events);
  if (!reduced && qe === null) return null;
  return (
    <>
      {reduced && <ReducedAssuranceLabel testId="session-run-reduced" />}
      {qe !== null && <QeAcceptanceLabel qe={qe} testId="session-run-qe" />}
    </>
  );
}

/** The one rendering of a QE acceptance decision (session header, plan, gate, delivery). */
export function QeAcceptanceLabel({ qe, testId = 'qe-acceptance' }: { qe: QeDecision; testId?: string }): React.ReactElement {
  const showText = useDisplayText();
  const w = qeWords(qe);
  return (
    <span data-testid={testId} data-status={w.status} className={`wk-assurance-qe wk-assurance-qe--${w.status}`} title={showText(w.detail)}>
      {showText(w.text)}
    </span>
  );
}

/**
 * The operator's explicit word on QE acceptance at launch (QE-IN-APP-WORKFLOWS): "Skip QE
 * acceptance" needs a reason before it can be sent; "Force QE acceptance" requires it whatever the
 * run's score says. One or the other, never both; nothing is ticked by studio.
 */
export function QeAcceptanceOptions({ skip, reason, force, onSkip, onReason, onForce, testId = 'launch-qe' }: {
  skip: boolean;
  reason: string;
  force: boolean;
  onSkip: (on: boolean) => void;
  onReason: (text: string) => void;
  onForce: (on: boolean) => void;
  testId?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} className="wk-assurance-optin">
      <label className="wk-assurance-optin-label">
        <input type="checkbox" data-testid={`${testId}-skip`} checked={skip} onChange={(e) => { onSkip(e.target.checked); if (e.target.checked) onForce(false); }} />
        {' '}{QE_SKIP_LABEL}
      </label>
      <p data-testid={`${testId}-skip-disclosure`} className="wk-assurance-optin-why">{QE_SKIP_DISCLOSURE}</p>
      {skip && (
        <input
          type="text"
          data-testid={`${testId}-skip-reason`}
          aria-label="Why skip QE acceptance"
          placeholder="Why skip QE acceptance (required)"
          className="wk-input"
          value={reason}
          maxLength={2000}
          onChange={(e) => onReason(e.target.value)}
        />
      )}
      <label className="wk-assurance-optin-label">
        <input type="checkbox" data-testid={`${testId}-force`} checked={force} onChange={(e) => { onForce(e.target.checked); if (e.target.checked) onSkip(false); }} />
        {' '}{QE_FORCE_LABEL}
      </label>
      <p data-testid={`${testId}-force-disclosure`} className="wk-assurance-optin-why">{QE_FORCE_DISCLOSURE}</p>
    </div>
  );
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

/**
 * EX-03 / EX-04: crew's record of the delivery, under its receipt — an unverified (post-hoc)
 * hand-over says so with whether the tree moved, and the QE acceptance check is said either way.
 */
export function DeliveryAssuranceLines({ recorded, testIdPrefix }: { recorded: DeliveryAssuranceView | null; testIdPrefix: string }): React.ReactElement | null {
  const showText = useDisplayText();
  if (recorded === null) return null;
  const unverified = unverifiedDeliveryLine(recorded);
  const qe = recorded.qeAcceptance;
  return (
    <>
      {unverified !== null && <p data-testid={`${testIdPrefix}-unverified`} className="wk-assurance wk-assurance-kind--floor-only">{unverified}</p>}
      {qe !== null && (
        <p data-testid={`${testIdPrefix}-qe`} data-status={qe.status ?? 'required'} data-satisfied={qe.satisfied ? 'true' : 'false'} className={qe.satisfied ? 'wk-assurance' : 'wk-assurance wk-assurance-kind--unchecked'}>
          {qe.status === 'waived' || qe.status === 'skipped'
            ? showText(qe.status === 'waived' ? `QE acceptance: waived (${qe.reason.replace(/^waived:\s*/, '')})` : `QE acceptance: skipped by operator (${qe.reason.replace(/^QE acceptance skipped by operator:\s*/, '')})`)
            : qe.satisfied
              ? `QE acceptance: PASS${qe.reviewer !== null ? ` by ${qe.reviewer}` : ''}${qe.verdictId !== null ? ` (${qe.verdictId})` : ''}`
              : `QE acceptance not met: ${showText(qe.reason)}`}
        </p>
      )}
    </>
  );
}
