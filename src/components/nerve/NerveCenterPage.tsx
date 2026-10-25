import { useEffect, useRef, useState } from 'react';
import type { SystemAction, SystemAttention, SystemCli, SystemGovernanceCard, SystemInfra, SystemRun } from '../../api/system.js';
import { gateOpenPath } from '../../board/gateActions.js';
import { duration, LIVENESS_WORD, percent, runsWorstFirst, toneWord, type NerveState } from '../../board/nerveCenter.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { relTime } from '../../board/relTime.js';
import { sessionPath } from '../../board/sessionModel.js';
import { useNerveState } from '../../hooks/useNerveState.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { getCachedRoster } from '../../store/rosterCache.js';
import { useSystemStore } from '../../store/systemSnapshot.js';
import { AgentModal } from '../agents/AgentModal.js';
import { ConnectionRegistry, GovernanceRows, SeatsRegistry, WeekRegistry, useHealthRegistry, type HealthRegistry } from '../HealthRailSection.js';
import { TechDetails } from '../ui/index.js';

const defaultNavigate: Navigate = (p) => { history.pushState(null, '', p); window.dispatchEvent(new PopStateEvent('popstate')); };

/** HH:MM:SS, locale-free (the registry's own clock words). */
function clock(at: number): string {
  return new Date(at).toTimeString().slice(0, 8);
}

const LEVEL_GLYPH = { red: '✕', yellow: '!' } as const;
const STATE_GLYPH = { ok: '✓', degraded: '!', down: '✕', unknown: '?', off: '–' } as const;
const STATE_WORD = { ok: 'ok', degraded: 'degraded', down: 'down', unknown: 'unknown', off: 'off' } as const;

/** The page's one sentence: the tile's verdict, said in full. */
function headline(state: NerveState): string {
  if (state.read === 'checking') return 'Checking crew…';
  if (state.read !== 'fresh') return "Can't reach crew — what you see below may be out of date.";
  const red = state.attention.filter((a) => a.level === 'red').length;
  const n = state.attention.length;
  if (n === 0) return 'All clear — nothing is stopping work.';
  if (red > 0) return `Work is blocked: ${state.words}${n > 1 ? ` (and ${n - 1} more)` : ''}.`;
  return `${n === 1 ? '1 thing needs' : `${n} things need`} a look — work still flows.`;
}

/**
 * NERVE CENTER (`/watch`; `/health` redirects here — DES-SYSTEM-VIEW): ONE dashboard that answers
 * "is anything stopping work, why, and what fixes it?". Top to bottom:
 *
 *  - the verdict sentence, when crew last answered, and Re-check;
 *  - Needs attention (only when non-empty), worst first, each with its reason, remedy and action;
 *  - four panels — CLIs · Runs · Infra · Governance — that stack on a phone;
 *  - the feed (the old Watchtower: problems, decisions, finished, delivered), full width.
 *
 * Against a crew with `capabilities.system` the panels read `GET /system`. Against an older crew they
 * hold today's Health cards (Connection in Infra, Helpers and This week in CLIs, Governance in
 * Governance) with an upgrade note. The Health cards stay in their panels in both modes, so nothing
 * the old `/health` page showed is lost. Read-only apart from Sign in, Re-check and opening a run.
 */
