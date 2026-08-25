import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RightPanel } from '../src/components/RightPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { LIVE_WORKFLOWS } from './fixtures/workflows.js';
import {
  EMPTY_PUSH_OUTPUT,
  NO_URL_REASON,
  NOTHING_REASON,
  REAL_DELIVER_OUTPUT,
  REAL_PR_URL,
} from './fixtures/deliverOutput.js';
import type { SessionView, UnitStatus } from '../src/api/types.js';

/**
 * The Delivery rail section (wicked-studio#122, slice DA) under the OPERATOR's
 * amended spec (2026-08-24): "delivery isn't a top level class, it goes in the
 * right chat panel as a tab". So — a conditional last accordion governed by the
 * same `openAccordion`, never a pinned band and never a tablist conversion; the
 * at-a-glance signal lives on the header badge instead (revised EC54).
 *
 * The section count is NINE on a run that can deliver and EIGHT on one that
 * cannot. There is no fixed nine.
 */

let getUnitOutput: ReturnType<typeof vi.fn>;

/** A build run with a deliver phase in the given state. Distinct ids per test:
 *  the delivery + provenance caches are per-run-id and outlive a render. */
function run(id: string, status: UnitStatus, denial: string | null = null): SessionView {
  return makeView(
    { id, workflow_id: 'feature', status: 'completed', problem: 'wire the thing', workdir: '/w/tree' },
    [
      makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
      makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status, denial_reason: denial }),
    ],
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  useRunEventStore.setState({ byRun: {} });
  useDeliveryStore.setState({ byRun: {} });
  useProvenanceStore.setState({ byRun: {}, launchedHere: {} });
  // The app's ONE workflow-defs read (studio#122 D-1). The rail's visibility
  // gate and its remedy line both consult `is_system` now, so the panel is
  // rendered here against the REAL daemon table, cold cache each time.
  clearCachedWorkflows();
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: LIVE_WORKFLOWS });
  vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [] });
  vi.spyOn(client.api, 'getRun').mockImplementation((id: string) =>
    Promise.resolve({ run: run(id, 'done') }),
  );
  getUnitOutput = vi.fn().mockResolvedValue({ output: REAL_DELIVER_OUTPUT });
  vi.spyOn(client.api, 'getUnitOutput').mockImplementation(
    getUnitOutput as unknown as typeof client.api.getUnitOutput,
  );
});
afterEach(cleanup);

