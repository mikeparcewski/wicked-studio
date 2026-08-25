import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { RightPanel } from '../src/components/RightPanel.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { useRunEventStore } from '../src/store/events.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { DENYLIST_BLIND_SPOT, LIVE_WORKFLOWS } from './fixtures/workflows.js';
import type { SessionView, WorkflowDef } from '../src/api/types.js';

/**
 * THE COLD-CACHE INVARIANT (wicked-studio#122 D-1).
 *
 * **studio never renders the "launch with deliver: pr" remedy for a run whose
 * workflow is `is_system` — INCLUDING before the workflow defs have loaded.**
 *
 * The loading window is the whole difficulty. `canDeliver` gates the Delivery
 * section in, and with a cold cache all it can consult is the five-id denylist,
 * which does not know `collab` or any `interactive-*`. So for one paint an
 * interactive doc thread looks like build work — and the remedy it would print
 * is a suggestion the composer refuses (`deliverKindOf` demotes exactly those
 * to 'system' and strips `deliver` off the launch body).
 *
 * The chosen suppression is the REMEDY LINE, not the section: every other line
 * in that body is derived from the run's own units and is true whatever
 * workflow produced them, while the remedy is the only sentence that speaks
 * about a FUTURE launch and therefore the only one that can be false. Saying
 * less costs the operator a sentence; saying it wrongly sends them at a button
 * that will not do it.
 */

let getUnitOutput: ReturnType<typeof vi.fn>;
let resolveWorkflows: (v: { workflows: WorkflowDef[] }) => void;

/** A run on `workflow_id` with a build unit and no deliver phase. */
function noDeliverRun(id: string, workflow_id: string): SessionView {
  return makeView({ id, workflow_id, status: 'completed', problem: 'author the deck', workdir: '/w/tree' }, [
    makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
  ]);
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCachedWorkflows();
  useRunEventStore.setState({ byRun: {} });
  useDeliveryStore.setState({ byRun: {} });
  useProvenanceStore.setState({ byRun: {}, launchedHere: {} });
  vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [] });
  vi.spyOn(client.api, 'getRun').mockImplementation((id: string) =>
    Promise.resolve({ run: noDeliverRun(id, 'interactive-draft') }),
  );
  getUnitOutput = vi.fn();
  vi.spyOn(client.api, 'getUnitOutput').mockImplementation(
    getUnitOutput as unknown as typeof client.api.getUnitOutput,
  );
  // The defs are IN FLIGHT for the whole render, until a test resolves them.
  vi.spyOn(client.api, 'listWorkflows').mockReturnValue(
    new Promise((r) => { resolveWorkflows = r; }),
  );
});
afterEach(() => { cleanup(); clearCachedWorkflows(); });

describe('before the defs load', () => {
  for (const wf of DENYLIST_BLIND_SPOT) {
    it(`${wf}: the section may show, the "deliver: pr" remedy may NOT`, async () => {
      render(<RightPanel view={noDeliverRun(`r-${wf}`, wf)} />);
      // The denylist cannot rule this workflow out yet, so the section is here —
      // that is the exact window the defect lived in.
      fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

      const body = await screen.findByTestId('run-delivery');
      expect(body).toHaveAttribute('data-state', 'none');
      expect(body.textContent, 'a remedy the composer refuses').not.toContain('deliver: pr');
      // What it still says is TRUE and useful: the phase fact, and where the work is.
      expect(body).toHaveTextContent('This run has no deliver phase.');
      expect(body).toHaveTextContent('the work is in');
      expect(getUnitOutput).not.toHaveBeenCalled();
    });
  }

  it('a run with no workdir either says nothing at all beyond the phase fact', async () => {
    const view = makeView({ id: 'r-bare', workflow_id: 'interactive-demo', workdir: null }, [
      makeUnit({ id: 'r-bare:build', session_id: 'r-bare', ord: 0, status: 'done' }),
    ]);
    render(<RightPanel view={view} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    const body = await screen.findByTestId('run-delivery');
    expect(body.textContent?.trim()).toStrictEqual('This run has no deliver phase.');
  });

  it('an ORDINARY workflow is withheld from too — a def in hand is the only licence', async () => {
    // Erring toward saying less: `feature` IS deliverable, but nothing has
    // proved it yet. The line arrives with the defs, one tick later.
    render(<RightPanel view={noDeliverRun('r-feature', 'feature')} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));
    expect((await screen.findByTestId('run-delivery')).textContent).not.toContain('deliver: pr');
  });
});

describe('once the defs land', () => {
  it('the interactive thread loses its Delivery section entirely', async () => {
    render(<RightPanel view={noDeliverRun('r-draft', 'interactive-draft')} />);
    expect(screen.getByRole('button', { name: /Delivery/ })).toBeInTheDocument();

    resolveWorkflows({ workflows: LIVE_WORKFLOWS });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument(),
    );
  });

  it('the ordinary workflow gets its remedy back', async () => {
    render(<RightPanel view={noDeliverRun('r-feature-2', 'feature')} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));
    await screen.findByTestId('run-delivery');

    resolveWorkflows({ workflows: LIVE_WORKFLOWS });

    await waitFor(() =>
      expect(screen.getByTestId('run-delivery')).toHaveTextContent(
        'the work is in /w/tree — launch with deliver: pr to open a PR from it',
      ),
    );
  });
});
