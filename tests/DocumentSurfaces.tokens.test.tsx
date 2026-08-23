/**
 * Document mode — the §5.5 visual language under the token contract
 * (DES-VISION-001 vision slice 4; the e2e rig re-proves computed values in a
 * real browser).
 *
 * Pins the slice's §5.5 composition at unit level:
 *   - the version strip sits on `--surface-rail` with the accent-subtle spine
 *     rule, and the SELECTED entry carries the active version dot whose
 *     background resolves from `var(--accent)` (the slice DOM AC);
 *   - the Themes popover opens with `data-testid="themes-explanation"` — the
 *     one-liner in `--font-sans --ink-body --text-sm` (§5.5);
 *   - thread version tags are HISTORY: `--status-done` ink on a `--radius-sm`
 *     badge (§5.5 — Video's "recording complete" tag mirrors this);
 *   - the thread sits on `--surface-base`; user messages are transparent with
 *     a hairline; the composer wears §5.3's contract (`--surface-raised`,
 *     `--radius-xl`, the wk-composer focus-ring hook) with an accent-filled
 *     submit;
 *   - the §5.5 cross-link flash: scrollThreadToMessage is smooth AND flashes
 *     `wk-anchor-flash` once (pinned in threadAnchor.test.ts; referenced here
 *     because VersionStrip.select is the caller).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VersionStrip } from '../src/components/VersionStrip.js';
import { ThemesMenu, THEMES_EXPLAINER } from '../src/components/ThemesMenu.js';
import { DocumentThread } from '../src/components/DocumentThread.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';
import type { VersionEntry, VersionManifest } from '../src/api/interactive.js';

const PROJECT = 'proj-abc-123';
const DOC = 'q3-report';

const listThemes = vi.hoisted(() => vi.fn());
vi.mock('../src/api/interactive.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/interactive.js')>()),
  listThemes,
}));

function entry(version: number, over: Partial<VersionEntry> = {}): VersionEntry {
  return {
    version,
    parent: version - 1 || null,
    feedback_file: null,
    html_file: `v${version}.html`,
    created_at: `2026-08-1${version}T09:00:00Z`,
    ...over,
  };
}

function manifest(versions: VersionEntry[]): VersionManifest {
  return { head: versions[versions.length - 1]!.version, versions };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {} });
});

describe('VersionStrip — the §5.5 tokens', () => {
  function mount(selected = 2): void {
    render(
      <VersionStrip
        projectId={PROJECT}
        docId={DOC}
        manifest={manifest([entry(1), entry(2)])}
        selected={selected}
        navigate={vi.fn()}
        onForked={vi.fn()}
      />,
    );
  }

  it('the strip is --surface-rail with the accent-subtle spine rule on top', () => {
    mount();
    const strip = screen.getByTestId('version-strip');
    expect(strip.style.background).toBe('var(--surface-rail)');
    expect(strip.style.borderTop).toContain('var(--accent-subtle)');
  });

  it('the SELECTED entry carries the active version dot, background from var(--accent)', () => {
    mount(2);
    const dot = screen.getByTestId('version-active-dot');
    expect(dot.style.background).toBe('var(--accent)');
    // The dot lives in the selected entry and ONLY there.
    const selectedEntry = document.querySelector('[data-testid="version-entry"][data-selected="true"]');
    expect(selectedEntry?.contains(dot)).toBe(true);
    expect(document.querySelectorAll('[data-testid="version-active-dot"]')).toHaveLength(1);
  });

  it('version numbers and stamps read in the mono (§2.8: data)', () => {
    mount();
    for (const stamp of screen.getAllByTestId('version-stamp')) {
      expect(stamp.style.fontFamily).toBe('var(--font-mono)');
    }
  });
});

describe('ThemesMenu — the §5.5 explanation', () => {
  it('opens with data-testid="themes-explanation" in sans / --ink-body / --text-sm', async () => {
    listThemes.mockResolvedValue([{ name: 'stripe-ish' }]);
    const user = userEvent.setup();
    render(<ThemesMenu projectId={PROJECT} docId={DOC} />);
    await user.click(screen.getByTestId('themes-open'));

    const explanation = screen.getByTestId('themes-explanation');
    expect(explanation).toHaveTextContent(THEMES_EXPLAINER);
    expect(explanation.style.fontFamily).toBe('var(--font-sans)');
    expect(explanation.style.color).toBe('var(--ink-body)');
    expect(explanation.style.fontSize).toBe('var(--text-sm)');
  });
});

describe('DocumentThread — the §5.5 tokens', () => {
  function mountWithVersionTag(): void {
    const key = threadKey(PROJECT, DOC);
    // One user message already tagged with the version it produced (§7.6's
    // fold, pre-applied — the fold itself is pinned by the store's own tests).
    useDocThreadStore.setState({
      messages: { [key]: [{ kind: 'user', id: 'msg-1', text: 'make me a deck', version: 1 }] },
    });
    render(
      <DocumentThread
        projectId={PROJECT}
        docId={DOC}
        selectedVersion={1}
        navigate={vi.fn()}
      />,
    );
  }

  it('the thread pane sits on --surface-base in the sans', () => {
    render(<DocumentThread projectId={PROJECT} docId={null} selectedVersion={null} navigate={vi.fn()} />);
    const thread = screen.getByTestId('thread');
    expect(thread.style.background).toBe('var(--surface-base)');
    expect(thread.style.fontFamily).toBe('var(--font-sans)');
  });

  it('the version tag is history: --status-done ink on a --radius-sm badge', () => {
    mountWithVersionTag();
    const tag = screen.getByTestId('thread-version-tag');
    expect(tag).toHaveTextContent('▤ v1 landed');
    expect(tag.style.color).toBe('var(--status-done)');
    expect(tag.style.borderRadius).toBe('var(--radius-sm)');
    expect(tag.style.background).toBe('transparent');
  });

  it('user messages are transparent with a hairline (§5.3 shared across modes)', () => {
    mountWithVersionTag();
    const msg = screen.getByTestId('doc-message');
    expect(msg.style.background).toBe('transparent');
    expect(msg.style.border).toContain('var(--surface-raised)');
  });

  it('the composer wears §5.3: --surface-raised at --radius-xl, wk-composer hook, accent submit', () => {
    render(<DocumentThread projectId={PROJECT} docId={null} selectedVersion={null} navigate={vi.fn()} />);
    const composer = screen.getByTestId('doc-composer');
    const box = composer.parentElement as HTMLElement;
    expect(box.className).toContain('wk-composer');
    expect(box.style.background).toBe('var(--surface-raised)');
    expect(box.style.borderRadius).toBe('var(--radius-xl)');
    const submit = screen.getByTestId('doc-composer-submit');
    expect(submit.style.background).toBe('var(--accent)');
    expect(submit.style.color).toBe('var(--accent-fg)');
  });
});
