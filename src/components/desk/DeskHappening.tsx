import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { CoreEvent, SessionView } from '../../api/types.js';
import { everythingPath } from '../../board/everythingModel.js';
import { relTime } from '../../board/relTime.js';
import { waitsOnYou } from '../../board/attention.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { STREAM_TYPES, useDeskStream, type StreamItem } from '../../store/deskStream.js';
import { agentColor } from '../charts/Chart.js';
import { Skeleton } from '../ui/index.js';
import { AlertTriangle, CircleAlert } from 'lucide-react';

/** Backfill: the newest frames of the most recently active runs, read once per page load. */
const BACKFILL_RUNS = 6;
const SHOWN = 60;
const QUIET_MS = 10 * 60_000;

/** Test hook: every scope backfills again on its next mount. */
export function resetHappeningBackfill(): void { useDeskStream.setState({ backfills: {} }); }

/**
 * HAPPENING NOW = a live stream of what is happening everywhere (DES-desk-v2 §2.2): every run's
 * CoreEvents as they arrive over `/ws`, in plain words, newest on top, each with its agent's colour,
 * the job as a link and an age that ticks. On first load it backfills the newest frames of the most
 * recently active runs (`GET /runs/:id/events?type=…`), then it is live. Nothing is synthesised: a
 * quiet stream says so, with the age of its last real event. Hovering pauses it (new items wait
 * above, counted, until the pointer leaves). Fixed height; scrolls inside.
 */
