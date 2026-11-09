import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import type { RosterSeat, SeatContainerLoginOutcome } from '../../api/types.js';
import { seatLabel } from '../../board/seatNames.js';
import { getCachedRoster } from '../../store/rosterCache.js';
import { isShortcutsPaletteOpen } from '../../hooks/useGlobalShortcuts.js';
import { useLayerStore } from '../../store/layers.js';
import { Terminal } from '../Terminal.js';
import { AgentLoginProvider, SignInNotCompleted } from './agentLogin.js';
import { holdInert, useLoginCover } from './inertHold.js';

/**
 * Helper sign-in through crew's container-login endpoint. Crew may open the helper on this
 * computer or in a container. Studio shows the returned terminal and reads the recorded outcome.
 * A user closing the window cancels with DELETE after any opening POST has answered; terminal
 * exit and a completed outcome finish without cancellation. The helper's modal then rechecks
 * the roster. Helpers without `sign_in: 'container'` retain the copy-command steps.
 */

/** How long studio waits for crew's ingest once the login terminal closed (crew bounds an ingest at 30 s). */
export const OUTCOME_WAIT_MS = 45_000;
const OUTCOME_POLL_MS = 1_000;
/** One outcome read's own bound (a local GET answers in milliseconds). */
const READ_TIMEOUT_MS = 10_000;

export const offersContainer = (seat: RosterSeat): boolean => seat.sign_in === 'container';

/**
 * Wait for crew to record the sign-in's ingest (404 = not yet); `null` when it did not answer in time.
 * The deadline also aborts a read in flight (codex r1: a stalled read must not hold the agent's lock).
 */
