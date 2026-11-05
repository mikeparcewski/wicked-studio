import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { proposalsFor, TrackerActions } from '../src/components/trackers/TrackerActions.js';
import { useCapabilities } from '../src/store/capabilities.js';

/**
 * DES-PM-001 §5 in studio: the Tracker actions card on the deliver gate and the delivery, over crew's
 * `GET/POST /runs/:id/tracker-actions` (pm-crew, api-types 0.187.0). Negative controls, each RED without its fix:
 *  - hidden (and reading nothing) on a crew without tracker links;
 *  - Confirm sends exactly the shown action (the card's body and hash) and nothing else;
 *  - Skip sends nothing;
 *  - the result shows as crew answers it, never before (no optimistic "posted");
 *  - an agent-kind 403 (`tracker_actions_human_only`) reads in plain words.
 */

const HASH = 'a'.repeat(64);
const HASH_T = 'b'.repeat(64);
const card = (over: Record<string, unknown> = {}) => ({
  runId: 'r1', source: 'acme-jira', system: 'jira', tenant: 'cloud-1', tenantLabel: 'acme.atlassian.net', issue: 'BILL-142',
  title: 'Proration rounds annual plans down', identity: 'crew-bot@acme.example', admittedBy: { kind: 'project', id: 'proj_billing' }, ...over,
});
const ISSUES = { runId: 'r1', issues: [
  { issue: 'BILL-142', ref: 'BILL-142', source: 'acme-jira', system: 'jira', trackerId: 'trk_bill', admittedBy: { kind: 'project', id: 'proj_billing' } },
  { issue: 'OPS-9', ref: 'OPS-9', source: 'acme-jira', system: 'jira', trackerId: 'trk_ops', admittedBy: null },
] };

let calls: Array<{ path: string; method: string; body: Record<string, unknown> | undefined }> = [];
let confirmImpl: (body: Record<string, unknown>) => Promise<unknown>;
beforeEach(() => {
  calls = [];
  useCapabilities.setState({ loaded: true, trackerLinks: true });
  confirmImpl = async (b) => ({ done: true, card: card(b['comment'] !== undefined ? { comment: b['comment'] } : {}), at: '2026-11-05T01:00:00Z', results: [{ part: b['comment'] !== undefined ? 'comment' : 'transition', ok: true }] });
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ path, method, body });
    if (path === '/runs/r1/tracker-actions' && method === 'GET') return Promise.resolve(ISSUES);
    if (path === '/runs/r1/tracker-actions' && method === 'POST') {
      if (body?.['confirm'] !== undefined) return confirmImpl(body);
      if (body?.['comment'] !== undefined) return Promise.resolve({ done: false, card: card({ comment: body['comment'] }), actionHash: HASH });
      return Promise.resolve({ done: false, card: card({ transition: { from: 'In Progress', to: 'In Review', mapped: { from: 'doing', to: 'doing' } } }), actionHash: HASH_T });
    }
    return Promise.reject(new ApiError(404, 'not found'));
  });
});
afterEach(() => { cleanup(); useCapabilities.setState({ trackerLinks: false }); });

const confirms = () => calls.filter((c) => c.method === 'POST' && c.body?.['confirm'] !== undefined);
const renderCard = async (): Promise<HTMLElement[]> => {
  render(<TrackerActions runId="r1" stage="gate" title="Fix the proration rounding" />);
  await waitFor(() => expect(screen.getAllByTestId('tracker-actions-confirm')).toHaveLength(2));
  return screen.getAllByTestId('tracker-actions-row');
};

