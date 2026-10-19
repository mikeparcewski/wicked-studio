import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { issueCopy, SEVERITY_WORD, type CopyCommand } from '../../board/agentsCopy.js';
import { authOf, commandDisplay, countWords, rowForKey, type AgentIssue, type AgentRow } from '../../board/agentsModel.js';
import { hookOffers, SignInNotCompleted, useAgentLogin, useAuthOps } from './agentLogin.js';
import { holdInert, useLoginCover } from './inertHold.js';
import type { RosterSeat } from '../../api/types.js';
import { getCachedRoster, setCachedRoster } from '../../store/rosterCache.js';

import { useModalEscape } from '../Modal.js';
import { Skeleton } from '../ui/StateBanner.js';
import { TechDetails } from '../ui/TechDetails.js';
import { setPickedForNewWork, useAgentRows } from './useAgentRows.js';
import { api } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import { homeDirsIn } from '../../board/homePath.js';
import { useViewPrefsStore } from '../../store/viewPrefs.js';
import { Switch } from '../ui/Switch.js';
import { Terminal } from '../Terminal.js';

/**
 * Deposit ONE agent's fresh reading into the shared roster (codex S4 r12): a re-check answers for the agent
 * it asked about, so a late answer can never overwrite another agent's newer reading. The next full read
 * refreshes everything else.
 */
function depositSeat(fresh: readonly RosterSeat[], key: string): void {
  const cur = getCachedRoster();
  const mine = fresh.find((s) => s.key === key);
  if (cur === null) { setCachedRoster([...fresh]); return; }
  // The agent left the roster: drop just that one (codex S4 r13); every other seat keeps its own reading.
  if (mine === undefined) { setCachedRoster(cur.filter((s) => s.key !== key)); return; }
  setCachedRoster(cur.some((s) => s.key === key) ? cur.map((s) => (s.key === key ? mine : s)) : [...cur, mine]);
}

/**
 * ONE MODAL PER AGENT (DES-seats-page §4): what is happening, why it matters and what you can do,
 * one card per issue, most important first. It replaces the old sign-in panel everywhere it was
 * mounted (the Desk's sign-in chore, the helper sheet, Health, Configuration, the Agents page).
 *
 * Sign-in "while authenticating" (§4.2): the user signs in (today: copies the command into their own
 * terminal; with the login container, the hook's Sign in button), then "I've signed in: check again"
 * asks the daemon to re-run that agent's check and waits for it (`GET /roster?refresh=<key>`, A3b),
 * and the issues re-derive from that fresh reading. Studio never handles credentials.
 * Sign in / Check now / Sign out go through `useAgentLogin()` (agentLogin.tsx), the container lane's seam.
 */

/** The client's own bound on one check (the daemon waits at most 20 s; a supplied hook may not). */
export const CHECK_DEADLINE_MS = 30_000;

type Outcome =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'in' }
  | { kind: 'free' }
  | { kind: 'still' }
  | { kind: 'failed' }
  | { kind: 'status-only' }
  | { kind: 'container-in' }
  | { kind: 'cant-confirm' }
  | { kind: 'couldnt' }
  | { kind: 'not-rechecked' }
  | { kind: 'signout-failed' }
  | { kind: 'signin-failed' }
  | { kind: 'signin-refused'; detail: string }
  | { kind: 'signing-in' }
  | { kind: 'signin-checking' }
  | { kind: 'out-done' };

