import { actorWords } from '../../board/actorWords.js';
import type { SessionView } from '../../api/types.js';
import { councilRulingOf, rulesSummary, type RuleRow } from '../../board/assuranceModel.js';
import type { RulePosition } from '../../api/types.js';
import { QE_FORCE_DISCLOSURE, QE_FORCE_LABEL, QE_SKIP_DISCLOSURE, QE_SKIP_LABEL, REDUCED_ASSURANCE_LABEL, REDUCED_OPT_IN_DISCLOSURE, REDUCED_OPT_IN_LABEL, isReduced, qeSkippedText, qeWords, sessionQe, unverifiedDeliveryLine, type DeliveryAssuranceView, type QeDecision, receiptWords, sessionAssurance, type AssuranceReceipt as Receipt } from '../../board/assuranceModel.js';
import { useRunEvents } from '../../hooks/useRunEvents.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { TechDetails } from '../ui/index.js';
import { FLOOR_OVERRIDDEN_LABEL, overrideWhere } from '../../board/floorOverride.js';
import { stepWord } from '../../board/runConversation.js';

/** "you" opens a sentence as "You"; a person's own id is said as recorded. */
const capitalize = (s: string): string => (s === 'you' ? 'You' : s);

/**
 * The assurance receipt, compact (wicked-core#850): one lead line — how the decision was assured
 * (passed: "Independently accepted" / "Floor-only approval" / …; otherwise "Checked independently" /
 * "Floor checks only" / …) and the Reduced assurance label on a reduced run — then what was
 * required and what ran, who built and checked it (and whether they were separate seats), what was
 * skipped and why, and the tree and attempt. The engine's detail for each skip rides the hover.
 */
export function AssuranceReceipt({ receipt, passed = null, testId = 'assurance-receipt', tech = 'own', units = null, showRules = true }: {
  receipt: Receipt;
  /** The run's units, so an override says which step it was at ("the Fix step's checks"); null = "step 2". */
  units?: SessionView['units'] | null;
  /** The decision passed (an approval, a delivery), did not, or is not known. */
  passed?: boolean | null;
  testId?: string;
  /** `host`: the card it sits in has ONE Technical details and shows {@link AssuranceReceiptTech} there (a gate
   *  row), so the receipt draws no disclosure of its own. */
  tech?: 'own' | 'host';
  /** (DES-RULE-CHECK-001) `false` where the host shows the rule line itself (the gate card, under its question). */
  showRules?: boolean;
}): React.ReactElement {
  const w = receiptWords(receipt, passed);
  const judged = (receipt.operatorJudges ?? []).filter((j) => j.floorOverride === undefined);
  const overrides = (receipt.operatorJudges ?? []).filter((j) => j.floorOverride !== undefined);
  // Never an actor id ("local (human)"): the local operator is "you" (operator 2026-10-29).
  const judgedBy = [...new Set(judged.map((j) => actorWords(j.by)))];
  const judgedGates = judged.length;
  const overriddenBy = [...new Set(overrides.map((j) => actorWords(j.by)))];
  const stepOf = (ord: number): string | null => {
    const u = (units ?? []).find((x) => x.ord === ord);
    if (u === undefined) return null;
    const key = u.id.includes(':') ? u.id.slice(u.id.indexOf(':') + 1) : String(u.stage ?? '');
    return key === '' ? null : stepWord(key);
  };
  const lead = w.kind === 'floor-only' ? 'Only automatic checks ran'
    : w.kind === 'same-seat' ? 'The helper checked its own work'
      : w.kind === 'unchecked' ? 'Nothing was verified'
        : w.kind === 'partial' ? 'Some checks ran independently' : w.label;
  return (
    <div data-testid={testId} data-kind={w.kind} data-mode={receipt.mode} className="wk-assurance" role="group" aria-label="Assurance receipt">
      <p className="wk-assurance-lead">
        <span className={`wk-assurance-kind wk-assurance-kind--${w.kind}`}>{lead}</span>
        {w.reduced && <ReducedAssuranceLabel />}
        {judgedBy.length > 0 && <OperatorJudgedLabel />}
        {overriddenBy.length > 0 && <FloorOverriddenLabel />}
      </p>
      {overriddenBy.length > 0 && (
        <p data-testid="assurance-floor-overridden-line" className="wk-assurance-line">
          {overrides.length === 1 ? 'At one gate' : `At ${overrides.length} gates`} the repository checks failed and {overriddenBy.join(', ')} overrode them
          {overrides.length === 1 && overrides[0]!.note !== null ? <>: <q>{overrides[0]!.note}</q></> : null}. Every other check still applied, and QE acceptance is still required.
        </p>
      )}
      {overrides.length > 1 && (
        <ul data-testid="assurance-floor-overrides" className="wk-assurance-list">
          {overrides.map((o, i) => (
            <li key={`${o.floorOverride?.resultId ?? ''}-${i}`} data-testid="assurance-floor-override">
              {capitalize(actorWords(o.by))}{o.floorOverride !== undefined ? `, at ${overrideWhere(o.floorOverride, stepOf)}` : ''}
              {o.note !== null ? <>: <q>{o.note}</q></> : ' (no rationale recorded)'}
            </li>
          ))}
        </ul>
      )}
      {judgedBy.length > 0 && (
        <p data-testid="assurance-operator-judged-line" className="wk-assurance-line">
          {judgedGates === 1 ? 'At one gate' : `At ${judgedGates} gates`} the judge could not rule, so {judgedBy.join(', ')} judged the work as it stood; that approval ran no further check.
        </p>
      )}
      {showRules && receipt.rules !== undefined && receipt.rules.length > 0 && <RulesChecked rows={receipt.rules} />}
      {receipt.skipped.length > 0 && <p className="wk-assurance-line">{receipt.skipped.length} {receipt.skipped.length === 1 ? "check didn't" : "checks didn't"} run on this step.</p>}
      {receipt.qe !== undefined && <p className="wk-assurance-line"><QeAcceptanceLabel qe={receipt.qe} testId="assurance-qe" /></p>}
      {tech === 'own' && (
        <details className="wk-tech-details">
          <summary className="wk-tech-details-summary">Technical details</summary>
          <AssuranceReceiptTech receipt={receipt} passed={passed} />
        </details>
      )}
    </div>
  );
}

