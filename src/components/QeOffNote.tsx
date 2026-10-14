import { QE_FORCE_DISCLOSURE, QE_FORCE_LABEL, QE_OFF_FORCED_NOTE, QE_OFF_NOTE } from '../board/assuranceModel.js';

/**
 * The composer's line when QE acceptance is OFF on this computer (`GET /health.capabilities.qeAcceptance`,
 * Settings › System): no skip to tick and no reason to type, because studio's service skips it for
 * every job that would need it and labels the job, its gates and its delivery. Forcing it for this
 * one job stays possible.
 */
export function QeOffNote({ force, onForce, testId = 'launch-qe-off' }: {
  force: boolean;
  onForce: (on: boolean) => void;
  testId?: string;
}): React.ReactElement {
  return (
    <div data-testid={testId} className="wk-assurance-optin">
      <p data-testid={`${testId}-note`} className="wk-field-note">{force ? QE_OFF_FORCED_NOTE : QE_OFF_NOTE}</p>
      <label className="wk-assurance-optin-label">
        <input type="checkbox" data-testid={`${testId}-force`} checked={force} onChange={(e) => onForce(e.target.checked)} />
        {' '}{QE_FORCE_LABEL}
      </label>
      <p className="wk-assurance-optin-why">{QE_FORCE_DISCLOSURE}</p>
    </div>
  );
}
