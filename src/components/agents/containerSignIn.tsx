import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client.js';
import type { RosterSeat, SeatContainerLoginOutcome } from '../../api/types.js';
import { seatLabel } from '../../board/seatNames.js';
import { getCachedRoster } from '../../store/rosterCache.js';
import { isShortcutsPaletteOpen } from '../../hooks/useGlobalShortcuts.js';
import { useLayerStore } from '../../store/layers.js';
import { Terminal } from '../Terminal.js';
import { AgentLoginProvider, SignInNotCompleted } from './agentLogin.js';
import { holdInert, useLoginCover } from './inertHold.js';

/**
 * THE CONTAINER SIGN-IN (STANDARDS option A; crew#1006 on wicked-core#938): an agent crew marks
 * `sign_in: 'container'` signs in once, in a disposable login container crew opens in its own PTY.
 * Studio only shows that terminal and waits: when it closes, crew moves the credential into its broker
 * (studio never sees it), and the modal's re-check reads the broker's answer off the roster.
 *
 *   Sign in   → `POST /seats/:key/container-login` → the login container's terminal, over the modal.
 *               When its socket closes (crew closes it when the PTY exits, and kills the PTY when the
 *               socket drops, so either way the login is over and crew ingests it) or the user closes
 *               the window, studio waits, bounded, for crew's ingest (`GET /seats/:key/container-login`),
 *               then the hook resolves and the modal re-checks (`GET /roster?refresh=<key>`). It rejects
 *               when the container could not be opened, and with crew's reason (SignInNotCompleted) when
 *               the ingest refused the sign-in.
 *   Sign out  → `POST /seats/:key/container-logout`.
 *   Check now → studio's default re-check.
 * Agents without `sign_in: 'container'` keep the copy-the-command steps, so a daemon outside the
 * container floor (which sends no such seat) changes nothing.
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

/** While a login terminal is open, how often studio asks whether crew already ingested it (its exit can be missed). */
export const WATCH_POLL_MS = 2_000;

interface Session {
  /** Unique per sign-in: every terminal callback is bound to its own session (codex r1). */
  id: number;
  key: string;
  name: string;
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
function LoginTerminal({ session, open, onOpenError, onClosed }: {
  session: Session;
  open: (cols: number, rows: number) => Promise<{ id: string }>;
  onOpenError: (err: unknown) => void;
  onClosed: () => void;
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
  const { key, name, opened } = session;
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
              ? `Follow ${name}’s sign-in steps in this terminal. When it finishes, this closes and studio checks the sign-in (up to a minute).`
              : `Opening ${name}’s login container… The first sign-in can take a few minutes while it is prepared.`}
          </p>
          <Terminal cwd="." open={open} onOpenError={onOpenError} onExit={onClosed} />
          <span className="wk-agents-safe">It runs in a disposable container, and studio’s service keeps the sign-in. Studio never shows your password or token. For Claude, paste only the code your browser shows into claude’s own prompt: the sign-in reads the token claude prints, and asks you to paste it (unechoed) only if it cannot.</span>
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
    return new Promise<void>((resolve, reject) => { show({ id: ++seq.current, key, name, opened: false, done: false, watch: new AbortController(), pending: null, onChecking, resolve, reject }); });
  }, []);

  const signOut = useCallback(async (key: string): Promise<void> => { await api.seatContainerLogout(key); }, []);

  /** This session's callbacks: a late answer for an older, settled session touches nothing (codex r1). */
  const bound = (s: Session): { open: (cols: number, rows: number) => Promise<{ id: string }>; closed: () => void; openError: (err: unknown) => void } => {
    const mine = (): boolean => live.current === s && !s.done;
    const closed = (): void => {
      if (!mine()) return;
      s.done = true;
      s.watch.abort();
      show(null);
      // Closed before the container opened (codex r4): the window goes now, but the agent stays held until
      // the POST answers. A refusal opened nothing; a terminal it did open is closed by the unmounted
      // Terminal itself, and crew's ingest of it is awaited like any other, so a retry never meets a 409.
      const settled = s.opened ? Promise.resolve(true) : (s.pending ?? Promise.reject(new Error('never sent'))).then(() => true, () => false);
      // Success only when crew's ingest says so: a refused ingest (nothing pasted, a bad token) rejects with crew's
      // reason, so the modal shows it rather than a re-check that reads like the sign-in worked. No answer in time
      // hands back to the re-check, which reads the broker either way.
      // While it waits, the modal says crew is checking the sign-in (the operator has nothing more to do).
      void settled.then((o) => { if (!o) return null; s.onChecking?.(); return waitForOutcome(s.key); }).then((outcome) => {
        if (outcome !== null && !outcome.ok) s.reject(new SignInNotCompleted(outcome.error?.trim() || 'the sign-in did not finish'));
        else s.resolve();
      }, () => s.resolve());
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
        <LoginTerminal key={session.id} session={session} open={on.open} onOpenError={on.openError} onClosed={on.closed} />
      )}
    </AgentLoginProvider>
  );
}