/** The receipt's technical lines — what was required and ran, who built and checked it, what was skipped, the tree
 *  and attempt — for the one Technical details of the card the receipt sits in. */
export function AssuranceReceiptTech({ receipt, passed = null, testId }: { receipt: Receipt; passed?: boolean | null; testId?: string }): React.ReactElement {
  const w = receiptWords(receipt, passed);
  const showText = useDisplayText();
  return (
    <div className="wk-session-verdict-details" data-tech="on" {...(testId !== undefined ? { 'data-testid': testId } : {})}>
      <p><span data-testid="assurance-kind">{w.label}</span> · {showText(w.required)} · {showText(w.ran)}</p>
      {w.who !== null && <p data-testid="assurance-who" className="wk-assurance-line">{showText(w.who)}</p>}
      {(w.skipped !== null || w.where !== null) && (
        <p className="wk-assurance-line">
          {w.skipped !== null && (
            <span data-testid="assurance-skipped">{showText(w.skipped)}</span>
          )}
          {w.skipped !== null && w.where !== null && ' · '}
          {w.where !== null && <span data-testid="assurance-where">{showText(w.where)}</span>}
        </p>
      )}
      {w.skippedDetail.length > 0 && <TechDetails summary="Why these checks did not run" text={w.skippedDetail} />}
    </div>
  );
}

const RULE_WORD: Record<string, string> = { kept: 'kept', broken: 'broken', n_a: 'not applicable', unchecked: 'unchecked', skipped: 'skipped', waived: 'waived by your instruction', deferred: 'deferred to delivery', disputed: 'disputed: you decide' };
const HOW_WORD: Record<string, string> = { fact: 'by fact', judge: 'by a judge', machine: 'by the engine', cache: 'unchanged since last check', operator: 'by the operator', council: 'by council', none: 'nobody could rule' };
/** Who each side of a dispute is (`RulePosition.by`). */
const BY_WORD: Record<string, string> = { rule_judge: 'Rule judge', reviewer: 'Reviewer' };
/** A process rule's party (`RuleRow.party`): whose conduct it is about. */
const PARTY_WORD: Record<string, string> = { reviewer: "about the reviewer's conduct", engine: 'about the engine', person: 'about your intent' };
/** The engine's no-ruling codes (`RuleCouncilRecord.reason`) lead its detail; the detail says it in words. */
const NO_RULING_CODE = /\b(?:no_quorum|timeout|seats_benched|cap|error|incomplete_evidence|identity_unknown):\s*/g;

