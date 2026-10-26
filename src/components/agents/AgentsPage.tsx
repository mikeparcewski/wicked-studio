import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { api } from '../../api/client.js';
import { readErrorKind } from '../../api/errors.js';
import { getCachedRoster, setCachedRoster } from '../../store/rosterCache.js';
import { agentTiles, authOf, fixLabel, readyNote, type AgentRow, type Cell } from '../../board/agentsModel.js';
import { agentStatus, agentsSentence, agentWeekLine } from '../../board/calmAgents.js';
import { relTime } from '../../board/relTime.js';
import { AGENTS_PATH, type Navigate } from '../../hooks/useRoute.js';
import { StateBanner } from '../ui/StateBanner.js';
import { OverflowMenu } from '../ui/OverflowMenu.js';
import { TechDetails } from '../ui/TechDetails.js';
import { CalmButton, CalmEmpty, CalmFacts, CalmHead, CalmLoading, CalmRow, CalmRows, CalmSection, type CalmTone } from '../calm/Calm.js';
import { AgentModal } from './AgentModal.js';
import { useAgentLogin } from './agentLogin.js';
import { SetupPanel } from './SetupPanel.js';
import { useAgentRows } from './useAgentRows.js';

/**
 * THE AGENTS PAGE (`/agents`, DES-seats-page §3; the calm pages mockup, 2026-10-26): a title, one
 * sentence ("3 of 5 are ready to work"), and one row per AI agent — its name, this week's steps and
 * how many passed first time, and ONE status word (Ready / Out of quota, back at HH:MM / Not signed
 * in → Sign in). The seat's details (sign-in, how it is governed, version, account) open under the
 * row; the row itself opens the agent's modal (what is happening, sign in or out, new work) —
 * `?fix=<key>` opens it. Read-only; the reads are shared with the rail's Agents dot
 * (`store/agentsReads.ts`).
 */

export { AGENTS_PATH };
export const INSTALL_DOCS = 'https://github.com/mikeparcewski/wicked-crew#install--quickstart';
/** An unread sign-in is read again every this many ms, at most {@link UNKNOWN_REREADS} times in a row. */
export const UNKNOWN_REREAD_MS = 15_000;
export const UNKNOWN_REREADS = 8;

const TONE: Record<Cell['tone'], CalmTone> = { ok: 'ok', gate: 'gate', fail: 'fail', quiet: 'quiet' };

function cellWords(c: Cell): string {
  return `${c.word}${c.sub !== null ? ` · ${c.sub}` : ''}`;
}

