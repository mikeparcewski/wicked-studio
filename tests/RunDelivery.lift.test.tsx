// wicked-core#431 / api-types 0.33.0 on the DELIVERY CARD (the rail's Delivery body): the deliver
// lift's story off the run's event log — every outcome, the re-verify on the tree that would ship
// (forced-install source, a failed re-verify, a failed post-check proof), the engine's refusal
// verbatim (once — never duplicated under the unit's own denial_reason), the addendum's
// refused-before-the-lift case, and silence for a daemon that never sent a deliver-ord frame.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { RunDelivery } from '../src/components/RunDelivery.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { useRunEventStore } from '../src/store/events.js';
import { usePostHocDeliverStore } from '../src/store/postHocDeliver.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import type { CoreEvent, SessionView, UnitStatus } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';
import { G6_EVENTS, GATE_RUN } from './fixtures/gateEvidence.js';
import {
  BASE_AFTER,
  BASE_BEFORE,
  DELIVER_CHANGED_TREE_TAIL,
  DELIVER_CONFLICT_TAIL,
  DELIVER_FAILED_TAIL,
  DELIVER_LIFTED_TAIL,
  DELIVER_REVERIFY_FAILED_TAIL,
  DELIVER_SKIPPED_TAIL,
  DELIVER_UNCHANGED_TAIL,
  DELIVER_WRONG_HEAD_TAIL,
  DETAIL_REVERIFY_FAILED,
  REFUSAL_CONFLICT,
  REFUSAL_REVERIFY_FAILED,
  REFUSAL_WRONG_HEAD,
  deliverRejectedReason,
  deliverWorkerFailedReason,
} from './fixtures/wire433.js';

/** The recorded run's view with its deliver unit (ord 5) in `status`, filed on a plain workflow. */
function view(status: UnitStatus, denial: string | null = null, workdir = '/w/trees/run-3r2'): SessionView {
  return makeView(
    { id: GATE_RUN, workflow_id: 'feature', status: status === 'done' ? 'completed' : 'failed', workdir, repo_ref: 'studio-api' },
    [
      makeUnit({ id: `${GATE_RUN}:fix`, session_id: GATE_RUN, ord: 3, status: 'done' }),
      makeUnit({ id: `${GATE_RUN}:verify`, session_id: GATE_RUN, ord: 4, status: 'done' }),
      makeUnit({ id: `${GATE_RUN}:deliver`, session_id: GATE_RUN, ord: 5, status, denial_reason: denial }),
    ],
  );
}