/** How a row's verdict was reached, in words. A council's ruling names the council's own seats and its vote; the
 *  row's `judge` is the RULE JUDGE's seat (the engine keeps it on a council row), so it is never shown as the
 *  council's. A disputed row says nothing here: its reason says why no ruling stands. */
function howWords(r: RuleRow): string {
  const ruled = councilRulingOf(r);
  if (ruled !== null) {
    const who = [ruled.seats.join(', '), ...(ruled.uncounted.length > 0 ? [`${ruled.uncounted.join(', ')} not counted`] : [])].filter((x) => x !== '').join('; ');
    const seats = who !== '' ? ` (${who})` : '';
    const lead = ruled.ruling === 'waived' ? `the council kept it only on your instruction, ${ruled.tally}${seats}: confirm or skip it` : `settled by council ${ruled.tally}${seats}`;
    return `${lead}${r.how === 'cache' ? ', unchanged since last check' : ''}`;
  }
  if (r.status === 'disputed') return '';
  // A council row with no ruling it carries is never "by a judge (<the rule judge>)".
  if (r.how === 'council' || r.origin === 'council') return HOW_WORD['council']!;
  // A skip is the operator's, never a seat's.
  return `${HOW_WORD[r.how] ?? r.how}${r.judge !== null && r.how !== 'operator' ? ` (${r.judge})` : ''}`;
}

/** One side's reading: "Rule judge (claude): broken, “…”". */
function positionWords(p: RulePosition): string {
  return `${BY_WORD[p.by] ?? p.by} (${p.seat !== '' ? p.seat : 'unknown seat'}): ${RULE_WORD[p.status] ?? p.status}`;
}

/** One rule's row: its verdict, how it was reached and why; a dispute's two readings and a council's votes under it. */
function RuleItem({ r }: { r: RuleRow }): React.ReactElement {
  const showText = useDisplayText();
  const ruled = councilRulingOf(r);
  // Why: a council ruling's winning rationale (its reason repeats the tally); else the engine's reason (the fact,
  // the cite in words, the skip's reason, why no council ruled), else the bare cite.
  const why0 = ruled !== null && r.cite !== null ? r.cite : r.reason !== '' ? r.reason : r.cite ?? '';
  // Only the engine's own no-ruling sentence carries its codes; a cite or a person's reason is shown as written.
  const why = r.status === 'disputed' ? why0.replace(NO_RULING_CODE, '') : why0;
  const how = howWords(r);
  const c = r.council;
  // The reviewer's own reading, when it differs from the row and no council record already says it.
  const reviewerApart = c === null && r.reviewer !== null && r.reviewer.status !== r.status ? r.reviewer : null;
  return (
    <li data-testid="assurance-rule" data-status={r.status} data-origin={r.origin ?? undefined} className="wk-assurance-rule">
      <span className={`wk-assurance-rule-status wk-assurance-rule-status--${r.status}`}>{RULE_WORD[r.status] ?? r.status}</span>
      {' '}<code className="wk-assurance-rule-id">{r.ruleId}</code>
      {how !== '' && <span data-testid="assurance-rule-how" className="wk-assurance-rule-how"> {how}</span>}
      {why !== '' && <span className="wk-assurance-rule-why">: {showText(why)}</span>}
      {!r.blocking && <span data-testid="assurance-rule-party" className="wk-assurance-rule-how"> · {PARTY_WORD[r.party ?? ''] ?? (r.party !== null ? `about ${r.party}` : 'a process rule')}; reported, does not block</span>}
      {c !== null && (
        <ul data-testid="assurance-rule-council" className="wk-assurance-rule-council">
          {c.positions.map((p, i) => (
            <li key={`p${i}`} data-testid="assurance-rule-position" data-by={p.by}>
              {positionWords(p)}{p.cite !== '' && <>, <q>{showText(p.cite)}</q></>}
            </li>
          ))}
          {c.votes.length > 0 && (
            <li data-testid="assurance-rule-votes">
              Council votes: {c.votes.map((v, i) => (
                <span key={`v${i}`} data-testid="assurance-rule-vote" data-counted={v.counted ? 'true' : 'false'}>
                  {i > 0 ? ' · ' : ''}{v.seat}: {v.status !== undefined ? RULE_WORD[v.status] ?? v.status : 'no vote'}
                  {!v.counted && (v.status !== undefined ? ` (not counted${v.whyNot !== undefined ? `: ${showText(v.whyNot)}` : ''})` : v.whyNot !== undefined ? ` (${showText(v.whyNot)})` : '')}
                </span>
              ))}
            </li>
          )}
        </ul>
      )}
      {reviewerApart !== null && (
        <span data-testid="assurance-rule-reviewer" className="wk-assurance-rule-why">. {positionWords(reviewerApart)}{reviewerApart.cite !== '' && <>, <q>{showText(reviewerApart.cite)}</q></>}</span>
      )}
    </li>
  );
}

