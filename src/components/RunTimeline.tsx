import { Fragment, useEffect, useMemo, useState } from 'react';
import type { CoreEvent, SessionView, WorkUnit } from '../api/types.js';
import { useRunEventStore } from '../store/events.js';
import { useProvenanceStore } from '../store/provenance.js';
import { DeliverLift } from './DeliverLift.js';
import { deliverLift, liftOutcomeLabel } from './deliverLiftModel.js';
import { shortId } from './gateVerdictModel.js';
import { ProvenanceLine } from './ProvenanceLine.js';
import { runBaseLine, runBaseOf } from './runBaseModel.js';
import { VerdictDetail } from './VerdictDetail.js';
import { WorkUnitDetail } from './WorkUnitDetail.js';

/**
 * The run evidence timeline (DES-UX-002 §2, slice BB): a terminal run's default
 * layout — a left-rail navigator over the durably-recorded event trail
 * (`GET /runs/:id/events`, already hydrated into the run event store by App's
 * backfill) + a detail panel. Zero new requests of its own: the rail is a pure
 * view over the fetched log, and the panel REUSES WorkUnitDetail (transcripts)
 * and VerdictDetail (evaluator reasoning) rather than forking either.
 *
 * Phase grouping is the §2.2 CLIENT derivation: no `phaseStarted`/`phaseEnded`
 * event exists, so execution events are bucketed by their unit's `stage`
 * (joined from the SessionView's units by `ord`). The derivation is
 * O(units + events) per render, memoized; CREW-UX-6 (explicit boundary events)
 * remains the optimization seam if logs outgrow it.
 *
 * wicked-core#431 (api-types 0.33.0) adds four rows, each only when its frame is
 * in the log: `runBaseResolved` (the one-line "based on origin/<ref> @ <commit>,
 * N behind, lifted" note at the head), `worktreeRestored` (the creator's tree put
 * back after an evaluator mutation), `deliverLiftEvaluated` (the pre-push lift's
 * outcome — its detail is the shared {@link DeliverLift} card) and
 * `evaluatorToolCallDenied` (a write-class tool call refused at the ACP boundary).
 */

/** The event types that constitute a run's timeline (§2.2); everything else is skipped. */
interface TimelineRow {
  key: string;
  event: CoreEvent;
  /** The row's operator-language label (the ASCII rail's left column). */
  label: string;
  /** Right-hand context: clock, CLI + attempt, criterion, verdict… */
  meta: string;
  /** Phase bucket: `phase: <stage>` for execution events, `gate` for gate nodes, null = head/tail. */
  group: string | null;
  border: 'fail' | 'gate' | 'amend' | null;
}

const BORDER_TOKEN: Record<NonNullable<TimelineRow['border']>, string> = {
  fail: 'var(--status-fail-dim)',
  gate: 'var(--status-gate-dim)',
  amend: 'var(--accent-subtle)',
};

