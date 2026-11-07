import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-CHAT-ARTIFACTS-001 slice A5 (studio; plugins-complete G4): a refine card keeps the person's own edits.
 *  - The card lists crew's protected edits: the ones the ask is about inline, the rest folded; each is "Keep it"
 *    (preselected) or "Let this change it". Go sends `edits.allow` with exactly the released ids, none when all are kept.
 *  - A re-resolved card (the document moved before Go) draws the new head's edits, all kept again.
 *  - "Kept your N edits" only once a version made by the run is in the document; a refusal says crew's reason.
 *  - A crew-made retry reads "Try again".
 */

const { ArtifactProposalCard } = await import('../src/components/chat/ArtifactProposalCard.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { goWords, protectedGroups, refineGoEdits, refineOutcome, refineOutcomeLine, isArtifactProposal, resetSettledProposals } = await import('../src/board/artifactProposal.js');
type Proposal = import('../src/api/chatArtifacts-wire.js').ArtifactProposal;
type Entry = import('../src/board/artifactProposal.js').ProposalEntry;

const PID = 'chat-r:t1';
const RUN = 'bbbbbbbb-1111-5222-8333-444444444444';
const TITLE = { id: 'text:h#0a1b2c3d', kind: 'text' as const, label: 'slide 1 · heading “Release 0.17”', wid: 'h', touched: true };
const ORDER = { id: 'order#11112222', kind: 'order' as const, label: 'your slide order', wid: null, touched: false };
const GONE = { id: 'gone:sec-s5', kind: 'gone' as const, label: 'removed slide 5', wid: 'sec-s5', touched: false };

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    pid: PID, chatId: 'chat-r', turnId: 't1', kind: 'refine', seat: 'claude',
    what: { entry: null, title: 'Coverage deck', label: 'Change · Coverage deck', outcome: 'A new version of the document. Your own edits are kept.' },
    brief: 'tighten the speaker notes', reason: null, sources: [], repos: [],
    helpers: { seats: ['codex', 'claude'], label: 'Codex and Claude Code: one writes, the other checks' },
    time: null, stops: 'Stops for you if the check fails.', filedIn: { projectId: 'mikes', label: 'Mikes' },
    target: { ref: 'mikes/coverage-deck', title: 'Coverage deck', base: 3 },
    protected: [TITLE, ORDER, GONE],
    blocked: null,
    ...over,
  };
}
const entry = (p: Proposal, over: Partial<Entry> = {}): Entry => ({ pid: p.pid, turnId: 't1', at: 1, proposal: p, state: 'open', ...over });

const posts: Array<{ path: string; body: unknown }> = [];
let decideAnswer: () => Response = () => new Response('{}', { status: 500 });
let versions: Array<{ version: number; run_id?: string | null }> = [];
const ok = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  posts.length = 0;
  versions = [];
  resetSettledProposals();
  useCapabilities.setState({ loaded: true, chatProposals: true });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname;
    if (init?.method === 'POST') {
      posts.push({ path: path.replace(/^\/api\/v1/, ''), body: JSON.parse(String(init.body)) });
      return Promise.resolve(decideAnswer());
    }
    if (path.endsWith('/api/versions')) return Promise.resolve(ok({ head: versions.at(-1)?.version ?? 3, versions: versions.map((v) => ({ parent: null, feedback_file: null, html_file: `_v${v.version}.html`, created_at: '', ...v })) }));
    return Promise.resolve(ok({}));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const text = (id: string): string => screen.getByTestId(id).textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('the refine board model', () => {
  it('groups, the allow a Go carries, the retry words and the outcome only once the version landed', () => {
    const p = proposal();
    expect(protectedGroups(p)).toEqual({ touched: [TITLE], rest: [ORDER, GONE] });
    expect(refineGoEdits(p, new Set())).toBeUndefined();
    // Only ids the card shows: a stale or invented id never rides a Go.
    expect(refineGoEdits(p, new Set([TITLE.id, 'text:x#00000000']))).toEqual({ allow: [TITLE.id] });
    expect(goWords(p)).toBe('Make the change');
    expect(goWords(proposal({ sourceRunId: 'r-1', turnId: null }))).toBe('Try again');
    const run = { session: { id: RUN } };
    expect(refineOutcome(run, [{ version: 4, run_id: 'other' }], 2)).toEqual({ kind: 'pending' });
    expect(refineOutcomeLine(refineOutcome(run, [{ version: 4, run_id: RUN }], 2))).toBe('v4 made · kept your 2 edits');
    expect(refineOutcomeLine(refineOutcome({ session: { id: RUN, landing_failed: { reason: 'the revision did not keep your edits' } } }, null, 2)))
      .toBe('Not changed: the revision did not keep your edits');
    expect(isArtifactProposal({ ...p, protected: [{ id: 'x', kind: 'bogus', label: 'x', wid: null, touched: false }] })).toBe(false);
  });
});

