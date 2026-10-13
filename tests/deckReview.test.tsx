import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proposalView, reviewRows, reviewSummary, adaptItems } from '../src/board/deckReview.js';
import { deckOf } from '../src/board/deck.js';

/**
 * P-D1 — the host's review rail for a deck (DES-PRESENTATION-EDITOR-001 §3-§4; D3, D4, D5, D8): a
 * person's decision per slide on the version shown (an approval reads "changed since" once the engine
 * says the slide's hash moved), the audience, and an audience change opened as a proposal that is
 * compared slide by slide, then kept or dropped.
 */

const slide = (id: string, wid: string, title: string, body: string, notes = ''): string =>
  `<section data-slide-id="${id}" data-wid="${wid}"><h2>${title}</h2><p>${body}</p>${notes === '' ? '' : `<aside class="notes" data-notes-for="${id}" hidden>${notes}</aside>`}</section>`;
const V3 = slide('a', 'section-0', 'Q3 review', 'Where we are') + slide('b', 'section-1', 'Revenue', 'Up 18%') + slide('c', 'section-2', 'Next', 'Hire two AEs') + slide('d', 'section-3', 'Risks', 'Hiring');
const V4 = slide('a', 'section-0', 'Q3 review', 'Where we are') + slide('c', 'section-2', 'Next', 'Hire three AEs', 'Name them') + slide('b', 'section-1', 'Revenue', 'Up 18%');

const api = vi.hoisted(() => ({
  review: null as unknown,
  html: {} as Record<number, string>,
  decisions: [] as unknown[],
  audiences: [] as unknown[],
  proposals: [] as unknown[],
  closes: [] as unknown[],
  events: [] as unknown[],
  forks: [] as unknown[],
  eventFails: false,
  forkHeadMoved: null as number | null,
}));

vi.mock('../src/api/interactive.js', () => {
  class HeadMovedError extends Error { head: number; constructor(head: number) { super('head_moved'); this.head = head; } }
  return {
    HeadMovedError,
    interactiveDocUrl: (_p: string, _d: string, v: number) => `/doc/${v}`,
    getDeckReview: vi.fn(async () => api.review),
    postSlideDecision: vi.fn(async (_p: string, _d: string, body: unknown) => { api.decisions.push(body); return { decision: body }; }),
    putDeckAudience: vi.fn(async (_p: string, _d: string, body: unknown) => { api.audiences.push(body); return { audience: body }; }),
    openDeckProposal: vi.fn(async (_p: string, _d: string, body: unknown) => { api.proposals.push(body); return { proposal: body }; }),
    closeDeckProposal: vi.fn(async (_p: string, _d: string, body: unknown) => { api.closes.push(body); return body; }),
    postEvent: vi.fn(async (_p: string, evt: unknown) => { if (api.eventFails) throw new Error('bridge down'); api.events.push(evt); return { ok: true }; }),
    postFork: vi.fn(async (_p: string, _d: string, from: number, _s: unknown, expectHead: number) => {
      api.forks.push({ from, expectHead });
      if (api.forkHeadMoved !== null) throw new HeadMovedError(api.forkHeadMoved);
      return { version: 9, parent: from };
    }),
  };
});

import { DeckReview } from '../src/components/session/DeckReview.js';

const decision = (d: string, version: number, current: boolean, note: string | null = null) => ({ decision: d, version, note, at: 't', current });
const review = (head: number, extra: Record<string, unknown> = {}) => ({
  version: head, head, audience: null, proposal: null,
  slides: [
    { slide_id: 'a', hash: 'h', decision: decision('approved', 3, true) },
    { slide_id: 'b', hash: 'h', decision: decision('approved', 2, false) },
    { slide_id: 'c', hash: 'h', decision: decision('changes_requested', 3, true, 'Name the AEs') },
    { slide_id: 'd', hash: 'h', decision: null },
  ],
  ...extra,
});