function hhmmss(ts: unknown): string {
  if (typeof ts !== 'number') return '';
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Pure rail derivation (unit-tested): recorded events → ordered, phase-bucketed rows. */
export function timelineRows(events: readonly CoreEvent[], units: readonly WorkUnit[]): TimelineRow[] {
  const byOrd = new Map(units.map((u) => [u.ord, u]));
  const rows: TimelineRow[] = [];
  events.forEach((e, i) => {
    const key = typeof e.seq === 'number' ? `s${e.seq}` : `i${i}`;
    const ord = typeof e.ord === 'number' ? e.ord : null;
    const unit = ord !== null ? byOrd.get(ord) : undefined;
    const phase = ord !== null ? `phase: ${unit?.stage ?? `unit ${ord}`}` : null;
    const attempt = typeof e.attempt === 'number' ? e.attempt : 0;
    const push = (label: string, meta: string, group: string | null, border: TimelineRow['border'] = null): void => {
      rows.push({ key, event: e, label, meta, group, border });
    };
    switch (e.type) {
      case 'sessionStarted': push('run-started', hhmmss(e.ts), null); break;
      case 'runBaseResolved': {
        const base = runBaseOf(e);
        if (base !== null) push('based on', runBaseLine(base), null);
        break;
      }
      case 'workflowSelected': push('workflow', str(e.workflowId) || str(e.workflow_id), null); break;
      case 'unitPlanned': push('planned', str(e.description), null); break;
      case 'unitDispatched':
        push(`unit ${ord ?? '?'}`, `${unit?.assigned_cli ?? '(no CLI recorded)'} · attempt ${attempt}`, phase);
        break;
      case 'unitOutputCaptured': push('✓ output', 'view transcript', phase); break;
      case 'stepFailed': push('✗ failed', str(e['failureKind']) || str(e.detail), phase, 'fail'); break;
      case 'crashRecoveryRedrive': push('↩ retry', `attempt ${attempt}`, phase); break;
      case 'gateEscalated': push('gate', str(e['condition']), 'gate', 'gate'); break;
      case 'worktreeRestored': {
        const n = Array.isArray(e.discarded) ? e.discarded.length : 0;
        push('↺ restored', `creator tree ${str(e.tree) ? shortId(str(e.tree)) : '?'} · ${n} path${n === 1 ? '' : 's'} discarded`, phase, 'gate');
        break;
      }
      case 'evaluatorToolCallDenied':
        push('✗ write refused', `${str(e.cli) || '?'} · ${str(e['tool']) || 'a write tool'}${str(e['path']) ? ` ${str(e['path'])}` : ''}`, phase, 'fail');
        break;
      case 'deliverLiftEvaluated': {
        const outcome = str(e.outcome) || null;
        const conflicts = Array.isArray(e['conflicts']) ? (e['conflicts'] as unknown[]).filter((c): c is string => typeof c === 'string') : [];
        const meta =
          outcome === 'conflict' ? `${liftOutcomeLabel(outcome)} · ${conflicts.join(', ') || 'no path listed'}`
          : outcome === 'lifted' ? `${liftOutcomeLabel(outcome)} · ${str(e['baseRef']) || 'remote'} @ ${str(e['baseAfter']) ? shortId(str(e['baseAfter']), 7) : '?'}`
          : `${liftOutcomeLabel(outcome)}${str(e['note']) ? ` · ${str(e['note'])}` : ''}`;
        push('lift', meta, phase, outcome === 'conflict' || outcome === 'failed' ? 'fail' : null);
        break;
      }
      case 'gateEvaluated': push('verdict', e.combined === true ? 'pass' : 'deny', 'gate', 'gate'); break;
      case 'unitReworkAmended': push('amended', str(e.amendment), 'gate', 'amend'); break;
      case 'sessionCompleted': push('run-ended', 'completed', null); break;
      case 'sessionFailed': push('run-ended', 'failed', null, 'fail'); break;
      case 'runCancelled': push('run-ended', 'cancelled', null); break;
      default: break; // not a timeline event (§2.2's list governs)
    }
  });
  return rows;
}

/** The unit's description as PLANNED — the amendment diff's "original" column (EC49). */
function plannedDescription(events: readonly CoreEvent[], ord: number | null): string | null {
  const planned = events.find((e) => e.type === 'unitPlanned' && e.ord === ord);
  const d = planned?.description;
  return typeof d === 'string' ? d : null;
}

function DetailLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="uppercase tracking-wider font-mono" style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}>
      {children}
    </p>
  );
}

/** EC49: `unitReworkAmended` rendered as an explicit diff — original vs amended, side by side. */
function AmendmentDiff({ event, original }: { event: CoreEvent; original: string | null }): React.ReactElement {
  return (
    <div data-testid="amendment-diff" className="flex flex-col gap-2">
      <p className="text-xs font-semibold font-mono" style={{ color: 'var(--accent)' }}>
        Amendment — unit {typeof event.ord === 'number' ? event.ord : '?'}
      </p>
      <div>
        <DetailLabel>amendment (operator)</DetailLabel>
        <p className="text-xs mt-0.5" style={{ color: 'var(--ink-body)' }}>{str(event.amendment)}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div data-testid="amendment-original">
          <DetailLabel>original description</DetailLabel>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {original ?? '(original description not in the event log)'}
          </p>
        </div>
        <div data-testid="amendment-amended">
          <DetailLabel>amended description</DetailLabel>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-body)' }}>{str(e2sAmended(event))}</p>
        </div>
      </div>
    </div>
  );
}