describe('the refine card', () => {
  it('lists the edits the ask is about inline and folds the rest; keeping them all sends no allow', async () => {
    decideAnswer = () => ok({ view: { proposal: proposal(), state: 'decided', decision: 'go', result: { runId: RUN, artifactRef: 'mikes/coverage-deck', adopted: false, stub: false } } });
    render(<ArtifactProposalCard chatId="chat-r" entry={entry(proposal())} seatName="Claude Code" stub={false} onChanged={() => {}} />);
    const rows = screen.getAllByTestId('artifact-proposal-protected-edit');
    expect(rows.map((r) => r.getAttribute('data-edit-id'))).toEqual([TITLE.id]);
    expect(text('artifact-proposal-protected-more')).toBe('Keeping 2 more of your edits');
    expect((screen.getAllByTestId('artifact-proposal-keep')[0] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toEqual({ decision: 'go' });
  });

  it('"Let this change it" sends exactly that edit in allow, folded ones included', async () => {
    decideAnswer = () => ok({ view: { proposal: proposal(), state: 'decided', decision: 'go', result: { runId: RUN, artifactRef: 'mikes/coverage-deck', adopted: false, stub: false } } });
    render(<ArtifactProposalCard chatId="chat-r" entry={entry(proposal())} seatName="Claude Code" stub={false} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId('artifact-proposal-let-change'));
    fireEvent.click(screen.getByTestId('artifact-proposal-protected-more'));
    const order = screen.getAllByTestId('artifact-proposal-protected-edit').find((r) => r.getAttribute('data-edit-id') === ORDER.id)!;
    fireEvent.click(order.querySelector('[data-testid="artifact-proposal-let-change"]')!);
    expect(order.getAttribute('data-change')).toBe('true');
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toEqual({ decision: 'go', edits: { allow: [TITLE.id, ORDER.id] } });
  });

  it('a card re-resolved on a moved head draws the new head’s edits, all kept again', async () => {
    const moved = proposal({ target: { ref: 'mikes/coverage-deck', title: 'Coverage deck', base: 4 }, protected: [{ ...TITLE, id: 'text:h#99998888', label: 'slide 1 · heading “Release 0.18”' }] });
    decideAnswer = () => new Response(JSON.stringify({ code: 'proposal_reresolved', error: 'Coverage deck changed since this was proposed (now v4); check the card again', view: { proposal: moved, state: 'open' } }), { status: 409, headers: { 'content-type': 'application/json' } });
    render(<ArtifactProposalCard chatId="chat-r" entry={entry(proposal())} seatName="Claude Code" stub={false} onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId('artifact-proposal-let-change'));
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-error').textContent).toContain('now v4'));
    const row = screen.getByTestId('artifact-proposal-protected-edit');
    expect(row.getAttribute('data-edit-id')).toBe('text:h#99998888');
    expect(row.getAttribute('data-change')).toBe('false');
    expect(text('artifact-proposal-target')).toBe('ChangesCoverage deck · v4');
  });

  it('"Kept your N edits" only once a version made by the run is in the document', async () => {
    decideAnswer = () => ok({ view: { proposal: proposal(), state: 'decided', decision: 'go', result: { runId: RUN, artifactRef: 'mikes/coverage-deck', adopted: false, stub: false } } });
    const run = { session: { id: RUN, status: 'running' } } as never;
    const { rerender } = render(<ArtifactProposalCard chatId="chat-r" entry={entry(proposal())} seatName="Claude Code" stub={false} onChanged={() => {}} run={null} />);
    fireEvent.click(screen.getByTestId('artifact-proposal-confirm'));
    await waitFor(() => expect(screen.getByTestId('artifact-proposal').getAttribute('data-state')).toBe('decided'));
    rerender(<ArtifactProposalCard chatId="chat-r" entry={entry(proposal())} seatName="Claude Code" stub={false} onChanged={() => {}} run={run} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('artifact-proposal-outcome')).toBeNull();
    versions = [{ version: 4, run_id: RUN }];
    rerender(<ArtifactProposalCard chatId="chat-r" entry={entry(proposal())} seatName="Claude Code" stub={false} onChanged={() => {}} run={{ session: { id: RUN, status: 'completed' } } as never} />);
    await waitFor(() => expect(screen.getByTestId('artifact-proposal-outcome').textContent).toBe('v4 made · kept your 3 edits'), { timeout: 5000 });
  });

  it('a refused refine says crew’s reason; the retry card reads Try again', () => {
    const decided = entry(proposal(), { state: 'decided', decision: 'go', result: { runId: RUN, artifactRef: 'mikes/coverage-deck', adopted: false, stub: false } });
    const failed = { session: { id: RUN, status: 'completed', landing_failed: { reason: 'the revision did not keep your edits, so nothing was applied' } } } as never;
    render(<ArtifactProposalCard chatId="chat-r" entry={decided} seatName="Claude Code" stub={false} onChanged={() => {}} run={failed} />);
    expect(text('artifact-proposal-outcome')).toBe('Not changed: the revision did not keep your edits, so nothing was applied');
    cleanup();
    const retry = proposal({ pid: `chat-r:retry:${RUN}`, turnId: null, sourceRunId: RUN, reason: 'The last change was not applied: the revision did not keep your edits. Try again revises the latest version, and keeps your edits.' });
    render(<ArtifactProposalCard chatId="chat-r" entry={entry(retry)} seatName="Claude Code" stub={false} onChanged={() => {}} />);
    expect(screen.getByTestId('artifact-proposal-confirm').textContent).toBe('Try again');
    expect(text('artifact-proposal-reason')).toContain('The last change was not applied');
  });
});
