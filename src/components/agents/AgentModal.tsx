import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { api } from '../../api/client.js';
import type { RosterSeat } from '../../api/types.js';
import { issueCopy, SEVERITY_WORD, type CopyCommand } from '../../board/agentsCopy.js';
import { authOf, commandDisplay, countWords, rowForKey, type AgentIssue, type AgentRow } from '../../board/agentsModel.js';
import { setCachedRoster } from '../../store/rosterCache.js';
import { useModalEscape } from '../Modal.js';
import { Skeleton } from '../ui/StateBanner.js';
import { TechDetails } from '../ui/TechDetails.js';
import { useAgentRows } from './useAgentRows.js';

/**
 * ONE MODAL PER AGENT (DES-seats-page §4): what is happening, why it matters and what you can do,
 * one card per issue, most important first. It replaces the old sign-in panel everywhere it was
 * mounted (the Desk's sign-in chore, the helper sheet, Health, Configuration, the Agents page).
 *
 * Sign-in "while authenticating" (§4.2): the user copies the command, signs in in their own
 * terminal, then "I've signed in: check again". Until crew's on-demand re-check (ask A3b) ships,
 * the ONE polling contract: re-read `GET /roster` every 5 s for at most 45 s while the modal is
 * open, stop when this agent's `probed_at` is newer than the click, and re-derive the issues from
 * that fresh reading. Studio never handles credentials: no terminal, no login route.
 */

export const CHECK_EVERY_MS = 5_000;
export const CHECK_FOR_MS = 45_000;

type Outcome =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'in' }
  | { kind: 'still' }
  | { kind: 'failed' }
  | { kind: 'status-only' }
  | { kind: 'cant-confirm' }
  | { kind: 'couldnt' }
  | { kind: 'not-rechecked' };

const OUTCOME_WORDS: Record<Exclude<Outcome['kind'], 'idle'>, (name: string) => { lead: string; tone: 'ok' | 'fail' | 'quiet'; line: string | null }> = {
  checking: (n) => ({ lead: `Checking ${n}’s sign-in…`, tone: 'quiet', line: null }),
  in: (n) => ({ lead: `The sign-in worked, and ${n} answered a request.`, tone: 'ok', line: 'Its row is updated everywhere. You can close this.' }),
  still: () => ({ lead: 'Still signed out.', tone: 'fail', line: 'Finish the sign-in in your terminal, then check again.' }),
  failed: () => ({ lead: 'The sign-in worked. One thing still stops it, below.', tone: 'ok', line: null }),
  'status-only': (n) => ({ lead: `${n}’s own check says it is signed in.`, tone: 'ok', line: 'Studio couldn’t confirm it with a request yet; its first step will.' }),
  'cant-confirm': () => ({ lead: 'Looks signed in.', tone: 'quiet', line: 'It has no way to confirm; its first step will.' }),
  couldnt: () => ({ lead: 'Couldn’t check just now.', tone: 'fail', line: 'Nothing changed; try again.' }),
  'not-rechecked': () => ({ lead: 'Studio’s service hasn’t re-checked yet.', tone: 'quiet', line: 'Your sign-in may still have worked; check again in a minute.' }),
};

function fresh(seat: RosterSeat | undefined, since: number): boolean {
  const t = typeof seat?.probed_at === 'string' ? Date.parse(seat.probed_at) : NaN;
  return Number.isFinite(t) && t > since;
}

function SeverityIcon({ issue }: { issue: AgentIssue }): React.ReactElement {
  const Icon = issue.severity === 'problem' ? AlertCircle : issue.severity === 'warning' ? AlertTriangle : Info;
  return <Icon aria-hidden size={16} className={`wk-agents-sev-icon wk-agents-sev--${issue.severity}`} />;
}

