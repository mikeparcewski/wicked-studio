import { ConnectionRegistry, GovernanceRows, SeatsRegistry, WeekRegistry, useHealthRegistry } from './HealthRailSection.js';
import { SignInPanel } from './SignInPanel.js';

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
  const { governance, overdue, signIn, week } = registry;
  // Said once for the page (image review): the cards that this crew cannot fill say "Not available yet".
  const missing = [week.kind === 'absent' ? 'the week' : null, governance.kind === 'absent' ? 'governance' : null].filter((s): s is string => s !== null);
  return (
    <div data-testid="health-page" className="wk-desk-scroll wk-health-page">
      <header className="wk-everything-head">
        <h1 className="wk-desk-hello">Health</h1>
        <p className="wk-desk-date">The studio's own checks: the socket and API server, every council seat, and where governance evidence lands.</p>
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
      <section data-testid="health-card-seats" className="wk-health-card" aria-label="Seats">
        <h2 className="wk-health-card-title">Seats</h2>
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
        <SignInPanel seat={signIn} onClose={() => registry.setSignIn(null)} onChecked={registry.acceptRoster} />
      )}
    </div>
  );
}