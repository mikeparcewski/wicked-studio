import { useEffect, useMemo, useRef, useState } from 'react';
import { unitConsideredKey } from '../../api/considered.js';
import { decisionsApi, isDecisionsUnsupported, type DecisionView } from '../../api/decisions.js';
import type { SteeringRule } from '../../api/steering.js';
import type { SessionView } from '../../api/types.js';
import { unitStepName } from '../../board/chainModel.js';
import { ruleHistory, ruleOrigin, whereConsidered, WHERE_VERDICT_WORDS, type OriginWhere } from '../../board/ruleOrigin.js';
import { considerationsNaming, useConsideredStore } from '../../store/considered.js';
import { openSheet } from '../../store/sheets.js';
import { humanTitle } from '../runIdentity.js';
import { Tech } from '../Tech.js';

/**
 * ORIGIN, history and "Where it was considered" on the rule page (DES-DECISION-CAPTURE §3 B11,
 * slice DC-S8). ORIGIN is read ONLY from crew's decision ledger (`GET /decisions`): the decision
 * whose landed rule is this one — its verbatim words, who said them, when, and where (G4). A rule
 * no decision landed has no ORIGIN here (its provenance row says where it came from), and a daemon
 * without the ledger draws nothing. "Where it was considered" is what studio has read: the turns
 * and steps whose Consideration names the rule, plus a bounded look into the project's recent
 * steps when the page opens — the daemon keeps no index of this, and the block says what it looked in.
 *
 * No "Hold work to it" here (DC rev 2 B2/N7): a decision rule is advisory until DES-rule-check.
 */

const PROBE_CAP = 12;
/** Steps worth a look: anything dispatched (a live step was given its rules at dispatch, like the step sheet shows). Never `pending`. */
const PROBED = new Set(['done', 'completed', 'failed', 'denied', 'rejected', 'accepted', 'distributed', 'executing', 'running']);

type Read = { kind: 'loading' } | { kind: 'ok'; decisions: DecisionView[] } | { kind: 'unsupported' } | { kind: 'failed'; message: string };

function fmtWhen(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
}

const HOW_WORDS = { auto: 'remembered on the spot', chip: 'remembered when you clicked Remember', 'needs-you': 'remembered from Needs You' } as const;

function whereWords(w: OriginWhere): string {
  switch (w.kind) {
    case 'chat': return 'in a conversation';
    case 'run': return w.ord !== null ? `in a run, step ${w.ord + 1}` : 'in a run';
    case 'gate': return 'at a run’s gate';
    case 'elicitation': return 'answering a run’s question';
    default: return '';
  }
}

function whereIds(w: OriginWhere): string[] {
  switch (w.kind) {
    case 'chat': return [`chat ${w.chatId}`, ...(w.turnId !== null ? [`turn ${w.turnId}`] : [])];
    case 'run': return [`run ${w.runId}`, ...(w.ord !== null ? [`ord ${w.ord}`] : [])];
    case 'gate': return [...(w.runId !== null ? [`run ${w.runId}`] : []), `gate ${w.gateId}`];
    case 'elicitation': return [...(w.runId !== null ? [`run ${w.runId}`] : []), `elicitation ${w.elicitationId}`];
    default: return [];
  }
}

/** The project's runs, newest first — the rule's project, or every run for a rule that applies everywhere. */
function runsFor(project: string | undefined, runs: readonly SessionView[]): SessionView[] {
  const mine = project !== undefined && project !== '' ? runs.filter((v) => v.session.project_id === project) : [...runs];
  const at = (v: SessionView): number => { const c = (v.session as unknown as { created_at?: unknown }).created_at; return typeof c === 'number' ? c : 0; };
  return mine.sort((a, b) => at(b) - at(a));
}

