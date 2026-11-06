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
  it('the deck stacks its filmstrip above the slide in a narrow frame', () => {
    const deck = read('../src/plugins/wicked-deck/template.html');
    const narrow = deck.slice(deck.indexOf('@media (max-width: 599px)'));
    expect(narrow).toMatch(/grid-template-rows: auto minmax\(0, 1fr\)/u);
    expect(narrow).toMatch(/\.strip ol \{ flex-direction: row; \}/u);
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
