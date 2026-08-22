// DES-FEEDBACK-002 §7 (slice K) — the version compare lens.
//
// These pin the §7.5 ACs:
//   - defaultComparand is the LINEAGE PARENT ("v(N) vs v(N−1)" is parent, not
//     ordinal-minus-one — a forked v3 with parent v1 compares against v1);
//   - the toggle is disabled WITH A REASON on a v1-only document;
//   - entering compare renders two compare-pane iframes whose src end /doc/N
//     and /doc/parent — two instances of the already-real version URL, no new
//     routes (§7.1 EXISTS);
//   - the vs: dropdown lists every OTHER version and re-points ONLY the right
//     pane; overlay stacks the two iframes and the slider drives the top one's
//     opacity;
//   - every exit path (✕ / registry Escape / the toggle) returns to the solo
//     canvas at the selected version, with the comparand state reset.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentCanvas, defaultComparand } from '../src/components/DocumentCanvas.js';
import type { VersionManifest } from '../src/api/interactive.js';

const PROJECT = 'proj-abc-123';
const DOC = 'q3-report';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url), writable: true, configurable: true,
  });
}

function prodOrigin(): void {
  vi.stubEnv('VITE_API_HOST', '');
  setLocation('http://127.0.0.1:7788/');
}

type Reply = { status?: number; body: unknown };

function stubFetch(routes: Record<string, Reply>): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    seen.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (hit === undefined) return Promise.reject(new Error(`unrouted fetch: ${url}`));
    const { status = 200, body } = hit[1];
    return Promise.resolve({
      ok: status >= 200 && status < 300, status, statusText: String(status),
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    });
  }));
  return seen;
}

function entry(version: number, parent: number | null) {
  return { version, parent, feedback_file: null, html_file: `v${version}.html`,
           created_at: `2026-08-1${version}T09:00:00Z` };
}

const LINEAR: VersionManifest = { head: 3, versions: [entry(1, null), entry(2, 1), entry(3, 2)] };
const FORKED: VersionManifest = { head: 3, versions: [entry(1, null), entry(2, 1), entry(3, 1)] };
const V1ONLY: VersionManifest = { head: 1, versions: [entry(1, null)] };

beforeEach(prodOrigin);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ── The default comparand, pure (§7.2) ───────────────────────────────────────

describe('defaultComparand — lineage parent, not ordinal-minus-one', () => {
  it('linear lineage: v3 defaults to its parent v2', () => {
    expect(defaultComparand(LINEAR, 3)).toBe(2);
  });

  it('FORKED lineage: v3 with parent v1 defaults to v1 — the operator words are lineage', () => {
    expect(defaultComparand(FORKED, 3)).toBe(1);
  });

  it('no parent (v1 selected among others): nearest OTHER version stands in', () => {
    expect(defaultComparand(LINEAR, 1)).toBe(2);
  });

  it('v1-only document: nothing to compare — null (the disabled case)', () => {
    expect(defaultComparand(V1ONLY, 1)).toBeNull();
  });
});

// ── The component (§7.5) ─────────────────────────────────────────────────────

async function mountDoc(manifest: VersionManifest, version: number | null = null) {
  stubFetch({ '/api/versions': { body: manifest } });
  const navigate = vi.fn();
  render(<DocumentCanvas projectId={PROJECT} docId={DOC} version={version} navigate={navigate} />);
  await screen.findByTestId('doc-canvas');
  return navigate;
}

