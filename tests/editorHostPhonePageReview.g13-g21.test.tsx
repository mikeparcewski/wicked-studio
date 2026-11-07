import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocCheck } from '../src/api/docChecks.js';
import { reviewLanded, reviewRequestOf } from '../src/board/checksPanel.js';
import { ChecksPanel, REVIEW_POLL_MS } from '../src/components/session/ChecksPanel.js';
import { InteractiveDocSurfaceAdapter } from '../src/editors/adapters/interactiveDoc.js';
// @ts-expect-error -- a plain Node script, no declarations
import { EDITORS, surfacesOf } from '../scripts/build-editors.mjs';

/**
 * plugins-complete G13 (a page exports as HTML and PDF), G14 (full screen and the deck on a phone) and G21 ("Review
 * this version" asks the four reviews again for the version on screen).
 */

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('G13: a page exports', () => {
  it('wicked-page holds artifact.export and declares the Export action', () => {
    const page = (EDITORS as { id: string; permissions: { id: string }[] }[]).find((e) => e.id === 'wicked-page')!;
    expect(page.permissions.map((p) => p.id)).toContain('artifact.export');
    const actions = (surfacesOf('wicked-page') as { card: { actions: { verb: string }[] } }).card.actions;
    expect(actions.map((a) => a.verb)).toEqual(['host:ask', 'host:export']);
  });
  it('the page adapter offers a web page and a PDF', () => {
    const a = new InteractiveDocSurfaceAdapter({ artifactKey: 'k', title: 'P', kind: 'page', source: 'interactive-doc', projectId: 'p', docId: 'd', composerKey: 'c' });
    expect(a.exports().map((x) => x.format)).toEqual(['html', 'pdf']);
    expect(a.capabilities()).toContain('export');
  });
});