function Command({ c }: { c: CopyCommand }): React.ReactElement {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const copy = (): void => {
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    const flash = (s: 'copied' | 'failed'): void => {
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
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const live = useRef(true);
  const dialog = useRef<HTMLDivElement | null>(null);
  useModalEscape(onClose);

  useEffect(() => {
    live.current = true;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => { live.current = false; back?.focus?.(); };
  }, []);

  const checkAgain = (): void => {
    if (outcome.kind === 'checking') return;
    const since = Date.now();
    setOutcome({ kind: 'checking' });
    const round = (): void => {
      Promise.resolve()
        .then(() => api.getRoster())
        .then(({ roster }) => {
          if (!live.current) return;
          setCachedRoster(roster);
          const mine = roster.find((s) => s.key === (row?.key ?? agentKey));
          const check = (mine as Record<string, unknown> | undefined)?.['login_check'];
          // An agent with no status command (pi, copilot) is never re-probed: one read is the answer.
          const probeless = mine !== undefined && authOf(mine) === 'signed_in' && check === 'unverified' && typeof mine.probed_at !== 'string';
          if (probeless) { setOutcome({ kind: 'cant-confirm' }); return; }
          if (mine !== undefined && fresh(mine, since)) {
            const auth = authOf(mine);
            if (auth === 'signed_out') setOutcome({ kind: 'still' });
            else if (auth === 'signed_in' && check === 'live') setOutcome({ kind: mine.council_eligible === false ? 'failed' : 'in' });
            else if (auth === 'signed_in') setOutcome({ kind: 'status-only' });
            else setOutcome({ kind: 'not-rechecked' });
            return;
          }
          if (Date.now() - since + CHECK_EVERY_MS > CHECK_FOR_MS) { setOutcome({ kind: 'not-rechecked' }); return; }
          setTimeout(() => { if (live.current) round(); }, CHECK_EVERY_MS);
        }, () => { if (live.current) setOutcome({ kind: 'couldnt' }); });
    };
    round();
  };

  const now = Date.now();
  const cards = useMemo(() => (row === undefined ? [] : row.issues.map((i) => ({ issue: i, copy: issueCopy(i.code, row, rows, now) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [row, rows]);

  if (row === undefined && rosterState === 'ok') return null;
  const name = row?.name ?? '';
  const result = outcome.kind === 'idle' ? null : OUTCOME_WORDS[outcome.kind](name);
  const resultLine = result === null ? null : (
    <div data-testid="agents-check-result" data-state={outcome.kind} role="status" className="wk-agents-result">
      <span className={`wk-agents-word wk-agents-word--${result.tone}`}>{result.lead}</span>
      {result.line !== null && <span>{result.line}</span>}
    </div>
  );
  // Once the fresh reading clears the sign-in card, its result line moves to the top of the modal.
  const settledOutcome = outcome.kind !== 'idle' && row !== undefined && !row.issues.some((i) => i.code === 'signed_out');
  const checkBlock = (
    <div className="wk-agents-check" data-testid="agents-check-block">
      <div className="wk-agents-check-row">
        <button type="button" data-testid="agents-check" onClick={checkAgain} disabled={outcome.kind === 'checking'} aria-busy={outcome.kind === 'checking'} className="wk-btn wk-btn--primary">
          I’ve signed in: check again
        </button>
        <span className="wk-agents-check-hint">{`After you sign in, this asks ${name} and sends one short request.`}</span>
      </div>
      {!settledOutcome && resultLine}
    </div>
  );

  return createPortal(
    <div className="wk-agents-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="agents-modal" data-agent={agentKey} className="wk-agents-modal">
        <div className="wk-agents-modal-head">
          <h2 id={titleId} className="wk-agents-modal-title">{name}</h2>
          <button type="button" data-testid="agents-modal-close" aria-label="Close" title="Close" onClick={onClose} className="wk-btn wk-btn--secondary wk-btn--icon wk-agents-close">✕</button>
        </div>
        <div className="wk-agents-modal-body">
          {row === undefined ? <Skeleton rows={3} variant="card" /> : (
            <>
              {settledOutcome && <div className="wk-agents-check">{resultLine}</div>}
              {cards.length !== 1 && <p className="wk-agents-count" data-testid="agents-modal-count">{countWords(row)}</p>}
              {cards.length === 0 && intent !== 'sign-in' && <p className="wk-agents-none">{`${name} is ready. Nothing needs doing.`}</p>}
              {intent === 'sign-in' && !row.issues.some((i) => i.code === 'signed_out') && (
                <section data-testid="agents-issue" data-code="sign_in_again" aria-label="Sign in again" className="wk-agents-issue wk-agents-issue--note">
                  <div className="wk-agents-issue-title"><span>Sign in again</span></div>
                  {row.login !== null ? (
                    <>
                      <p>{`Run this in your terminal, then follow ${name}’s own sign-in steps.`}</p>
                      <Command c={{ line: row.login, display: commandDisplay(row.login), label: 'sign-in' }} />
                      <span className="wk-agents-safe">Studio never sees your password or token: the sign-in happens between your terminal and the provider.</span>
                      {checkBlock}
                    </>
                  ) : <p>{`Studio’s service sent no sign-in command for ${name}. Sign in the way its maker documents.`}</p>}
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
                        {f.commands.map((c) => <Command key={c.label} c={c} />)}
                        {f.check === true && checkBlock}
                        {f.note !== null && <span className="wk-agents-safe">{f.note}</span>}
                        {f.sub !== undefined && (() => {
                          const list = (
                            <ol className="wk-agents-fixes wk-agents-fixes--sub">
                              {f.sub.map((g, k) => (
                                <li key={k}><b>{g.lead}</b>{g.text !== '' ? ` ${g.text}` : ''}{g.commands.map((c) => <Command key={c.label} c={c} />)}
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
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