beforeEach(() => {
  Object.assign(api, { review: review(3), html: { 3: V3, 4: V4 }, decisions: [], audiences: [], proposals: [], closes: [], events: [], forks: [], eventFails: false, forkHeadMoved: null });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const v = Number(String(url).split('/').pop());
    return { ok: api.html[v] !== undefined, status: 200, text: async () => api.html[v] ?? '' } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the review model', () => {
  it('badges, the summary, the proposal and the adapt items', () => {
    const rows = reviewRows(deckOf(V3), review(3) as never);
    expect(rows.map((r) => [r.state, r.words])).toStrictEqual([
      ['approved', 'Approved on version 3'],
      ['stale', 'Approved on version 2 — changed since'],
      ['changes', 'Changes asked: Name the AEs'],
      ['none', 'Not reviewed'],
    ]);
    expect(reviewSummary(rows)).toBe('1 of 4 approved · 1 changed since review · 1 asks for changes');
    expect(proposalView(null, 3)).toStrictEqual({ state: 'none' });
    expect(proposalView({ base: 3, preset: 'exec', label: null, at: 't' }, 3)).toStrictEqual({ state: 'waiting', base: 3, audience: 'Executives' });
    expect(proposalView({ base: 3, preset: 'custom', label: 'The board', at: 't' }, 5)).toStrictEqual({ state: 'ready', base: 3, proposed: 5, audience: 'The board' });
    // keep approved: the CURRENT approval (a) is left alone; a stale one (b) is rewritten
    expect(adaptItems(rows, { preset: 'eng' }, 'keep', true).map((i) => i.selector)).toStrictEqual(['section-1', 'section-2', 'section-3']);
    expect(adaptItems(rows, { preset: 'eng' }, 'keep', false)).toHaveLength(4);
  });
});