export async function waitForOutcome(key: string, waitMs = OUTCOME_WAIT_MS, pollMs = OUTCOME_POLL_MS, stop?: AbortSignal): Promise<SeatContainerLoginOutcome | null> {
  const until = Date.now() + waitMs;
  // A function, not a narrowed property read: `stop` can abort while a read is awaited.
  const stopped = (): boolean => stop?.aborted === true;
  for (;;) {
    const left = until - Date.now();
    if (left <= 0 || stopped()) return null;
    const abort = new AbortController();
    const onStop = (): void => abort.abort();
    stop?.addEventListener('abort', onStop);
    // Every read is bounded (codex r3: a stalled read must not stall an unbounded watch); the next one retries.
    const timer = setTimeout(() => abort.abort(), Math.min(left, READ_TIMEOUT_MS));
    try {
      return await api.seatContainerLoginOutcome(key, abort.signal);
    } catch {
      // 404 until the ingest lands; any other failure is retried the same way until the deadline.
    } finally {
      clearTimeout(timer);
      stop?.removeEventListener('abort', onStop);
    }
    if (Date.now() + pollMs >= until || stopped()) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * How a sign-in in the terminal is finished, per agent (crew-0182). Pi stays open after `/login`, so the person ends it:
 * quitting pi or closing this window both keep what it saved (crew ingests it on close). codex and opencode end by
 * themselves. A container sign-in (claude, copilot) ends when its own steps finish.
 */
export function loginFinishLine(key: string, name: string, onHost: boolean): string {
  if (key === 'pi') return 'Type /login and finish it in your browser. Signed in? Quit pi (ctrl+d) or close this window to save it.';
  if (onHost) return `Follow ${name}’s sign-in steps in this terminal. It closes by itself when ${name} is done, and studio checks the sign-in. Closing it early keeps a sign-in that already finished.`;
  return `Follow ${name}’s sign-in steps in this terminal. When it finishes, this closes and studio checks the sign-in (up to a minute).`;
}

/** While a login terminal is open, how often studio asks whether crew already ingested it (its exit can be missed). */
export const WATCH_POLL_MS = 2_000;

interface Session {
  /** Unique per sign-in: every terminal callback is bound to its own session (codex r1). */
  id: number;
  key: string;
  name: string;
  onHost: boolean;
  /** The login container's terminal opened (its POST answered). */
  opened: boolean;
  /** Settled: the terminal closed or failed to open; later events are ignored. */
  done: boolean;
  /** Ends the open-terminal watch for crew's outcome. */
  watch: AbortController;
  /** The container-login POST, once sent (a window closed before it answered waits for it, codex r4). */
  pending: Promise<unknown> | null;
  /** The modal's waiting state: the window closed and crew is checking the sign-in (its ingest). */
  onChecking: (() => void) | undefined;
  resolve: () => void;
  reject: (err: unknown) => void;
}

const FOCUSABLE = 'button:not([disabled]), a[href], summary, textarea, [tabindex]:not([tabindex="-1"])';

/** The login container's terminal, over the agent's modal (Escape closes it first, like every later layer). */
function LoginTerminal({ session, open, onOpenError, onClosed, onExit }: {
  session: Session;
  open: (cols: number, rows: number) => Promise<{ id: string }>;
  onOpenError: (err: unknown) => void;
  onClosed: () => void;
  onExit: () => void;
}): React.ReactElement {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClosed);
  closeRef.current = onClosed;
  // Escape closes THIS window first, always (codex r6): it is the top layer even when an agent modal mounted
  // after it (Back, then Forward), so it claims the press before that modal's own listener sees it.
  useEffect(() => {
    const { pushModal, popModal } = useLayerStore.getState();
    const id = pushModal();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || useLayerStore.getState().shortcutOverlayOpen || isShortcutsPaletteOpen()) return;
      e.stopImmediatePropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); popModal(id); };
  }, []);
  // A real modal (codex r1): every other agents layer beneath is inert while it is open, focus starts in
  // it, Tab stays in it, and focus goes back where it was when it closes.
  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The app root too (codex r5): if the agent's modal goes away beneath (Back), the page stays inert. Agent
    // modals beneath hold themselves inert while the cover is up (AgentModal, codex r6).
    const release = holdInert(document.getElementById('root'));
    useLoginCover.getState().set(true);
    dialog.current?.focus();
    return () => {
      // An agent modal beneath restores focus itself once it is no longer inert (codex r7); anywhere else,
      // focus goes straight back.
      const beneath = back?.closest('.wk-agents-scrim') ?? null;
      useLoginCover.getState().set(false, back);
      release();
      if (beneath === null && back?.isConnected === true && !back.matches(':disabled')) back.focus();
    };
  }, []);
  const trapTab = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab' || dialog.current === null) return;
    const f = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (f.length === 0) return;
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const { key, name, opened, onHost } = session;
  return createPortal(
    <div className="wk-agents-scrim wk-agents-scrim--login" data-testid="agents-login-scrim">
      <div ref={dialog} tabIndex={-1} onKeyDown={trapTab} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="agents-login" data-agent={key} data-state={opened ? 'open' : 'opening'} className="wk-agents-modal wk-agents-modal--login">
        <div className="wk-agents-modal-head">
          <h2 id={titleId} className="wk-agents-modal-title">{`Sign in to ${name}`}</h2>
          <button type="button" data-testid="agents-login-close" aria-label="Close the sign-in" title="Close" onClick={onClosed} className="wk-btn wk-btn--secondary wk-btn--icon wk-agents-close">✕</button>
        </div>
        <div className="wk-agents-modal-body">
          <p data-testid="agents-login-line" role="status">
            {opened
              ? loginFinishLine(key, name, onHost)
              : onHost ? `Opening ${name}’s own sign-in on this computer…` : `Opening ${name}’s sign-in… The first sign-in can take a few minutes while it is prepared.`}
          </p>
          <Terminal cwd="." open={open} onOpenError={onOpenError} onExit={onExit} />
          <span className="wk-agents-safe">{onHost ? `Studio opens ${name}’s own sign-in on this computer.` : `Studio opens ${name}’s sign-in; follow its steps there.`} Studio never shows your password or token. For Claude, paste only the code your browser shows into claude’s own prompt: the sign-in reads the token claude prints, and asks you to paste it (unechoed) only if it cannot.</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Wrap the app: the Agents tab's sign-in hooks for container seats, and the host of their login terminal. */
export function ContainerSignInProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  /** The one open session, read synchronously (the terminal's callbacks outlive renders). */
  const live = useRef<Session | null>(null);
  const seq = useRef(0);
  const show = (s: Session | null): void => { live.current = s; setSession(s === null ? null : { ...s }); };

  const signIn = useCallback((key: string, onChecking?: () => void): Promise<void> => {
    // One login terminal at a time (crew holds one sign-in per seat; studio shows one window).
    if (live.current !== null) return Promise.reject(new Error(`finish the ${live.current.name} sign-in first`));
    const seat = getCachedRoster()?.find((s) => s.key === key);
    const name = seat !== undefined ? seatLabel(seat) : key;
    return new Promise<void>((resolve, reject) => { show({ id: ++seq.current, key, name, onHost: seat?.['sign_in_on'] === 'host', opened: false, done: false, watch: new AbortController(), pending: null, onChecking, resolve, reject }); });
  }, []);

  const signOut = useCallback(async (key: string): Promise<void> => { await api.seatContainerLogout(key); }, []);

  /** This session's callbacks: a late answer for an older, settled session touches nothing (codex r1). */
  const bound = (s: Session): { open: (cols: number, rows: number) => Promise<{ id: string }>; closed: (cancel?: boolean) => void; openError: (err: unknown) => void } => {
    const mine = (): boolean => live.current === s && !s.done;
    const closed = (cancel = false): void => {
      if (!mine()) return;
      s.done = true;
      s.watch.abort();
      show(null);
      // Closing during the opening POST hides the window immediately, but keeps this helper held
      // until that POST answers. Only then can DELETE close the sign-in it opened.
      const settled = s.opened ? Promise.resolve(true) : (s.pending ?? Promise.reject(new Error('never sent'))).then(() => true, () => false);
      // Success only when crew's ingest says so: a refused ingest (nothing pasted, a bad token) rejects with crew's
      // reason, so the modal shows it rather than a re-check that reads like the sign-in worked. No answer in time
      // hands back to the re-check, which reads the broker either way.
      // While it waits, the modal says crew is checking the sign-in (the operator has nothing more to do).
      void settled.then(async (o) => {
        if (!o) return null;
        if (cancel) {
          try { await api.closeSeatContainerLogin(s.key); }
          catch (error) {
            if (!(error instanceof ApiError) || error.status !== 404 && error.status !== 405) {
              throw new SignInNotCompleted('Studio couldn’t close the sign-in. Try again in a minute.');
            }
          }
        }
        s.onChecking?.();
        return waitForOutcome(s.key);
      }).then((outcome) => {
        if (outcome !== null && !outcome.ok) s.reject(new SignInNotCompleted(outcome.error?.trim() || 'the sign-in did not finish'));
        else s.resolve();
      }, (error: unknown) => s.reject(error));
    };
    const opened = (): void => {
      if (!mine()) return;
      s.opened = true;
      show(s);
      // crew can record the outcome without this socket ever closing (codex r2: a PTY that exits before the
      // terminal socket registers is never routed to it), so an outcome alone also ends the session.
      void waitForOutcome(s.key, Number.POSITIVE_INFINITY, WATCH_POLL_MS, s.watch.signal).then((o) => { if (o !== null) closed(); });
    };
    return {
      open: (cols, rows) => {
        const post = api.seatContainerLogin(s.key, { cols, rows });
        s.pending = post;
        return post.then((r) => { opened(); return { id: r.terminalId }; });
      },
      // The terminal closed (its PTY exited, its socket dropped, or the user closed it): wait for crew's
      // ingest, then hand back.
      closed,
      openError: (err) => { if (!mine()) return; s.done = true; s.watch.abort(); show(null); s.reject(err); },
    };
  };
  const current = session === null || live.current === null || live.current.id !== session.id ? null : live.current;
  const on = current === null ? null : bound(current);
  return (
    <AgentLoginProvider hooks={{ signIn, signOut, offers: offersContainer }}>
      {children}
      {session !== null && on !== null && (
        <LoginTerminal key={session.id} session={session} open={on.open} onOpenError={on.openError} onClosed={() => on.closed(true)} onExit={() => on.closed()} />
      )}
    </AgentLoginProvider>
  );
}