describe('Tracker actions (deliver gate and delivery)', () => {
  it('hidden on a crew without tracker links, and reads nothing', async () => {
    useCapabilities.setState({ trackerLinks: false });
    const { container } = render(<TrackerActions runId="r1" stage="gate" title="t" />);
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([]);
  });

  it('lists crew’s card for each action on each issue crew still admits: the exact text, the move, the account and the link', async () => {
    const rows = await renderCard();
    expect(rows.map((r) => r.dataset.part)).toEqual(['comment', 'transition']);
    expect(within(rows[0]!).getByTestId('tracker-actions-comment')).toHaveTextContent('A change for this is waiting at the deliver gate of the job “Fix the proration rounding”.');
    expect(rows[1]).toHaveTextContent('Move BILL-142 from In Progress (doing) to In Review (doing)');
    expect(within(rows[0]!).getByTestId('tracker-actions-who')).toHaveTextContent('As crew-bot@acme.example on acme-jira · acme.atlassian.net · linked to proj_billing');
    // OPS-9 is no longer admitted: no card is even asked for.
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body?.['issue'])).toEqual(['BILL-142', 'BILL-142']);
    // Asking for the cards sends nothing: no confirm yet.
    expect(confirms()).toEqual([]);
  });

  it('Confirm sends exactly the shown action and nothing else, and the result is crew’s answer', async () => {
    let land!: (v: unknown) => void;
    confirmImpl = () => new Promise((r) => { land = r; });
    const rows = await renderCard();
    fireEvent.click(within(rows[0]!).getByTestId('tracker-actions-confirm'));
    await waitFor(() => expect(confirms()).toHaveLength(1));
    expect(confirms()[0]!.body).toEqual({ issue: 'BILL-142', comment: 'A change for this is waiting at the deliver gate of the job “Fix the proration rounding”.', confirm: HASH });
    // Not shown as posted until crew says so.
    expect(within(rows[0]!).getByTestId('tracker-actions-confirm')).toHaveTextContent('Posting…');
    expect(within(rows[0]!).queryByTestId('tracker-actions-result')).toBeNull();
    await act(async () => { land({ done: true, card: card({ comment: 'x' }), at: '2026-11-05T01:00:00Z', results: [{ part: 'comment', ok: false, error: 'the tool refused it: 403' }] }); });
    const result = await within(rows[0]!).findByTestId('tracker-actions-result');
    expect(result).toHaveTextContent('Comment not posted: the tool refused it: 403.');
    // The move was not touched.
    expect(confirms()).toHaveLength(1);
    expect(within(rows[1]!).getByTestId('tracker-actions-confirm')).toHaveTextContent('Confirm');
  });

  it('Skip sends nothing', async () => {
    const rows = await renderCard();
    const before = calls.length;
    fireEvent.click(within(rows[1]!).getByTestId('tracker-actions-skip'));
    expect(within(rows[1]!).getByTestId('tracker-actions-skipped')).toHaveTextContent('Skipped: nothing was sent.');
    await act(async () => { await Promise.resolve(); });
    expect(calls.length).toBe(before);
    expect(confirms()).toEqual([]);
  });

  it('an agent-kind 403 reads in plain words', async () => {
    const refusal = { error: 'only a person approves an action on a tracker; you are agent/operator', code: 'tracker_actions_human_only' };
    confirmImpl = async () => { throw new ApiError(403, refusal.error, refusal); };
    const rows = await renderCard();
    fireEvent.click(within(rows[0]!).getByTestId('tracker-actions-confirm'));
    const words = await within(rows[0]!).findByTestId('tracker-actions-refused');
    expect(words).toHaveTextContent('Only a person signed in to studio as an operator can approve an action on a tracker. A job’s or a plugin’s token can’t, so nothing was sent.');
    expect(words.textContent).not.toContain('the daemon refused this');
  });

  it('a card that changed since it was shown comes back as crew’s new card, waiting for a new click', async () => {
    confirmImpl = async () => { throw new ApiError(409, 'the card changed', { code: 'card_changed', card: card({ comment: 'x', identity: 'other@acme.example' }), actionHash: 'c'.repeat(64) }); };
    const rows = await renderCard();
    fireEvent.click(within(rows[0]!).getByTestId('tracker-actions-confirm'));
    expect(await within(rows[0]!).findByTestId('tracker-actions-note')).toHaveTextContent('The card changed since it was shown');
    expect(within(rows[0]!).getByTestId('tracker-actions-who')).toHaveTextContent('As other@acme.example');
    expect(confirms()).toHaveLength(1);
  });

  it('proposes a comment for every admitted issue, a move only for Jira (In Review at the gate, Done once delivered)', () => {
    const issues = [{ issue: 'BILL-1', ref: 'BILL-1', system: 'jira', admittedBy: { kind: 'project', id: 'p' } }, { issue: '#4', ref: 'acme/a#4', system: 'github', admittedBy: { kind: 'repo', id: 'a' } }, { issue: 'X-1', ref: 'X-1', system: 'jira', admittedBy: null }];
    expect(proposalsFor(issues, 'delivery', { title: 'T', prUrl: 'https://github.com/acme/a/pull/7' }).map((p) => p.body)).toEqual([
      { issue: 'BILL-1', comment: 'Delivered in https://github.com/acme/a/pull/7 (job “T”).' },
      { issue: 'BILL-1', transition: 'Done' },
      { issue: 'acme/a#4', comment: 'Delivered in https://github.com/acme/a/pull/7 (job “T”).' },
    ]);
    expect(proposalsFor(issues, 'gate', { title: 'T', prUrl: null }).filter((p) => p.part === 'transition').map((p) => p.body.transition)).toEqual(['In Review']);
  });
});