function seed(tail: CoreEvent[]): void {
  useRunEventStore.setState({ byRun: { [GATE_RUN]: [...G6_EVENTS, ...tail] } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearCachedWorkflows();
  useDeliveryStore.setState({ byRun: {} });
  usePostHocDeliverStore.setState({ byRun: {} });
  useRunEventStore.setState({ byRun: {} });
});
afterEach(() => { cleanup(); clearCachedWorkflows(); });

describe('RunDelivery — the deliver lift block', () => {
  it('unchanged: the base was already the tip — the verified tree is the tree that would ship; no push or PR claim', () => {
    seed(DELIVER_UNCHANGED_TAIL);
    render(<RunDelivery view={view('done')} />);
    const lift = screen.getByTestId('deliver-lift');
    expect(lift).toHaveAttribute('data-outcome', 'unchanged');
    expect(lift).toHaveAttribute('data-attempt', '0');
    expect(lift).toHaveTextContent('Deliver lift — base unchanged');
    expect(screen.getByTestId('deliver-lift-summary')).toHaveTextContent(`origin/main is still at ${BASE_BEFORE.slice(0, 7)}`);
    expect(lift.textContent).not.toMatch(/pushed|PR open/);
    expect(screen.queryByTestId('deliver-lift-floor')).toBeNull();
    expect(screen.queryByTestId('deliver-lift-failure')).toBeNull();
    // The card's own claim is untouched: `done` without a url is still only "deliver ran".
    expect(screen.getByTestId('run-delivery')).toHaveAttribute('data-state', 'delivered');
  });

  it('lifted: base before → after, tree before → after, and the re-verify per check — the forced install named by its source', () => {
    seed(DELIVER_LIFTED_TAIL);
    render(<RunDelivery view={view('done')} />);
    expect(screen.getByTestId('deliver-lift')).toHaveAttribute('data-outcome', 'lifted');
    expect(screen.getByTestId('deliver-lift-summary')).toHaveTextContent(
      `re-based onto origin/main @ ${BASE_AFTER.slice(0, 7)} (was ${BASE_BEFORE.slice(0, 7)})`,
    );
    const floor = screen.getByTestId('deliver-lift-floor');
    expect(floor).toHaveAttribute('data-floor', 'pass');
    expect(floor).toHaveTextContent('repository checks re-run on the tree that would ship — pass');
    const rows = screen.getAllByTestId('deliver-lift-check');
    expect(rows.map((r) => r.getAttribute('data-check'))).toEqual(['install', 'typecheck', 'lint', 'test']);
    expect(rows[0]).toHaveTextContent('install · exit 0 · 21.4s · package-lock.json (forced: lockfile drift)');
    expect(rows.every((r) => r.getAttribute('data-ok') === 'true')).toBe(true);
    expect(screen.queryByTestId('deliver-lift-changed-tree')).toBeNull();
    expect(screen.queryByTestId('deliver-lift-failure')).toBeNull();
  });

  it("conflict on a rejected unit: files, remedy, and the refusal ONCE — the engine's FRAMED denial_reason (Worker FAILED on unit 5: …) already carries it, so the lift block omits its copy", () => {
    seed(DELIVER_CONFLICT_TAIL);
    // As the engine frames it on the plain worker-failure path (actor.rs) — never the bare refusal.
    const reason = deliverWorkerFailedReason(REFUSAL_CONFLICT);
    expect(reason.startsWith('Worker FAILED on unit 5: deliver: LIFT-CONFLICT')).toBe(true);
    render(<RunDelivery view={view('rejected', reason)} />);
    expect(screen.getByTestId('run-delivery')).toHaveAttribute('data-state', 'failed');
    const lift = screen.getByTestId('deliver-lift');
    expect(lift).toHaveAttribute('data-outcome', 'conflict');
    expect(screen.getByTestId('deliver-lift-conflicts')).toHaveTextContent('testid-inventory.json');
    expect(screen.getByTestId('deliver-lift-remedy')).toHaveTextContent('remedy:');
    // The unit's own reason renders verbatim below; the lift block does not repeat it.
    expect(screen.getByTestId('run-delivery-reason')).toHaveTextContent(reason);
    expect(screen.queryByTestId('deliver-lift-failure')).toBeNull();
    expect(screen.getAllByText(/LIFT-CONFLICT — lifting/)).toHaveLength(1);
  });

  it("a rejected re-verify failure: the triage-Fail framing (Worker FAILED on unit 5 (triage: …): <150/250 excerpt>) carries the elided detail — omitted from the lift block, said once", () => {
    seed(DELIVER_REVERIFY_FAILED_TAIL);
    const reason = deliverRejectedReason(REFUSAL_REVERIFY_FAILED);
    render(<RunDelivery view={view('rejected', reason)} />);
    expect(screen.getByTestId('run-delivery-reason')).toHaveTextContent('Worker FAILED on unit 5 (triage:');
    expect(screen.queryByTestId('deliver-lift-failure')).toBeNull();
    const card = screen.getByTestId('run-delivery');
    expect((card.textContent ?? '').split('deliver: the tree that would ship').length - 1).toBe(1);
  });

  it('conflict when the unit has NOT resolved yet (the retry gate is open): the refusal renders in the lift block', () => {
    seed(DELIVER_CONFLICT_TAIL);
    render(<RunDelivery view={view('distributed')} />);
    expect(screen.getByTestId('run-delivery')).toHaveAttribute('data-state', 'in-flight');
    expect(screen.getByTestId('deliver-lift-failure')).toHaveTextContent(REFUSAL_CONFLICT);
  });

  it('skipped and failed carry the engine\'s note', () => {
    seed(DELIVER_SKIPPED_TAIL);
    const { unmount } = render(<RunDelivery view={view('done')} />);
    expect(screen.getByTestId('deliver-lift')).toHaveAttribute('data-outcome', 'skipped');
    expect(screen.getByTestId('deliver-lift-summary')).toHaveTextContent('the lift could not be decided — no remote default branch resolved');
    expect(screen.getByTestId('deliver-lift-summary')).toHaveTextContent("the deliver script's own rebase stands");
    unmount();

    seed(DELIVER_FAILED_TAIL);
    render(<RunDelivery view={view('distributed')} />);
    expect(screen.getByTestId('deliver-lift')).toHaveAttribute('data-outcome', 'failed');
    expect(screen.getByTestId('deliver-lift-summary')).toHaveTextContent('could not be applied — git read-tree -m -u exited 128');
    expect(screen.getByTestId('deliver-lift-failure')).toHaveTextContent('deliver: the lift onto origin/main');
  });

  it('the addendum: refused for a wrong HEAD ref — no lift frame, the engine\'s deliver: text on its own', () => {
    seed(DELIVER_WRONG_HEAD_TAIL);
    render(<RunDelivery view={view('distributed')} />);
    const lift = screen.getByTestId('deliver-lift');
    expect(lift).toHaveAttribute('data-outcome', 'refused');
    expect(lift).toHaveTextContent('refused before the lift');
    expect(screen.queryByTestId('deliver-lift-summary')).toBeNull();
    expect(screen.getByTestId('deliver-lift-failure')).toHaveTextContent(REFUSAL_WRONG_HEAD.replace(/`/g, ''));
  });

  it('a FAILED re-verify: floor fail, the red check marked (its stderr tail behind a collapsed block), the skipped one named, the refusal as the wire carries it — elided', () => {
    seed(DELIVER_REVERIFY_FAILED_TAIL);
    render(<RunDelivery view={view('distributed')} />);
    const floor = screen.getByTestId('deliver-lift-floor');
    expect(floor).toHaveAttribute('data-floor', 'fail');
    const rows = screen.getAllByTestId('deliver-lift-check');
    expect(rows.map((r) => [r.getAttribute('data-check'), r.getAttribute('data-ok')])).toEqual([
      ['install', 'true'], ['typecheck', 'true'], ['lint', 'false'],
    ]);
    expect(screen.getByTestId('deliver-lift-skipped')).toHaveTextContent('skipped (an earlier check failed): test');
    expect(screen.queryByTestId('deliver-lift-changed-tree')).toBeNull();
    // What the wire carries (F-255-04): the 150/250 head+tail of the 532-char refusal — the marker
    // renders dimmed between the kept words; the lockfile-drift sentence sits in the elided middle.
    expect(DETAIL_REVERIFY_FAILED).toMatch(/chars elided/);
    const failure = screen.getByTestId('deliver-lift-failure');
    expect(failure).toHaveTextContent('deliver: the tree that would ship');
    expect(within(failure).getByTestId('deliver-lift-failure-elided')).toHaveTextContent(/\[… \d+ chars elided …\]/);
    expect(failure).not.toHaveTextContent('Lockfile drift between the old base and the tip');
    expect(failure).toHaveTextContent('the checks run again until the tree passes');
    // The evidence behind the red row (F-255-03): lint's stderr tail, collapsed; the green rows carry none.
    const lint = rows.find((r) => r.getAttribute('data-check') === 'lint')!;
    const tail = within(lint).getByTestId('deliver-lift-check-tail');
    expect(tail.tagName).toBe('DETAILS');
    expect(tail).toHaveAttribute('data-stream', 'stderr');
    expect((tail as HTMLDetailsElement).open).toBe(false);
    expect(tail).toHaveTextContent('@typescript-eslint/no-explicit-any');
    expect(within(tail).getByText(/stderr tail/)).toBeInTheDocument();
    expect(screen.getAllByTestId('deliver-lift-check-tail')).toHaveLength(1);
  });

  it('a failed POST-CHECK PROOF: passed:false over all-green rows is explained as "the checks CHANGED the worktree"', () => {
    seed(DELIVER_CHANGED_TREE_TAIL);
    render(<RunDelivery view={view('distributed')} />);
    expect(screen.getByTestId('deliver-lift-floor')).toHaveAttribute('data-floor', 'fail');
    expect(screen.getAllByTestId('deliver-lift-check').every((r) => r.getAttribute('data-ok') === 'true')).toBe(true);
    expect(screen.getByTestId('deliver-lift-changed-tree')).toHaveTextContent('the checks CHANGED the worktree while running');
    expect(screen.getByTestId('deliver-lift-failure')).toHaveTextContent("deliver: the repository's checks passed but CHANGED the worktree while running");
  });

  it('no deliver-ord frame (an older daemon, or the phase not yet dispatched) ⇒ no block; no deliver unit ⇒ no block', () => {
    useRunEventStore.setState({ byRun: { [GATE_RUN]: G6_EVENTS } });
    const { unmount } = render(<RunDelivery view={view('pending')} />);
    expect(screen.queryByTestId('deliver-lift')).toBeNull();
    unmount();
    // A post-hoc-delivered run has no deliver unit to key the lift on.
    seed(DELIVER_LIFTED_TAIL);
    const v = makeView({ id: GATE_RUN, workflow_id: 'feature', status: 'completed' }, [makeUnit({ id: `${GATE_RUN}:fix`, session_id: GATE_RUN, ord: 3, status: 'done' })]);
    render(<RunDelivery view={v} />);
    expect(screen.queryByTestId('deliver-lift')).toBeNull();
  });
});
