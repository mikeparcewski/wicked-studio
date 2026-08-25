import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * D2, held STRUCTURALLY: **`DeliveryChip` decides through `canDeliver` — the
 * same predicate the rail's section and the project census gate on.**
 *
 * The sibling assertion in `delivery.materialised.test.tsx` ("if a row is
 * chipped, `canDeliver` is true for it") cannot fail, and a mutation run proved
 * it: delete the gate from `DeliveryChip` and every delivery test still passes.
 * That is not the test being weak — it is the invariant being UNREACHABLE
 * today, by construction. `canDeliver` returns true for any run whose deliver
 * state is not `'none'`, and the chip already returns null on the `'none'` and
 * `'in-flight'` claims, so the two conditions can never disagree while
 * `canDeliver` leads with the evidence arm.
 *
 * So the thing worth pinning is not an outcome (there is none to observe) but
 * the WIRING: that the row consults the shared predicate at all, and obeys it
 * when it says no. Both are checked here against a wrapped module export — the
 * pattern `deliverKind.shared.test.tsx` already uses for the composer/rail
 * seam — so a later edit that drops the gate, or re-forks the rule into a
 * row-local copy, fails HERE instead of silently.
 */
vi.mock('../src/components/delivery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/delivery.js')>();
  return { ...actual, canDeliver: vi.fn(actual.canDeliver) };
});

import * as client from '../src/api/client.js';
import { DeliveryChip } from '../src/components/RunDelivery.js';
import { canDeliver } from '../src/components/delivery.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { LIVE_RUN_IDS, LIVE_WORKFLOWS, materialised } from './fixtures/workflows.js';
import type { SessionView } from '../src/api/types.js';

const gate = vi.mocked(canDeliver);

/** The live PR run's shape: materialised def, deliver unit `done`. */
function delivering(id: string = LIVE_RUN_IDS.prOpened): SessionView {
  return makeView(
    { id, workflow_id: materialised(id), status: 'completed', workdir: '/w/tree' },
    [
      makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
      makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status: 'done' }),
    ],
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCachedWorkflows();
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: LIVE_WORKFLOWS });
  gate.mockClear();
});
afterEach(cleanup);

describe('D2: the row chips only what the shared predicate licenses', () => {
  it('the chip DECIDES through canDeliver, with the row\'s own view', () => {
    const view = delivering();
    render(<DeliveryChip view={view} />);

    expect(screen.getByTestId('run-delivery-chip')).toHaveTextContent('deliver ran');
    expect(gate).toHaveBeenCalled();
    expect(gate.mock.calls.some(([v]) => v === view)).toBe(true);
  });

  it('and OBEYS it: a withheld run is not chipped, whatever its own units say', () => {
    // The unreachable half, forced: the predicate says no about a run that
    // demonstrably delivered. The chip must stay silent — a row may never
    // announce an outcome for a run whose Delivery section studio withholds.
    gate.mockReturnValue(false);
    render(<DeliveryChip view={delivering()} />);
    expect(screen.queryByTestId('run-delivery-chip')).toBeNull();
  });

  it('costs no request of its own — the defs read is module state, shared', async () => {
    render(
      <>
        {Array.from({ length: 40 }, (_, i) => (
          <DeliveryChip key={i} view={delivering(`chip-budget-${i}`)} />
        ))}
      </>,
    );
    await waitFor(() => expect(client.api.listWorkflows).toHaveBeenCalledTimes(1));
    expect(client.api.listWorkflows).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('run-delivery-chip')).toHaveLength(40);
  });
});