describe('G14: full screen on a phone', () => {
  const css = read('../src/styles/sections/editor-host.css');
  const phone = css.slice(css.indexOf('@media (max-width: 599px)'), css.indexOf('/* The app nav collapses'));
  it('the header wraps, with tag, title and Esc on the first row', () => {
    expect(phone).toMatch(/\.wk-full-head \{[^}]*flex-wrap: wrap/u);
    expect(phone).toMatch(/\.wk-full-gap \{[^}]*flex: 0 0 100%/u);
    expect(phone).toMatch(/\[data-testid='full-shell-exit'\] \{ order: 0; \}/u);
  });
  it('the chat drawer lies over the artifact instead of a 360 px column', () => {
    expect(phone).toMatch(/\.wk-full-drawer \{[^}]*position: absolute; inset: 0/u);
  });
  it('the deck stacks its filmstrip above the slide in a narrow frame, only where the filmstrip shows', () => {
    const deck = read('../src/plugins/wicked-deck/template.html');
    const narrow = deck.slice(deck.indexOf('@media (max-width: 599px)'), deck.indexOf('@media (prefers-reduced-motion'));
    // The one rule that changes the deck's layout is keyed on a visible strip (inline, present and options hide it).
    const layout = narrow.split('\n').filter((l) => /^\s*\.deck/u.test(l));
    expect(layout).toHaveLength(1);
    expect(layout[0]).toMatch(/^\s*\.deck:has\(> \.strip:not\(\[hidden\]\)\) \{ grid-template-columns: minmax\(0, 1fr\); grid-template-rows: auto minmax\(0, 1fr\); \}/u);
    // Every other phone rule styles only the strip and its thumbnails.
    for (const l of narrow.split('\n').filter((x) => /\{/u.test(x) && !/@media|^\s*\.deck/u.test(x))) expect(l.trim()).toMatch(/^\.(strip|thumb)\b/u);
    // ... and the strip is hidden by the plugin where it must not show.
    expect(read('../src/plugins/wicked-deck/plugin.ts')).toContain("strip.hidden = size === 'inline' || present || options;");
  });
});

const check = (reviewer: DocCheck['reviewer'], version: number): DocCheck => ({
  id: `${reviewer}-${version}`, source: 'review:intent', reviewer, version, state: 'pass', sentence: 'Fine.', findings: [],
  by: { seat: 'codex', evaluator: true, excluded_seats: [], author_known: true }, skill: null, run_id: 'r1', at: '2026-11-06T00:00:00Z',
} as DocCheck);

describe('G21: Review this version', () => {
  it('a review has landed only when all four reviewers have a verdict on that version', () => {
    expect(reviewLanded([check('match', 3), check('a11y', 3), check('copy', 3)], 3)).toBe(false);
    expect(reviewLanded([check('match', 3), check('a11y', 3), check('copy', 3), check('qe', 2)], 3)).toBe(false);
    expect(reviewLanded([check('match', 3), check('a11y', 3), check('copy', 3), check('qe', 3)], 3)).toBe(true);
    expect(reviewRequestOf('launch', 3)).toEqual({ event_type: 'wicked.interactive.review.requested', payload: { document_id: 'launch', version: 3 } });
  });

  it('posts review.requested for the version on screen, then re-reads until the verdicts land', async () => {
    let landed = false;
    const posts: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url: u, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ ok: true, event_id: 'e1', correlation_id: 'c1' }), { status: 200 });
      }
      const checks = landed ? (['match', 'a11y', 'copy', 'qe'] as const).map((r) => check(r, 3)) : [check('match', 2)];
      return new Response(JSON.stringify({ document_id: 'launch', version: 3, checks }), { status: 200 });
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ChecksPanel projectId="notes" docId="launch" head={3} pointAt={async () => true} />);
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review')).toBeTruthy());
    fireEvent.click(screen.getByTestId('artifact-checks-review'));
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review-state').dataset['state']).toBe('asked'));
    expect(posts).toEqual([{ url: expect.stringMatching(/\/projects\/notes\/interactive\/api\/events$/u), body: { event_type: 'wicked.interactive.review.requested', payload: { document_id: 'launch', version: 3 } } }]);
    expect((screen.getByTestId('artifact-checks-review') as HTMLButtonElement).disabled).toBe(true);
    landed = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_POLL_MS + 10); });
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review-state').dataset['state']).toBe('landed'));
    expect(screen.getByTestId('artifact-checks-review-state').textContent).toContain('Version 3 is reviewed.');
  });

  it('one read at a time: the next starts 10 s after the last settles, however long a read takes', async () => {
    let inFlight = 0; let most = 0; let gets = 0;
    const release: (() => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ ok: true, event_id: 'e', correlation_id: 'c' }), { status: 200 });
      gets += 1; inFlight += 1; most = Math.max(most, inFlight);
      if (gets > 1) await new Promise<void>((r) => release.push(r));
      inFlight -= 1;
      return new Response(JSON.stringify({ document_id: 'launch', version: 3, checks: [] }), { status: 200 });
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ChecksPanel projectId="notes" docId="launch" head={3} pointAt={async () => true} />);
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review')).toBeTruthy());
    fireEvent.click(screen.getByTestId('artifact-checks-review'));
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review-state').dataset['state']).toBe('asked'));
    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_POLL_MS + 10); });
    expect(gets).toBe(2);
    // The second read hangs for a minute: no third starts meanwhile.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(gets).toBe(2);
    expect(most).toBe(1);
    await act(async () => { release.shift()!(); await vi.advanceTimersByTimeAsync(50); });
    await act(async () => { await vi.advanceTimersByTimeAsync(REVIEW_POLL_MS + 10); });
    await waitFor(() => expect(gets).toBe(3));
  });

  it('an answer for an ask on another version changes nothing on the version now shown', async () => {
    let answer: (() => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') { await new Promise<void>((r) => { answer = r; }); return new Response(JSON.stringify({ ok: true, event_id: 'e', correlation_id: 'c' }), { status: 200 }); }
      return new Response(JSON.stringify({ document_id: 'launch', version: 3, checks: [] }), { status: 200 });
    }));
    const view = render(<ChecksPanel projectId="notes" docId="launch" head={3} pointAt={async () => true} />);
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review')).toBeTruthy());
    fireEvent.click(screen.getByTestId('artifact-checks-review'));
    await waitFor(() => expect(answer).not.toBeNull());
    view.rerender(<ChecksPanel projectId="notes" docId="launch" head={4} pointAt={async () => true} />);
    await waitFor(() => expect(screen.queryByTestId('artifact-checks-review-state')).toBeNull());
    await act(async () => { answer!(); await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('artifact-checks-review-state')).toBeNull();
    expect((screen.getByTestId('artifact-checks-review') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a version that already has its four reviews says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'POST'
      ? new Response(JSON.stringify({ ok: true, event_id: 'e', correlation_id: 'c' }), { status: 200 })
      : new Response(JSON.stringify({ document_id: 'launch', version: 3, checks: (['match', 'a11y', 'copy', 'qe'] as const).map((r) => check(r, 3)) }), { status: 200 }))));
    render(<ChecksPanel projectId="notes" docId="launch" head={3} pointAt={async () => true} />);
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review')).toBeTruthy());
    fireEvent.click(screen.getByTestId('artifact-checks-review'));
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review-state').textContent).toContain('already has its four reviews'));
  });

  it('a refused ask says why, and the button comes back', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'POST'
      ? new Response(JSON.stringify({ error: 'unknown doc' }), { status: 404 })
      : new Response(JSON.stringify({ document_id: 'launch', version: 3, checks: [] }), { status: 200 }))));
    render(<ChecksPanel projectId="notes" docId="launch" head={3} pointAt={async () => true} />);
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review')).toBeTruthy());
    fireEvent.click(screen.getByTestId('artifact-checks-review'));
    await waitFor(() => expect(screen.getByTestId('artifact-checks-review-state').dataset['state']).toBe('failed'));
    expect((screen.getByTestId('artifact-checks-review') as HTMLButtonElement).disabled).toBe(false);
  });
});