/** The name's second line when there is no week to tell: the account kind, opt-in or left out of new work. */
function agentSub(row: AgentRow): string | null {
  const parts = [row.account, row.optIn ? 'opt-in' : row.picked ? null : 'not used for new work'].filter((x): x is string => x !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** One agent: its name, its week, its one status word; the seat's details open under it. */
function AgentLine({ r, open }: { r: AgentRow; open: (key: string) => void }): React.ReactElement {
  const status = agentStatus(r);
  const fix = fixLabel(r);
  const week = agentWeekLine(r);
  const sub = r.sign.word === 'Signed out' ? 'Not signed in' : week ?? agentSub(r);
  const notes = r.issues.filter((i) => i.severity === 'note').length;
  return (
    <CalmRow data-testid="agents-row" data={{ agent: r.key, ready: r.ready.word }}
      tone={status.move === 'signin' ? 'quiet' : TONE[status.tone]} title={r.name}
      sub={sub}
      meta={status.move === 'signin' ? undefined : <span data-testid="agents-status">{status.word}</span>} metaTone={TONE[status.tone]}
      onOpen={() => open(r.key)} openTestId="agents-open" openLabel={`Open ${r.name}: new work, sign-in and sign-out`}
      trailing={status.move === 'signin'
        ? <button type="button" data-testid="agents-fix" data-agent={r.key} data-tone={fix?.tone ?? 'fail'} className="wk-calm-btn wk-calm-btn--link"
            aria-label={`Sign in to ${r.name}`} onClick={() => open(r.key)}>Sign in</button>
        // A problem always shows; a warning only beside a ready word (a bench's word already says what is wrong).
        : fix !== null && (fix.tone === 'fail' || (fix.tone === 'gate' && status.tone === 'ok'))
          ? <button type="button" data-testid="agents-fix" data-agent={r.key} data-tone={fix.tone} className={`wk-calm-btn wk-calm-btn--link wk-agents-fixlink wk-agents-fixlink--${fix.tone}`}
              aria-label={`${fix.label} for ${r.name}: what is happening and how to fix it`} onClick={() => open(r.key)}>{fix.label}</button>
          : null}
      detailsLabel={`${r.name}: seat details`}
      details={(
        <>
          <CalmFacts data-testid="agents-details" facts={[
            { k: 'Ready for work', v: cellWords(r.ready), testId: 'agents-ready' },
            { k: 'Sign-in', v: cellWords(r.sign), testId: 'agents-sign' },
            { k: 'How it’s governed', v: cellWords(r.governed), testId: 'agents-governed' },
            { k: 'Version', v: cellWords(r.version), testId: 'agents-version' },
            ...(r.account !== null ? [{ k: 'Account', v: r.account }] : []),
            { k: 'New work', v: r.optIn ? 'Only when you pick it' : r.picked ? 'Used for new work' : 'Not used for new work' },
            { k: 'Reviews', v: r.reviews ? (r.alsoReviews ? 'Also reviews work' : 'Can review work') : 'Doesn’t review right now' },
            ...(fix !== null ? [{ k: 'To look at', v: `${fix.label}${notes > 0 && fix.tone !== 'quiet' ? ` · plus ${notes} ${notes === 1 ? 'note' : 'notes'}` : ''}` }] : []),
          ]} />
          <div className="wk-calm-row-acts">
            <CalmButton testId="agents-details-open" onClick={() => open(r.key)}>{`Open ${r.name}`}</CalmButton>
          </div>
        </>
      )} />
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

  // The page's moves, behind one quiet menu (the page itself has no primary action: its rows are the moves).
  const menu = (
    <OverflowMenu label="More for agents" data-testid="agents-more" items={[
      { id: 'check', label: retrying ? 'Checking…' : 'Check sign-ins now', testId: 'agents-check-all', onSelect: checkAll, disabled: retrying ? 'Checking now' : null },
      { id: 'add', label: 'Add an agent', testId: 'agents-add', onSelect: () => { window.open(INSTALL_DOCS, '_blank', 'noopener,noreferrer'); } },
      ...(setup ? [] : [{ id: 'setup', label: 'Setup guide', testId: 'agents-setup-guide', onSelect: () => navigate(join(basePath, 'setup=1')) }]),
    ]} />
  );

  let sentence: string;
  let body: React.ReactNode;
  if (rosterFailed && !v.hasRoster) {
    sentence = 'Studio couldn’t ask your agents just now.';
    body = kind === 'offline'
      ? (
        <>
          <StateBanner kind="offline" onRetry={retry} retrying={retrying} data-testid="agents-banner" />
          <p className="wk-calm-foot">So it can’t say which agents are ready. If this keeps happening, start studio’s service again on this computer, then Retry.</p>
          <TechDetails data-testid="agents-offline-how" summary="How to start studio’s service" text={['In a terminal: npx wicked-crew serve', 'Installed as a login service: wicked-crew serve --install-service starts it again.']} />
        </>
      )
      : (
        <>
          <StateBanner kind="error" what="agents" error={v.rosterError instanceof Error ? v.rosterError.message : null} onRetry={retry} retrying={retrying} data-testid="agents-banner" />
          <p className="wk-calm-foot">If it keeps failing, Health shows whether studio’s service is working.</p>
          <div><a href="/watch" className="wk-calm-btn wk-calm-btn--secondary" data-testid="agents-health-link" onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate('/watch'); }}>Open Nerve Center</a></div>
        </>
      );
  } else if (!v.hasRoster) {
    sentence = 'Asking each agent…';
    body = <CalmLoading data-testid="agents-loading" rows={5} label="Asking each agent" />;
  } else if (v.rows.length === 0) {
    sentence = agentsSentence(v.rows);
    body = (
      <CalmEmpty data-testid="agents-empty" title="No AI agents found on this computer."
        body={<p>Install one of Claude Code, Codex, Pi, GitHub Copilot CLI or opencode, then check again.</p>}
        action={<>
          <a href={INSTALL_DOCS} target="_blank" rel="noreferrer" className="wk-calm-btn wk-calm-btn--primary">How to install an agent</a>
          <CalmButton onClick={retry} disabled={retrying}>{retrying ? 'Checking…' : 'Check again'}</CalmButton>
        </>} />
    );
  } else {
    sentence = agentsSentence(v.rows);
    const missing = [v.diagState === 'failed' ? 'how often each agent has to start fresh' : null, v.recordState === 'failed' ? 'this week’s steps' : null].filter((x): x is string => x !== null);
    const qeShared = v.rows.every((r) => r.qe === null);
    const checked = v.readAt !== null ? relTime(v.readAt) : null;
    const t = agentTiles(v.rows);
    const others = [t.floorOnly > 0 ? `${t.floorOnly} on a sandbox floor only` : null, t.boundaryOnly > 0 ? `${t.boundaryOnly} on a repository boundary only` : null].filter((x): x is string => x !== null);
    body = (
      <>
        {rosterFailed && <StateBanner kind="stale" asOf={v.readAt} onRetry={retry} retrying={retrying} data-testid="agents-banner" />}
        {missing.length > 0 && <StateBanner kind="partial" what={missing.join(' and ')} data-testid="agents-partial" />}
        {setup && <SetupPanel rows={v.rows} open={open} navigate={navigate} />}
        <CalmSection label="Your agents" tools={menu} data-testid="agents-list-sec">
          <CalmRows data-testid="agents-list" label="Agents">
            {v.rows.map((r) => <AgentLine key={r.key} r={r} open={open} />)}
          </CalmRows>
        </CalmSection>
        {/* The numbers a person rarely needs, behind one quiet disclosure. */}
        <details className="wk-calm-disclose" data-testid="agents-tiles">
          <summary><ChevronDown size={16} aria-hidden className="wk-calm-chev" /> At a glance</summary>
          <div className="wk-calm-disclose-body">
            <CalmFacts facts={[
              { k: 'Ready for work', v: `${t.ready} / ${t.total} · ${readyNote(t)}`, testId: 'agents-tile-ready' },
              { k: 'Every action checked', v: `${t.everyAction}${others.length > 0 ? ` · ${others.join(', ')}` : t.everyAction === t.total ? ' · all of them' : ''}`, testId: 'agents-tile-checked' },
              { k: 'Things to fix', v: `${t.fixes}${t.notes > 0 ? ` · plus ${t.notes} ${t.notes === 1 ? 'note' : 'notes'}` : ''}`, testId: 'agents-tile-fix' },
            ]} />
            <p className="wk-calm-foot" data-testid="agents-foot">
              {v.settled && checked !== null ? `Refreshed ${checked}. ` : ''}{v.runsRead !== null ? `Steps count the last 7 days (${v.runsRead} ${v.runsRead === 1 ? 'job' : 'jobs'}). ` : ''}{qeShared ? 'Studio’s service doesn’t report yet which agents can run quality checks.' : ''}
            </p>
          </div>
        </details>
      </>
    );
  }

  return (
    <div data-testid="agents-panel" className="wk-agents-panel wk-calm-col">
      <CalmHead title="Agents" sentence={sentence} sentenceTestId="agents-sentence" action={v.hasRoster && v.rows.length > 0 ? undefined : null} />
      {body}
      {fix !== null && known && <AgentModal agentKey={fix} onClose={close} />}
    </div>
  );
}

/** The `/agents` page (and the Desk's Agents tab): the calm column around the panel. */
export function AgentsPage({ search, navigate }: { search: string; navigate: Navigate }): React.ReactElement {
  return (
    <div className="wk-calm" data-testid="agents-page">
      <AgentsPanel search={search} navigate={navigate} />
    </div>
  );
}