describe('the rail keeps its shape (revised EC54)', () => {
  const sectionCount = (): number =>
    screen.getAllByRole('button', { expanded: false })
      .concat(screen.getAllByRole('button', { expanded: true })).length;

  it('the real contract: NINE sections on a build run, EIGHT on a chat thread', () => {
    // "Exactly nine" was never the contract — Delivery is the CONDITIONAL ninth,
    // and hiding it on threads that can never deliver is the product decision
    // (the operator put delivery in the right panel as a tab; a chat thread has
    // no deliver phase and never will). Both halves are pinned here so neither
    // can drift into a fixed count.
    render(<RightPanel view={run('r-shape', 'done')} />);
    expect(sectionCount()).toBe(9);
    expect(screen.getByRole('button', { name: /What \/ Where/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Delivery/ })).toHaveAttribute('aria-expanded', 'false');
    cleanup();

    render(<RightPanel view={makeView({ id: 'r-shape-chat', workflow_id: 'chat' }, [])} />);
    expect(sectionCount()).toBe(8);
    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();
  });

  it('renders no delivery element outside the rail, and no band above it', () => {
    const { container } = render(<RightPanel view={run('r-band', 'done')} />);

    // The badge is the ONLY delivery element before a gesture; the body is not
    // in the document at all until the section is opened.
    expect(screen.getByTestId('run-delivery-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('run-delivery')).not.toBeInTheDocument();

    // …and it lives INSIDE the Delivery header button, not in a band of its own.
    const header = screen.getByRole('button', { name: /Delivery/ });
    expect(header).toContainElement(screen.getByTestId('run-delivery-badge'));
    // The rail is still an accordion list, never a tablist (the DocPanel strip).
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('the badge states the outcome WITHOUT any gesture — and never claims a PR unread', () => {
    const cases: { status: UnitStatus; denial: string | null; state: string; label: string }[] = [
      // `done` with no url in hand is the PHASE, not the artifact (D2). This is
      // the 665a9aeb row: the first cut said "PR open" here.
      { status: 'done', denial: null, state: 'delivered', label: 'deliver ran' },
      { status: 'rejected', denial: NOTHING_REASON, state: 'nothing-to-deliver', label: 'nothing delivered' },
      { status: 'rejected', denial: NO_URL_REASON, state: 'failed', label: 'deliver failed' },
      { status: 'pending', denial: null, state: 'in-flight', label: 'pending' },
    ];
    for (const [i, c] of cases.entries()) {
      render(<RightPanel view={run(`r-badge-${i}`, c.status, c.denial)} />);
      const badge = screen.getByTestId('run-delivery-badge');
      expect(badge).toHaveAttribute('data-state', c.state);
      expect(badge).toHaveTextContent(c.label);
      expect(badge.textContent).not.toMatch(/\bPR\b/);
      cleanup();
    }
  });

  it('the badge upgrades to the PR claim ONLY once a url is in hand', async () => {
    render(<RightPanel view={run('r-badge-up', 'done')} />);
    const badge = () => screen.getByTestId('run-delivery-badge');
    expect(badge()).toHaveAttribute('data-state', 'delivered');
    expect(badge()).toHaveTextContent('deliver ran');

    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));
    await screen.findByTestId('run-delivery-link');

    expect(badge()).toHaveAttribute('data-state', 'pr-open');
    expect(badge()).toHaveTextContent('PR open');
  });

  it('D1: the badge cannot contradict its own body — the 665a9aeb shape, both halves', async () => {
    // The REAL wire shape: deliver unit `done`, `denial_reason: null`, and the
    // real 677-byte transcript, which carries one `/pull/new/` form and zero
    // numbered PRs. The first cut painted "PR open" in `--accent` on the header
    // while the body underneath said no PR link was recorded.
    getUnitOutput.mockResolvedValue({ output: EMPTY_PUSH_OUTPUT });
    render(<RightPanel view={run('r-665a9aeb', 'done')} />);

    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));
    const body = await screen.findByTestId('run-delivery-nolink');

    const badge = screen.getByTestId('run-delivery-badge');
    expect(badge).toHaveAttribute('data-state', 'delivered');
    expect(badge).toHaveTextContent('deliver ran');
    // Body and badge agree, and neither claims an artifact.
    const panel = screen.getByTestId('run-delivery');
    expect(panel).toHaveAttribute('data-state', 'delivered');
    expect(body).toHaveTextContent('the deliver phase recorded no PR link — nothing can be pointed at');
    expect(screen.queryByTestId('run-delivery-link')).not.toBeInTheDocument();
    // And the badge is not painted as the PR accent nor as a failure.
    expect(badge.style.color).toBe('var(--ink-muted)');

    // The HEADLINE is the loudest sentence in the section and was the one the
    // first cut got wrong; pin the rendered words, not just the badge's.
    expect(panel).toHaveTextContent('The deliver phase ran and crew approved it. That alone is not a PR.');
    expect(panel.textContent ?? '').not.toMatch(/\bPR open\b/i);

    // …and the "no link" line is MUTED, not `--status-fail`: an approved phase
    // that produced no PR is missing evidence, not a run that failed. The
    // colour is the claim as much as the words are.
    expect(body.style.color).toBe('var(--ink-muted)');
    expect(body.style.color).not.toBe('var(--status-fail)');
  });

  it('EC57: a run with no deliver phase carries no badge — silence, not "unknown"', async () => {
    const view = makeView({ id: 'r-none', workflow_id: 'feature', workdir: '/w/tree' }, [
      makeUnit({ id: 'r-none:build', session_id: 'r-none', ord: 0, status: 'done' }),
    ]);
    render(<RightPanel view={view} />);

    // The section itself waits for the def that proves `feature` deliverable —
    // `tests/delivery.coldCache.test.tsx` owns that half. Once it is here, the
    // header carries no badge: a run with no deliver phase has no state worth a
    // chip, and silence beats an "unknown" one.
    expect(await screen.findByRole('button', { name: /Delivery/ })).toBeInTheDocument();
    expect(screen.queryByTestId('run-delivery-badge')).not.toBeInTheDocument();
  });

  it('EC57: a CHAT thread gets no Delivery section at all', () => {
    const view = makeView({ id: 'r-chat', workflow_id: 'chat' }, []);
    render(<RightPanel view={view} />);

    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-delivery-badge')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /What \/ Where|Decisions|Governance|Burn|Data|Steering|Assumptions|Files referenced/ }))
      .toHaveLength(8);
  });
});

