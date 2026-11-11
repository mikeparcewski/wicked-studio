import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactProposal, ProposalToken } from '../src/api/types.js';
import { foldJobLineages } from '../src/board/jobStream.js';
import { JobPassage } from '../src/components/session/JobPassage.js';
import { resetJobLocal } from '../src/hooks/useJobStream.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useJobBinding } from '../src/store/jobBinding.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { jobProposal, CHAT } from './jobFixtures.js';

// Wire fixtures for the documents and sources tokens. The contract types both lists; these keep them unknown so a
// test can send a malformed one, which the passage must survive.
interface InputToken extends Omit<ProposalToken, 'kind' | 'documents' | 'sources'> {
  kind: 'documents' | 'sources';
  documents?: unknown;
  sources?: unknown;
}
const documents: InputToken = {
  id: 'documents', kind: 'documents', label: '2 documents', swap: null,
  documents: [
    { token: 'brief', label: 'Brief.pdf', status: 'ok' },
    { token: 'old', label: 'Old.pdf', status: 'struck', reason: 'This file expired' },
    { token: 'notes', label: 'Notes.txt', status: 'ok' },
  ],
};
const sources: InputToken = {
  id: 'sources', kind: 'sources', label: 'the web', swap: null,
  sources: [
    { id: 'web', label: 'the web', picked: true },
    { id: 'support-pg', label: 'support-pg', picked: false },
    { id: 'private', label: 'Private support', picked: false, reason: 'Connect it first' },
  ],
};
function proposal(tokens: InputToken[] = [documents, sources], over: Record<string, unknown> = {}): ArtifactProposal {
  return {
    ...jobProposal(),
    sentence: { text: 'Use {documents} from {sources}.', tokens, notes: [], ask: 'Start?' },
    inputs: { documents: { kind: 'documents', tokens: ['brief', 'notes'] }, sources: { kind: 'sources', ids: ['web'] } },
    ...over,
  } as unknown as ArtifactProposal;
}
const say = vi.fn();
const onChanged = vi.fn();
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
function passage(...proposals: ArtifactProposal[]): React.ReactElement {
  return passageOf(proposals.map((p, i) => ({ at: i + 1, turnId: p.turnId, kind: 'proposal', proposal: p })));
}
function passageOf(records: Parameters<typeof foldJobLineages>[0]): React.ReactElement {
  const lineage = foldJobLineages(records)[0]!;
  return <JobPassage chatId={CHAT} lineage={lineage} runs={[]} sessionId={CHAT} say={say} onChanged={onChanged} />;
}
/** crew's hold for a typed correction (`proposal_revising`) on `p`, as the record stream carries it. */
const revising = (p: ArtifactProposal): Parameters<typeof foldJobLineages>[0] => [
  { at: 1, turnId: p.turnId, kind: 'proposal', proposal: p },
  { at: 2, turnId: 't9', kind: 'proposal_revising', pid: p.pid },
] as Parameters<typeof foldJobLineages>[0];
const token = (name: string): HTMLElement => screen.getByRole('button', { name });
const start = (): HTMLButtonElement => screen.getAllByTestId('job-passage-reply').find((b) => b.dataset['reply'] === 'start') as HTMLButtonElement;
const next = (p: ArtifactProposal, tokens: InputToken[] = [documents, sources]): ArtifactProposal => proposal(tokens, {
  pid: `${CHAT}:t2`, turnId: 't2', revises: p.pid, lineage: p.pid,
});