describe('DeckReview', () => {
  const mount = (head = 3, onForked = vi.fn()) => { render(<DeckReview projectId="notes" docId="q3" head={head} onForked={onForked} />); return onForked; };
  const row = (id: string): HTMLElement => screen.getAllByTestId('deck-review-row').find((r) => r.getAttribute('data-slide-id') === id)!;

  it('lists each slide with the engine’s badge, and records a person’s approval on the version shown', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId('deck-review-row')).toHaveLength(4));
    expect(screen.getByTestId('deck-review-summary').textContent).toBe('1 of 4 approved · 1 changed since review · 1 asks for changes');
    expect(row('b').getAttribute('data-state')).toBe('stale');
    expect(within(row('b')).getByTestId('deck-review-badge').textContent).toBe('Approved on version 2 — changed since');
    expect(screen.getByText(/don’t hold up delivery/)).toBeTruthy();
    fireEvent.click(within(row('d')).getByTestId('deck-review-approve'));
    await waitFor(() => expect(api.decisions).toStrictEqual([{ version: 3, slide_id: 'd', decision: 'approved' }]));
    fireEvent.click(within(row('a')).getByTestId('deck-review-ask'));
    fireEvent.change(within(row('a')).getByTestId('deck-review-note'), { target: { value: ' Shorter title ' } });
    fireEvent.click(within(row('a')).getByTestId('deck-review-save-changes'));
    await waitFor(() => expect(api.decisions[1]).toStrictEqual({ version: 3, slide_id: 'a', decision: 'changes_requested', note: 'Shorter title' }));
    fireEvent.click(within(row('c')).getByTestId('deck-review-clear'));
    await waitFor(() => expect(api.decisions[2]).toStrictEqual({ version: 3, slide_id: 'c', decision: 'cleared' }));
  });

  it('an audience change opens a proposal and sends ONE structural batch on the version, keeping approved slides', async () => {
    mount();
    await waitFor(() => screen.getByTestId('deck-audience-change'));
    expect(screen.getByTestId('deck-audience-label').textContent).toBe('Not set');
    fireEvent.click(screen.getByTestId('deck-audience-change'));
    fireEvent.click(screen.getAllByTestId('deck-audience-preset').find((r) => (r as HTMLInputElement).value === 'customer')!);
    fireEvent.change(screen.getByTestId('deck-audience-length'), { target: { value: 'shorten' } });
    fireEvent.click(screen.getByTestId('deck-audience-adapt'));
    await waitFor(() => expect(api.events).toHaveLength(1));
    expect(api.proposals).toStrictEqual([{ base: 3, preset: 'customer' }]);
    const evt = api.events[0] as { event_type: string; payload: { version: number; expect_head: number; items: { selector: string; type: string; instruction: string }[] } };
    expect(evt.event_type).toBe('wicked.interactive.feedback.submitted');
    expect([evt.payload.version, evt.payload.expect_head]).toStrictEqual([3, 3]);
    expect(evt.payload.items.map((i) => [i.selector, i.type])).toStrictEqual([['section-1', 'structural-change'], ['section-2', 'structural-change'], ['section-3', 'structural-change']]);
    expect(evt.payload.items[0]!.instruction).toMatch(/customers.*shorter/s);
  });

  it('a batch that cannot be sent closes the proposal again; "Just record it" only records', async () => {
    api.eventFails = true;
    mount();
    await waitFor(() => screen.getByTestId('deck-audience-change'));
    fireEvent.click(screen.getByTestId('deck-audience-change'));
    fireEvent.click(screen.getByTestId('deck-audience-adapt'));
    await waitFor(() => expect(api.closes).toStrictEqual([{ outcome: 'dropped' }]));
    expect(screen.getByTestId('deck-review-line').textContent).toMatch(/Not started: bridge down/);
    fireEvent.click(screen.getAllByTestId('deck-audience-preset').find((r) => (r as HTMLInputElement).value === 'custom')!);
    expect((screen.getByTestId('deck-audience-record') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('deck-audience-custom'), { target: { value: 'The board' } });
    fireEvent.click(screen.getByTestId('deck-audience-record'));
    await waitFor(() => expect(api.audiences).toStrictEqual([{ version: 3, preset: 'custom', label: 'The board' }]));
  });

  it('a landed proposal compares slide by slide, then Keep records it', async () => {
    api.review = review(4, { proposal: { base: 3, preset: 'exec', label: null, at: 't' } });
    mount(4);
    await waitFor(() => expect(screen.getByTestId('deck-proposal').getAttribute('data-state')).toBe('ready'));
    expect(screen.getByTestId('deck-proposal').textContent).toMatch(/Proposed for Executives: version 4 \(from version 3\)/);
    fireEvent.click(screen.getByTestId('deck-proposal-compare'));
    await waitFor(() => screen.getByTestId('deck-compare'));
    expect(screen.getByTestId('deck-compare-summary').textContent).toBe('Version 3 → 4: 1 changed · 1 removed · 2 moved · notes on 1');
    const changed = screen.getAllByTestId('deck-compare-row').find((r) => r.getAttribute('data-kind') === 'changed')!;
    expect(within(changed).getByTestId('deck-compare-words').querySelector('ins')!.textContent).toBe('three');
    expect(within(changed).getByTestId('deck-compare-words').querySelector('del')!.textContent).toBe('two');
    fireEvent.click(screen.getByTestId('deck-proposal-keep'));
    await waitFor(() => expect(api.closes).toStrictEqual([{ outcome: 'kept', version: 4 }]));
  });

  it('Drop restores the version it adapted with expect_head, and is refused when the deck moved on', async () => {
    api.review = review(4, { proposal: { base: 3, preset: 'eng', label: null, at: 't' } });
    const onForked = mount(4);
    await waitFor(() => screen.getByTestId('deck-proposal-drop'));
    fireEvent.click(screen.getByTestId('deck-proposal-drop'));
    await waitFor(() => expect(api.closes).toStrictEqual([{ outcome: 'dropped' }]));
    expect(api.forks).toStrictEqual([{ from: 3, expectHead: 4 }]);
    expect(onForked).toHaveBeenCalledWith(9);
    cleanup();
    api.forkHeadMoved = 6;
    api.closes = [];
    mount(4);
    await waitFor(() => screen.getByTestId('deck-proposal-drop'));
    fireEvent.click(screen.getByTestId('deck-proposal-drop'));
    await waitFor(() => expect(screen.getByTestId('deck-review-line').textContent).toBe('Not dropped: the deck changed since — version 6.'));
    expect(api.closes).toStrictEqual([]);
  });

  it('codex r1: Drop while waiting still forks the base with expect_head; a rewrite that landed meanwhile refuses it', async () => {
    api.review = review(3, { proposal: { base: 3, preset: 'eng', label: null, at: 't' } });
    mount(3);
    await waitFor(() => expect(screen.getByTestId('deck-proposal').getAttribute('data-state')).toBe('waiting'));
    fireEvent.click(screen.getByTestId('deck-proposal-drop'));
    await waitFor(() => expect(api.closes).toStrictEqual([{ outcome: 'dropped' }]));
    expect(api.forks).toStrictEqual([{ from: 3, expectHead: 3 }]);
  });

  it('codex r1: while the rail trails the head nothing decides; a decision names the version it was read for', async () => {
    const { rerender } = render(<DeckReview projectId="notes" docId="q3" head={3} onForked={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('deck-review-row')).toHaveLength(4));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const iapi = await import('../src/api/interactive.js');
    vi.mocked(iapi.getDeckReview).mockImplementationOnce(async () => { await gate; return review(4) as never; });
    rerender(<DeckReview projectId="notes" docId="q3" head={4} onForked={vi.fn()} />);
    await waitFor(() => screen.getByTestId('deck-review-reading'));
    const approve = within(row('b')).getByTestId('deck-review-approve') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.queryByTestId('deck-review-reading')).toBeNull());
    // version 4's deck: a, c, b — b's approval (on version 2) is stale, so it offers Approve again
    fireEvent.click(within(row('b')).getByTestId('deck-review-approve'));
    await waitFor(() => expect(api.decisions).toStrictEqual([{ version: 4, slide_id: 'b', decision: 'approved' }]));
  });

  it('codex r1: a batch that fails AND a proposal that cannot be closed is said, and the rail re-reads', async () => {
    api.eventFails = true;
    const iapi = await import('../src/api/interactive.js');
    vi.mocked(iapi.closeDeckProposal).mockRejectedValueOnce(new Error('bridge down'));
    mount();
    await waitFor(() => screen.getByTestId('deck-audience-change'));
    fireEvent.click(screen.getByTestId('deck-audience-change'));
    fireEvent.click(screen.getByTestId('deck-audience-adapt'));
    await waitFor(() => expect(screen.getByTestId('deck-review-line').textContent).toMatch(/could not be closed: drop it below/));
  });

  it('codex r2: a compare still being read when the head moves on is dropped, never shown for the newer head', async () => {
    api.review = review(4, { proposal: { base: 3, preset: 'exec', label: null, at: 't' } });
    api.html[5] = V4;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (String(url).endsWith('/3')) await gate; return (realFetch as unknown as (u: string) => Promise<Response>)(url); }));
    const { rerender } = render(<DeckReview projectId="notes" docId="q3" head={4} onForked={vi.fn()} />);
    await waitFor(() => screen.getByTestId('deck-proposal-compare'));
    fireEvent.click(screen.getByTestId('deck-proposal-compare'));
    api.review = review(5, { proposal: { base: 3, preset: 'exec', label: null, at: 't' } });
    rerender(<DeckReview projectId="notes" docId="q3" head={5} onForked={vi.fn()} />);
    release();
    await waitFor(() => expect(screen.getByTestId('deck-proposal').textContent).toMatch(/version 5/));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('deck-compare')).toBeNull();
  });

  it('an engine with no review store says so instead of guessing', async () => {
    api.review = null;
    mount();
    await waitFor(() => expect(screen.getByTestId('deck-review').getAttribute('data-state')).toBe('absent'));
    expect(screen.getByTestId('deck-review').textContent).toMatch(/update wicked-interactive/);
  });
});