describe('opening Delivery for a run that DID open a PR (EC55, EC59)', () => {
  it('fires ONE output read, keyed by the deliver unit\'s FULL id, and links the numbered PR', async () => {
    render(<RightPanel view={run('r-pr', 'done')} />);
    expect(getUnitOutput).not.toHaveBeenCalled(); // gesture-gated

    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    const link = await screen.findByTestId('run-delivery-link');
    expect(link).toHaveAttribute('href', REAL_PR_URL);
    expect(link.getAttribute('href')).toMatch(/^https:\/\/\S+\/pull\/\d+$/);
    // The link opens a third-party origin, so pin BOTH tokens (Copilot on #125). Modern
    // browsers imply `noopener` for `target="_blank"`, but the repo's own external links
    // (Markdown.tsx, RepoDetailPage.tsx) state it explicitly and this must not be the
    // one that drifts.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(getUnitOutput).toHaveBeenCalledTimes(1);
    expect(getUnitOutput).toHaveBeenCalledWith('r-pr', 'r-pr:deliver');
    // The url is in hand, so — and only so — the claim becomes the artifact.
    expect(screen.getByTestId('run-delivery')).toHaveAttribute('data-state', 'pr-open');
  });

  it('EC55 negative pin: no href anywhere in the panel contains /pull/new/', async () => {
    const { container } = render(<RightPanel view={run('r-trap', 'done')} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));
    await screen.findByTestId('run-delivery-link');

    const hrefs = [...container.querySelectorAll('[href]')].map((e) => e.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('/pull/new/'))).toBe(false);
    expect(hrefs).toContain(REAL_PR_URL);
  });

  it('EC61: an OVERLAY-named deliver unit resolves by tool_cmd and reads its own id', async () => {
    const view = makeView({ id: 'r-ovl', workflow_id: 'feature-pr', status: 'completed', workdir: '/w/tree' }, [
      makeUnit({ id: 'r-ovl:build', session_id: 'r-ovl', ord: 0, status: 'done' }),
      makeUnit({
        id: 'r-ovl:open-the-pr', session_id: 'r-ovl', ord: 1, status: 'done',
        tool_cmd: ['bash', '-lc', 'git push …\ngh pr create --head "$B" --fill'],
      }),
    ]);
    render(<RightPanel view={view} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    expect(await screen.findByTestId('run-delivery-link')).toHaveAttribute('href', REAL_PR_URL);
    expect(getUnitOutput).toHaveBeenCalledWith('r-ovl', 'r-ovl:open-the-pr');
  });

  it('re-opening the section re-reads nothing — the budget is one per run', async () => {
    render(<RightPanel view={run('r-once', 'done')} />);
    const header = screen.getByRole('button', { name: /Delivery/ });

    fireEvent.click(header);
    await screen.findByTestId('run-delivery-link');
    fireEvent.click(header); // collapse
    fireEvent.click(header); // and open again
    await screen.findByTestId('run-delivery-link');

    expect(getUnitOutput).toHaveBeenCalledTimes(1);
  });

  it('EC59: a delivered run whose transcript carries no url says so — never a linkless "Delivered"', async () => {
    getUnitOutput.mockResolvedValue({ output: 'Everything up-to-date\n' });
    render(<RightPanel view={run('r-nolink', 'done')} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    expect(await screen.findByTestId('run-delivery-nolink'))
      .toHaveTextContent('the deliver phase recorded no PR link — nothing can be pointed at');
    expect(screen.queryByTestId('run-delivery-link')).not.toBeInTheDocument();
  });

  it('an EMPTY `outputUnavailable` falls back to studio\'s sentence, never a blank line', async () => {
    // `outputUnavailable ?? null` kept the empty string and the panel painted an
    // empty red paragraph where the reason belongs — absent and empty both mean
    // "the daemon said nothing", so both take the fallback.
    getUnitOutput.mockResolvedValue({ output: null, outputUnavailable: '' });
    render(<RightPanel view={run('r-blank', 'done')} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    expect((await screen.findByTestId('run-delivery-nolink')).textContent)
      .toStrictEqual('the deliver phase recorded no PR link — nothing can be pointed at');
  });

  it('EC59: `outputUnavailable` renders the DAEMON\'s words, never an indefinite Loading…', async () => {
    getUnitOutput.mockResolvedValue({
      output: null,
      outputUnavailable: 'the unit was denied — deny-dominates stores no output past a deny',
    });
    render(<RightPanel view={run('r-unavail', 'done')} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    expect(await screen.findByTestId('run-delivery-nolink')).toHaveTextContent(
      'the unit was denied — deny-dominates stores no output past a deny',
    );
  });
});

describe('a run that delivered NOTHING (EC56)', () => {
  it('renders denial_reason by STRING EQUALITY and fires ZERO output reads', async () => {
    render(<RightPanel view={run('r-empty', 'rejected', NOTHING_REASON)} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    const reason = await screen.findByTestId('run-delivery-reason');
    // Equality, not phrase-matching: a message crew truncates must degrade, not
    // be re-worded into something studio made up (crew#322).
    expect(reason.textContent).toStrictEqual(NOTHING_REASON);
    expect(screen.getByTestId('run-delivery')).toHaveAttribute('data-state', 'nothing-to-deliver');
    // A rejected unit has NO stored transcript by design — asking is the bug.
    expect(getUnitOutput).not.toHaveBeenCalled();
  });

  it('a deliver failure for any other reason is `failed`, same verbatim rule, same zero reads', async () => {
    render(<RightPanel view={run('r-fail', 'rejected', NO_URL_REASON)} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    const reason = await screen.findByTestId('run-delivery-reason');
    expect(reason.textContent).toStrictEqual(NO_URL_REASON);
    expect(screen.getByTestId('run-delivery')).toHaveAttribute('data-state', 'failed');
    expect(getUnitOutput).not.toHaveBeenCalled();
  });

  it('a null denial_reason says crew recorded none, and synthesizes nothing', async () => {
    render(<RightPanel view={run('r-silent', 'rejected', null)} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    expect((await screen.findByTestId('run-delivery-reason')).textContent)
      .toStrictEqual('crew recorded no reason');
    expect(getUnitOutput).not.toHaveBeenCalled();
  });

  it('an EMPTY denial_reason takes the same fallback, never a blank paragraph', async () => {
    // `reason ?? '…'` keeps `''` — the same absent-vs-empty bug already fixed in
    // `store/delivery.ts`, one field over. Normalized at the derivation now.
    render(<RightPanel view={run('r-blank-reason', 'rejected', '')} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    expect((await screen.findByTestId('run-delivery-reason')).textContent)
      .toStrictEqual('crew recorded no reason');
  });

  it('a run with no deliver phase names the worktree and the remedy, and reads nothing', async () => {
    const view = makeView({ id: 'r-nodeliver', workflow_id: 'feature', workdir: '/w/tree' }, [
      makeUnit({ id: 'r-nodeliver:build', session_id: 'r-nodeliver', ord: 0, status: 'done' }),
    ]);
    render(<RightPanel view={view} />);
    // The SECTION waits for the defs, not just the remedy line (D-1's cold-cache
    // invariant, tightened): "this run has no deliver phase" is a claim about a
    // classification, so `feature` gets it only once the daemon's own flag
    // confirms the workflow is ordinary. `tests/delivery.coldCache.test.tsx`
    // owns the withheld half.
    fireEvent.click(await screen.findByRole('button', { name: /Delivery/ }));

    const body = await screen.findByTestId('run-delivery');
    expect(body).toHaveAttribute('data-state', 'none');
    await waitFor(() => expect(body).toHaveTextContent('deliver: pr'));
    expect(getUnitOutput).not.toHaveBeenCalled();
  });
});

describe('EC60: the Files panel stops presenting attention as outcome', () => {
  it('is labelled "Files referenced" and captions what it actually counts', async () => {
    const id = 'r-files';
    useRunEventStore.getState().hydrate(id, [
      { type: 'dataUsed', session: id, ord: 0, files: ['/w/tree/a.ts', '/w/tree/b.ts'] },
    ]);
    render(<RightPanel view={run(id, 'rejected', NOTHING_REASON)} />);

    expect(screen.getByRole('button', { name: /Files referenced/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Files referenced/ }));
    expect(await screen.findByTestId('files-scope-note')).toHaveTextContent(
      'files the agents read or wrote in the worktree — not a delivered changeset',
    );
    // The 665a9aeb shape: a file count beside a delivery that produced nothing.
    // The count no longer claims to be the run's outcome — the caption disclaims
    // it, and the Delivery badge carries the outcome instead.
    expect(screen.getByTestId('run-delivery-badge')).toHaveAttribute('data-state', 'nothing-to-deliver');
  });
});

describe('the rail heals a stale open section (Copilot on #125)', () => {
  it('falls back to What / Where when the open section disappears with the run', async () => {
    // `openAccordion` is mount-scoped and RightPanel does not remount between runs. Open
    // Delivery on a run that CAN deliver, then hand the SAME mounted panel a run that cannot:
    // the id is now absent from `sections`, and the rail must not render with nothing open.
    const deliverable = run('r-stale-yes', 'done');
    const notDeliverable = makeView({ id: 'r-stale-no', workflow_id: 'chat' }, []);

    const { rerender } = render(<RightPanel view={deliverable} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));
    await screen.findByTestId('run-delivery');

    rerender(<RightPanel view={notDeliverable} />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Delivery/ })).toBeNull();
    });
    const expanded = document.querySelectorAll('[aria-expanded="true"]');
    expect(expanded.length).toBe(1);
    expect(expanded[0]?.textContent).toContain('What / Where');
  });

  it('a deliberately collapsed rail STAYS collapsed — null is a real state, not a stale id', async () => {
    render(<RightPanel view={run('r-stale-null', 'done')} />);
    fireEvent.click(screen.getByRole('button', { name: /What \/ Where/ }));
    await waitFor(() => {
      expect(document.querySelectorAll('[aria-expanded="true"]').length).toBe(0);
    });
  });
});
