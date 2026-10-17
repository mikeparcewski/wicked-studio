import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import { readErrorKind } from '../../api/errors.js';
import { getCachedRoster, setCachedRoster } from '../../store/rosterCache.js';
import { agentTiles, authOf, fixLabel, readyNote, type AgentRow, type Cell } from '../../board/agentsModel.js';
import { StatBand, StatTile } from '../ui/StatTile.js';
import { relTime } from '../../board/relTime.js';
import { AGENTS_PATH, type Navigate } from '../../hooks/useRoute.js';
import { usePhone } from '../../hooks/usePhone.js';
import { EmptyState, Skeleton, StateBanner } from '../ui/StateBanner.js';
import { PageFrame } from '../ui/PageFrame.js';
import { TechDetails } from '../ui/TechDetails.js';
import { AgentModal } from './AgentModal.js';
import { useAgentLogin } from './agentLogin.js';
import { SetupPanel } from './SetupPanel.js';
import { useAgentRows } from './useAgentRows.js';

/**
 * THE AGENTS PAGE (`/agents`, DES-seats-page §3): one row per AI agent — ready for work, its fixes,
 * sign-in, safety checks, what it can do, version and how it runs — and one modal per agent with
 * what is happening and what you can do (`?fix=<key>` opens it). Read-only; the reads are shared
 * with the rail's Agents dot (`store/agentsReads.ts`).
 */

export { AGENTS_PATH };
export const INSTALL_DOCS = 'https://github.com/mikeparcewski/wicked-crew#install--quickstart';
const PHONE_INTRO = 'Sign-in, safety checks and fixes for each AI agent.';
/** An unread sign-in is read again every this many ms, at most {@link UNKNOWN_REREADS} times in a row. */
export const UNKNOWN_REREAD_MS = 15_000;
export const UNKNOWN_REREADS = 8;
const INTRO = 'The AI coding tools studio gives work to: whether each is signed in, how its actions are checked, and what to do when one isn’t ready.';

function CellView({ c, testId }: { c: Cell; testId?: string }): React.ReactElement {
  return (
    <>
      <span data-testid={testId} className={`wk-agents-word wk-agents-word--${c.tone}`}>{c.word}</span>
      {c.sub !== null && <span className="wk-agents-sub">{c.sub}</span>}
    </>
  );
}

function FixButton({ row, onOpen, big = false }: { row: AgentRow; onOpen: () => void; big?: boolean }): React.ReactElement | null {
  const f = fixLabel(row);
  // Nothing to fix still opens the agent (codex r1): its modal is where new work, sign-in and sign-out live.
  const openIt = <button type="button" data-testid="agents-open" data-agent={row.key} onClick={onOpen} aria-label={`Open ${row.name}: new work, sign-in and sign-out`} className="wk-btn wk-btn--quiet wk-btn--sm">Open</button>;
  if (f === null) return big ? openIt : <span className="wk-agents-nothing-row"><span className="wk-agents-sub wk-agents-nothing">Nothing to fix</span>{openIt}</span>;
  const Icon = f.tone === 'fail' ? AlertCircle : f.tone === 'gate' ? AlertTriangle : Info;
  const label = f.label;
  return (
    <button type="button" data-testid="agents-fix" data-agent={row.key} data-tone={f.tone} onClick={onOpen}
      aria-label={`${f.label} for ${row.name}: what is happening and how to fix it`}
      className={`wk-agents-fix wk-agents-fix--${f.tone}${big ? ' wk-agents-fix--big' : ''}`}>
      <Icon aria-hidden size={14} />
      <span>{label}</span>
    </button>
  );
}

