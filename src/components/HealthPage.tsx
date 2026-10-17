import { useEffect } from 'react';
import { HEALTH_RECHECKED } from '../hooks/useRailHealthDot.js';
import { ConnectionRegistry, GovernanceRows, SeatsRegistry, WeekRegistry, useHealthRegistry } from './HealthRailSection.js';
import { AgentModal } from './agents/AgentModal.js';
import { getCachedRoster } from '../store/rosterCache.js';

/**
 * `/health` (studio#421 rail polish, change 3): the rail's Health link lands the FULL registry — the
 * same engine as the retired rail-foot flyout (`useHealthRegistry`, active for the page's whole mount:
 * the page IS the fetch gesture, EC30), carded. Four cards, one per section: Connection (socket + API
 * server), Seats (one row per council seat), This week (the window caption and each seat's weekly
 * 1:1), Governance (store · records · dead letters · findings, studio#246). The one plain-words
 * sign-in panel rides the same seat rows ("Sign in", DES-STUDIO-REBUILD-001 Amendment 5, decision 5
 * — a re-read clears every row through the registry).
 */
export function HealthPage(): React.ReactElement {
  const registry = useHealthRegistry(true);
  // Opening the page is a fresh read: the rail's dot re-reads with it (codex review r2).
  useEffect(() => { window.dispatchEvent(new Event(HEALTH_RECHECKED)); }, []);
  const { governance, overdue, signIn, week } = registry;
  // Said once for the page (image review): the cards that this crew cannot fill say "Not available yet".
  const missing = [week.kind === 'absent' ? 'the week' : null, governance.kind === 'absent' ? 'governance' : null].filter((s): s is string => s !== null);
  return (
    <div data-testid="health-page" className="wk-desk-scroll wk-health-page wk-measure wk-measure--narrow">
      <header className="wk-everything-head">
        <h1 className="wk-desk-hello">Health</h1>
        <p className="wk-desk-date">Studio's own checks: its connection and service, each helper, and where check results are saved.</p>
        {missing.length > 0 && (
          <p data-testid="health-upgrade-note" className="wk-health-note">
            This version of crew does not report {missing.join(' or ')} yet. Upgrade crew to see {missing.length > 1 ? 'them' : 'it'}.
          </p>
        )}
      </header>
      <section data-testid="health-card-connection" className="wk-health-card" aria-label="Connection">
        <h2 className="wk-health-card-title">Connection</h2>
        <ConnectionRegistry registry={registry} />
      </section>
      <section data-testid="health-card-seats" className="wk-health-card" aria-label="Helpers">
        <h2 className="wk-health-card-title">Helpers</h2>
        <SeatsRegistry registry={registry} />
      </section>
      <section data-testid="health-card-week" className="wk-health-card" aria-label="This week">
        <h2 className="wk-health-card-title">This week</h2>
        <WeekRegistry registry={registry} />
      </section>
      <section data-testid="health-card-governance" className="wk-health-card" aria-label="Governance">
        <h2 className="wk-health-card-title">Governance</h2>
        <GovernanceRows read={governance} overdue={overdue ? registry.probeDeadlineMs : 0} onReprobe={registry.reprobeNow} />
      </section>
      {signIn !== null && (
        <AgentModal agentKey={signIn.key} intent="sign-in" onClose={() => { const r = getCachedRoster(); if (r !== null) registry.acceptRoster(r); registry.setSignIn(null); }} />
      )}
    </div>
  );
}