export function NerveCenterPage({ navigate = defaultNavigate, needCount = 0, feed = null }: {
  navigate?: Navigate;
  /** The Desk's settled needs-you count (an older crew's "waiting on you"). */
  needCount?: number;
  /** The feed, rendered under the panels (App passes the embedded Watchtower feed). */
  feed?: React.ReactNode;
}): React.ReactElement {
  const registry = useHealthRegistry(true);
  const state = useNerveState(needCount);
  const mode = useSystemStore((s) => s.mode);
  const snapshot = useSystemStore((s) => s.snapshot);
  const answeredAt = useSystemStore((s) => (s.mode === 'system' ? s.snapshotAt : s.healthAt));
  const reading = useSystemStore((s) => s.reading);
  const snapshotError = useSystemStore((s) => s.snapshotError);
  // The Health cards read once on mount (EC30); when the shared poll sees crew come back or go away,
  // they re-read too, so the cards never contradict the verdict above them.
  // `null` until the poll has an answer either way: the mount read already covers that first answer.
  const reachable = useSystemStore((s) => (s.healthError !== null ? false : s.healthAt !== null ? true : null));
  const { reread } = registry;
  const lastReach = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = lastReach.current;
    lastReach.current = reachable;
    if (prev !== null && reachable !== null && prev !== reachable) reread();
  }, [reachable]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read on the flip only
  // Opening the page is a fresh read for the tile too (the old Health page's rule); one already in
  // flight (the poll's own first read) serves it.
  useEffect(() => { void useSystemStore.getState().refresh(); }, []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const system = mode === 'system' && snapshot !== null;
  const { governance, week } = registry;
  const missing = [week.kind === 'absent' ? 'the week' : null, governance.kind === 'absent' ? 'governance' : null].filter((s): s is string => s !== null);
  const recheck = (): void => registry.reprobeNow();
  const act = (a: SystemAction): void => {
    if (a.kind === 'recheck') { recheck(); return; }
    if (a.kind === 'sign-in') {
      const seat = (registry.roster ?? []).find((s) => s.key === a.target);
      if (seat !== undefined) registry.setSignIn(seat);
      else navigate(`/agents?fix=${encodeURIComponent(a.target)}`);
      return;
    }
    navigate(a.kind === 'open-gate' ? gateOpenPath('', a.target) : sessionPath(`run:${a.target}`));
  };

  // The old Health page's Helpers and This week cards: in the CLIs panel against an older crew, under
  // the panels when the snapshot's CLI cards are there.
  const helpers = (
    <>
      <section data-testid="health-card-seats" className="wk-nc-sub" aria-label="Helpers">
        <h3 className="wk-nc-sub-title">{system ? 'Sign-in' : 'Helpers'}</h3>
        <SeatsRegistry registry={registry} />
      </section>
      <section data-testid="health-card-week" className="wk-nc-sub" aria-label="This week">
        <h3 className="wk-nc-sub-title">This week</h3>
        <WeekRegistry registry={registry} />
      </section>
    </>
  );

  return (
    <div data-testid="nerve-center-page" data-mode={mode} data-tone={state.tone} className="wk-desk-scroll wk-nc-page wk-measure">
      <header className="wk-nc-head">
        <div className="wk-nc-head-row">
          <h1 className="wk-desk-hello">{PAGE_NAMES.watch}</h1>
          <span data-testid="nc-verdict" data-tone={state.tone} className="wk-nc-verdict">
            <span aria-hidden className="wk-nc-verdict-light" />
            {state.words}<span className="sr-only"> — {toneWord(state.tone)}</span>
          </span>
          <button type="button" data-testid="nc-recheck" className="wk-btn wk-btn--secondary wk-btn--sm wk-nc-recheck" disabled={reading} onClick={recheck}>
            {reading ? 'Checking…' : 'Re-check'}
          </button>
        </div>
        <p data-testid="nc-headline" className="wk-desk-date">
          {headline(state)}
          {answeredAt !== null && <span data-testid="nc-checked" className="wk-nc-checked"> Crew answered at {clock(answeredAt)}.</span>}
        </p>
        {mode === 'fallback' && (
          <p data-testid="nc-upgrade-note" className="wk-health-note">
            This version of crew does not report the full system yet (each CLI&apos;s week, run liveness, infra probes, governance cards).
            Upgrade crew to see them. Below are studio&apos;s own checks and the feed.
          </p>
        )}
        {missing.length > 0 && (
          <p data-testid="health-upgrade-note" className="wk-health-note">
            This version of crew does not report {missing.join(' or ')} yet. Upgrade crew to see {missing.length > 1 ? 'them' : 'it'}.
          </p>
        )}
      </header>

      {state.attention.length > 0 && <AttentionStrip items={state.attention} onAct={act} />}

      {/* Two columns that do not share row heights: CLIs over Infra, Runs over Governance (the
          design's sketch); one column on a phone. */}
      <div className="wk-nc-grid">
        <div className="wk-nc-col">
          <section data-testid="nc-panel-clis" className="wk-nc-panel" aria-labelledby="nc-clis-title">
            <h2 id="nc-clis-title" className="wk-nc-panel-title">CLIs</h2>
            {system ? <CliCards clis={snapshot.clis} onSignIn={(key) => act({ kind: 'sign-in', target: key })} /> : helpers}
          </section>

          <section data-testid="nc-panel-infra" className="wk-nc-panel" aria-labelledby="nc-infra-title">
            <h2 id="nc-infra-title" className="wk-nc-panel-title">Infra</h2>
            <section data-testid="health-card-connection" className="wk-nc-sub" aria-label="Connection">
              <h3 className="wk-nc-sub-title">Studio to crew</h3>
              <ConnectionRegistry registry={registry} />
            </section>
            {system && <InfraRows rows={snapshot.infra} onRecheck={recheck} />}
          </section>
        </div>

        <div className="wk-nc-col">
          <section data-testid="nc-panel-runs" className="wk-nc-panel" aria-labelledby="nc-runs-title">
            <h2 id="nc-runs-title" className="wk-nc-panel-title">Runs</h2>
            {system
              ? <RunRows runs={snapshot.runs} now={now} navigate={navigate} />
              : mode === 'fallback'
                ? <p data-testid="nc-runs-fallback" className="wk-health-absent">This crew does not report run liveness yet. The feed below shows what needs you, what went quiet and what finished.</p>
                : <p data-testid="nc-runs-pending" className="wk-health-absent">{snapshotError !== null ? "Crew's system snapshot could not be read. Re-check, or see the feed below." : 'Checking crew…'}</p>}
          </section>

          <section data-testid="nc-panel-governance" className="wk-nc-panel" aria-labelledby="nc-gov-title">
            <h2 id="nc-gov-title" className="wk-nc-panel-title">Governance</h2>
            {system && <GovernanceCards cards={snapshot.governance} />}
            <section data-testid="health-card-governance" className="wk-nc-sub" aria-label="Evidence">
              <h3 className="wk-nc-sub-title">Evidence store</h3>
              <GovernanceRows read={governance} overdue={registry.overdue ? registry.probeDeadlineMs : 0} onReprobe={registry.reprobeNow} />
            </section>
          </section>
        </div>
      </div>

      {/* With the snapshot, the CLI cards carry each CLI's state; the roster's sign-in rows and the
          week's coaching moves (the old Health cards) sit under the panels, side by side. */}
      {system && (
        <section data-testid="nc-panel-helpers" className="wk-nc-panel wk-nc-helpers" aria-labelledby="nc-helpers-title">
          <h2 id="nc-helpers-title" className="wk-nc-panel-title">Helpers: sign-in and this week</h2>
          <div className="wk-nc-helpers-cols">{helpers}</div>
        </section>
      )}

      {feed !== null && <section data-testid="nc-feed" className="wk-nc-feed" aria-label="Feed">{feed}</section>}

      <SignInModal registry={registry} />
    </div>
  );
}

