import { useEffect, useRef } from 'react';
import { agentRows } from '../../board/agentsModel.js';
import { goodEnough, setupSettled } from '../../board/firstUse.js';
import { AGENTS_PATH, type Navigate } from '../../hooks/useRoute.js';
import { ensureAgentsRead, useAgentsReads } from '../../store/agentsReads.js';
import { useFirstUseReads } from '../../store/firstUseReads.js';
import { storedDefaults } from './useAgentRows.js';

/** Where first use lands: the Agents tab's setup steps (desk-v2's `/agents` redirect keeps the query). */
export const SETUP_PATH = `${AGENTS_PATH}?setup=1`;

/**
 * THE LANDING RULE (DES-seats-page §5.1), once per app load: opened at `/` (a deep link is never
 * hijacked), with `studio.setup` neither completed nor skipped, and the computer not yet good
 * enough → the Agents tab's setup steps. Good enough on arrival → persist `completedAt` and stay on
 * the Desk. The decision waits for every read it uses; a failed read decides nothing.
 */
export function useFirstUseLanding(pathname: string, search: string, navigate: Navigate): void {
  const start = useRef({ pathname, search });
  const decided = useRef(start.current.pathname !== '/' || start.current.search !== '');
  const f = useFirstUseReads();
  const a = useAgentsReads();
  useEffect(() => { if (!decided.current) void f.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The agents are read only when setup is still open (an existing install pays no extra reads).
  const open = f.state === 'ok' && !setupSettled(f.setup);
  useEffect(() => { if (open && !decided.current) ensureAgentsRead(); }, [open]);

  useEffect(() => {
    if (decided.current) return;
    if (f.state === 'failed') { decided.current = true; return; }
    if (f.state !== 'ok') return;
    if (setupSettled(f.setup)) { decided.current = true; return; }
    if (a.rosterState === 'failed') { decided.current = true; return; }
    if (a.rosterState !== 'ok' || a.roster === null) return;
    decided.current = true;
    const rows = agentRows({ roster: a.roster, acpByCli: a.acpByCli, record: a.record, defaults: storedDefaults(), now: Date.now() });
    if (goodEnough({ rows, repos: f.repos, projects: f.projects })) { void f.save({ completedAt: Date.now() }); return; }
    // Only while the user is still where the app opened (they may have moved on).
    if (pathname === '/' && search === '') navigate(SETUP_PATH, { replace: true });
  }, [f, a.rosterState, a.roster, a.acpByCli, a.record, pathname, search, navigate]);
}