/** The name's second line: the account kind (crew A2), and opt-in or left out of new work. */
function agentSub(row: AgentRow): string | null {
  const parts = [row.account, row.optIn ? 'opt-in' : row.picked ? null : 'not used for new work'].filter((x): x is string => x !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The sign-in pill: one word, its tone; the sub (when it was checked) is the pill's title. */
function SignPill({ c }: { c: Cell }): React.ReactElement {
  return <span data-testid="agents-sign" title={c.sub ?? undefined} className={`wk-agents-pill wk-agents-pill--${c.tone}`}>{c.word}</span>;
}

function AgentName({ r }: { r: AgentRow }): React.ReactElement {
  const sub = agentSub(r);
  return (
    <span className="wk-agents-who">
      {/* The agent's colour (Desk v2's --agent-* tokens when present; accent otherwise). */}
      <span aria-hidden className="wk-agents-dot" style={{ background: `var(--agent-${r.key}, var(--accent))` }} />
      <span>
        <span className="wk-agents-name">{r.name}</span>
        {sub !== null && <span className="wk-agents-sub">{sub}</span>}
        {/* codex r3 P1: never beside "No reviews" — the fold note shows only while it can review. */}
        {r.alsoReviews && r.reviews && <span className="wk-agents-sub">also reviews work</span>}
      </span>
    </span>
  );
}

/** THE FOUR TILES (operator-approved concept, 2026-10-13): ready, every action checked, things to fix, and the moves. */
function Tiles({ rows, onCheck, checking, onSetup }: { rows: AgentRow[]; onCheck: () => void; checking: boolean; onSetup: (() => void) | null }): React.ReactElement {
  const t = agentTiles(rows);
  const others = [t.floorOnly > 0 ? `${t.floorOnly} on a sandbox floor only` : null, t.boundaryOnly > 0 ? `${t.boundaryOnly} on a repository boundary only` : null].filter((x): x is string => x !== null);
  return (
    <div className="wk-agents-tiles" data-testid="agents-tiles">
      {/* One band of tiles, one card with hairline dividers (UI-CONTRACT §4.6), beside the moves. */}
      <StatBand label="Agents at a glance" data-testid="agents-band">
        <StatTile data-testid="agents-tile-ready" label="Ready for work" value={`${t.ready} / ${t.total}`}
          note={readyNote(t)} />
        <StatTile data-testid="agents-tile-checked" label="Every action checked" value={t.everyAction}
          note={others.length > 0 ? others.join(', ') : t.everyAction === t.total ? 'all of them' : null} />
        <StatTile data-testid="agents-tile-fix" label="Things to fix" value={t.fixes}
          note={t.notes > 0 ? `plus ${t.notes} ${t.notes === 1 ? 'note' : 'notes'}` : null} />
      </StatBand>
      <div className="wk-card wk-agents-tile wk-agents-tile--moves">
        <button type="button" data-testid="agents-check-all" className="wk-btn wk-btn--primary" onClick={onCheck} disabled={checking}>{checking ? 'Checking…' : 'Check sign-ins now'}</button>
        <a href={INSTALL_DOCS} target="_blank" rel="noreferrer" data-testid="agents-add" className="wk-btn wk-btn--secondary">Add an agent</a>
        {onSetup !== null && <button type="button" data-testid="agents-setup-guide" className="wk-btn wk-btn--link wk-agents-setup-link" onClick={onSetup}>Setup guide</button>}
      </div>
    </div>
  );
}

/** Notes under a problem or warning button, so the tile's note count can be found row by row (codex HIER). */
function moreNotes(r: AgentRow): React.ReactElement | null {
  const n = r.issues.filter((i) => i.severity === 'note').length;
  return n > 0 && r.issues.some((i) => i.severity !== 'note') ? <span className="wk-agents-sub">{`+ ${n} ${n === 1 ? 'note' : 'notes'}`}</span> : null;
}

function Table({ rows, open }: { rows: AgentRow[]; open: (key: string) => void }): React.ReactElement {
  return (
    <div className="wk-card wk-agents-tablecard">
      <table className="wk-agents-table" data-testid="agents-table" aria-label="Agents">
        <colgroup>
          <col style={{ width: '26%' }} /><col style={{ width: '14%' }} /><col style={{ width: '19%' }} />
          <col style={{ width: '18%' }} /><col style={{ width: '10%' }} /><col style={{ width: '13%' }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Agent</th><th scope="col">Sign-in</th><th scope="col">Ready for work</th>
            <th scope="col">How it’s governed</th><th scope="col">Version</th><th scope="col">Fixes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-testid="agents-row" data-agent={r.key} data-ready={r.ready.word}>
              <td><AgentName r={r} /></td>
              <td><SignPill c={r.sign} /></td>
              <td><CellView c={r.ready} testId="agents-ready" /></td>
              <td><CellView c={r.governed} testId="agents-governed" /></td>
              <td><CellView c={r.version} testId="agents-version" /></td>
              <td><FixButton row={r} onOpen={() => open(r.key)} />{moreNotes(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cards({ rows, open }: { rows: AgentRow[]; open: (key: string) => void }): React.ReactElement {
  const line = (c: Cell): string => `${c.word}${c.sub !== null ? ` · ${c.sub}` : ''}`;
  return (
    <div className="wk-agents-cards" data-testid="agents-cards">
      {rows.map((r) => (
        <article key={r.key} data-testid="agents-row" data-agent={r.key} data-ready={r.ready.word} aria-label={r.name} className="wk-agents-card">
          <div className="wk-agents-card-top">
            <AgentName r={r} />
            <SignPill c={r.sign} />
          </div>
          <dl className="wk-agents-facts">
            <dt>For work</dt><dd>{line(r.ready)}</dd>
            <dt>Governed</dt><dd>{line(r.governed)}</dd>
            <dt>Version</dt><dd>{line(r.version)}</dd>
          </dl>
          <FixButton row={r} onOpen={() => open(r.key)} big />
        </article>
      ))}
    </div>
  );
}

/**
 * THE AGENTS PANEL — the page's contents with no page chrome of its own, so a host can mount it
 * (operator 2026-10-13: the Desk's "Agents" tab, hosted by studio-desk-v2). `basePath` is the
 * host's address for the panel (`/agents` standalone; the Desk tab's address when hosted): a fix
 * button opens `<basePath>…fix=<key>`, and closing the modal returns to `basePath`. "Check all again"
 * rides the panel's own toolbar, so the host needs no actions slot.
 */
export function AgentsPanel({ search, navigate, basePath = AGENTS_PATH }: {
  search: string; navigate: Navigate; basePath?: string;
}): React.ReactElement {
  const v = useAgentRows();
  const phone = usePhone();
  const [, tick] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => { void v.reload(); /* a fresh reading each time the page opens */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  // An agent whose sign-in studio's service has not read yet (its check is still running, or timed
  // out on a busy computer) is read again shortly, a bounded number of times, so the row turns into
  // the answer without a reload instead of staying "Unknown" while the service already knows.
  // Read from the rows on screen: a failed full re-read keeps its cached rows, and an Unknown among
  // them still recovers on its own (codex r2).
  const unread = v.hasRoster && v.settled && v.rows.some((r) => authOf(r.seat) === 'unknown');
  // Tries so far in this unread spell: every try counts (answered or failed), so a failed read never
  // stops the next one; an answer that reads everyone ends the spell.
  const [rereads, setRereads] = useState(0);
  useEffect(() => {
    if (!unread) { setRereads(0); return; }
    if (rereads >= UNKNOWN_REREADS) return;
    let live = true;
    const t = setTimeout(() => {
      // The roster alone (no diagnostics, no week record). Its answer is deposited only if no newer
      // roster landed while it was out (a sign-in check, another surface) and the panel is still here.
      const before = getCachedRoster();
      Promise.resolve()
        .then(() => api.getRoster())
        .then(({ roster }) => { if (live && Array.isArray(roster) && getCachedRoster() === before) setCachedRoster(roster); })
        .catch(() => { /* counted below; the next try follows */ })
        .finally(() => { if (live) setRereads((n) => n + 1); });
    }, UNKNOWN_REREAD_MS);
    return () => { live = false; clearTimeout(t); };
  }, [unread, rereads]);

  const params = new URLSearchParams(search);
  const fix = params.get('fix');
  // First use (§5.2): `?setup=1` shows the setup steps above the table; an agent's modal keeps them open behind it.
  const setup = params.get('setup') === '1';
  const join = (path: string, q: string): string => `${path}${path.includes('?') ? '&' : '?'}${q}`;
  const here = setup ? join(basePath, 'setup=1') : basePath;
  const withFix = (key: string): string => join(here, `fix=${encodeURIComponent(key)}`);
  const known = fix !== null && v.rows.some((r) => r.keys.includes(fix));
  // An unknown key lands on the page with no modal and no error (§2.2).
  useEffect(() => {
    if (fix !== null && v.rosterState === 'ok' && !known) navigate(here, { replace: true });
  }, [fix, known, v.rosterState, navigate, here]);
  const open = (key: string): void => navigate(withFix(key));
  const close = (): void => navigate(here, { replace: true });

  const retry = (): void => { setRetrying(true); void v.reload().finally(() => setRetrying(false)); };
  // "Check sign-ins now": every agent with a sign-in re-checks on the daemon at once (the login hook), then one full re-read.
  const login = useAgentLogin();
  const checkAll = (): void => {
    setRetrying(true);
    const keys = v.rows.filter((r) => r.sign.word !== 'No sign-in needed').map((r) => r.key);
    void Promise.allSettled(keys.map((k) => login.checkNow(k))).then(() => v.reload()).finally(() => setRetrying(false));
  };
  const rosterFailed = v.rosterState === 'failed';
  const kind = rosterFailed ? readErrorKind(v.rosterError) : null;

  let body: React.ReactNode;
  if (rosterFailed && !v.hasRoster) {
    body = kind === 'offline'
      ? (
        <>
          <StateBanner kind="offline" onRetry={retry} retrying={retrying} data-testid="agents-banner" />
          <p className="wk-agents-sub">So it can’t say which agents are ready. If this keeps happening, start studio’s service again on this computer, then Retry.</p>
          <TechDetails data-testid="agents-offline-how" summary="How to start studio’s service" text={['In a terminal: npx wicked-crew serve', 'Installed as a login service: wicked-crew serve --install-service starts it again.']} />
        </>
      )
      : (
        <>
          <StateBanner kind="error" what="agents" error={v.rosterError instanceof Error ? v.rosterError.message : null} onRetry={retry} retrying={retrying} data-testid="agents-banner" />
          <p className="wk-agents-sub">If it keeps failing, Health shows whether studio’s service is working.</p>
          <div><a href="/health" className="wk-btn wk-btn--secondary wk-agents-door" data-testid="agents-health-link" onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate('/health'); }}>Open Health</a></div>
        </>
      );
  } else if (!v.hasRoster) {
    body = (
      <div className="wk-card" data-testid="agents-loading">
        <Skeleton rows={5} variant="row" />
        <p className="wk-agents-sub">Asking each agent…</p>
      </div>
    );
  } else if (v.rows.length === 0) {
    body = (
      <div className="wk-card">
        <EmptyState data-testid="agents-empty" title="No AI agents found on this computer."
          body="Install one of Claude Code, Codex, Pi, GitHub Copilot CLI or opencode, then check again."
          action={<>
            <a href={INSTALL_DOCS} target="_blank" rel="noreferrer" className="wk-btn wk-btn--primary">How to install an agent</a>
            <button type="button" className="wk-btn wk-btn--secondary" onClick={retry} disabled={retrying}>{retrying ? 'Checking…' : 'Check again'}</button>
          </>} />
      </div>
    );
  } else {
    const missing = [v.diagState === 'failed' ? 'how often each agent has to start fresh' : null, v.recordState === 'failed' ? 'this week’s steps' : null].filter((x): x is string => x !== null);
    const qeShared = v.rows.every((r) => r.qe === null);
    const checked = v.readAt !== null ? relTime(v.readAt) : null;
    body = (
      <>
        {rosterFailed && <StateBanner kind="stale" asOf={v.readAt} onRetry={retry} retrying={retrying} data-testid="agents-banner" />}
        {/* No second Retry: "Check sign-ins now" re-reads everything (codex r8 AFF). */}
        {missing.length > 0 && <StateBanner kind="partial" what={missing.join(' and ')} data-testid="agents-partial" />}
        {setup && <SetupPanel rows={v.rows} open={open} navigate={navigate} />}
        <Tiles rows={v.rows} onCheck={checkAll} checking={retrying} onSetup={setup ? null : () => navigate(join(basePath, 'setup=1'))} />
        {phone ? <Cards rows={v.rows} open={open} /> : <Table rows={v.rows} open={open} />}
        <p className="wk-agents-foot" data-testid="agents-foot">
          {v.settled && checked !== null ? `Refreshed ${checked}. ` : ''}{v.runsRead !== null ? `Steps count the last 7 days (${v.runsRead} ${v.runsRead === 1 ? 'job' : 'jobs'}). ` : ''}{qeShared ? 'Studio’s service doesn’t report yet which agents can run quality checks.' : ''}
        </p>
      </>
    );
  }

  return (
    <div data-testid="agents-panel" className="wk-agents-panel">
      {body}
      {fix !== null && known && <AgentModal agentKey={fix} onClose={close} />}
    </div>
  );
}

/** The standalone `/agents` page: PageFrame chrome around the panel (until the Desk tab hosts it). */
export function AgentsPage({ search, navigate }: { search: string; navigate: Navigate }): React.ReactElement {
  const phone = usePhone();
  return (
    <div className="flex-1 overflow-y-auto">
      <PageFrame title="Agents" intro={phone ? PHONE_INTRO : INTRO} data-testid="agents-page">
        <AgentsPanel search={search} navigate={navigate} />
      </PageFrame>
    </div>
  );
}

