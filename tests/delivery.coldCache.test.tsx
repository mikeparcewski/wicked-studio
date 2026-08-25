import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { RightPanel } from '../src/components/RightPanel.js';
import { RunDelivery } from '../src/components/RunDelivery.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { useRunEventStore } from '../src/store/events.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { DENYLIST_BLIND_SPOT, LIVE_WORKFLOWS, materialised } from './fixtures/workflows.js';
import type { SessionView, WorkflowDef } from '../src/api/types.js';

/**
 * THE COLD-CACHE INVARIANT (wicked-studio#122 D-1, tightened after the live
 * measurement).
 *
 * **studio says nothing about the delivery of a run it cannot prove is
 * deliverable — no section, no "no deliver phase" sentence, no "launch with
 * deliver: pr" remedy — before the defs land AND after.**
 *
 * The first cut suppressed only the REMEDY LINE, on the argument that the rest
 * of the body is derived from the run's own units and true whatever composed
 * them. That holds for every claim except `'none'`, which is not a fact about
 * units at all: "this run has no deliver phase" is a claim about a
 * classification. Measured against the live daemon, that was the whole corpus —
 * 86 of 129 runs carry a materialised `wf-<runId>` def `GET /workflows` never
 * serves, so `undefined` is their permanent answer, and 30 interactive document
 * threads rendered a Delivery section whose entire body was that sentence.
 *
 * So the licence is the same on both: `is_system === false`, a def IN HAND. The
 * exception, pinned below, is a run that HAS a deliver phase — evidence beats
 * classification, and 5c5e08b7 opened a real PR under a materialised def.
 */

let getUnitOutput: ReturnType<typeof vi.fn>;
let resolveWorkflows: (v: { workflows: WorkflowDef[] }) => void;

/** A run on `workflow_id` with a build unit and no deliver phase. */
function noDeliverRun(id: string, workflow_id: string): SessionView {
  return makeView({ id, workflow_id, status: 'completed', problem: 'author the deck', workdir: '/w/tree' }, [
    makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
  ]);
}

/** The same run, WITH a deliver phase crew approved. */
function deliveredRun(id: string, workflow_id: string): SessionView {
  const v = noDeliverRun(id, workflow_id);
  return {
    ...v,
    units: [...v.units, makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status: 'done' })],
  };
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

