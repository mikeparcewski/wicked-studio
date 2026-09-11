// #246 — the command deck's Governed tile degrades when the daemon says its governance
// evidence is NOT landing (`GET /diagnostics`.governance: a null store, or an error finding such
// as `governance.deadletter`) — the same signal the Health rail's heart reads. The claims-derived
// percentage stays (it is what the claims say); it is painted in the fail token with the reason
// underneath, and the tile carries `data-state="governance-error"`.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiagnosticsGovernance, GovernanceClaim } from '../src/api/types.js';
import { DeckKpiRibbon } from '../src/components/DeckKpiRibbon.js';
import { makeView } from './factories.js';
import { GOVERNANCE_DEADLETTERS, GOVERNANCE_HEALTHY, GOVERNANCE_LEGACY_OUTBOX, GOVERNANCE_NO_STORE } from './fixtures/wave2.js';

const NOW = 1_760_000_000_000;
afterEach(cleanup);

const RUNS = [makeView({ id: 'a', status: 'completed' }), makeView({ id: 'b', status: 'completed' })];
// A claim's scope names its run (`runIdOfScope`: the id itself, or `wicked-agent/<id>`).
const CLAIMS = [{ claim_id: 'c1', scope: 'wicked-agent/a', phase: 'build' }] as unknown as GovernanceClaim[];

function ribbon(governance: DiagnosticsGovernance | null | undefined): HTMLElement {
  render(<DeckKpiRibbon runs={RUNS} claims={CLAIMS} governance={governance} needCount={0} navigate={() => {}} now={NOW} />);
  return screen.getByTestId('home-kpi-governed');
}

describe('DeckKpiRibbon — the Governed tile and diagnostics.governance (#246)', () => {
  it('reads the claims percentage plainly when governance is healthy, absent, or only warning', () => {
    for (const g of [GOVERNANCE_HEALTHY, GOVERNANCE_LEGACY_OUTBOX, null, undefined]) {
      const tile = ribbon(g);
      expect(tile).toHaveAttribute('data-value', '50%');
      expect(tile).not.toHaveAttribute('data-state');
      expect(tile.textContent).toContain('1/2 runs');
      cleanup();
    }
  });

  it('dead letters (the F-022 signal) degrade the tile: fail-coloured value, the count and a pointer to Health', () => {
    const tile = ribbon(GOVERNANCE_DEADLETTERS);
    expect(tile).toHaveAttribute('data-value', '50%'); // the claims still say 50 % — not rewritten
    expect(tile).toHaveAttribute('data-state', 'governance-error');
    expect(tile.querySelector('.deck-big')).toHaveStyle({ color: 'var(--status-fail)' });
    expect(tile.textContent).toContain('128+ governance events dead-lettered (see Health)');
    expect(tile.textContent).not.toContain('1/2 runs');
  });

  it('a boot that resolved NO store is never "Governed": the tile says evidence is not landing', () => {
    const tile = ribbon(GOVERNANCE_NO_STORE);
    expect(tile).toHaveAttribute('data-state', 'governance-error');
    expect(tile.textContent).toContain('no governance store resolved — evidence is not landing (see Health)');
  });
});