function SignInModal({ registry }: { registry: HealthRegistry }): React.ReactElement | null {
  const { signIn } = registry;
  if (signIn === null) return null;
  return (
    <AgentModal
      agentKey={signIn.key}
      intent="sign-in"
      onClose={() => {
        const r = getCachedRoster();
        if (r !== null) registry.acceptRoster(r);
        registry.setSignIn(null);
        // A sign-in changes what the snapshot says (the CLI card, attention, the tile): read it now.
        void useSystemStore.getState().refresh({ force: true });
      }}
    />
  );
}

const ACTION_WORD: Record<SystemAction['kind'], string> = { 'sign-in': 'Sign in', recheck: 'Re-check', 'open-gate': 'Open gate', 'open-run': 'Open run' };

/** Needs attention: every item worst first — what, why, what fixes it, and the one existing action. */
function AttentionStrip({ items, onAct }: { items: SystemAttention[]; onAct: (a: SystemAction) => void }): React.ReactElement {
  return (
    <section data-testid="nc-attention" className="wk-nc-attention" aria-labelledby="nc-attention-title">
      <h2 id="nc-attention-title" className="wk-nc-panel-title">Needs attention <span className="wk-nc-count">{items.length}</span></h2>
      <ul className="wk-nc-attention-list">
        {items.map((a) => (
          <li key={a.id} data-testid="nc-attention-item" data-id={a.id} data-level={a.level} data-panel={a.panel} className="wk-nc-attention-item">
            <span aria-hidden className="wk-nc-glyph" data-level={a.level}>{LEVEL_GLYPH[a.level]}</span>
            <div className="wk-nc-attention-body">
              <span className="wk-nc-attention-text">
                <span className="sr-only">{a.level === 'red' ? 'Blocking: ' : 'Needs a look: '}</span>{a.text}
              </span>
              {a.reason !== null && <span className="wk-nc-line">{a.reason}</span>}
              {a.remedy !== null && <span data-testid="nc-attention-remedy" className="wk-nc-line wk-nc-remedy">{a.remedy}</span>}
            </div>
            {a.action !== null && (
              <button type="button" data-testid="nc-attention-action" data-kind={a.action.kind} className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => onAct(a.action!)}>
                {a.action.label ?? ACTION_WORD[a.action.kind]}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Units per day as a tiny bar sparkline (oldest left). */
function Sparkline({ days }: { days: number[] }): React.ReactElement | null {
  if (days.length === 0) return null;
  const max = Math.max(1, ...days);
  const w = 6; const gap = 2; const h = 20;
  return (
    <svg data-testid="nc-cli-spark" role="img" aria-label={`Units per day, oldest first: ${days.join(', ')}`} width={days.length * (w + gap)} height={h} className="wk-nc-spark">
      {days.map((n, i) => {
        const bh = n === 0 ? 1 : Math.max(2, Math.round((n / max) * h));
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1} />;
      })}
    </svg>
  );
}

const CLI_STATE: Record<SystemCli['state'], { word: string; tone: 'ok' | 'warn' | 'fail' | 'dim' }> = {
  signed_in: { word: 'signed in', tone: 'ok' },
  signed_out: { word: 'signed out', tone: 'warn' },
  benched: { word: 'benched', tone: 'fail' },
  unknown: { word: 'not known', tone: 'dim' },
};

function CliCards({ clis, onSignIn }: { clis: SystemCli[]; onSignIn: (key: string) => void }): React.ReactElement {
  if (clis.length === 0) return <p className="wk-health-absent">Crew reports no CLIs.</p>;
  return (
    <ul className="wk-nc-cards">
      {clis.map((c) => {
        const st = CLI_STATE[c.state];
        const pin = c.versionPin;
        return (
          <li key={c.key} data-testid="nc-cli" data-cli={c.key} data-state={c.state} className="wk-nc-card">
            <div className="wk-nc-card-head">
              <span aria-hidden className="wk-nc-dot" data-tone={st.tone} />
              <span className="wk-nc-card-name">{c.name}</span>
              <span data-testid="nc-cli-state" className="wk-nc-card-state" data-tone={st.tone}>{st.word}</span>
            </div>
            {c.reason !== null && <p data-testid="nc-cli-reason" className="wk-nc-line wk-nc-why">{c.reason}{c.benchedUntil !== null ? ` — back ${clock(c.benchedUntil)}` : ''}</p>}
            {c.units === null && c.statsNote !== null && <p data-testid="nc-cli-statsnote" className="wk-nc-line">{c.statsNote}</p>}
            {/* The week in one dense line: the number first, its word after (scans as a row). */}
            <dl className="wk-nc-stats">
              <div><dd data-testid="nc-cli-units">{c.units ?? '—'}</dd><dt>units</dt></div>
              <div><dd data-testid="nc-cli-pass">{percent(c.passPct)}</dd><dt>pass</dt></div>
              <div><dd data-testid="nc-cli-median">{duration(c.medianMs)}</dd><dt>median</dt></div>
              <div><dd data-testid="nc-cli-429">{c.rateLimited ?? '—'}</dd><dt>429s</dt></div>
              <div><dd data-testid="nc-cli-fallbacks">{c.fallbacks ?? '—'}</dd><dt>fallbacks</dt></div>
              {c.tokens !== null && <div><dd data-testid="nc-cli-tokens">{c.tokens.toLocaleString()}</dd><dt>tokens</dt></div>}
            </dl>
            <div className="wk-nc-card-foot">
              <Sparkline days={c.perDay} />
              <span className="wk-nc-line wk-nc-facts">
                {[
                  c.version !== null ? <span key="v" data-testid="nc-cli-version">{c.version}</span> : null,
                  pin !== null ? (
                    <span key="p" data-testid="nc-cli-pin" data-matched={pin.matched === null ? 'unknown' : String(pin.matched)} title={pin.pinned !== null ? `pinned ${pin.pinned}${pin.observed !== null ? `, running ${pin.observed}` : ''}` : undefined}>
                      {pin.matched === true ? '✓ version pin' : pin.matched === false ? '✗ version pin' : '? version pin'}
                    </span>
                  ) : null,
                  c.governanceMode !== null ? <span key="g" data-testid="nc-cli-gov">{c.governanceMode}</span> : null,
                  c.sandbox !== null ? <span key="s" data-testid="nc-cli-sandbox">{c.sandbox}</span> : null,
                ].filter((x) => x !== null).flatMap((x, i) => (i === 0 ? [x] : [' · ', x]))}
              </span>
            </div>
            {c.lastError !== null && (
              <TechDetails data-testid="nc-cli-error" summary="Last error" text={c.lastError.at !== null ? `${new Date(c.lastError.at).toISOString()} — ${c.lastError.message}` : c.lastError.message} />
            )}
            {c.canSignIn && c.state !== 'signed_in' && (
              <button type="button" data-testid="nc-cli-signin" data-cli={c.key} className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => onSignIn(c.key)}>
                Sign in
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RunRows({ runs, now, navigate }: { runs: SystemRun[]; now: number; navigate: Navigate }): React.ReactElement {
  if (runs.length === 0) return <p data-testid="nc-runs-empty" className="wk-health-absent">No unfinished runs.</p>;
  return (
    <ol className="wk-nc-runs">
      {runsWorstFirst(runs).map((r) => {
        const atGate = r.atGate;
        const path = atGate ? gateOpenPath('', r.runId) : sessionPath(`run:${r.runId}`);
        return (
          <li key={r.runId} data-testid="nc-run" data-run-id={r.runId} data-liveness={r.liveness} className="wk-nc-run">
            <span data-testid="nc-run-liveness" className="wk-nc-liveness" data-liveness={r.liveness}>{LIVENESS_WORD[r.liveness]}</span>
            <div className="wk-nc-run-body">
              <span className="wk-nc-run-title" title={r.title}>{r.title}</span>
              <span className="wk-nc-line">
                {[r.phase, r.seat].filter((x): x is string => x !== null).join(' · ')}
                {r.lastEventAt !== null && <>{r.phase !== null || r.seat !== null ? ' · ' : ''}<span data-testid="nc-run-last">last event {relTime(r.lastEventAt, now)}</span></>}
              </span>
              {r.reason !== null && <span className="wk-nc-line wk-nc-why">{r.reason}</span>}
            </div>
            <a href={path} data-testid={atGate ? 'nc-run-gate' : 'nc-run-open'} className="wk-btn wk-btn--secondary wk-btn--sm"
              onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate(path); }}>
              {atGate ? 'Open gate' : 'Open'}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function InfraRows({ rows, onRecheck }: { rows: SystemInfra[]; onRecheck: () => void }): React.ReactElement {
  if (rows.length === 0) return <p className="wk-health-absent">Crew reports no components.</p>;
  return (
    <ul className="wk-nc-infra">
      {rows.map((r) => (
        <li key={r.key} data-testid="nc-infra" data-key={r.key} data-state={r.state} className="wk-nc-infra-row">
          <span aria-hidden className="wk-nc-glyph" data-state={r.state}>{STATE_GLYPH[r.state]}</span>
          <div className="wk-nc-infra-body">
            <span className="wk-nc-infra-name">{r.name} <span data-testid="nc-infra-state" className="wk-nc-infra-state" data-state={r.state}>{STATE_WORD[r.state]}{r.state === 'unknown' && r.timeoutMs !== null ? ` — no answer in ${duration(r.timeoutMs)}` : ''}</span></span>
            {r.reason !== null && <span className="wk-nc-line">{r.reason}</span>}
            {r.remedy !== null && r.state !== 'ok' && <span data-testid="nc-infra-remedy" className="wk-nc-line wk-nc-remedy">{r.remedy}</span>}
            {r.detail !== null && <TechDetails data-testid="nc-infra-detail" text={r.detail} />}
          </div>
          <button type="button" data-testid="nc-infra-recheck" data-key={r.key} className="wk-btn wk-btn--secondary wk-btn--sm" onClick={onRecheck} aria-label={`Re-check ${r.name}`}>
            Re-check
          </button>
        </li>
      ))}
    </ul>
  );
}

function GovernanceCards({ cards }: { cards: SystemGovernanceCard[] }): React.ReactElement {
  if (cards.length === 0) return <p className="wk-health-absent">Crew reports no governance cards.</p>;
  return (
    <ul className="wk-nc-govcards">
      {cards.map((g) => (
        <li key={g.key} data-testid="nc-gov" data-key={g.key} data-state={g.state} className="wk-nc-govcard">
          <span className="wk-nc-govcard-name">{g.name}</span>
          <span className="wk-nc-govcard-value" data-state={g.state}>
            <span aria-hidden className="wk-nc-glyph" data-state={g.state}>{STATE_GLYPH[g.state]}</span> {g.value}{g.key === 'qe_acceptance' && g.value !== 'not counted' ? '%' : ''}
          </span>
          {g.breakdown !== null && <span data-testid="nc-gov-breakdown" className="wk-nc-line">{g.breakdown}</span>}
          {g.detail !== null && <span className="wk-nc-line">{g.detail}</span>}
          {g.remedy !== null && g.state !== 'ok' && <span className="wk-nc-line wk-nc-remedy">{g.remedy}</span>}
        </li>
      ))}
    </ul>
  );
}
