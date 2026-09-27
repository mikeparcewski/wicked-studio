// Studio Wave B, idea 4 — TRIAGE BY CONSEQUENCE on Home's "N proposals to review" row:
//   the group row counts what an accept DOES (memory-only vs changes enforcement) and carries
//   "Accept N memory-only ›"; the click PREVIEWS exactly which ones, the confirm waits out the undo
//   window, then each is accepted through the existing `POST /proposals/:id/approve`. The ones
//   that change enforcement stay listed for individual review, at most 4 at a time.

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '../src/api/proposals.js';

const { approveProposal, listProposals } = vi.hoisted(() => ({
  approveProposal: vi.fn(async (id: string) => ({ outcome: 'promoted', active_id: `m-${id}` })),
  listProposals: vi.fn(async () => [] as Proposal[]),
}));
vi.mock('../src/api/proposals.js', async (orig) => {
  const real = await orig<typeof import('../src/api/proposals.js')>();
  return { ...real, approveProposal, listProposals };
});

import { groupAlike, memberPage } from '../src/board/needsQueue.js';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { proposalConsequence } from '../src/board/proposalTriage.js';
import { flushDecisionsForTest, setUndoWindowForTest, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { NeedsQueueSurface } from '../src/components/NeedsYouQueue.js';

const NOW = Date.UTC(2026, 8, 27, 12);

afterEach(cleanup);
beforeEach(() => {
  approveProposal.mockClear();
  listProposals.mockClear();
});

const mem = (i: number): Proposal => ({
  id: `mem-${i}`, kind_type: 'memory', payload: { content: `Remember fact ${i}`, tier: 'semantic' },
  facets: {}, provenance: {}, state: 'pending', created_at: Math.floor(NOW / 1000) - 3600 - i,
});
const pol = (i: number, type = 'security'): Proposal => ({
  id: `pol-${i}`, kind_type: `policy:${type}`, payload: { rule: `Rule ${i} must hold`, severity: 'warn' },
  facets: {}, provenance: {}, state: 'pending', created_at: Math.floor(NOW / 1000) - 7200 - i,
});

function inputs(proposals: Proposal[]): NeedsYouInputs {
  return { runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {}, chats: [], repos: [], campaigns: [], now: NOW, proposals };
}

const MEMS = Array.from({ length: 5 }, (_, i) => mem(i));
const POLS = Array.from({ length: 6 }, (_, i) => pol(i));
const MIXED = [...MEMS, ...POLS];

describe('the model: what an accept does, read from kind_type', () => {
  it('memory is harmless, policy changes enforcement, anything else is unknown', () => {
    expect(proposalConsequence(mem(0))).toBe('memory');
    expect(proposalConsequence(pol(0))).toBe('enforcement');
    expect(proposalConsequence({ ...mem(0), kind_type: 'skill' })).toBe('unknown');
  });

  it('the group row names the split and carries "Accept 5 memory-only ›" for exactly the memories', () => {
    const rows = groupAlike(needsYouRows(inputs(MIXED)), NOW);
    const group = rows.find((r) => r.groupKey === 'proposal')!;
    expect(group.subject).toBe('11 proposals to review');
    expect(group.text).toBe('5 memory-only · 6 change enforcement');
    expect(group.action).toMatchObject({ kind: 'accept-memory', label: 'Accept 5 memory-only ›' });
    expect([...(group.action as { ids: string[] }).ids].sort()).toEqual(MEMS.map((p) => p.id).sort());
  });

  it('a group with no memory proposals offers no batch accept', () => {
    const group = groupAlike(needsYouRows(inputs(POLS)), NOW).find((r) => r.groupKey === 'proposal')!;
    expect(group.action.kind).toBe('open');
    expect(group.text).toBe('6 change enforcement');
  });

  it('enforcement-changing members list first, 4 per page', () => {
    const group = groupAlike(needsYouRows(inputs(MIXED)), NOW).find((r) => r.groupKey === 'proposal')!;
    const first = memberPage(group, 0);
    expect(first.items).toHaveLength(4);
    expect(first.items.every((m) => m.proposal?.consequence === 'enforcement')).toBe(true);
    expect(first.pages).toBe(3);
    expect(memberPage(group, 1).items.map((m) => m.proposal?.consequence)).toEqual(['enforcement', 'enforcement', 'memory', 'memory']);
    expect(first.items[0]!.text).toBe('Changes enforcement — lands a security rule (warn)');
  });
});

describe('the row: one click accepts exactly the harmless set, the rest remain', () => {
  it('previews exactly the memories, waits out the undo window, then approves only those', async () => {
    setUndoWindowForTest(10_000);
    // After the accept the queue re-reads: only the enforcement-changing ones are still pending.
    listProposals.mockResolvedValue(POLS);
    render(<NeedsQueueSurface rows={needsYouRows(inputs(MIXED))} runs={[]} navigate={() => {}} now={NOW} />);
    const acceptBtn = screen.getByTestId('need-accept-act');
    expect(acceptBtn).toHaveTextContent('Accept 5 memory-only ›');
    await userEvent.click(acceptBtn);
    // The preview names exactly the five, and nothing is posted yet.
    const preview = screen.getByTestId('need-accept-preview');
    expect(within(preview).getAllByTestId('need-accept-item').map((li) => li.getAttribute('data-id')).sort())
      .toEqual(MEMS.map((p) => p.id).sort());
    expect(preview).toHaveTextContent('5 memories become active for workers to recall; no rule is written and enforcement is unchanged. 6 proposals stay for individual review.');
    expect(approveProposal).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('need-accept-confirm'));
    // Queued behind the undo window: still nothing posted.
    expect(screen.getByTestId('need-accept-act')).toHaveAttribute('data-accept-phase', 'queued');
    const pending = useUndoQueue.getState().pending;
    expect(pending).toHaveLength(1);
    expect(approveProposal).not.toHaveBeenCalled();
    // The window ends (the test shortens it): each memory is approved, no policy is.
    setUndoWindowForTest(0);
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(approveProposal).toHaveBeenCalledTimes(5));
    expect(approveProposal.mock.calls.map((c) => c[0]).sort()).toEqual(MEMS.map((p) => p.id).sort());
    expect(approveProposal.mock.calls.some((c) => String(c[0]).startsWith('pol-'))).toBe(false);
    await waitFor(() => expect(listProposals).toHaveBeenCalled());
  });

  it('Undo sends nothing', async () => {
    setUndoWindowForTest(10_000);
    render(<NeedsQueueSurface rows={needsYouRows(inputs(MIXED))} runs={[]} navigate={() => {}} now={NOW} />);
    await userEvent.click(screen.getByTestId('need-accept-act'));
    await userEvent.click(screen.getByTestId('need-accept-confirm'));
    const id = useUndoQueue.getState().pending[0]!.id;
    act(() => undoDecision(id));
    await waitFor(() => expect(screen.getByTestId('need-accept-act')).toHaveAttribute('data-accept-phase', 'idle'));
    expect(approveProposal).not.toHaveBeenCalled();
  });

  it('the expanded list shows at most 4 at a time, enforcement first, and pages', async () => {
    render(<NeedsQueueSurface rows={needsYouRows(inputs(MIXED))} runs={[]} navigate={() => {}} now={NOW} />);
    await userEvent.click(screen.getByTestId('need-group-toggle'));
    const shown = () => screen.getAllByTestId('need-member');
    expect(shown()).toHaveLength(4);
    expect(shown().every((m) => m.getAttribute('data-key')!.startsWith('proposal:pol-'))).toBe(true);
    expect(screen.getByTestId('need-members-pager')).toHaveTextContent('Showing 1–4 of 11');
    await userEvent.click(screen.getByTestId('need-page-next'));
    expect(shown()).toHaveLength(4);
    expect(screen.getByTestId('need-members-pager')).toHaveTextContent('Showing 5–8 of 11');
  });
});
