import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client.js';
import type { RosterSeat } from '../api/types.js';
import { signInLapsed } from '../board/deskModel.js';
import { useDisplayText } from '../hooks/useHomePath.js';
import { setCachedRoster } from '../store/rosterCache.js';
import { CopyButton } from './CopyButton.js';
import { Modal } from './Modal.js';

/**
 * CLI SIGN-IN, IN PLAIN WORDS (DES-STUDIO-REBUILD-001 Amendment 5, decision 5). Wherever a helper
 * (a CLI seat) is signed out — the Desk's "needs signing in again" row, Health, the Helpers sheet,
 * /everything › Helpers, Configuration — "Sign in" opens this one panel:
 *
 *  - which CLI, and that studio will not sign in for it (a CLI's login is an interactive flow in a
 *    terminal — a browser tab cannot run it for you);
 *  - the ONE command to run, as the daemon sent it in the roster's `login_invocation`: the seat's
 *    own login verb with the worker home the daemon runs it from (`CLAUDE_CONFIG_DIR=…/.wicked-worker/
 *    claude claude`). Read from the wire, never guessed: a seat the daemon sent no line for gets an
 *    honest sentence instead. The home directory reads `~/…` in the default layer (studio#467); Copy
 *    puts the line on the clipboard exactly as given;
 *  - "I've signed in — check again": one `GET /roster`, deposited in the shared cache so every row
 *    that reads the roster (the Desk's chore, Health, Helpers) clears itself when the seat is back.
 */

export interface SignInWords {
  /** The helper's name as the roster gives it (`display_name`, else its key). */
  cli: string;
  /** The daemon's own login line, or `null` when the roster carries none for this seat. */
  line: string | null;
}

export function signInWords(seat: RosterSeat): SignInWords {
  const raw = typeof seat.login_invocation === 'string' ? seat.login_invocation.trim() : '';
  return { cli: seat.display_name || seat.key, line: raw === '' ? null : raw };
}

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'signed-in' }
  | { kind: 'signed-out' }
  | { kind: 'failed'; why: string };

export function SignInPanel({ seat, onClose, onChecked }: {
  seat: RosterSeat;
  onClose: () => void;
  /** After a re-read: the roster as read, and whether this seat is signed in now. */
  onChecked?: (roster: RosterSeat[], signedIn: boolean) => void;
}): React.ReactElement {
  const { cli, line } = signInWords(seat);
  const showText = useDisplayText();
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });

  const checkAgain = (): void => {
    setCheck({ kind: 'checking' });
    api.getRoster()
      .then(({ roster }) => {
        setCachedRoster(roster);
        const mine = roster.find((s) => s.key === seat.key);
        const signedIn = mine !== undefined && !signInLapsed(mine);
        setCheck({ kind: signedIn ? 'signed-in' : 'signed-out' });
        onChecked?.(roster, signedIn);
      })
      .catch((e: unknown) => setCheck({ kind: 'failed', why: e instanceof Error ? e.message : String(e) }));
  };

  return createPortal(
    <Modal title={`Sign in — ${cli}`} onClose={onClose}>
      <div data-testid="signin-panel" data-seat={seat.key} className="flex flex-col gap-3" style={{ maxWidth: 640 }}>
        <p style={{ color: 'var(--ink-body)' }}>
          Studio can’t sign in for you — {cli} asks its questions in a terminal. Open a terminal and run this one command,
          then finish the sign-in it asks for.
        </p>
        {line !== null ? (
          <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
            <code data-testid="signin-line" className="rounded px-2 py-1" style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)', overflowWrap: 'anywhere' }}>
              {showText(line)}
            </code>
            {/* The clipboard gets the line as given; the button's name and tooltip never print the home path. */}
            <CopyButton command={line} label={`copy the sign-in command for ${cli}`} />
          </div>
        ) : (
          <p data-testid="signin-no-line" style={{ color: 'var(--ink-muted)' }}>
            The daemon didn’t say how to sign {cli} in — it sent no login command for this helper. Sign in with the
            CLI’s own command, then check again here.
          </p>
        )}
        <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>
          The command uses the helper’s own home — the one the daemon runs it from — so the sign-in lands where the
          daemon looks for it.
        </p>
        <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="signin-check"
            onClick={checkAgain}
            disabled={check.kind === 'checking'}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {check.kind === 'checking' ? 'Checking…' : 'I’ve signed in — check again'}
          </button>
          {check.kind !== 'idle' && check.kind !== 'checking' && (
            <span data-testid="signin-result" data-state={check.kind} role="status" style={{ color: check.kind === 'signed-in' ? 'var(--status-run)' : 'var(--ink-body)' }}>
              {check.kind === 'signed-in' && `${cli} is signed in. You can close this.`}
              {check.kind === 'signed-out' && `${cli} is still signed out — finish the sign-in in the terminal, then check again.`}
              {check.kind === 'failed' && `Couldn’t read the roster (${check.why}). The command above still stands.`}
            </span>
          )}
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
