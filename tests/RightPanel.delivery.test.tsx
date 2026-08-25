import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RightPanel } from '../src/components/RightPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { makeUnit, makeView } from './factories.js';
import {
  NO_URL_REASON,
  NOTHING_REASON,
  REAL_DELIVER_OUTPUT,
  REAL_PR_URL,
} from './fixtures/deliverOutput.js';
import type { SessionView, UnitStatus } from '../src/api/types.js';

/**
 * The Delivery rail section (wicked-studio#122, slice DA) under the OPERATOR's
 * amended spec (2026-08-24): "delivery isn't a top level class, it goes in the
 * right chat panel as a tab". So — a ninth accordion governed by the same
 * `openAccordion`, never a pinned band and never a tablist conversion; the
 * at-a-glance signal lives on the header badge instead (revised EC54).
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
  it('has exactly 9 sections and still opens on What / Where', () => {
    render(<RightPanel view={run('r-shape', 'done')} />);

    const headers = screen.getAllByRole('button', { expanded: false })
      .concat(screen.getAllByRole('button', { expanded: true }));
    expect(headers).toHaveLength(9);
    expect(screen.getByRole('button', { name: /What \/ Where/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Delivery/ })).toHaveAttribute('aria-expanded', 'false');
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

  it('the badge states the outcome WITHOUT any gesture', () => {
    const cases: { status: UnitStatus; denial: string | null; state: string; label: string }[] = [
      { status: 'done', denial: null, state: 'delivered', label: 'PR open' },
      { status: 'rejected', denial: NOTHING_REASON, state: 'nothing-to-deliver', label: 'nothing delivered' },
      { status: 'rejected', denial: NO_URL_REASON, state: 'failed', label: 'deliver failed' },
      { status: 'pending', denial: null, state: 'in-flight', label: 'pending' },
    ];
    for (const [i, c] of cases.entries()) {
      render(<RightPanel view={run(`r-badge-${i}`, c.status, c.denial)} />);
      const badge = screen.getByTestId('run-delivery-badge');
      expect(badge).toHaveAttribute('data-state', c.state);
      expect(badge).toHaveTextContent(c.label);
      cleanup();
    }
  });

  it('EC57: a run with no deliver phase carries no badge — silence, not "unknown"', () => {
    const view = makeView({ id: 'r-none', workflow_id: 'feature', workdir: '/w/tree' }, [
      makeUnit({ id: 'r-none:build', session_id: 'r-none', ord: 0, status: 'done' }),
    ]);
    render(<RightPanel view={view} />);

    expect(screen.getByRole('button', { name: /Delivery/ })).toBeInTheDocument();
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
    expect(getUnitOutput).toHaveBeenCalledTimes(1);
    expect(getUnitOutput).toHaveBeenCalledWith('r-pr', 'r-pr:deliver');
    expect(screen.getByTestId('run-delivery')).toHaveAttribute('data-state', 'delivered');
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

  it('a run with no deliver phase names the worktree and the remedy, and reads nothing', async () => {
    const view = makeView({ id: 'r-nodeliver', workflow_id: 'feature', workdir: '/w/tree' }, [
      makeUnit({ id: 'r-nodeliver:build', session_id: 'r-nodeliver', ord: 0, status: 'done' }),
    ]);
    render(<RightPanel view={view} />);
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }));

    const body = await screen.findByTestId('run-delivery');
    expect(body).toHaveAttribute('data-state', 'none');
    expect(body).toHaveTextContent('deliver: pr');
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