/** The wire spells it `updatedDescription` (core event_to_json); §2.2's `amended_description` is the same record. */
function e2sAmended(e: CoreEvent): string {
  return str(e.updatedDescription) || str(e['amended_description']);
}

/** The sessionStarted detail: the run's provenance line (DES-UX-001 §3, reused). */
function StartDetail({ runId, problem }: { runId: string; problem: string }): React.ReactElement {
  const provenance = useProvenanceStore((s) => s.byRun[runId]);
  const load = useProvenanceStore((s) => s.load);
  useEffect(() => load(runId), [load, runId]);
  return (
    <div className="flex flex-col gap-2">
      <DetailLabel>run origin</DetailLabel>
      <p className="text-xs" style={{ color: 'var(--ink-body)' }}>{problem}</p>
      <ProvenanceLine provenance={provenance} testId="timeline-provenance" />
    </div>
  );
}

interface Props {
  view: SessionView;
  navigate?: (path: string) => void;
  /** Evidence references in reused transcripts open the FileViewer (slice R wiring, kept). */
  onOpenFile?: (path: string) => void;
}

const EMPTY_EVENTS: CoreEvent[] = [];

export function RunTimeline({ view, navigate, onOpenFile }: Props): React.ReactElement {
  const { session, units } = view;
  const events = useRunEventStore((s) => s.byRun[session.id]) ?? EMPTY_EVENTS;
  const ordered = useMemo(() => [...units].sort((a, b) => a.ord - b.ord), [units]);
  const rows = useMemo(() => timelineRows(events, ordered), [events, ordered]);
  const [selKey, setSelKey] = useState<string | null>(null);
  const selected = rows.find((r) => r.key === selKey) ?? null;
  const byOrd = useMemo(() => new Map(ordered.map((u) => [u.ord, u])), [ordered]);
  // Every unit with a captured-output row mounts its (reused) WorkUnitDetail ONCE and
  // stays mounted — selection only toggles visibility, so a click renders the transcript
  // within one frame cycle and fires zero additional /units/*/output fetches (§2.5).
  const outputOrds = useMemo(
    () => [...new Set(rows.filter((r) => r.event.type === 'unitOutputCaptured' && typeof r.event.ord === 'number').map((r) => r.event.ord as number))],
    [rows],
  );
  const selectedOutputOrd = selected?.event.type === 'unitOutputCaptured' && typeof selected.event.ord === 'number'
    ? selected.event.ord
    : null;

  function eventDetail(row: TimelineRow): React.ReactElement {
    const e = row.event;
    const ord = typeof e.ord === 'number' ? e.ord : null;
    const unit = ord !== null ? byOrd.get(ord) : undefined;
    switch (e.type) {
      case 'gateEvaluated':
        return <VerdictDetail runId={session.id} units={ordered} />;
      case 'unitReworkAmended':
        return <AmendmentDiff event={e} original={plannedDescription(events, ord)} />;
      case 'stepFailed':
        return (
          <div data-testid="step-failed-detail" className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold font-mono" style={{ color: 'var(--status-fail)' }}>
              Worker failure — unit {ord ?? '?'} · attempt {typeof e.attempt === 'number' ? e.attempt : 0}
              {str(e['failureKind']) && ` · ${str(e['failureKind'])}`}
            </p>
            <p className="text-xs whitespace-pre-wrap font-mono" style={{ color: 'var(--ink-body)' }}>
              {str(e.detail) || '(no failure detail recorded)'}
            </p>
          </div>
        );
      case 'sessionStarted':
        return <StartDetail runId={session.id} problem={session.problem} />;
      case 'runBaseResolved': {
        const base = runBaseOf(e);
        return (
          <div data-testid="run-base-detail" className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold font-mono" style={{ color: 'var(--ink-body)' }}>
              Run base — {base === null ? '(unreadable frame)' : runBaseLine(base)}
            </p>
            {base !== null && (
              <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
                worktree minted from {base.baseCommit}
                {base.localHead !== '' && ` · the registered clone's HEAD was ${base.localHead}`}
                {` · git fetch origin ${base.fetched ? 'succeeded' : 'FAILED (cached refs used)'}`}
              </p>
            )}
            {base !== null && base.note !== null && (
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{base.note}</p>
            )}
          </div>
        );
      }
      case 'deliverLiftEvaluated': {
        const lift = ord !== null ? deliverLift(events, ord) : null;
        return lift !== null ? (
          <DeliverLift view={lift} />
        ) : (
          <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>lift · {str(e.outcome) || '?'}</p>
        );
      }
      case 'worktreeRestored': {
        const discarded = Array.isArray(e.discarded)
          ? (e.discarded as unknown[]).filter((c): c is { path: string; status: string } =>
              typeof c === 'object' && c !== null && typeof (c as { path?: unknown }).path === 'string' && typeof (c as { status?: unknown }).status === 'string')
          : [];
        const ref = str(e['suggestionRef']) || null;
        return (
          <div data-testid="worktree-restored-detail" className="flex flex-col gap-1.5" style={{ overflowWrap: 'anywhere' }}>
            <p className="text-xs font-semibold font-mono" style={{ color: 'var(--status-gate)' }}>
              Creator tree restored — unit {ord ?? '?'} · {str(e.phase) || 'phase'} by {str(e.cli) || 'the seat'}
            </p>
            <p className="text-xs font-mono" style={{ color: 'var(--ink-body)' }}>
              discarded: {discarded.length === 0 ? 'no path listed' : discarded.map((c) => `${c.status} ${c.path}`).join(', ')}
              {str(e.tree) && <span style={{ color: 'var(--ink-dim)' }}> · tree {shortId(str(e.tree))}</span>}
              {str(e.head) && ` · HEAD reset to ${shortId(str(e.head), 7)}`}
            </p>
            <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
              {ref !== null ? (
                <>
                  the discarded edit is kept at <code>{ref}</code> — <code style={{ userSelect: 'all' }}>git show {ref}</code>
                </>
              ) : (
                'the discarded edit was not pinned (no suggestion ref)'
              )}
            </p>
          </div>
        );
      }
      case 'evaluatorToolCallDenied':
        return (
          <div data-testid="tool-call-denied-detail" className="flex flex-col gap-1.5" style={{ overflowWrap: 'anywhere' }}>
            <p className="text-xs font-semibold font-mono" style={{ color: 'var(--status-fail)' }}>
              Write refused — unit {ord ?? '?'} · {str(e.cli) || 'the seat'} asked for {str(e['tool']) || 'a write tool'}
              {str(e['path']) && ` on ${str(e['path'])}`}
            </p>
            <p className="text-xs font-mono" style={{ color: 'var(--ink-body)' }}>{str(e['reason']) || '(no reason recorded)'}</p>
            <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>
              refused at the {str(e['carrier']) || 'acp'} permission boundary — a read-only phase may not edit; the call cost the seat one tool call, not the phase a retry
            </p>
          </div>
        );
      case 'gateEscalated':
        return (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold font-mono" style={{ color: 'var(--status-gate)' }}>Gate escalated — unit {ord ?? '?'}</p>
            {str(e['condition']) && <p className="text-xs" style={{ color: 'var(--ink-body)' }}>criterion: {str(e['condition'])}</p>}
            {str(e['verdictSummary']) && <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{str(e['verdictSummary'])}</p>}
          </div>
        );
      case 'workflowSelected':
        return (
          <p className="text-xs font-mono" style={{ color: 'var(--ink-body)' }}>
            workflow {str(e.workflowId) || str(e.workflow_id) || '(unnamed)'}
            {typeof e.unitCount === 'number' && ` · ${e.unitCount} planned units`}
          </p>
        );
      default:
        return (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-mono" style={{ color: 'var(--ink-body)' }}>{row.label} · {e.type}</p>
            {unit !== undefined && <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{unit.description}</p>}
            {row.meta !== '' && <p className="text-xs font-mono" style={{ color: 'var(--ink-muted)' }}>{row.meta}</p>}
          </div>
        );
    }
  }

  return (
    <div className="flex-1 min-h-0 flex gap-3">
      {/* The rail: chronological event groupings (§2.3), phase headers derived client-side. */}
      <div
        data-testid="timeline"
        className="w-64 shrink-0 overflow-y-auto rounded-lg py-2"
        style={{ background: 'var(--surface-rail)', paddingLeft: 'var(--space-4)', paddingRight: 'var(--space-4)' }}
      >
        {typeof session.retry_of === 'string' && (
          <div className="pb-1.5 mb-1.5" style={{ borderBottom: '1px solid var(--surface-raised)' }}>
            <button
              type="button"
              data-testid="retry-link"
              onClick={() => navigate?.(`/runs/${encodeURIComponent(session.retry_of ?? '')}`)}
              title={`Open the parent run ${session.retry_of}`}
              className="text-xs font-mono underline transition-opacity hover:opacity-70"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}
            >
              retry of {session.retry_of.slice(0, 8)}
            </button>
          </div>
        )}
        {rows.length === 0 && (
          <p className="text-xs font-mono py-2" style={{ color: 'var(--ink-dim)' }}>
            No recorded events survive for this run — event retention predates it, or its log was pruned.
          </p>
        )}
        {rows.map((r, i) => (
          <Fragment key={r.key}>
            {r.group !== null && r.group !== rows[i - 1]?.group && (
              <p
                data-testid="timeline-phase"
                className="uppercase tracking-wider font-mono mt-2 mb-0.5"
                style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)' }}
              >
                {r.group}
              </p>
            )}
            <button
              type="button"
              data-testid="timeline-row"
              data-event-type={r.event.type}
              aria-current={selKey === r.key || undefined}
              onClick={() => setSelKey(r.key)}
              className="w-full text-left rounded px-2 py-1 text-sm font-mono flex items-baseline gap-2 transition-colors"
              style={{
                background: selKey === r.key ? 'var(--surface-raised)' : 'transparent',
                borderLeft: `2px solid ${r.border !== null ? BORDER_TOKEN[r.border] : 'transparent'}`,
                cursor: 'pointer',
              }}
            >
              <span className="shrink-0" style={{ color: 'var(--ink-body)' }}>{r.label}</span>
              <span className="truncate" style={{ color: 'var(--ink-muted)', fontSize: '11px' }} title={r.meta}>
                {r.meta}
              </span>
            </button>
          </Fragment>
        ))}
      </div>

      {/* The detail panel: one click from any row to its evidence (§2.3). */}
      <div
        data-testid="timeline-detail"
        className="flex-1 min-w-0 overflow-y-auto rounded-lg p-3"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        {selected === null && (
          <p className="text-xs font-mono" style={{ color: 'var(--ink-dim)' }}>select an event to see its detail</p>
        )}
        {outputOrds.map((ord) => {
          const u = byOrd.get(ord);
          if (u === undefined) return null;
          return (
            <ol key={ord} className="list-none" style={selectedOutputOrd === ord ? {} : { display: 'none' }}>
              <WorkUnitDetail
                runId={session.id}
                unit={u}
                isGated={false}
                {...(onOpenFile !== undefined ? { onOpenFile } : {})}
              />
            </ol>
          );
        })}
        {selected !== null && selected.event.type !== 'unitOutputCaptured' && eventDetail(selected)}
      </div>
    </div>
  );
}