describe('DocumentCanvas compare (§7.5)', () => {
  it('AC: on a v1-only document the toggle is DISABLED with the stated reason', async () => {
    await mountDoc(V1ONLY);
    const toggle = screen.getByTestId('version-compare-toggle');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute('title')).toBe('only one version exists');
  });

  it('AC: entering compare renders two panes — /doc/3 (selected) and /doc/2 (parent)', async () => {
    await mountDoc(LINEAR, 3);
    await userEvent.click(screen.getByTestId('version-compare-toggle'));
    const panes = screen.getAllByTestId('compare-pane');
    expect(panes).toHaveLength(2);
    expect(panes[0]!.getAttribute('src')).toMatch(/\/doc\/3$/);
    expect(panes[1]!.getAttribute('src')).toMatch(/\/doc\/2$/);
    // The solo canvas retired for the lens; the strip cluster names the pair.
    expect(screen.queryByTestId('doc-canvas')).toBeNull();
    expect(screen.getByTestId('compare-controls').textContent).toContain('Comparing v3 ↔ v2');
    // The comparand header names the lineage relation.
    expect(screen.getByText('v2 (parent)')).toBeTruthy();
  });

  it('AC: the vs: dropdown lists every OTHER version and re-points ONLY the right pane', async () => {
    await mountDoc(LINEAR, 3);
    await userEvent.click(screen.getByTestId('version-compare-toggle'));
    const vs = screen.getByTestId('compare-vs') as HTMLSelectElement;
    expect([...vs.options].map((o) => o.value)).toEqual(['1', '2']);
    await userEvent.selectOptions(vs, '1');
    const panes = screen.getAllByTestId('compare-pane');
    expect(panes[0]!.getAttribute('src')).toMatch(/\/doc\/3$/); // left untouched
    expect(panes[1]!.getAttribute('src')).toMatch(/\/doc\/1$/); // right re-pointed
  });

  it('AC: overlay stacks the two iframes; the slider drives the TOP frame opacity', async () => {
    await mountDoc(LINEAR, 3);
    await userEvent.click(screen.getByTestId('version-compare-toggle'));
    await userEvent.click(screen.getByTestId('compare-overlay-toggle'));
    const panes = screen.getAllByTestId('compare-pane');
    expect(panes).toHaveLength(2);
    const top = panes.find((p) => p.getAttribute('data-layer') === 'top')!;
    const under = panes.find((p) => p.getAttribute('data-layer') === 'under')!;
    expect(top.getAttribute('data-version')).toBe('2');
    expect((top as HTMLIFrameElement).style.opacity).toBe('0.5'); // slider default 50
    // Pointer events go to the top iframe only (§7.2).
    expect((under as HTMLIFrameElement).style.pointerEvents).toBe('none');
    const slider = screen.getByTestId('overlay-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '20' } });
    expect((screen.getAllByTestId('compare-pane')
      .find((p) => p.getAttribute('data-layer') === 'top') as HTMLIFrameElement).style.opacity)
      .toBe('0.2');
  });

  it('AC exit paths: ✕, registry Escape, and the toggle all return to the solo canvas', async () => {
    await mountDoc(LINEAR, 3);
    // ✕
    await userEvent.click(screen.getByTestId('version-compare-toggle'));
    await userEvent.click(screen.getByTestId('compare-exit'));
    expect(screen.queryByTestId('compare-pane')).toBeNull();
    expect(screen.getByTestId('doc-canvas').getAttribute('data-version')).toBe('3');
    // Escape — through the ONE shortcut registry (EC21), so a focused input yields.
    await userEvent.click(screen.getByTestId('version-compare-toggle'));
    expect(screen.getAllByTestId('compare-pane')).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('compare-pane')).toBeNull());
    // Overlay state resets on exit (§7.2: reset on exit) — re-entering is split mode.
    await userEvent.click(screen.getByTestId('version-compare-toggle'));
    await userEvent.click(screen.getByTestId('compare-overlay-toggle'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('compare-pane')).toBeNull());
    await userEvent.click(screen.getByTestId('version-compare-toggle'));
    expect(screen.getByTestId('compare-split')).toBeTruthy();
    expect(screen.queryByTestId('overlay-slider')).toBeNull();
  });

  it('Escape NEVER steals a typing context (the registry guard, EC21)', async () => {
    await mountDoc(LINEAR, 3);
    await userEvent.click(screen.getByTestId('version-compare-toggle'));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    // Compare stays: the key belonged to the editable element.
    expect(screen.getAllByTestId('compare-pane')).toHaveLength(2);
    input.remove();
  });
});