export function RuleOrigin({ rule, runs, navigate }: {
  rule: SteeringRule;
  runs: readonly SessionView[];
  navigate: (path: string) => void;
}): React.ReactElement | null {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setRead({ kind: 'loading' });
    const project = rule.targets.project;
    decisionsApi.list(project !== undefined && project !== '' ? { project } : {})
      .then((r) => { if (!cancelled) setRead({ kind: 'ok', decisions: r.decisions }); })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRead(isDecisionsUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [rule.id, rule.targets.project]);

  // A bounded look into the project's recent steps, through the same store the thread's lines use:
  // ONCE per rule opened (the runs list refreshes every few seconds and must not re-probe), one
  // read at a time, stopping the moment the daemon turns out to have no such route, and skipping
  // steps already read. Units carry no attempt on this wire, so a step is read at attempt 0 — the
  // step sheet reads the same key; crew computes the Consideration from the step's persisted
  // output at read time, the attempt only labels the key.
  const [probed, setProbed] = useState(0);
  const project = rule.targets.project;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  useEffect(() => {
    let cancelled = false;
    const picked: Array<{ runId: string; ord: number }> = [];
    outer: for (const v of runsFor(project, runsRef.current)) {
      for (const u of [...v.units].sort((a, b) => a.ord - b.ord)) {
        if (!PROBED.has(u.status)) continue;
        picked.push({ runId: v.session.id, ord: u.ord });
        if (picked.length >= PROBE_CAP) break outer;
      }
    }
    setProbed(0);
    void (async () => {
      let n = 0;
      for (const { runId, ord } of picked) {
        const store = useConsideredStore.getState();
        if (cancelled || store.unsupported) break;
        if (unitConsideredKey(runId, ord) in store.byKey) { n += 1; setProbed(n); continue; }
        await store.loadUnit(runId, ord);
        if (cancelled) break;
        n += 1;
        setProbed(n);
      }
    })();
    return () => { cancelled = true; };
  }, [rule.id, project]);

  const byKey = useConsideredStore((s) => s.byKey);
  const unsupported = useConsideredStore((s) => s.unsupported);
  const where = useMemo(() => whereConsidered(rule.id, considerationsNaming(byKey, rule.id), {
    runTitle: (id) => { const v = runs.find((x) => x.session.id === id); return v === undefined ? null : humanTitle(v.session.problem || id); },
    stepName: (id, ord) => { const u = runs.find((x) => x.session.id === id)?.units.find((x) => x.ord === ord); return u === undefined ? null : unitStepName(u); },
  }), [byKey, rule.id, runs]);

  const origin = read.kind === 'ok' ? ruleOrigin(rule, read.decisions) : null;
  const history = read.kind === 'ok' ? ruleHistory(rule, read.decisions) : [];
  const go = (href: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(href); };

  return (
    <div data-testid="rule-origin-block" data-read={read.kind} className="flex flex-col gap-3">
      {read.kind === 'failed' && (
        <p data-testid="rule-origin-error" role="alert" className="text-[11px]" style={{ color: 'var(--status-fail)' }}>
          Could not read where this rule came from ({read.message}).
        </p>
      )}
      {origin !== null && (
        <section data-testid="rule-origin" data-decision-id={origin.decisionId} data-how={origin.how ?? ''} className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>Origin — your words</h3>
          {origin.words !== '' && (
            <blockquote data-testid="rule-origin-words" className="m-0 text-[12px]" style={{ color: 'var(--ink-high)', borderLeft: '2px solid var(--border-strong)', paddingLeft: 8 }}>
              “{origin.words}”
            </blockquote>
          )}
          {origin.choice !== null && <p data-testid="rule-origin-choice" className="m-0 text-[11px]" style={{ color: 'var(--ink-muted)' }}>You chose: {origin.choice}</p>}
          <p data-testid="rule-origin-meta" className="m-0 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {origin.actor} · <time dateTime={new Date(origin.at).toISOString()}>{fmtWhen(origin.at)}</time>
            {origin.how !== null && <> · {HOW_WORDS[origin.how]}</>}
            {origin.where !== null && (
              <>
                {' · '}
                {origin.where.href !== null
                  ? <a href={origin.where.href} data-testid="rule-origin-where" onClick={go(origin.where.href)} className="wk-since-toggle">{whereWords(origin.where)} →</a>
                  : <span data-testid="rule-origin-where">{whereWords(origin.where)}</span>}
              </>
            )}
          </p>
          {origin.approvedProposal && <p data-testid="rule-origin-approved" className="m-0 text-[11px]" style={{ color: 'var(--ink-muted)' }}>You approved a helper’s proposal; the rule is the proposal’s words, not yours.</p>}
          {origin.edited !== null && <p data-testid="rule-origin-edited" className="m-0 text-[11px]" style={{ color: 'var(--ink-muted)' }}>Edited at Remember to: ‘{origin.edited}’ — your words above are kept.</p>}
          {origin.redacted && <p data-testid="rule-origin-redacted" className="m-0 text-[11px]" style={{ color: 'var(--ink-muted)' }}>A secret in the words was masked when they were recorded.</p>}
          {origin.authMode === 'off' && origin.how === 'auto' && <p data-testid="rule-origin-authoff" className="m-0 text-[11px]" style={{ color: 'var(--status-gate)' }}>Remembered on the spot under auth=off — the daemon could not prove a human typed it.</p>}
          <Tech data-testid="tech-rule-origin" parts={[`decision ${origin.decisionId}`, ...(origin.where !== null ? whereIds(origin.where) : [])]} block />
        </section>
      )}
      {history.length > 0 && (
        <section data-testid="rule-history" className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>History</h3>
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {history.map((h, i) => (
              <li key={`${h.at}:${i}`} data-testid="rule-history-row">
                {h.at > 0 && <><time dateTime={new Date(h.at).toISOString()}>{fmtWhen(h.at)}</time> · </>}
                {h.text}
                {h.href !== null && <> · <a href={h.href} onClick={go(h.href)} className="wk-since-toggle">open →</a></>}
              </li>
            ))}
          </ol>
        </section>
      )}
      {!unsupported && (
        <section data-testid="rule-where" data-count={where.length} data-probed={probed} className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>Where it was considered</h3>
          {where.length === 0 ? (
            <p data-testid="rule-where-empty" className="m-0 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Not seen in anything opened this session{probed > 0 ? ` or in the ${probed} recent ${probed === 1 ? 'step' : 'steps'} looked in` : ''}. Open a conversation or a step to see whether it was considered there.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {where.map((w) => (
                <li key={w.key} data-testid="rule-where-row" data-kind={w.kind} data-verdict={w.verdict} {...(w.object !== null ? { 'data-object': w.object } : {})}>
                  <a href={w.href} data-testid="rule-where-open" onClick={go(w.href)} className="wk-since-toggle">{w.label}</a>
                  {' — '}
                  <span data-testid="rule-where-verdict">{WHERE_VERDICT_WORDS[w.verdict]}</span>
                  {w.object !== null && (
                    <>
                      {' · '}
                      <button type="button" data-testid="rule-where-step" onClick={() => { const m = /^step:(.+):(\d+)$/.exec(w.object ?? ''); if (m !== null) openSheet({ kind: 'step', runId: m[1]!, ord: Number(m[2]) }); }} className="wk-since-toggle">look underneath</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {probed > 0 && where.length > 0 && <p data-testid="rule-where-probe" className="m-0 text-[10px]" style={{ color: 'var(--ink-dim)' }}>Includes a look into the {probed} most recent {probed === 1 ? 'step' : 'steps'} of this rule’s runs.</p>}
        </section>
      )}
    </div>
  );
}
