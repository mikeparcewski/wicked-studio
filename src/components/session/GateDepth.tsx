import { useMemo } from 'react';
import type { SessionView, WorkUnit } from '../../api/types.js';
import type { OpenGate } from '../../store/gates.js';
import { useGateTrust, type GateTrust } from '../../hooks/useGateTrust.js';
import { useProjectsStore } from '../../store/projects.js';
import { recordLabel, ruleOffer, runBandOf, seatRecord, type RuleOffer } from '../gateTrustModel.js';
import { creatorUnitBefore } from '../gateMoveModel.js';
import { reviewedUnitFor } from '../gateVerdictModel.js';
import { GateUnderReview } from '../GateUnderReview.js';
import { VerdictDiff } from '../VerdictDiff.js';

/**
 * S16a-1b: the gate card's depth in the session thread (ported from the run page's SteeringGate,
 * which other hosts still keep) — the creator seat's track record, the "make it a rule" offer, the
 * work under review and "Why it failed". Reads only: every gate answer still goes through
 * `commitGateDecision` / `commitGateReassign`; the rule offer's one write is POST /standing-orders
 * (`useGateTrust.makeRule`) and sends no gate decision.
 */

const EMPTY_UNITS: readonly WorkUnit[] = [];

export interface SeatTrust {
  /** "claude: 8/10 approvals held · 2 sent back" — neutral text, never a tone; null when unknown. */
  record: string | null;
  /** The standing-order offer after three alike approvals, or null. */
  offer: RuleOffer | null;
  trust: GateTrust;
}

/** The creator seat's record and the rule offer for one open gate on one run. */
export function useSeatTrust(view: SessionView, gate: OpenGate | undefined, facts: {
  isPlanGate: boolean; isDeliverGate: boolean; isEscalation: boolean;
}): SeatTrust {
  const runId = view.session.id;
  const ord = gate?.ord;
  const projectId = typeof view.session.project_id === 'string' && view.session.project_id !== 'default' ? view.session.project_id : null;
  const trust = useGateTrust(runId, ord, gate !== undefined && !facts.isPlanGate);
  const projectName = useProjectsStore((s) => (projectId === null ? null : s.projects.find((p) => p.id === projectId)?.name ?? null));
  const units = view.units ?? EMPTY_UNITS;
  const creator = useMemo(
    () => (facts.isPlanGate || typeof ord !== 'number' ? null : creatorUnitBefore(units, ord)),
    [facts.isPlanGate, ord, units],
  );
  const record = useMemo(() => {
    if (trust.gates === null || creator === null || typeof creator.assigned_cli !== 'string' || creator.assigned_cli === '') return null;
    const r = seatRecord(trust.gates, creator.assigned_cli, creator.phase_ref ?? null);
    return r === null ? null : recordLabel(r);
  }, [trust.gates, creator]);
  const band = runBandOf(view.session);
  const gateKind = gate?.gateKind ?? null;
  const landsDoctrine = view.session.workflow_id === 'steering-author';
  const offer = useMemo(() => {
    if (gate === undefined || trust.gates === null || trust.orders === null || trust.me === undefined) return null;
    return ruleOffer(trust.gates, trust.orders, {
      projectId, projectName, band, gateKind,
      isPlanGate: facts.isPlanGate, isDeliverGate: facts.isDeliverGate, isEscalation: facts.isEscalation, landsDoctrine,
    }, Date.now(), trust.me);
  }, [gate, trust.gates, trust.orders, trust.me, projectId, projectName, band, gateKind, facts.isPlanGate, facts.isDeliverGate, facts.isEscalation, landsDoctrine]);
  return { record, offer, trust };
}

/** The rule offer: why, the question, the 14-day preview — all above the one button that makes it. */
export function RuleOfferBlock({ seat, locked }: { seat: SeatTrust; locked: boolean }): React.ReactElement | null {
  const { offer, trust } = seat;
  if (trust.made !== null) {
    return (
      <p data-testid="session-gate-rule-made" className="wk-session-gate-detail-item">
        Standing order made: {trust.made.text}. It answers this gate and the next alike ones.
      </p>
    );
  }
  if (offer === null) return null;
  return (
    <div data-testid="session-gate-rule-offer" className="wk-session-gate-rule">
      <p className="wk-session-gate-detail-item">{offer.because}</p>
      <p data-testid="session-gate-rule-question" className="wk-session-gate-question">{offer.question}</p>
      <p
        data-testid="session-gate-rule-preview"
        data-would-approve={offer.preview.wouldApprove}
        data-you-approved={offer.preview.youApproved}
        data-you-sent-back={offer.preview.youSentBack}
        className="wk-session-gate-detail-item"
      >
        {offer.previewText}
      </p>
      <button type="button" data-testid="session-gate-rule-make" onClick={() => void trust.makeRule(offer)} disabled={locked || trust.busy} className="wk-session-gate-send">
        Make it a rule
      </button>
      {trust.error !== null && <p data-testid="session-gate-rule-error" role="alert" className="wk-session-gate-error">{trust.error}</p>}
    </div>
  );
}

/** ⋯ Details depth: the work under review, "Why it failed" (VerdictDiff), the gate's source line. */
export function GateDepthDetails({ view, gate, failing, reviewedOrd, source, underReview }: {
  view: SessionView;
  /** Lead with the finished phase this gate asks about (a review gate; not an escalation). */
  underReview: boolean;
  gate: OpenGate;
  failing: readonly string[];
  reviewedOrd: number | null;
  source: string | null;
}): React.ReactElement {
  const runId = view.session.id;
  const units = view.units ?? EMPTY_UNITS;
  const reviewed = useMemo(() => (underReview ? reviewedUnitFor(units, gate.ord, null) : null), [underReview, units, gate.ord]);
  const next = useMemo(() => (typeof gate.ord === 'number' ? units.find((u) => u.ord === gate.ord) ?? null : null), [units, gate.ord]);
  return (
    <>
      {reviewed !== null && (
        <div data-testid="session-gate-under-review">
          <GateUnderReview runId={runId} units={units} reviewed={reviewed} next={next} />
        </div>
      )}
      {failing.length > 0 && <VerdictDiff runId={runId} units={units} reviewedOrd={reviewedOrd} items={failing} />}
      {source !== null && <p data-testid="session-gate-source" className="wk-session-gate-detail-item">{source}</p>}
    </>
  );
}