const OUTCOME_WORDS: Record<Exclude<Outcome['kind'], 'idle'>, (name: string, detail: string) => { lead: string; tone: 'ok' | 'fail' | 'quiet'; line: string | null }> = {
  checking: (n) => ({ lead: `Checking ${n}’s sign-in…`, tone: 'quiet', line: 'This can take up to 20 seconds.' }),
  in: (n) => ({ lead: `The sign-in worked, and ${n} answered a request.`, tone: 'ok', line: 'Its row is updated everywhere. You can close this.' }),
  free: (n) => ({ lead: `${n} needs no sign-in.`, tone: 'ok', line: null }),
  still: () => ({ lead: 'Still signed out.', tone: 'fail', line: 'Finish the sign-in, then check again.' }),
  failed: () => ({ lead: 'The sign-in worked. One thing still stops it, below.', tone: 'ok', line: null }),
  'container-in': (n) => ({ lead: `${n} is signed in.`, tone: 'ok', line: 'Studio’s service keeps the sign-in; its first step confirms it with a request.' }),
  'status-only': (n) => ({ lead: `${n}’s own check says it is signed in.`, tone: 'ok', line: 'Studio couldn’t confirm it with a request yet; its first step will.' }),
  'cant-confirm': () => ({ lead: 'Looks signed in.', tone: 'quiet', line: 'It has no way to confirm; its first step will.' }),
  couldnt: () => ({ lead: 'Couldn’t check just now.', tone: 'fail', line: 'Nothing changed; try again.' }),
  'not-rechecked': () => ({ lead: 'Studio’s service is still checking.', tone: 'quiet', line: 'Your sign-in may still have worked; check again in a minute.' }),
  'signout-failed': (n) => ({ lead: `Couldn’t sign ${n} out.`, tone: 'fail', line: 'Nothing changed; try again.' }),
  'signin-failed': (n) => ({ lead: `Couldn’t open ${n}’s sign-in.`, tone: 'fail', line: 'Try again.' }),
  // The login window closed but studio's service refused that sign-in: its reason, as it said it. The lead never
  // asserts the agent's standing: a refused re-sign-in leaves an earlier working sign-in in place.
  'signin-refused': (n, detail) => ({ lead: `The ${n} sign-in didn’t finish.`, tone: 'fail', line: detail }),
  'out-done': (n) => ({ lead: `${n} is signed out.`, tone: 'ok', line: 'Sign it in again whenever you want it back.' }),
  'signing-in': (n) => ({ lead: `Finish signing in to ${n} in the window that opened.`, tone: 'quiet', line: 'Studio checks it as soon as that window closes.' }),
  // The window closed and studio's service is checking what it left (its ingest, then the re-check): nothing to type.
  'signin-checking': (n) => ({ lead: `Checking the sign-in with ${n}…`, tone: 'quiet', line: 'This can take up to a minute. There is nothing more to type.' }),
};

/** What one fresh reading of the agent says, as the modal's result line (one mapping for every check). */
function outcomeOf(fresh: readonly RosterSeat[], key: string, answer: 'probed' | 'timed_out' | 'not_probed' | null, after: 'sign-out' | null): Outcome {
  const mine = fresh.find((s) => s.key === key);
  if (mine === undefined || answer === 'timed_out') return { kind: 'not-rechecked' };
  const auth = authOf(mine);
  const check = (mine as Record<string, unknown>)['login_check'];
  if (auth === 'not_required') return { kind: 'free' };
  // After a sign-out, signed out is the success (codex S4 r10), not "still signed out".
  if (auth === 'signed_out') return { kind: after === 'sign-out' ? 'out-done' : 'still' };
  // "It answered a request" only from THIS check's fresh answer (codex S4 r1): an old reading proves nothing new.
  if (auth === 'signed_in' && check === 'live' && answer === 'probed') return { kind: mine.council_eligible === false || mine.recent_bench !== undefined ? 'failed' : 'in' };
  // A container sign-in (crew#1006): the reading is crew's credential broker's, not the CLI's own check.
  if (auth === 'signed_in' && mine.sign_in === 'container' && answer === 'probed') {
    return { kind: mine.council_eligible === false || mine.recent_bench !== undefined ? 'failed' : 'container-in' };
  }
  if (auth === 'signed_in' && check === 'status' && answer === 'probed') return { kind: 'status-only' };
  // An agent with no status command (pi, copilot) is never re-probed: the answer is the reading.
  if (auth === 'signed_in') return { kind: 'cant-confirm' };
  return { kind: 'not-rechecked' };
}

function SeverityIcon({ issue }: { issue: AgentIssue }): React.ReactElement {
  const Icon = issue.severity === 'problem' ? AlertCircle : issue.severity === 'warning' ? AlertTriangle : Info;
  return <Icon aria-hidden size={16} className={`wk-agents-sev-icon wk-agents-sev--${issue.severity}`} />;
}

