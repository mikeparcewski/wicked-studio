// studio#332: the team model (core#590 S5) records `RoutingInfo { method: 'teamed', winner }` on
// every seated unit and `unitDistributed.routingMethod: 'teamed'` with null agreement fields. It
// must read as a routing, never as a council pick, a degraded council, or "undefined".

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CoreEvent } from '../src/api/types.js';
import { AssumptionsPanel } from '../src/components/AssumptionsPanel.js';
import { RoutingProvenance } from '../src/components/RoutingProvenance.js';
import { narrate } from '../src/components/narrator.js';
import type { RunModel } from '../src/hooks/useRunModel.js';

describe('teamed routing', () => {
  it('AssumptionsPanel renders "Routed <seat>" with no degraded/undefined wording', () => {
    const model = {
      session: { id: 'r1' },
      units: [
        { ord: 1, description: 'build — do it', resolved: true, routing: { method: 'teamed', winner: 'codex' } },
      ],
    } as unknown as RunModel;
    render(<AssumptionsPanel model={model} />);
    const panel = screen.getByTestId('assumptions');
    expect(panel).toHaveTextContent('Routed codex');
    expect(panel).not.toHaveTextContent('undefined');
    expect(panel).not.toHaveTextContent('degraded');
    expect(panel).not.toHaveTextContent('council:');
  });

  it('RoutingProvenance renders the teamed seat, not an evaluator-distinct "(was undefined)"', () => {
    render(<RoutingProvenance routing={{ method: 'teamed', winner: 'claude' }} />);
    const el = screen.getByTestId('routing-provenance');
    expect(el).toHaveTextContent('Routed: claude');
    expect(el).not.toHaveTextContent('undefined');
    expect(el).not.toHaveTextContent('Evaluator-distinct');
  });

  it('a recorded teamed unitDistributed frame narrates a routing with no council language', () => {
    const frame = {
      type: 'unitDistributed', session: 'r1', ord: 2, cli: 'claude', routingMethod: 'teamed',
      agreementPct: null, returned: null, seated: null, dissent: null,
    } as unknown as CoreEvent;
    const line = narrate(frame, { phaseOf: () => 'build' });
    expect(line?.text).toBe('build routed to claude');
    expect(line?.text).not.toMatch(/council|agreement|undefined/);
  });
});
