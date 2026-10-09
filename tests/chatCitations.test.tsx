/**
 * crew#561 / F-RC1-117 — no fabricated citation renders unmarked.
 *
 * On RC1 Phase 6 a seat answered with 26 commit SHAs, two of which existed in no repo, and the
 * thread rendered all 26 as identical plain text. The daemon now verifies each citation and sends a
 * `chatCitations` frame; this surface MARKS the reply from it and never edits the seat's text.
 *
 * Three levels, the way the chat suites are split:
 *  - the pure label/mark derivations (`citationLabel`, `citationMarks`, `flaggedCitations`);
 *  - the rendering: the bubble's strip and the INLINE badge on a backticked citation;
 *  - the fold: a `chatCitations` frame on the live stream lands on the reply it answers.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { Markdown } from '../src/components/Markdown.js';
import { ChatThread, replayTranscript, type Msg } from '../src/components/ChatThread.js';
import { citationLabel, citationMarks, flaggedCitations } from '../src/components/citations.js';
import type { ChatCitationItem, ChatCitations } from '../src/api/chat-wire.js';

const item = (over: Partial<ChatCitationItem> = {}): ChatCitationItem => ({
  raw: '6d77153',
  kind: 'sha',
  status: 'unverified',
  ...over,
});

const citations = (over: Partial<ChatCitations> = {}): ChatCitations => ({
  verified: 24,
  unverifiable: 2,
  corrected: 0,
  unchecked: 0,
  items: [item()],
  ...over,
});

// ── The derivations ─────────────────────────────────────────────────────────

describe('the reply counter and what it marks', () => {
  it('always speaks both numbers — "24 verified · 2 unverifiable"', () => {
    expect(citationLabel(citations())).toBe('24 verified · 2 unverifiable');
  });

  it('a clean answer says so: "56 verified · 0 unverifiable"', () => {
    expect(citationLabel(citations({ verified: 56, unverifiable: 0 }))).toBe('56 verified · 0 unverifiable');
  });

  it('adds corrected and unchecked only when they happened', () => {
    expect(citationLabel(citations({ corrected: 3, unchecked: 1 }))).toBe(
      '24 verified · 2 unverifiable · 3 corrected · 1 unchecked',
    );
  });

  it('marks everything that is not verified, and nothing else', () => {
    const c = citations({
      items: [
        item({ raw: 'dd621c0', status: 'verified' }),
        item({ raw: '6d77153', status: 'unverified' }),
        item({ raw: 'acceptance.ts:79', kind: 'line', status: 'corrected', resolved: 'acceptance.ts:80' }),
        item({ raw: 'x.ts', kind: 'path', status: 'unchecked' }),
      ],
    });
    expect(flaggedCitations(c).map((i) => i.raw)).toEqual(['6d77153', 'acceptance.ts:79', 'x.ts']);
    expect(citationMarks(c)?.has('dd621c0')).toBe(false);
    // Nothing to mark ⇒ no map at all, so the renderer keeps its default components.
    expect(citationMarks(citations({ items: [item({ status: 'verified' })] }))).toBeUndefined();
    expect(citationMarks(undefined)).toBeUndefined();
  });
});

// ── The rendering ───────────────────────────────────────────────────────────

const seatMsg = (over: Partial<Extract<Msg, { kind: 'seat' }>> = {}): Msg => ({
  kind: 'seat',
  cliKey: 'opencode',
  text: 'Landed in `dd621c0`; the deliver gate defaulted on in `6d77153`.',
  pending: false,
  ok: true,
  turn: 1,
  ...over,
});

describe('the bubble: the strip, and the inline mark on the citation itself', () => {
  afterEach(cleanup);

  it('shows "N verified · M unverifiable" and names the fabricated SHA', () => {
    const { container } = render(
      <ChatThread
        messages={[{ kind: 'user', text: 'release notes', turn: 1 }, seatMsg({ citations: citations() })]}
        view="full"
        layout="list"
        seatOrder={['opencode']}
        items={[]}
      />,
    );
    const strip = container.querySelector('[data-testid="seat-citations"]')!;
    expect(strip.textContent).toContain('24 verified · 2 unverifiable');
    expect(strip.getAttribute('data-unverifiable')).toBe('2');
    const flag = container.querySelector('[data-testid="citation-flag"]')!;
    expect(flag.getAttribute('data-status')).toBe('unverified');
    expect(flag.textContent).toContain('6d77153');
    expect(flag.textContent).toContain('UNVERIFIED');
  });

  it('marks the fabricated SHA where it sits, and leaves the real one alone', () => {
    const { container } = render(
      <ChatThread
        messages={[{ kind: 'user', text: 'q', turn: 1 }, seatMsg({ citations: citations() })]}
        view="full"
        layout="list"
        seatOrder={['opencode']}
        items={[]}
      />,
    );
    const marks = [...container.querySelectorAll('[data-testid="citation-mark"]')];
    expect(marks.map((m) => m.getAttribute('data-raw'))).toEqual(['6d77153']);
    expect(marks[0]!.textContent).toContain('UNVERIFIED');
    // The seat's own text is intact — marked, not edited.
    expect(container.querySelector('[data-testid="seat-bubble"]')!.textContent).toContain('dd621c0');
  });

  it('a reply with no verdicts renders exactly as before — no strip, no mark', () => {
    const { container } = render(
      <ChatThread
        messages={[{ kind: 'user', text: 'q', turn: 1 }, seatMsg()]}
        view="full"
        layout="list"
        seatOrder={['opencode']}
        items={[]}
      />,
    );
    expect(container.querySelector('[data-testid="seat-citations"]')).toBeNull();
    expect(container.querySelector('[data-testid="citation-mark"]')).toBeNull();
  });

  it('a corrected line ref renders the real place, inline and in the strip', () => {
    const c = citations({
      verified: 2,
      unverifiable: 0,
      corrected: 1,
      items: [item({ raw: 'acceptance.ts:79', kind: 'line', status: 'corrected', resolved: 'acceptance.ts:80', note: 'acceptancePhaseIds is on line 80, not 79' })],
    });
    const { container } = render(
      <ChatThread
        messages={[
          { kind: 'user', text: 'q', turn: 1 },
          seatMsg({ text: '`acceptancePhaseIds` is at `acceptance.ts:79`.', citations: c }),
        ]}
        view="full"
        layout="list"
        seatOrder={['opencode']}
        items={[]}
      />,
    );
    const mark = container.querySelector('[data-testid="citation-mark"]')!;
    expect(mark.getAttribute('data-status')).toBe('corrected');
    expect(mark.textContent).toContain('→ acceptance.ts:80');
    expect(mark.getAttribute('title')).toContain('is on line 80, not 79');
  });

  it('a fenced code block is never marked, even when it contains a flagged token', () => {
    const { container } = render(
      <Markdown marks={citationMarks(citations())}>{'```\ngit show 6d77153\n```'}</Markdown>,
    );
    expect(container.querySelector('[data-testid="citation-mark"]')).toBeNull();
    expect(container.textContent).toContain('git show 6d77153');
  });
});

// ── The fold (a reload: the transcript's own record) ────────────────────────

describe('a reload keeps the marks — the transcript carries the verdicts', () => {
  it('folds a citations record onto the reply it belongs to', () => {
    const { messages } = replayTranscript([
      { at: 1, turnId: 'd-1', kind: 'user', text: 'release notes', seats: ['opencode'] },
      { at: 2, turnId: 'd-1', kind: 'seat', cliKey: 'opencode', text: 'cites `6d77153`', ok: true, usage: null },
      { at: 3, turnId: 'd-1', kind: 'seat', cliKey: 'claude', text: 'cites nothing', ok: true, usage: null },
      {
        at: 4,
        turnId: 'd-1',
        kind: 'citations',
        cliKey: 'opencode',
        verified: 1,
        unverifiable: 1,
        corrected: 0,
        unchecked: 0,
        items: [item()],
      },
    ]);
    // Three bubbles, not four: the verdicts are not a message.
    expect(messages).toHaveLength(3);
    const opencode = messages[1] as Extract<Msg, { kind: 'seat' }>;
    const claude = messages[2] as Extract<Msg, { kind: 'seat' }>;
    expect(opencode.citations).toMatchObject({ verified: 1, unverifiable: 1 });
    expect(claude.citations).toBeUndefined(); // the other seat's reply is untouched
  });

  it('drops a record with no reply to fold onto instead of rendering it', () => {
    const { messages } = replayTranscript([
      {
        at: 1,
        turnId: 'd-9',
        kind: 'citations',
        cliKey: 'opencode',
        verified: 0,
        unverifiable: 1,
        corrected: 0,
        unchecked: 0,
        items: [item()],
      },
    ]);
    expect(messages).toEqual([]);
  });
});