function Command({ c }: { c: CopyCommand }): React.ReactElement {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current !== null) clearTimeout(timer.current); }; }, []);
  const copy = (): void => {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    const flash = (s: 'copied' | 'failed'): void => {
      if (!mounted.current) return;
      setState(s);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2000);
    };
    if (clip === undefined || typeof clip.writeText !== 'function') { flash('failed'); return; }
    clip.writeText(c.line).then(() => flash('copied'), () => flash('failed'));
  };
  // One line that scrolls sideways (codex r9 WRAP): a command never breaks mid-path or mid-flag (§8),
  // and the characters stay the real ones, so a hand-selected copy still runs.
  return (
    <div className="wk-agents-cmd">
      <code data-testid="agents-command">{c.display}</code>
      <button type="button" data-testid="agents-copy" data-command-kind={c.label} data-state={state} onClick={copy}
        aria-label={`Copy the ${c.label} command`} className="wk-btn wk-btn--secondary wk-agents-copy">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
    </div>
  );
}

export function AgentModal({ agentKey, onClose, intent }: {
  agentKey: string;
  onClose: () => void;
  /** `sign-in`: the caller asked to sign this agent in again (Configuration's Re-authenticate), so the
   *  modal offers the command even when the agent reads signed in. */
  intent?: 'sign-in';
}): React.ReactElement | null {
  const titleId = useId();
  const { rows, rosterState } = useAgentRows();
  const row: AgentRow | undefined = rowForKey(rows, agentKey);
  const [ownOutcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const live = useRef(true);
  const dialog = useRef<HTMLDivElement | null>(null);
  useModalEscape(onClose);
  // Inert while the container login window covers it, however it got there (codex r6).
  const covered = useLoginCover((c) => c.open);
  const scrim = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!covered) return undefined;
    const release = holdInert(scrim.current);
    return () => {
      release();
      // Focus comes back here only now that this modal is no longer inert (codex r7): the trigger the login
      // window was opened from when it can take focus, else the dialog itself.
      const a = document.activeElement;
      if (a !== null && a !== document.body && a.isConnected) return;
      const to = useLoginCover.getState().returnTo;
      if (to !== null && to.isConnected && dialog.current?.contains(to) === true && !to.matches(':disabled')) to.focus();
      else dialog.current?.focus();
    };
  }, [covered]);

  useEffect(() => {
    live.current = true;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Mounted under an open login window (codex r6): focus stays in that window.
    if (!useLoginCover.getState().open) dialog.current?.focus();
    // aria-modal for real (codex PR r2 P1): the app behind is inert while the modal is open.
    // Held, not owned: the container login window over this modal holds it too (inertHold.ts).
    const release = holdInert(document.getElementById('root'));
    return () => {
      live.current = false;
      release();
      back?.focus?.();
    };
  }, []);

  /** Tab and Shift+Tab stay inside the dialog. */
  const trapTab = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab' || dialog.current === null) return;
    const f = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (f.length === 0) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  // One check at a time, tied to this agent (codex PR r1): a new agent, a new click or closing retires the old one.
  const login = useAgentLogin();
  const gen = useRef(0);
  /** The one deadline of the check in flight (a supplied hook has no daemon bound of its own, codex S4 r4). */
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDeadline = (): void => { if (deadline.current !== null) { clearTimeout(deadline.current); deadline.current = null; } };
  /**
   * ONE AUTH OPERATION AT A TIME (codex S4 r4–r7): a sign-in or a sign-out through the hooks holds every
   * other control (check, sign in, sign out) until it settles; it is never given up on a timer, because a
   * late sign-out could then undo a newer sign-in. The lock is per agent and outlives the modal (useAuthOps).
   */
  const busy = useAuthOps((o) => o.pending[agentKey] ?? null);
  /** This agent's sign-in is being checked (its window closed): a modal opened meanwhile shows it too. */
  const sharedChecking = useAuthOps((o) => o.checking[agentKey] === true);
  const outcome: Outcome = ownOutcome.kind === 'idle' && sharedChecking ? { kind: 'signin-checking' } : ownOutcome;
  /** Bumped per auth operation and per agent: an answer from a retired one is ignored. */
  const outGen = useRef(0);
  useEffect(() => { gen.current += 1; outGen.current += 1; clearDeadline(); checking.current = false; setOutcome({ kind: 'idle' }); }, [agentKey]);
  useEffect(() => () => clearDeadline(), []);

  /** Sign out run here (crew#615 `POST /seats/:cli/logout`, moved from General settings 2026-10-16): the terminal
   *  is open, or the daemon answered 404 (no documented logout for this agent) and the offer is gone. */
  const [logoutRun, setLogoutRun] = useState(false);
  const [noLogout, setNoLogout] = useState(false);
  useEffect(() => { setLogoutRun(false); setNoLogout(false); }, [agentKey]);
  const techDetails = useViewPrefsStore((s) => s.prefs.technical_details);
  /** Which button asked: a card's check block, or the footer's Check now (its result shows beside it). */
  const [from, setFrom] = useState<'card' | 'foot'>('card');
  /** A check in flight, read synchronously (a retired check frees it at once, codex S4 r8). */
  const checking = useRef(false);
  const checkAgain = (origin: 'card' | 'foot' = 'card'): void => {
    if (checking.current || useAuthOps.getState().pending[row?.key ?? agentKey] !== undefined) return;
    setFrom(origin);
    const key = row?.key ?? agentKey;
    const mineGen = ++gen.current;
    const current = (): boolean => live.current && gen.current === mineGen;
    setOutcome({ kind: 'checking' });
    checking.current = true;
    clearDeadline();
    // Past CHECK_DEADLINE_MS nothing a late answer says is taken, and Check now is free again.
    deadline.current = setTimeout(() => { if (current()) { gen.current += 1; checking.current = false; setOutcome({ kind: 'not-rechecked' }); } }, CHECK_DEADLINE_MS);
    Promise.resolve()
      .then(() => login.checkNow(key))
      .then(({ roster, outcome: answer }) => {
        if (!current()) return;
        clearDeadline();
        checking.current = false;
        depositSeat(roster, key);
        setOutcome(outcomeOf(roster, key, answer, null));
      }, () => { if (current()) { clearDeadline(); checking.current = false; setOutcome({ kind: 'couldnt' }); } });
  };

  /** Run one sign-in or sign-out hook; a throw and a rejection both say so (codex S4 r5, r6). */
  const runAuth = (kind: 'in' | 'out', key: string): void => {
    const hook = kind === 'in' ? login.signIn : login.signOut;
    if (hook === undefined || !hookOffers(login, kind, row?.seat) || !useAuthOps.getState().begin(key, kind)) return;
    gen.current += 1; clearDeadline(); checking.current = false; // a check in flight is stale now
    const mine = ++outGen.current;
    const current = (): boolean => live.current && outGen.current === mine;
    setFrom(kind === 'in' ? 'card' : 'foot');
    setOutcome(kind === 'in' ? { kind: 'signing-in' } : { kind: 'idle' });
    /** The sign-in window closed and studio's service is checking it: that state holds until the answer. */
    let checkingIn = false;
    const onChecking = (): void => {
      checkingIn = true;
      useAuthOps.getState().markChecking(key);
      if (current()) { setFrom('card'); setOutcome({ kind: 'signin-checking' }); }
    };
    let pending: void | Promise<void>;
    try { pending = kind === 'in' ? login.signIn?.(key, onChecking) : hook(key); } catch (e) { pending = Promise.reject(e); }
    const end = (): void => useAuthOps.getState().end(key);
    // After the hook: ONE bounded re-check of the agent that deposits its row whether or not this modal is
    // still open, with the agent's lock held until it lands, so nothing newer can be overwritten by it and
    // no surface keeps the old sign-in (codex S4 r8, r10, r11, r14). The result line only if still current.
    const refresh = (): void => {
      if (current() && !checkingIn) { setFrom(kind === 'in' ? 'card' : 'foot'); setOutcome({ kind: 'checking' }); }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), CHECK_DEADLINE_MS); });
      Promise.race([Promise.resolve().then(() => login.checkNow(key)), late])
        .then(({ roster, outcome: answer }) => {
          depositSeat(roster, key);
          if (current()) setOutcome(outcomeOf(roster, key, answer, kind === 'out' ? 'sign-out' : null));
        }, () => { if (current()) setOutcome({ kind: 'not-rechecked' }); })
        .finally(() => { clearTimeout(timer); end(); });
    };
    Promise.resolve(pending).then(refresh, (err: unknown) => {
      end();
      if (!current()) return;
      setOutcome(kind === 'in' && err instanceof SignInNotCompleted ? { kind: 'signin-refused', detail: err.detail }
        : { kind: kind === 'in' ? 'signin-failed' : 'signout-failed' });
    });
  };

  // The agent left the roster: close (and unmount, so the background stops being inert), codex PR r3 P1.
  const gone = row === undefined && rosterState === 'ok';
  useEffect(() => { if (gone) onClose(); }, [gone, onClose]);

  // The hooks' buttons, for the agents they handle (the container hooks: only crew's container seats).
  const hookSignIn = hookOffers(login, 'in', row?.seat);
  const hookSignOut = hookOffers(login, 'out', row?.seat);
  const now = Date.now();
  const cards = useMemo(() => (row === undefined ? [] : row.issues.map((i) => ({ issue: i, copy: issueCopy(i, row, rows, now, hookSignIn) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [row, rows, hookSignIn]);

  if (row === undefined && rosterState === 'ok') return null; // the effect above closes it
  const name = row?.name ?? '';
  const result = outcome.kind === 'idle' ? null : OUTCOME_WORDS[outcome.kind](name, outcome.kind === 'signin-refused' ? outcome.detail : '');
  const resultLine = result === null ? null : (
    <div data-testid="agents-check-result" data-state={outcome.kind} role="status" className="wk-agents-result">
      <span className={`wk-agents-word wk-agents-word--${result.tone}`}>
        {outcome.kind === 'signin-checking' && <span className="wk-agents-spinner" data-testid="agents-check-spinner" aria-hidden="true" />}
        {result.lead}
      </span>
      {result.line !== null && <span>{result.line}</span>}
    </div>
  );
  // Once the fresh reading clears the sign-in card, its result line moves to the top of the modal.
  const settledOutcome = from === 'card' && outcome.kind !== 'idle' && row !== undefined && !row.issues.some((i) => i.code === 'signed_out' || i.code === 'live_check_failed');
  // A card carries its own check block; then the footer has none (Check now lives in one place at a time).
  const cardChecks = row !== undefined && (cards.some(({ copy }) => copy.fix.some((f) => f.check === true))
    || (intent === 'sign-in' && !row.issues.some((i) => i.code === 'signed_out') && (row.login !== null || hookSignIn)));
  // The result line's one place: the top once its own block is gone (a card that cleared, or a footer check that found a card).
  const topResult = (from === 'card' && settledOutcome) || (from === 'foot' && cardChecks && outcome.kind !== 'idle');
  const signInButton = hookSignIn && row !== undefined ? (
    <div><button type="button" data-testid="agents-signin" className="wk-btn wk-btn--primary" disabled={busy !== null} onClick={() => runAuth('in', row.key)}>{`Sign in to ${name}`}</button></div>
  ) : null;
  const checkBlock = (
    <div className="wk-agents-check" data-testid="agents-check-block">
      <div className="wk-agents-check-row">
        <button type="button" data-testid="agents-check" onClick={() => checkAgain('card')} disabled={outcome.kind === 'checking' || busy !== null} aria-busy={outcome.kind === 'checking'} className="wk-btn wk-btn--primary">
          I’ve signed in: check again
        </button>
        <span className="wk-agents-check-hint">{hookSignIn ? `After you sign in, this reads ${name}’s sign-in from studio’s service.` : `After you sign in, this asks ${name} and sends one short request.`}</span>
      </div>
      {from === 'card' && !settledOutcome && resultLine}
    </div>
  );

  return createPortal(
    <div ref={scrim} className="wk-agents-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialog} tabIndex={-1} onKeyDown={trapTab} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="agents-modal" data-agent={agentKey} className="wk-agents-modal">
        <div className="wk-agents-modal-head">
          <h2 id={titleId} className="wk-agents-modal-title">{name}</h2>
          <button type="button" data-testid="agents-modal-close" aria-label="Close" title="Close" onClick={onClose} className="wk-btn wk-btn--secondary wk-btn--icon wk-agents-close">✕</button>
        </div>
        <div className="wk-agents-modal-body">
          {row === undefined ? <Skeleton rows={3} variant="card" /> : (
            <>
              {topResult && <div className="wk-agents-check">{resultLine}</div>}
              {cards.length !== 1 && <p className="wk-agents-count" data-testid="agents-modal-count">{countWords(row)}</p>}
              {cards.length === 0 && intent !== 'sign-in' && <p className="wk-agents-none">{`${name} is ready. Nothing needs doing.`}</p>}
              {intent === 'sign-in' && !row.issues.some((i) => i.code === 'signed_out') && (
                <section data-testid="agents-issue" data-code="sign_in_again" aria-label="Sign in again" className="wk-agents-issue wk-agents-issue--note">
                  <div className="wk-agents-issue-title"><span>Sign in again</span></div>
                  {signInButton}
                  {signInButton !== null ? checkBlock : row.login !== null ? (
                    <>
                      <p>{`Run this in your terminal, then follow ${name}’s own sign-in steps.`}</p>
                      <Command c={{ line: row.login, display: commandDisplay(row.login), label: 'sign-in' }} />
                      <span className="wk-agents-safe">Studio never sees your password or token: the sign-in happens between your terminal and the provider.</span>
                      {checkBlock}
                    </>
                  ) : signInButton === null ? <p>{`Studio’s service sent no sign-in command for ${name}. Sign in the way its maker documents.`}</p> : null}
                </section>
              )}
              {cards.map(({ issue, copy }) => (
                <section key={issue.code} id={`${titleId}-${issue.code}`} data-testid="agents-issue" data-code={issue.code} data-severity={issue.severity} aria-label={copy.title} className={`wk-agents-issue wk-agents-issue--${issue.severity}`}>
                  <div className="wk-agents-issue-title">
                    <SeverityIcon issue={issue} />
                    <span className={`wk-agents-sev wk-agents-sev--${issue.severity}`}>{SEVERITY_WORD[issue.severity]}</span>{' '}
                    {copy.title}
                  </div>
                  <h3 className="wk-agents-h">What’s happening</h3>
                  <p>{copy.what}</p>
                  <h3 className="wk-agents-h">Why it matters</h3>
                  <p>{copy.why}</p>
                  <h3 className="wk-agents-h">What you can do</h3>
                  <ul className="wk-agents-fixes">
                    {copy.fix.map((f, i) => (
                      <li key={i}>
                        <b>{f.lead}</b>{f.text !== '' ? ` ${f.text}` : ''}
                        {/* The container sign-in replaces the terminal step (the login hooks), so its command and note go. */}
                        {f.signIn === true && signInButton}
                        {!(f.signIn === true && signInButton !== null) && f.commands.map((c) => <Command key={c.label} c={c} />)}
                        {f.check === true && checkBlock}
                        {f.note !== null && !(f.signIn === true && signInButton !== null) && <span className="wk-agents-safe">{f.note}</span>}
                        {f.sub !== undefined && (() => {
                          const list = (
                            <ol className="wk-agents-fixes wk-agents-fixes--sub">
                              {f.sub.map((g, k) => (
                                <li key={k}><b>{g.lead}</b>{g.text !== '' ? ` ${g.text}` : ''}{g.signIn === true && signInButton}{!(g.signIn === true && signInButton !== null) && g.commands.map((c) => <Command key={c.label} c={c} />)}
                                  {g.tech !== undefined && <TechDetails data-testid="agents-tech" summary={g.tech.summary} text={g.tech.text} />}</li>
                              ))}
                            </ol>
                          );
                          return f.subLabel === undefined ? list : (
                            <details className="wk-tech-details wk-agents-steps" data-testid="agents-steps"><summary className="wk-tech-details-summary">{f.subLabel}</summary>{list}</details>
                          );
                        })()}
                      </li>
                    ))}
                  </ul>
                  {copy.tech !== null && <TechDetails data-testid="agents-tech" text={copy.tech} {...(copy.techSummary !== undefined ? { summary: copy.techSummary } : {})} />}
                </section>
              ))}
              {/* New work (moved from General settings, operator 2026-10-16): whether this agent is picked for new
                  chats and jobs by default, and its free tier when it has one. */}
              <section data-testid="agents-new-work" aria-label="New work" className="wk-agents-new-work">
                <Switch label={`Use ${name} for new work`} data-testid="agents-new-work-toggle" checked={row.picked}
                  onChange={(on) => setPickedForNewWork(rows, row.key, on)}
                  hint={row.picked ? 'Picked for new chats and jobs. You can still change the helpers on each one.' : 'Not picked for new chats and jobs. You can still add it to one.'} />
                {typeof row.seat.free_tier === 'string' && row.seat.free_tier !== '' && <p data-testid="agents-free-tier" className="wk-field-note">{row.seat.free_tier}</p>}
                {/* Free without an account, but a provider account is still an option (General offered it). */}
                {authOf(row.seat) === 'not_required' && row.login !== null && (
                  <details className="wk-tech-details" data-testid="agents-optional-signin">
                    <summary className="wk-tech-details-summary">{`Sign ${name} in to a provider account (optional)`}</summary>
                    <p>{`Run this in your terminal, then Check now:`}</p>
                    <Command c={{ line: row.login, display: commandDisplay(row.login), label: 'sign-in' }} />
                  </details>
                )}
              </section>
            </>
          )}
        </div>
        {row !== undefined && (() => {
          // Check now and Sign out for every agent (the login hooks); the check block inside a card wins.
          // A seat that needs no sign-in may still hold a provider account it can sign out of (codex r1).
          const signedIn = row.sign.word === 'Signed in' || row.sign.word === 'Looks signed in' || authOf(row.seat) === 'not_required';
          const signOut = !signedIn ? null : hookSignOut
            // Signing out retires a check still in flight, so its older answer can't land after it (codex S4 r3).
            ? <button type="button" data-testid="agents-signout" className="wk-btn wk-btn--quiet" disabled={busy !== null} aria-busy={busy === 'out'} onClick={() => runAuth('out', row.key)}>{busy === 'out' ? 'Signing out…' : `Sign ${name} out`}</button>
            : row.logout !== null ? (
              <details className="wk-tech-details wk-agents-signout" data-testid="agents-signout-how">
                <summary className="wk-tech-details-summary">Sign out</summary>
                <p>{`Run this in your terminal to sign ${name} out:`}</p>
                <Command c={{ line: row.logout, display: commandDisplay(row.logout), label: 'sign-out' }} />
                {/* Or here: studio's service runs the agent's own sign-out command in a terminal (crew#615); studio types nothing. */}
                {!noLogout && !logoutRun && <button type="button" data-testid="agents-signout-run" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => setLogoutRun(true)}>{`Sign ${name} out here`}</button>}
                {logoutRun && (
                  <div data-testid="agents-signout-terminal" className="wk-agents-signout-term">
                    <p className="wk-field-note">Complete any prompt below, then check again.</p>
                    <Terminal key={row.key} cwd="." open={(cols, rowsN) => api.seatLogout(row.key, { cols, rows: rowsN }).then((r) => ({ id: r.terminalId }))}
                      onOpenError={(err) => { if (err instanceof ApiError && err.status === 404) { setNoLogout(true); setLogoutRun(false); } }}
                      concealHome={techDetails ? [] : homeDirsIn(row.logout)} />
                  </div>
                )}
              </details>
            ) : null;
          if (cardChecks && signOut === null) return null;
          return (
            <div className="wk-agents-modal-foot" data-testid="agents-modal-foot">
              {!cardChecks && (
                <div className="wk-agents-check-row">
                  <button type="button" data-testid="agents-check-now" onClick={() => checkAgain('foot')} disabled={outcome.kind === 'checking' || busy !== null} aria-busy={outcome.kind === 'checking'} className="wk-btn wk-btn--secondary">
                    {outcome.kind === 'checking' ? 'Checking…' : 'Check now'}
                  </button>
                  {from === 'foot' && resultLine}
                </div>
              )}
              {signOut}
            </div>
          );
        })()}
      </div>
    </div>,
    document.body,
  );
}