describe('before the defs load, a run with no deliver phase gets no section at all', () => {
  for (const wf of DENYLIST_BLIND_SPOT) {
    it(`${wf}: no Delivery header, no body, no remedy`, () => {
      render(<RightPanel view={noDeliverRun(`r-${wf}`, wf)} />);
      // This is the window the defect lived in: the denylist cannot rule these
      // out, so the section used to render and say "This run has no deliver
      // phase." about a document thread.
      expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();
      expect(screen.queryByTestId('run-delivery')).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain('This run has no deliver phase.');
      expect(document.body.textContent).not.toContain('deliver: pr');
      expect(getUnitOutput).not.toHaveBeenCalled();
    });
  }

  it('an ORDINARY workflow is withheld from too — a def in hand is the only licence', () => {
    // Erring toward saying less: `feature` IS deliverable, but nothing has
    // proved it yet. The section arrives with the defs, one tick later.
    render(<RightPanel view={noDeliverRun('r-feature', 'feature')} />);
    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();
  });

  it('and a MATERIALISED def is withheld forever — it is in no catalog to arrive in', async () => {
    const id = 'r-materialised';
    render(<RightPanel view={noDeliverRun(id, materialised(id))} />);
    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();

    resolveWorkflows({ workflows: LIVE_WORKFLOWS });
    await waitFor(() => expect(client.api.listWorkflows).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();
  });
});

describe('a run that HAS a deliver phase is never withheld — evidence beats classification', () => {
  it('a materialised def keeps its section with the cache stone cold', () => {
    const id = '5c5e08b7-9e06-43cc-9b15-300bfc599e21';
    render(<RightPanel view={deliveredRun(id, materialised(id))} />);

    expect(screen.getByRole('button', { name: /Delivery/ })).toBeInTheDocument();
    expect(screen.getByTestId('run-delivery-badge')).toHaveTextContent('deliver ran');
  });

  it('so does an is_system workflow that somehow ran one', async () => {
    render(<RightPanel view={deliveredRun('r-sys-delivered', 'interactive-draft')} />);
    expect(screen.getByRole('button', { name: /Delivery/ })).toBeInTheDocument();

    resolveWorkflows({ workflows: LIVE_WORKFLOWS });
    await waitFor(() => expect(client.api.listWorkflows).toHaveBeenCalled());
    // The flag demotes the CLASSIFICATION, not the unit that already ran.
    expect(screen.getByRole('button', { name: /Delivery/ })).toBeInTheDocument();
  });
});

describe('once the defs land', () => {
  it('the interactive thread still has no Delivery section', async () => {
    render(<RightPanel view={noDeliverRun('r-draft', 'interactive-draft')} />);
    resolveWorkflows({ workflows: LIVE_WORKFLOWS });

    await waitFor(() => expect(client.api.listWorkflows).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();
  });

  it('the ordinary workflow gets its section, its phase fact and its remedy', async () => {
    render(<RightPanel view={noDeliverRun('r-feature-2', 'feature')} />);
    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();

    resolveWorkflows({ workflows: LIVE_WORKFLOWS });

    const header = await screen.findByRole('button', { name: /Delivery/ });
    fireEvent.click(header);
    const body = await screen.findByTestId('run-delivery');
    expect(body).toHaveAttribute('data-state', 'none');
    expect(body).toHaveTextContent('This run has no deliver phase.');
    expect(body).toHaveTextContent('the work is in /w/tree — launch with deliver: pr to open a PR from it');
    expect(getUnitOutput).not.toHaveBeenCalled();
  });

  it('a run with no workdir says the phase fact and the remedy, and nothing else', async () => {
    const view = makeView({ id: 'r-bare', workflow_id: 'bug', workdir: null }, [
      makeUnit({ id: 'r-bare:build', session_id: 'r-bare', ord: 0, status: 'done' }),
    ]);
    render(<RightPanel view={view} />);
    resolveWorkflows({ workflows: LIVE_WORKFLOWS });

    fireEvent.click(await screen.findByRole('button', { name: /Delivery/ }));
    const body = await screen.findByTestId('run-delivery');
    expect(body.textContent?.trim()).toStrictEqual(
      'This run has no deliver phase.launch with deliver: pr to have the run open a PR from its worktree',
    );
  });
});

describe('RunDelivery enforces the licence itself, not just via the rail (Copilot on #125)', () => {
  it('rendered DIRECTLY for an unclassifiable run, it withholds the "no deliver phase" claim', async () => {
    // The rail would filter this section out entirely; the component is exported, so it must not
    // depend on that. A materialised `wf-<runId>` id is never in the catalog, so the licence is
    // permanently `undefined` — not `false`.
    clearCachedWorkflows();
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: LIVE_WORKFLOWS });
    const view = makeView(
      { id: 'r-direct', workflow_id: 'wf-r-direct', workdir: '/w/tree' },
      [],
    );
    render(<RunDelivery view={view} />);
    await waitFor(() => expect(client.api.listWorkflows).toHaveBeenCalled());
    expect(screen.queryByText(/no deliver phase/i)).toBeNull();
    expect(screen.queryByText(/deliver: pr/i)).toBeNull();
  });

  it('but a positively-classified feature run rendered directly DOES state it', async () => {
    clearCachedWorkflows();
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: LIVE_WORKFLOWS });
    const view = makeView({ id: 'r-direct-ok', workflow_id: 'feature', workdir: '/w/tree' }, []);
    render(<RunDelivery view={view} />);
    await waitFor(() => expect(screen.queryByText(/no deliver phase/i)).not.toBeNull());
  });
});