beforeEach(() => {
  posts.length = 0;
  say.mockClear();
  onChanged.mockClear();
  resetJobLocal();
  useJobBinding.setState({ binding: null });
  useCapabilities.setState({ loaded: true, chatJobPower: false });
  setCachedRoster([]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') posts.push({ path: new URL(url, 'http://x').pathname, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ view: {} }), { status: 201, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('job passage input tokens', () => {
  describe('list placement at 390x844', () => {
    // The sources token sits at `at` (x, y, 70 x 20); the 220 x 180 list hangs 4 px under it from its left edge.
    const at = { x: 300, y: 300 };
    /** Called when the list is measured (a test emulates browser layout effects there). */
    let onMeasureList: ((el: HTMLElement) => void) | null = null;
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, right: left + width, bottom: top + height, x: left, y: top, width, height, toJSON: () => ({}) }) as DOMRect;
    let rects: { mockRestore: () => void };
    beforeEach(() => {
      at.x = 300; at.y = 300; onMeasureList = null;
      vi.stubGlobal('innerWidth', 390);
      vi.stubGlobal('innerHeight', 844);
      rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this.getAttribute('role') === 'listbox') {
          onMeasureList?.(this as HTMLElement);
          // Measured where it hangs, plus whatever shift is applied (each placement clears it before measuring).
          const dx = Number(/translateX\((-?\d+)px\)/.exec((this as HTMLElement).style.transform)?.[1] ?? 0);
          return rect(at.x + dx, at.y + 24, 220, 180);
        }
        if (this.getAttribute('data-token') === 'sources') return rect(at.x, at.y, 70, 20);
        return rect(0, 0, 0, 0);
      });
    });
    afterEach(() => rects.mockRestore());

    it('a list from a token at the end of a line is moved inside the viewport before its first row takes focus', async () => {
      const focused: Array<{ transform: string; preventScroll: boolean | undefined }> = [];
      const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, o?: FocusOptions) {
        if (this.getAttribute('role') === 'option') focused.push({ transform: this.closest('ul')?.style.transform ?? '', preventScroll: o?.preventScroll });
      });
      try {
        render(passage(proposal()));
        fireEvent.click(token('the web, sources'));
        const list = screen.getByRole('listbox', { name: 'Change sources' });
        // 300 - 138 + 220 = 382: inside the 390-px edge with an 8-px margin, so nothing scrolls sideways.
        expect(list.style.transform).toBe('translateX(-138px)');
        expect(list.style.maxWidth).toBe('374px');
        expect(list).not.toHaveClass('wk-pass-swap--above');
        // Already placed when the first row is focused, and the focus does not scroll the thread under it.
        await waitFor(() => expect(focused).toEqual([{ transform: 'translateX(-138px)', preventScroll: true }]));
      } finally {
        focus.mockRestore();
      }
    });

    it('a token near the foot of the viewport opens its list above it', () => {
      at.x = 60; at.y = 700;
      render(passage(proposal()));
      fireEvent.click(token('the web, sources'));
      const list = screen.getByRole('listbox', { name: 'Change sources' });
      expect(list).toHaveClass('wk-pass-swap--above');
      expect(list.style.transform).toBe('');
      expect(list.style.maxHeight).toBe('');
    });

    it('is placed again when the thread scrolls, but not when the list scrolls inside', () => {
      at.x = 60;
      render(passage(proposal()));
      fireEvent.click(token('the web, sources'));
      const list = screen.getByRole('listbox', { name: 'Change sources' });
      expect(list).not.toHaveClass('wk-pass-swap--above');
      // The thread scrolls the token down to the viewport's foot.
      at.y = 700;
      fireEvent.scroll(list);
      expect(list).not.toHaveClass('wk-pass-swap--above');
      fireEvent.scroll(document.body);
      expect(list).toHaveClass('wk-pass-swap--above');
    });

    it('keeps a capped list’s own scroll when placed again', () => {
      // A short viewport: 168 px below the token and 88 above, so the 180-px list opens below, capped at 168.
      vi.stubGlobal('innerHeight', 300);
      at.x = 60; at.y = 100;
      render(passage(proposal()));
      fireEvent.click(token('the web, sources'));
      const list = screen.getByRole('listbox', { name: 'Change sources' });
      expect(list.style.maxHeight).toBe('168px');
      // As in a browser: measuring the list with its cap cleared lays it out unscrollable, which resets its scroll.
      let scrolled = 0;
      Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => scrolled, set: (v: number) => { scrolled = v; } });
      onMeasureList = (el) => { if (el === list && list.style.maxHeight === '') scrolled = 0; };
      list.scrollTop = 40;
      fireEvent.scroll(document.body);
      expect(list.style.maxHeight).toBe('168px');
      expect(list.scrollTop).toBe(40);
    });

    it('closes when its token scrolls out of view', () => {
      at.x = 60;
      render(passage(proposal()));
      fireEvent.click(token('the web, sources'));
      expect(screen.getByRole('listbox', { name: 'Change sources' })).toBeInTheDocument();
      // The thread scrolls the token above the viewport: the list closes.
      at.y = -60;
      fireEvent.scroll(document.body);
      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  it('opens documents with leave-out choices, struck reasons, and Something else last', () => {
    render(passage(proposal()));
    fireEvent.click(token('2 documents, documents'));
    const list = screen.getByRole('listbox', { name: 'Change documents' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Leave out Brief.pdf', 'Leave out Notes.txt', 'Old.pdf · This file expired', 'Something else…',
    ]);
    expect(within(list).getByRole('option', { name: 'Old.pdf · This file expired' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('posts a documents revision through swap, returns focus, and holds Start until crew answers', async () => {
    const p = proposal();
    const view = render(passage(p));
    const t = token('2 documents, documents');
    fireEvent.click(t);
    const choice = screen.getByRole('option', { name: 'Leave out Brief.pdf' });
    await waitFor(() => expect(choice).toHaveFocus());
    fireEvent.click(choice);
    expect(posts).toEqual([{ path: `/api/v1/chats/${CHAT}/proposals`, body: {
      revises: p.pid, edits: { inputs: { documents: { kind: 'documents', tokens: ['notes'] } } },
      source: 'swap', requestId: expect.any(String),
    } }]);
    expect(t).toHaveTextContent('…');
    expect(t).toHaveAttribute('aria-disabled', 'true');
    expect(start()).toBeDisabled();
    await waitFor(() => expect(t).toHaveFocus());
    fireEvent.click(t);
    fireEvent.keyDown(t, { key: 'Enter' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(posts).toHaveLength(1);
    const revised = next(p, [{ ...documents, label: '1 document', documents: [{ token: 'notes', label: 'Notes.txt', status: 'ok' }] }, sources]);
    view.rerender(passage(p, revised));
    await waitFor(() => expect(start()).toBeEnabled());
    expect(token('1 document, documents')).toHaveTextContent('1 document');
  });

  it('the last usable document is shown with why it stays, and picking it sends nothing (crew takes one at least)', () => {
    render(passage(proposal([{ ...documents, label: '1 document', documents: [{ token: 'brief', label: 'Brief.pdf', status: 'ok' }] }])));
    fireEvent.click(token('1 document, documents'));
    const list = screen.getByRole('listbox', { name: 'Change documents' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Brief.pdf · the job’s only document', 'Something else…']);
    const only = within(list).getByRole('option', { name: 'Brief.pdf · the job’s only document' });
    expect(only).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(only);
    for (const key of ['Enter', ' ']) fireEvent.keyDown(only, { key });
    expect(posts).toEqual([]);
    expect(useJobBinding.getState().binding).toBeNull();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('a row that can’t be picked, focused directly (not by the arrows), picks nothing on Enter or Space', async () => {
    render(passage(proposal()));
    fireEvent.click(token('2 documents, documents'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Leave out Brief.pdf' })).toHaveFocus());
    const struck = screen.getByRole('option', { name: 'Old.pdf · This file expired' });
    act(() => { struck.focus(); });
    for (const key of ['Enter', ' ']) fireEvent.keyDown(struck, { key });
    expect(posts).toEqual([]);
    expect(useJobBinding.getState().binding).toBeNull();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // The arrows go on from the row focus is on.
    fireEvent.keyDown(struck, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Something else…' })).toHaveFocus();
  });

  it('a documents list crew sent with a token twice is a plain fact, even with generic swaps on the token', () => {
    render(passage(proposal([{ ...documents, swap: { choices: [{ label: 'Only a', edit: { inputs: { documents: { kind: 'documents', tokens: ['a'] } } } }] },
      documents: [{ token: 'a', label: 'A', status: 'ok' }, { token: 'a', label: 'A', status: 'struck', reason: 'gone' }, { token: 'b', label: 'B', status: 'ok' }] } as unknown as InputToken])));
    expect(screen.queryByRole('button', { name: '2 documents, documents' })).toBeNull();
    expect(screen.getByText('2 documents')).toHaveClass('wk-pass-fact');
  });

  it('a struck document crew gave no reason for shows its name alone', () => {
    render(passage(proposal([{ ...documents, documents: [
      { token: 'brief', label: 'Brief.pdf', status: 'ok' }, { token: 'notes', label: 'Notes.txt', status: 'ok' }, { token: 'old', label: 'Old.pdf', status: 'struck' },
    ] }])));
    fireEvent.click(token('2 documents, documents'));
    expect(screen.getAllByTestId('job-passage-swap-unavailable').map((o) => o.textContent)).toEqual(['Old.pdf']);
  });

  it('arrow keys reach a struck row (its reason is heard), and neither a click nor Enter/Space on it picks anything', async () => {
    render(passage(proposal()));
    fireEvent.keyDown(token('2 documents, documents'), { key: 'Enter' });
    const first = screen.getByRole('option', { name: 'Leave out Brief.pdf' });
    const second = screen.getByRole('option', { name: 'Leave out Notes.txt' });
    const struck = screen.getByRole('option', { name: 'Old.pdf · This file expired' });
    const otherwise = screen.getByRole('option', { name: 'Something else…' });
    await waitFor(() => expect(first).toHaveFocus());
    expect(struck).toHaveAttribute('tabindex', '-1');
    fireEvent.click(struck);
    expect(posts).toEqual([]);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(struck).toHaveFocus();
    for (const key of ['Enter', ' ']) fireEvent.keyDown(struck, { key });
    expect(posts).toEqual([]);
    expect(useJobBinding.getState().binding).toBeNull();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(struck, { key: 'ArrowDown' });
    expect(otherwise).toHaveFocus();
    fireEvent.keyDown(otherwise, { key: 'ArrowUp' });
    expect(struck).toHaveFocus();
    fireEvent.keyDown(struck, { key: 'ArrowUp' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    fireEvent.keyDown(struck, { key: 'ArrowDown' });
    fireEvent.keyDown(otherwise, { key: 'ArrowDown' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(posts[0]?.body['edits']).toEqual({ inputs: { documents: { kind: 'documents', tokens: ['notes'] } } });
  });

  it('every source unpickable: the list still opens with each reason, and Something else is reachable', async () => {
    render(passage(proposal([{ ...sources, label: 'no sources', sources: [{ id: 'private', label: 'Private support', picked: false, reason: 'Connect it first' }] }])));
    fireEvent.click(token('no sources, sources'));
    const blocked = screen.getByRole('option', { name: 'Private support · Connect it first' });
    await waitFor(() => expect(blocked).toHaveFocus());
    fireEvent.keyDown(blocked, { key: 'Enter' });
    expect(posts).toEqual([]);
    fireEvent.keyDown(blocked, { key: 'ArrowDown' });
    const otherwise = screen.getByRole('option', { name: 'Something else…' });
    expect(otherwise).toHaveFocus();
    fireEvent.keyDown(otherwise, { key: 'Enter' });
    expect(useJobBinding.getState().binding?.label).toBe('Answering: something else for “no sources”');
  });

  it('crew’s hold arriving while a list is open closes it and focus goes back to the held token', async () => {
    const p = proposal();
    const view = render(passage(p));
    const t = token('the web, sources');
    fireEvent.click(t);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Leave out the web' })).toHaveFocus());
    view.rerender(passageOf(revising(p)));
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(t).toHaveFocus());
    expect(t).toHaveAttribute('aria-disabled', 'true');
    expect(posts).toEqual([]);
  });

  it('crew’s hold arriving while a list is open closes it, and a pick in that window sends nothing', async () => {
    const p = proposal();
    let pressed = false;
    function Arrival({ held }: { held: boolean }): React.ReactElement {
      // Press during the commit of the hold, before JobPassage's passive effect closes the list.
      useLayoutEffect(() => {
        if (!held) return;
        const list = screen.queryByRole('listbox');
        if (list !== null) {
          pressed = true;
          fireEvent.click(within(list).getByRole('option', { name: 'Leave out Brief.pdf' }));
          fireEvent.keyDown(within(list).getByRole('option', { name: 'Leave out Notes.txt' }), { key: 'Enter' });
        }
      }, [held]);
      return held ? passageOf(revising(p)) : passage(p);
    }
    const view = render(<Arrival held={false} />);
    const t = token('2 documents, documents');
    fireEvent.click(t);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Leave out Brief.pdf' })).toHaveFocus());
    view.rerender(<Arrival held />);
    expect(pressed).toBe(true);
    expect(posts).toEqual([]);
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(t).toHaveFocus());
    expect(t).toHaveAttribute('aria-disabled', 'true');
  });

  it.each([
    ['Add support-pg', ['web', 'support-pg']],
    ['Leave out the web', []],
  ])('sources: %s sends the complete new pick', (label, ids) => {
    render(passage(proposal()));
    fireEvent.click(token('the web, sources'));
    const list = screen.getByRole('listbox', { name: 'Change sources' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Leave out the web', 'Add support-pg', 'Private support · Connect it first', 'Something else…',
    ]);
    const blocked = within(list).getByRole('option', { name: 'Private support · Connect it first' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(blocked);
    expect(posts).toEqual([]);
    fireEvent.click(within(list).getByRole('option', { name: label as string }));
    expect(posts[0]?.body).toEqual({ revises: `${CHAT}:t1`, source: 'swap', requestId: expect.any(String),
      edits: { inputs: { sources: { kind: 'sources', ids } } } });
  });

  it.each([undefined, null, {}, [{ status: 'ok' }]])('documents without a valid list (%j) stay a plain fact', (list) => {
    render(passage(proposal([{ ...documents, documents: list }])));
    expect(screen.queryByRole('button', { name: '2 documents, documents' })).toBeNull();
    const fact = screen.getByText('2 documents');
    expect(fact.tagName).toBe('B');
    expect(fact).toHaveClass('wk-pass-fact');
    fireEvent.click(fact);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a sources token without a list stays a plain fact', () => {
    render(passage(proposal([{ ...sources, sources: undefined }])));
    expect(screen.queryByRole('button', { name: 'the web, sources' })).toBeNull();
    expect(screen.getByText('the web')).toHaveClass('wk-pass-fact');
  });

  it('an empty list still opens and Something else binds words to this input', async () => {
    render(passage(proposal([{ ...sources, label: 'no sources', sources: [] }])));
    const t = token('no sources, sources');
    fireEvent.keyDown(t, { key: ' ' });
    const otherwise = screen.getByRole('option', { name: 'Something else…' });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await waitFor(() => expect(otherwise).toHaveFocus());
    fireEvent.keyDown(otherwise, { key: 'Enter' });
    expect(screen.queryByRole('listbox')).toBeNull();
    const binding = useJobBinding.getState().binding!;
    expect(binding.label).toBe('Answering: something else for “no sources”');
    expect(binding.placeholder).toBe('Say what to change about sources…');
    expect(binding.instance).toContain(`${CHAT}:t1`);
    expect(binding.send('use the support database')).toBe(true);
    expect(say).toHaveBeenCalledWith('use the support database');
    expect(posts).toEqual([]);
  });

  it('Escape closes an input listbox and restores its token focus', async () => {
    render(passage(proposal()));
    const t = token('the web, sources');
    fireEvent.click(t);
    const first = screen.getByRole('option', { name: 'Leave out the web' });
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(t).toHaveFocus();
    expect(posts).toEqual([]);
  });

  it('crew’s next version closes old input choices, returns focus, and a fresh pick names the new version', async () => {
    const p = proposal();
    const view = render(passage(p));
    fireEvent.click(token('2 documents, documents'));
    const oldChoice = screen.getByRole('option', { name: 'Leave out Brief.pdf' });
    await waitFor(() => expect(oldChoice).toHaveFocus());
    const revised = next(p);
    view.rerender(passage(p, revised));
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(token('2 documents, documents')).toHaveFocus());
    fireEvent.click(token('2 documents, documents'));
    fireEvent.click(screen.getByRole('option', { name: 'Leave out Notes.txt' }));
    expect(posts[0]?.body).toMatchObject({ revises: revised.pid, source: 'swap',
      edits: { inputs: { documents: { kind: 'documents', tokens: ['brief'] } } } });
  });

  it('refuses an input pick on a changed version even before the close effect runs', async () => {
    const p = proposal();
    let pressed = false;
    function Arrival({ newest }: { newest: ArtifactProposal }): React.ReactElement {
      // Press during the commit of the new version, before JobPassage's passive effect closes the old listbox.
      useLayoutEffect(() => {
        if (newest.pid === p.pid) return;
        const list = screen.queryByRole('listbox');
        if (list !== null) {
          pressed = true;
          fireEvent.click(within(list).getByRole('option', { name: 'Leave out Brief.pdf' }));
        }
      }, [newest]);
      return newest.pid === p.pid ? passage(p) : passage(p, newest);
    }
    const view = render(<Arrival newest={p} />);
    fireEvent.click(token('2 documents, documents'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Leave out Brief.pdf' })).toHaveFocus());
    view.rerender(<Arrival newest={next(p)} />);
    expect(pressed).toBe(true);
    expect(posts).toEqual([]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a revision crew refuses releases the hold and keeps the original input facts', async () => {
    // crew refuses a person's revision with a 400 `edits_invalid` and its words (chat-proposals refusalOf), not a new version.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'That file cannot be left out', code: 'edits_invalid' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })));
    render(passage(proposal()));
    fireEvent.click(token('2 documents, documents'));
    fireEvent.click(screen.getByRole('option', { name: 'Leave out Brief.pdf' }));
    await act(async () => {});
    expect(start()).toBeEnabled();
    expect(token('2 documents, documents')).toHaveTextContent('2 documents');
    expect(screen.getByTestId('job-passage-error')).toHaveTextContent('That file cannot be left out');
  });
});
