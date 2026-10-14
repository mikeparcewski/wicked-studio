import { createContext, useContext, useMemo } from 'react';
import { create } from 'zustand';
import { api } from '../../api/client.js';
import type { RosterSeat } from '../../api/types.js';

/**
 * THE AGENTS TAB'S SIGN-IN HOOKS (STANDARDS: logins move to per-agent login containers, option A).
 * The modal's three affordances — Sign in, Check now, Sign out — call these. Studio's defaults are
 * today's flow: sign in and sign out are a command the user copies into their own terminal (studio
 * never handles credentials), and Check now re-runs the agent's sign-in check on the daemon
 * (`GET /roster?refresh=<key>`, read-only).
 *
 * The container flow (crew#1006) is wired by `ContainerSignInProvider` (containerSignIn.tsx), which
 * wraps the app in `<AgentLoginProvider hooks={…}>`: for the agents its `offers` names, the `signIn` /
 * `signOut` it supplies replace the copy-the-command step for signing in and out with a button that
 * opens that agent's login container; a `checkNow` it supplies would replace the re-check. Commands
 * for other fixes (a version check, the codex account switch) stay as they are.
 * Nothing else in the tab changes.
 */

export interface AgentCheckResult {
  /** The roster as the daemon answered it (deposited in the shared roster cache by the modal). */
  roster: RosterSeat[];
  /** The daemon's refresh answer: `probed` fresh, `timed_out` still checking, `not_probed` no sign-in check; `null` when not sent. */
  outcome: 'probed' | 'timed_out' | 'not_probed' | null;
}

export interface AgentLoginHooks {
  /** Open this agent's own sign-in (the login container). Absent: the copy-the-command step. A rejection says it failed. */
  signIn?: (key: string) => void | Promise<void>;
  /** Sign this agent out. Absent: the copy-the-sign-out-command step. A promise holds Check now until it settles. */
  signOut?: (key: string) => void | Promise<void>;
  /** Re-check this agent's sign-in now and answer with the fresh roster. */
  checkNow: (key: string) => Promise<AgentCheckResult>;
  /**
   * Which agents the supplied `signIn` / `signOut` handle (the container hooks: only a seat crew marks
   * `sign_in: 'container'`). Absent: every agent. The others keep the copy-the-command steps.
   */
  offers?: (seat: RosterSeat) => boolean;
}

/** Whether these hooks sign this agent in (`'in'`) or out (`'out'`) with a button. */
export function hookOffers(hooks: AgentLoginHooks, kind: 'in' | 'out', seat: RosterSeat | undefined): boolean {
  if ((kind === 'in' ? hooks.signIn : hooks.signOut) === undefined) return false;
  return hooks.offers === undefined || (seat !== undefined && hooks.offers(seat));
}

/** Studio's default: one bounded read-only re-check per click (crew A3b). */
export async function checkByRefresh(key: string): Promise<AgentCheckResult> {
  const r = await api.getRoster(key);
  if (!Array.isArray(r?.roster)) throw new Error('roster: no list');
  return { roster: r.roster, outcome: r.refresh?.key === key ? r.refresh.outcome : null };
}

export const DEFAULT_LOGIN_HOOKS: AgentLoginHooks = { checkNow: checkByRefresh };

const AgentLoginContext = createContext<AgentLoginHooks>(DEFAULT_LOGIN_HOOKS);

/** Supply the sign-in hooks for every Agents surface beneath (the tab, the modal from the Desk chore). */
export function AgentLoginProvider({ hooks = {}, children }: { hooks?: Partial<AgentLoginHooks>; children: React.ReactNode }): React.ReactElement {
  // An explicitly undefined checkNow (a JS caller) keeps the default re-check (codex S4 r2).
  const { signIn, signOut, checkNow, offers } = hooks;
  const value = useMemo<AgentLoginHooks>(() => ({
    ...(signIn !== undefined ? { signIn } : {}), ...(signOut !== undefined ? { signOut } : {}), checkNow: checkNow ?? DEFAULT_LOGIN_HOOKS.checkNow,
    ...(offers !== undefined ? { offers } : {}),
  }), [signIn, signOut, checkNow, offers]);
  return <AgentLoginContext.Provider value={value}>{children}</AgentLoginContext.Provider>;
}

export function useAgentLogin(): AgentLoginHooks {
  return useContext(AgentLoginContext);
}

/**
 * THE PER-AGENT AUTH LOCK (codex S4 r9): one sign-in or sign-out per agent at a time, held across modal
 * closes and reopens until the hook itself settles, so a late sign-out can never undo a newer sign-in.
 */
export const useAuthOps = create<{ pending: Record<string, 'in' | 'out'>; begin: (key: string, kind: 'in' | 'out') => boolean; end: (key: string) => void }>((set, get) => ({
  pending: {},
  begin: (key, kind) => {
    if (get().pending[key] !== undefined) return false;
    set({ pending: { ...get().pending, [key]: kind } });
    return true;
  },
  end: (key) => {
    const rest = { ...get().pending };
    delete rest[key];
    set({ pending: rest });
  },
}));
