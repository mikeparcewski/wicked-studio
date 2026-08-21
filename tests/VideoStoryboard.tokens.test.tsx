/**
 * Video mode — the §5.6 visual language under the token contract
 * (DES-VISION-001 vision slice 4; the e2e rig re-proves computed values in a
 * real browser).
 *
 * Pins the slice's §5.6 composition at unit level:
 *   - chapter thumbs sit on `--surface-raised`; the SELECTED chapter carries
 *     `border: 2px solid var(--accent)` (the slice DOM AC), 2px in every state
 *     so selection never shifts the layout;
 *   - the chapter caption (the mm:ss offset) is `--text-2xs --ink-dim` in the
 *     mono — data, not prose (§2.8);
 *   - the storyboard and action bar sit on `--surface-rail`; the player
 *     container wears the same clean framing as Document's canvas;
 *   - recording-status narration reads `--font-mono --text-xs --ink-body`
 *     (§5.6: never bare "Working…" — the §3.4 words are pinned elsewhere;
 *     this file pins the face).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VideoStoryboard } from '../src/components/VideoStoryboard.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';
import type { DemoStep } from '../src/api/interactive.js';

const PROJECT = 'proj-abc-123';
const DEMO = 'checkout-walkthrough';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', { value: new URL(url), writable: true, configurable: true });
}

type Reply = { status?: number; body: unknown };

function stubFetch(routes: Record<string, Reply>): void {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const hit = Object.entries(routes).find(([frag]) => url.includes(frag));
    if (!hit) return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    const { status = 200, body } = hit[1];
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    });
  }));
}

const STEPS: DemoStep[] = [
  { index: 0, title: 'Open the storefront', timestamp: 0 },
  { index: 1, title: 'Add a hoodie to the cart', timestamp: 6.5 },
];

beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  setLocation('http://127.0.0.1:7788/');
  stubFetch({
    '/api/demo/spec': { body: { steps: STEPS } },
    '/api/demo/recordings': { body: { version: 1, gif_url: '/d/x/demo/v1.gif' } },
    '/api/versions': { body: { head: 1, kind: 'demo', versions: [] } },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  useDocThreadStore.setState({ messages: {}, genState: {}, anchor: {}, landed: {} });
});

describe('VideoStoryboard — the §5.6 tokens', () => {
  it('chapter thumbs: --surface-raised, the SELECTED one bordered 2px var(--accent)', async () => {
    const user = userEvent.setup();
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    const cards = await screen.findAllByTestId('chapter-card');

    expect(cards[0]!.style.background).toBe('var(--surface-raised)');
    expect(cards[0]!.style.border).toBe('2px solid var(--accent)');
    // Unselected stays 2px (transparent) so selecting never shifts the layout.
    expect(cards[1]!.style.border).toBe('2px solid transparent');

    await user.click(cards[1]!);
    expect(cards[1]!.getAttribute('data-selected')).toBe('true');
    expect(cards[1]!.style.border).toBe('2px solid var(--accent)');
    expect(cards[0]!.style.border).toBe('2px solid transparent');
  });

  it('the chapter caption is --text-2xs --ink-dim in the mono (§5.6)', async () => {
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    const cards = await screen.findAllByTestId('chapter-card');
    const caption = cards[1]!.querySelector('span:last-child') as HTMLElement;
    expect(caption).toHaveTextContent('0:06');
    expect(caption.style.fontSize).toBe('var(--text-2xs)');
    expect(caption.style.color).toBe('var(--ink-dim)');
    expect(caption.style.fontFamily).toBe('var(--font-mono)');
  });

  it('the storyboard rides --surface-rail; the player wears the canvas framing', async () => {
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    await screen.findAllByTestId('chapter-card');
    expect(screen.getByTestId('demo-storyboard').style.background).toBe('var(--surface-rail)');
    const player = screen.getByTestId('demo-player');
    expect(player.style.background).toBe('var(--surface-base)');
    expect(player.style.border).toContain('var(--surface-raised)');
    expect(player.style.borderRadius).toBe('var(--radius-lg)');
  });

  it('recording-status narration reads mono / --text-xs / --ink-body (§5.6)', async () => {
    useDocThreadStore.setState({ genState: { [threadKey(PROJECT, DEMO)]: 'generating' } });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    await screen.findAllByTestId('chapter-card');
    const status = screen.getByTestId('demo-record-status');
    expect(status.style.fontFamily).toBe('var(--font-mono)');
    expect(status.style.fontSize).toBe('var(--text-xs)');
    expect(status.style.color).toBe('var(--ink-body)');
    // §3.4 rule 3 held through the conversion: the status names its subject.
    expect(status.textContent).toContain(DEMO);
  });
});