export function DeskHappening({ runs, runsShown, navigate, now, title, pathOf, agentName, scope = null, scopeKey = 'desk', seeAllPath }: {
  /** Whose backfill this is: 'desk', or the project's id (each scope reads its own recent runs once). */
  scopeKey?: string;
  /** A project's page: only events of these runs (the stream itself is studio-wide). */
  scope?: ReadonlySet<string> | null;
  /** Where "See all jobs" goes (a project's page scopes it). */
  seeAllPath?: string;
  runs: SessionView[];
  runsShown: boolean;
  navigate: Navigate;
  now: number;
  title: (v: SessionView) => string;
  pathOf: (runId: string) => string;
  agentName: (cli: string) => string;
}): React.ReactElement {
  const allItems = useDeskStream((s) => s.items);
  const items = useMemo(() => (scope === null ? allItems : allItems.filter((i) => scope.has(i.runId))), [allItems, scope]);
  const mine = useDeskStream((s) => s.backfills[scopeKey]);
  const backfilled = mine?.phase === 'done';
  // A backfill whose reads failed is never "quiet": it says what could not be read and offers a retry.
  const readIssue = mine !== undefined && mine.phase === 'done' && mine.failed > 0 ? { failed: mine.failed, total: mine.total } : null;
  const retryBackfill = (): void => { useDeskStream.getState().releaseBackfill(scopeKey); };
  const [paused, setPaused] = useState<StreamItem[] | null>(null);
  const [, tick] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (k: string): void => setExpanded((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // The age ticks.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  // One backfill per scope and page load, once the run list has answered (again on Retry). The store
  // holds the request's outcome, so a run-list update mid-read never loses its failure count.
  useEffect(() => {
    if (!runsShown || mine !== undefined) return;
    if (!useDeskStream.getState().claimBackfill(scopeKey)) return;
    const recent = [...runs]
      .filter((v) => v.session.archived_at == null)
      .sort((a, b) => activeAt(b) - activeAt(a))
      .slice(0, BACKFILL_RUNS);
    void Promise.all(recent.map((v) => api.getRunEvents(v.session.id, [...STREAM_TYPES]).then((r) => ({ ok: true, events: r.events ?? [] }), () => ({ ok: false, events: [] as CoreEvent[] }))))
      .then((pages) => useDeskStream.getState().finishBackfill(scopeKey, pages.flatMap((p) => p.events), pages.filter((p) => !p.ok).length, pages.length));
  }, [runsShown, runs, mine, scopeKey]);

  const view = (paused ?? items).slice(0, SHOWN);
  const waiting = paused === null ? 0 : items.filter((i) => !paused.some((p) => p.key === i.key)).length;
  // New items arrive at the top and the list glides back to them, unless the operator is reading it
  // (hovered) or asked for less motion.
  useEffect(() => {
    if (paused !== null) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    listRef.current?.scrollTo?.({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [items, paused]);

  const byId = useMemo(() => new Map(runs.map((v) => [v.session.id, v])), [runs]);
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const every = seeAllPath ?? everythingPath({ tab: 'sessions' });
  const last = items[0]?.at ?? null;
  const clock = Date.now();
  const quiet = last === null || clock - last > QUIET_MS;

  return (
    <section aria-labelledby="desk-now-title" data-testid="desk-happening" className="wk-card wk-now">
      <header className="wk-inbox-head">
        <h2 id="desk-now-title" className="wk-desk2-title">Happening now</h2>
        <span className="wk-viz-meta" data-testid="desk-stream-state">
          {!backfilled ? 'reading…' : readIssue !== null && readIssue.failed === readIssue.total && items.length === 0 ? 'not read'
            : quiet ? (last === null ? 'quiet' : `quiet · last event ${relTime(last, clock)}`) : <><span className="wk-live-dot" aria-hidden /> live</>}
          {readIssue !== null && readIssue.failed < readIssue.total && <> · {readIssue.failed} of {readIssue.total} jobs not read <button type="button" className="wk-link" data-testid="desk-stream-retry" onClick={retryBackfill}>retry</button></>}
        </span>
        <a href={every} onClick={go(every)} className="wk-link wk-now-every" data-testid="desk-see-everything">See all jobs</a>
      </header>
      {!backfilled && items.length === 0 ? <div className="wk-inbox-empty"><Skeleton rows={4} variant="row" /></div> : view.length === 0 ? (
        readIssue !== null && readIssue.failed === readIssue.total ? (
          <p className="wk-now-quiet" data-testid="desk-stream-unread" role="alert">Couldn’t read what happened on your recent jobs. <button type="button" className="wk-link" data-testid="desk-stream-retry" onClick={retryBackfill}>Try again</button></p>
        ) : <p className="wk-now-quiet" data-testid="desk-stream-quiet">Quiet right now. Nothing has happened on {scope === null ? 'any job' : 'this project’s jobs'} yet.</p>
      ) : (
        <ul
          ref={listRef}
          className="wk-stream"
          aria-label="Events from every job, newest first"
          aria-live="polite"
          data-testid="desk-stream"
          onMouseEnter={() => setPaused(items)}
          onMouseLeave={() => setPaused(null)}
        >
          {waiting > 0 && <li className="wk-stream-waiting" data-testid="desk-stream-waiting">{waiting} new · move away to see {waiting === 1 ? 'it' : 'them'}</li>}
          {foldRuns(view).map((g) => {
            const it = g[0]!;
            const v = byId.get(it.runId);
            const said = sayEvent(it, v, agentName);
            const folded = g.length > 1;
            const open = expanded.has(it.key);
            const worst = g.map((x) => sayEvent(x, v, agentName).tone).find((t) => t === 'fail') ?? said.tone;
            const Sev = worst === 'fail' ? CircleAlert : worst === 'gate' ? AlertTriangle : null;
            return (
              <li key={it.key} data-testid="desk-stream-item" data-type={it.type} data-count={g.length} data-live={it.live ? 'true' : undefined} className="wk-stream-item" data-tone={worst}>
                {/* The agent is only the dot; severity is its own icon (never the text colour). */}
                <i aria-hidden className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: said.agent !== null ? agentColor(said.agent) : 'var(--ink-dim)' }} />
                <span className="wk-stream-text">
                  <span className="wk-stream-line">
                    {Sev !== null && <Sev size={14} aria-label={worst === 'fail' ? 'Problem' : 'Needs a decision'} className="wk-stream-sev" data-sev={worst} />}
                    {folded ? `${v !== undefined ? title(v) : 'A job'} · ${g.length} events: ${g.slice(0, 3).map((x) => sayEvent(x, v, agentName).short).join(', ')}${g.length > 3 ? ', …' : ''}` : said.text}
                  </span>
                  <span className="wk-stream-meta">
                    {v !== undefined ? <a href={pathOf(it.runId)} onClick={go(pathOf(it.runId))} className="wk-stream-job" title={title(v)}>{folded ? 'Open the job' : title(v)}</a> : <span>A job no longer listed</span>}
                    {folded && <button type="button" className="wk-stream-more" aria-expanded={open} data-testid="desk-stream-expand" onClick={() => toggle(it.key)}>{open ? 'Fold' : 'Show each'}</button>}
                  </span>
                  {folded && open && (
                    <ul className="wk-stream-sub">
                      {g.map((x) => { const sx = sayEvent(x, v, agentName); return <li key={x.key}><i aria-hidden className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: sx.agent !== null ? agentColor(sx.agent) : 'var(--ink-dim)' }} />{sx.text}<span className="wk-stream-age">{relTime(x.at, Math.max(now, clock))}</span></li>; })}
                    </ul>
                  )}
                </span>
                <span className="wk-stream-age" title={new Date(it.at).toLocaleString()}>{relTime(it.at, Math.max(now, clock))}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Consecutive events of the same job fold into one line, so the ticker shows variety. */
export function foldRuns(items: readonly StreamItem[]): StreamItem[][] {
  const out: StreamItem[][] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last !== undefined && last[0]!.runId === it.runId) last.push(it); else out.push([it]);
  }
  return out;
}

function activeAt(v: SessionView): number {
  const s = v.session as { created_at?: number | null; ended_at?: number | null };
  return Math.max(s.ended_at ?? 0, s.created_at ?? 0);
}

/** A frame in plain words: what happened, which agent, and its tone. */
export function sayEvent(it: StreamItem, v: SessionView | undefined, agentName: (cli: string) => string): { text: string; short: string; agent: string | null; tone: 'ok' | 'fail' | 'gate' | 'run' | 'quiet' } {
  const r = sayLong(it, v, agentName);
  // A sentence that opens with an agent's name keeps its capital ("Pi CLI finished step 1").
  const named = r.agent !== null && r.text.startsWith(agentName(r.agent));
  return { ...r, short: named ? r.text : r.text.charAt(0).toLowerCase() + r.text.slice(1) };
}

function sayLong(it: StreamItem, v: SessionView | undefined, agentName: (cli: string) => string): { text: string; agent: string | null; tone: 'ok' | 'fail' | 'gate' | 'run' | 'quiet' } {
  const e = it.event as unknown as Record<string, unknown>;
  const ord = typeof e.ord === 'number' ? e.ord : null;
  const unit = ord === null ? undefined : (v?.units ?? []).find((u) => u.ord === ord);
  const unitAgent = typeof unit?.assigned_cli === 'string' && unit.assigned_cli !== '' ? unit.assigned_cli : null;
  const cli = typeof e.cli === 'string' ? e.cli : typeof e.cliKey === 'string' ? e.cliKey : null;
  const who = (k: string | null): string => (k === null ? 'An agent' : agentName(k));
  const step = ord === null ? 'a step' : `step ${ord}`;
  switch (it.type) {
    case 'sessionStarted': return { text: 'Job started', agent: null, tone: 'run' };
    case 'sessionCompleted': return { text: 'Job finished', agent: null, tone: 'ok' };
    case 'sessionFailed': return { text: 'Job failed', agent: null, tone: 'fail' };
    case 'runCancelled': return { text: 'Job cancelled', agent: null, tone: 'quiet' };
    case 'unitExecuting': return { text: `${who(unitAgent)} started ${step}`, agent: unitAgent, tone: 'run' };
    case 'unitDone': return { text: `${who(unitAgent)} finished ${step}`, agent: unitAgent, tone: 'ok' };
    case 'stepFailed': return { text: `${cap(step)} failed`, agent: unitAgent, tone: 'fail' };
    // An answered ask parks at its turn gate: it does not wait on you (the attention model).
    case 'awaitingHuman': return v !== undefined && v.session.status === 'awaiting_human' && !waitsOnYou(v.session)
      ? { text: 'Answered your question', agent: unitAgent, tone: 'ok' }
      : { text: `Asked you to decide at ${step}`, agent: unitAgent, tone: 'gate' };
    case 'gateDecided': return e.allow === true ? { text: `${cap(step)} passed its checks`, agent: unitAgent, tone: 'ok' } : { text: `${cap(step)} was sent back`, agent: unitAgent, tone: 'fail' };
    case 'gateEscalated': return { text: `${cap(step)} needs a person to decide`, agent: unitAgent, tone: 'gate' };
    case 'unitReassigned': return { text: `${cap(step)} moved to another agent`, agent: unitAgent, tone: 'quiet' };
    case 'councilSeatFailed': return { text: `${who(cli)} dropped out of a review${typeof e.reason === 'string' ? ` (${e.reason.replace(/_/g, ' ')})` : ''}`, agent: cli, tone: 'fail' };
    case 'governanceUnenforced': return { text: `${who(cli)} ran ${step} without its governance checks`, agent: cli, tone: 'fail' };
    case 'acpFallback': return { text: `${who(cli)} fell back to an ungoverned session`, agent: cli, tone: 'fail' };
    case 'failureTriaged': return { text: `Studio looked into why ${step} failed`, agent: null, tone: 'quiet' };
    case 'repoChecksEvaluated': return { text: 'The repository’s own checks ran', agent: null, tone: 'quiet' };
    default: return { text: it.type, agent: null, tone: 'quiet' };
  }
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
