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

// Local wire fixtures for the optional CS12 fields the pinned api-types lack.
interface InputToken extends Omit<ProposalToken, 'kind'> {
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
  it('a list opened from a token at the end of a phone line is moved back inside the viewport, before paint', () => {
    // 390-px viewport; the sources token ends the line at x 300-370, and the 220-px list hangs from its left edge.
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const at = (left: number, top: number, width: number, height: number) =>
        ({ left, top, right: left + width, bottom: top + height, x: left, y: top, width, height, toJSON: () => ({}) }) as DOMRect;
      if (this.getAttribute('role') === 'listbox') {
        // Measured where it hangs, plus whatever shift is applied (the layout effect clears it before measuring).
        const dx = Number(/translateX\((-?\d+)px\)/.exec((this as HTMLElement).style.transform)?.[1] ?? 0);
        return at(300 + dx, 324, 220, 180);
      }
      if (this.getAttribute('data-token') === 'sources') return at(300, 300, 70, 20);
      return at(0, 0, 0, 0);
    });
    try {
      render(passage(proposal()));
      fireEvent.click(token('the web, sources'));
      const list = screen.getByRole('listbox', { name: 'Change sources' });
      // 300 - 138 + 220 = 382: inside the 390-px edge with an 8-px margin, so nothing scrolls sideways.
      expect(list.style.transform).toBe('translateX(-138px)');
      expect(list).not.toHaveClass('wk-pass-swap--above');
    } finally {
      rects.mockRestore();
    }
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