/** (DES-RULE-CHECK-001) "N rules checked: K kept, B broken, X not applicable", expandable to every rule's
 *  row: its verdict, how it was reached, and why (the cite, the fact, or the operator's skip reason). A disputed rule
 *  says "disputed: you decide" with both readings, and a council's ruling its vote and seats; the list opens on its
 *  own while a dispute waits for you. Process rules (`blocking: false`) are listed apart, said not to block.
 *  `soFar`: a run still going says "So far, …" (its later gates may still rule). A reason's home paths
 *  are redacted unless technical details are on, as every other free text studio shows. */
export function RulesChecked({ rows, testId = 'assurance-rules', soFar = false }: { rows: readonly RuleRow[]; testId?: string; soFar?: boolean }): React.ReactElement {
  const s = rulesSummary(rows);
  const tone = s.broken > 0 ? 'broken' : s.unchecked + s.waived + s.disputed > 0 ? 'unchecked' : 'ok';
  const gate = rows.filter((r) => r.blocking);
  const process = rows.filter((r) => !r.blocking);
  return (
    <details data-testid={testId} data-tone={tone} className="wk-assurance-rules" open={s.disputed > 0 ? true : undefined}>
      <summary data-testid={`${testId}-line`} className="wk-assurance-line wk-assurance-rules-summary">{soFar ? `So far, ${s.line}` : s.line}</summary>
      <ul className="wk-assurance-list wk-assurance-rules-list">
        {gate.map((r) => <RuleItem key={r.ruleId} r={r} />)}
        {process.length > 0 && (
          <li data-testid={`${testId}-process`} className="wk-assurance-rules-process">
            <span className="wk-assurance-rules-process-head">Process rules: reported, they do not block this gate</span>
            <ul className="wk-assurance-list">
              {process.map((r) => <RuleItem key={r.ruleId} r={r} />)}
            </ul>
          </li>
        )}
      </ul>
    </details>
  );
}

/** The one spelling of the floor-override label (gate, delivery): the operator overrode a failed floor. */
export function FloorOverriddenLabel({ testId = 'assurance-floor-overridden' }: { testId?: string }): React.ReactElement {
  return (
    <span
      data-testid={testId}
      className="wk-assurance-reduced wk-assurance-operator"
      title="The repository checks failed at this gate and the operator overrode them with a written rationale. Every other check still applied; QE acceptance is still required."
    >
      {FLOOR_OVERRIDDEN_LABEL}
    </span>
  );
}

/** The one spelling of the operator-judged label (gate, delivery): the operator, not a helper, judged the work. */
export const OPERATOR_JUDGED_LABEL = 'Judged by operator';
export function OperatorJudgedLabel({ testId = 'assurance-operator-judged' }: { testId?: string }): React.ReactElement {
  return (
    <span
      data-testid={testId}
      className="wk-assurance-reduced wk-assurance-operator"
      title="Where the required judge could not rule, the operator judged the work as it stood; that approval ran no further check."
    >
      {OPERATOR_JUDGED_LABEL}
    </span>
  );
}

/** The one spelling of the reduced-assurance label (session header, gate, delivery). */
export function ReducedAssuranceLabel({ testId = 'assurance-reduced' }: { testId?: string }): React.ReactElement {
  return (
    <span
      data-testid={testId}
      className="wk-assurance-reduced"
      title="The helper may check its own work, and an unavailable check will not pause the run. Every receipt says so."
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
            ? showText(qe.status === 'waived' ? `QE acceptance: waived (${qe.reason.replace(/^waived:\s*/, '')})` : qeSkippedText(qe.reason))
            : qe.satisfied
              ? `QE acceptance: PASS${qe.reviewer !== null ? ` by ${qe.reviewer}` : ''}${qe.verdictId !== null ? ` (${qe.verdictId})` : ''}`
              : `QE acceptance not met: ${showText(qe.reason)}`}
        </p>
      )}
    </>
  );
}
