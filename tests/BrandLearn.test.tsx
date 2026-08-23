import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '../src/api/types.js';

/**
 * "Learn from a brand" (/theme) on the REAL wires — the flow studio#73
 * retracted, restored over interactive#181's readback:
 *
 *   ensure the project's scratch doc (real registry route, idempotent) →
 *   theme.requested over POST /api/events → bounded poll of
 *   GET /d/:docId/api/theme/learned → adapter → the resurrected §4.5 mapper →
 *   inline preview (nothing persisted) → Apply through the EXISTING
 *   appearance store. Every wrapper is mocked here, so ANY network the
 *   component did itself would be a jsdom failure — and the inert-at-rest
 *   constraint (zero learn-related calls before the user acts) is assertable.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn().mockResolvedValue({ settings: {} }),
    putAppearanceSettings: vi.fn().mockResolvedValue({ settings: {} }),
    listProjects: vi.fn().mockResolvedValue({ projects: [] }),
  },
}));

const listDocs = vi.fn();
const createDoc = vi.fn();
const requestThemeLearn = vi.fn();
const getLearnedTheme = vi.fn();
vi.mock('../src/api/interactive.js', () => ({
  listDocs: (...a: unknown[]) => listDocs(...a) as unknown,
  createDoc: (...a: unknown[]) => createDoc(...a) as unknown,
  requestThemeLearn: (...a: unknown[]) => requestThemeLearn(...a) as unknown,
  getLearnedTheme: (...a: unknown[]) => getLearnedTheme(...a) as unknown,
  attachSource: vi.fn(),
  interactiveUrl: (pid: string, p: string) =>
    `/api/v1/projects/${pid}/interactive${p.startsWith('/') ? p : `/${p}`}`,
  BridgeUnavailableError: class BridgeUnavailableError extends Error {},
  ServiceHintError: class ServiceHintError extends Error {
    readonly hint: string;
    constructor(message: string, hint: string) { super(message); this.hint = hint; }
  },
}));

const { api } = await import('../src/api/client.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { threadKey, useDocThreadStore } = await import('../src/store/docThread.js');
const { DEFAULT_APPEARANCE, useAppearanceStore } = await import('../src/theming/appearance.js');
const { SCRATCH_DOC_NAME } = await import('../src/theming/scratchDoc.js');
const { BrandLearn } = await import('../src/components/BrandLearn.js');

const root = () => document.documentElement;

function project(id: string, extra: Record<string, unknown> = {}): Project {
  return {
    id, name: id, description: null, status: 'active',
    scope: `project:${id}`, created_at: 1, updated_at: 1, ...extra,
  };
}

function scratchSummary() {
  return { name: SCRATCH_DOC_NAME, kind: 'doc', head: 1, versions: 1, updated_at: null };
}

// The fixture navy: #0a2a5e → the mapper lands (217, 81%, 59%) with a
// lightness-clamp + a contrast-floor adjustment (pinned in brandMapper.test.ts).
const LEARNED = {
  document_id: SCRATCH_DOC_NAME,
  learned_at: '2026-08-21T12:00:00.000Z',
  tokens: {
    name: 'acme-brand',
    colors: { background: '#f8fafc', primary: '#0a2a5e', secondary: '#0e7490' },
    fonts: { heading: 'Georgia', body: 'Georgia', mono: 'Menlo' },
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  listDocs.mockReset().mockResolvedValue([scratchSummary()]); // scratch doc exists by default
  createDoc.mockReset().mockResolvedValue({ name: SCRATCH_DOC_NAME, head: 0 });
  requestThemeLearn.mockReset().mockResolvedValue({ ok: true, event_id: 'e1', correlation_id: 'c1' });
  getLearnedTheme.mockReset().mockResolvedValue(LEARNED);
  vi.mocked(api.putAppearanceSettings).mockClear();
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE, loaded: true });
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {}, lastError: {} });
  useProjectsStore.setState({
    projects: [
      project('default'),
      project('scratch'),
      project('notes', { interactiveRoot: '/tmp/wi-notes' }),
    ],
    loading: false,
    error: null,
  });
  root().removeAttribute('style');
  root().removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function learnFrom(value = 'https://acme.example'): Promise<void> {
  fireEvent.change(screen.getByTestId('learn-input'), { target: { value } });
  await act(async () => {
    fireEvent.click(screen.getByTestId('learn-submit'));
    await vi.advanceTimersByTimeAsync(0); // ensure-doc + learn + the first poll settle
  });
}

describe('BrandLearn — the restored /theme extraction flow', () => {
  it('renders inert: the form is there, and NOT ONE learn wire has been touched', () => {
    render(<BrandLearn />);
    expect(screen.getByTestId('learn-source-url')).toBeChecked();
    expect(screen.getByTestId('learn-source-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('learn-source-image')).toBeInTheDocument();
    expect(screen.getByTestId('learn-project')).toBeInTheDocument();
    expect(screen.getByTestId('learn-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('learn-status')).toBeNull();
    expect(listDocs).not.toHaveBeenCalled();
    expect(createDoc).not.toHaveBeenCalled();
    expect(requestThemeLearn).not.toHaveBeenCalled();
    expect(getLearnedTheme).not.toHaveBeenCalled();
  });

  it('mentions the logo honesty in its copy — the learned shape carries none', () => {
    render(<BrandLearn />);
    expect(screen.getByTestId('brand-learn').textContent)
      .toMatch(/no logo, so the logo stays your manual choice/);
  });

  it('Learn reuses the existing scratch doc and fires theme.requested at it', async () => {
    render(<BrandLearn />);
    await learnFrom();
    // The default project is the one already bound to an interactive root.
    expect(listDocs).toHaveBeenCalledExactlyOnceWith('notes');
    expect(createDoc).not.toHaveBeenCalled(); // idempotent: listed → reused
    expect(requestThemeLearn).toHaveBeenCalledExactlyOnceWith(
      'notes', SCRATCH_DOC_NAME, { kind: 'url', url: 'https://acme.example' });
  });

  it('creates the scratch doc (slice-F shape) when the registry lacks it', async () => {
    listDocs.mockResolvedValue([]);
    render(<BrandLearn />);
    await learnFrom();
    expect(createDoc).toHaveBeenCalledTimes(1);
    const [pid, body] = createDoc.mock.calls[0] as [string, Record<string, unknown>];
    expect(pid).toBe('notes');
    expect(body).toMatchObject({ name: SCRATCH_DOC_NAME, kind: 'source', project: 'notes' });
    expect(requestThemeLearn).toHaveBeenCalledTimes(1);
  });

  it('a local path kind sends {kind, path} — nothing uploads from the browser', async () => {
    render(<BrandLearn />);
    fireEvent.click(screen.getByTestId('learn-source-pdf'));
    await learnFrom('/Users/op/brand.pdf');
    expect(requestThemeLearn).toHaveBeenCalledExactlyOnceWith(
      'notes', SCRATCH_DOC_NAME, { kind: 'pdf', path: '/Users/op/brand.pdf' });
  });

  it('rides the 404→200 readback, then previews inline WITHOUT persisting', async () => {
    getLearnedTheme
      .mockResolvedValueOnce(null)  // still 404: no learned theme
      .mockResolvedValueOnce(LEARNED);
    render(<BrandLearn />);
    await learnFrom();
    expect(getLearnedTheme).toHaveBeenCalledExactlyOnceWith('notes', SCRATCH_DOC_NAME);
    expect(screen.queryByTestId('learn-preview-chip')).toBeNull(); // still waiting

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); // first backoff step
    expect(getLearnedTheme).toHaveBeenCalledTimes(2);

    // Preview via the slice-7 machinery: inline overrides on <html>…
    expect(root().style.getPropertyValue('--_accent-h')).toBe('217');
    expect(root().style.getPropertyValue('--_accent-s')).toBe('81%');
    expect(root().style.getPropertyValue('--_accent-l')).toBe('59%');
    expect(root().style.getPropertyValue('--logo-url')).toBe(''); // logo NEVER touched
    // …but NOTHING persisted: the store still holds the defaults, no PUT fired.
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(258);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.putAppearanceSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('learn-preview-chip').textContent).toContain('217');
    // The mapper's moves are disclosed under the preview.
    const list = screen.getByTestId('mapper-adjustments');
    expect(list.textContent).toContain('lightness-clamp');
    expect(list.textContent).toContain('contrast-floor');
  });

  it('polling stops the moment the tokens land — no loop outlives the flow', async () => {
    render(<BrandLearn />);
    await learnFrom();
    expect(getLearnedTheme).toHaveBeenCalledTimes(1); // learned on the first read
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getLearnedTheme).toHaveBeenCalledTimes(1); // and never again
  });

  it('Apply persists the mapped accent through the EXISTING appearance store, logo untouched', async () => {
    render(<BrandLearn />);
    await learnFrom();
    fireEvent.click(screen.getByTestId('learn-apply'));
    const a = useAppearanceStore.getState().appearance;
    expect(a.accent_h).toBe(217);
    expect(a.accent_s).toBe(81);
    expect(a.accent_l).toBe(59);
    expect(a.logo_url).toBeNull(); // the manual choice stands — no logo in the learned shape
    await act(async () => { await vi.advanceTimersByTimeAsync(400); }); // the store's debounce
    expect(api.putAppearanceSettings).toHaveBeenCalledExactlyOnceWith(a);
    expect(screen.getByTestId('learn-status').textContent).toMatch(/Applied/);
  });

  it('Discard reverts the un-persisted preview to the stored appearance', async () => {
    render(<BrandLearn />);
    await learnFrom();
    expect(root().style.getPropertyValue('--_accent-h')).toBe('217');
    fireEvent.click(screen.getByTestId('learn-discard'));
    expect(root().style.getPropertyValue('--_accent-h')).toBe('258');
    expect(useAppearanceStore.getState().appearance.accent_h).toBe(258);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.putAppearanceSettings).not.toHaveBeenCalled();
    expect(screen.queryByTestId('learn-apply')).toBeNull();
  });

  it('Cancel while queued aborts the poll — no further readback requests', async () => {
    getLearnedTheme.mockResolvedValue(null); // never learns
    render(<BrandLearn />);
    await learnFrom();
    expect(getLearnedTheme).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByTestId('learn-cancel')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getLearnedTheme).toHaveBeenCalledTimes(1); // the abort ended the loop
    expect(screen.queryByTestId('learn-status')).toBeNull(); // back to idle
  });

  it('unmount aborts the poll', async () => {
    getLearnedTheme.mockResolvedValue(null);
    const { unmount } = render(<BrandLearn />);
    await learnFrom();
    expect(getLearnedTheme).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getLearnedTheme).toHaveBeenCalledTimes(1);
  });

  it("surfaces the bridge's ASYNC refusal (status.posted error) VERBATIM and stops polling", async () => {
    getLearnedTheme.mockResolvedValue(null);
    const refusal = "Couldn't grab that URL: refusing to fetch 169.254.169.254: "
      + 'loopback, private and link-local addresses are blocked (SSRF guard)';
    render(<BrandLearn />);
    await learnFrom('http://169.254.169.254/');
    // The bridge's own error line arrives on the scratch doc's thread over /ws.
    act(() => {
      useDocThreadStore.getState().ingest({
        type: 'interactiveEvent',
        event: {
          event_type: 'wicked.interactive.status.posted',
          payload: {
            project_id: 'notes', document_id: SCRATCH_DOC_NAME,
            state: 'error', message: refusal,
          },
        },
      } as never);
    });
    const polls = getLearnedTheme.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); // next tick reads it
    expect(screen.getByTestId('learn-status').textContent).toBe(refusal);
    expect(screen.queryByTestId('learn-apply')).toBeNull();
    expect(root().style.getPropertyValue('--_accent-h')).toBe(''); // no preview
    const after = getLearnedTheme.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getLearnedTheme.mock.calls.length).toBe(after); // refusal ended the loop
    expect(after - polls).toBeLessThanOrEqual(1);
  });

  it('a STALE thread error (from before this learn) does not end the wait', async () => {
    const key = threadKey('notes', SCRATCH_DOC_NAME);
    useDocThreadStore.setState({ lastError: { [key]: { text: 'old failure from last week' } } });
    render(<BrandLearn />);
    await learnFrom();
    // The learn resolves on the first read — the stale error never surfaced.
    expect(screen.getByTestId('learn-status').textContent).not.toContain('old failure');
    expect(screen.getByTestId('learn-preview-chip')).toBeInTheDocument();
  });

  it('learned tokens with no usable brand color are an honest error, not a default accent', async () => {
    getLearnedTheme.mockResolvedValue({
      ...LEARNED, tokens: { name: 'fonts-only', fonts: { body: 'Georgia' } },
    });
    render(<BrandLearn />);
    await learnFrom();
    expect(screen.getByTestId('learn-status').textContent).toMatch(/no usable brand color/);
    expect(root().style.getPropertyValue('--_accent-h')).toBe(''); // nothing applied
    expect(screen.queryByTestId('learn-apply')).toBeNull();
  });

  it('a SYNC refusal from the emit (unknown doc, 403, 503) shows verbatim and never polls', async () => {
    requestThemeLearn.mockRejectedValue(new Error('API 403: event type not emittable'));
    render(<BrandLearn />);
    await learnFrom();
    expect(screen.getByTestId('learn-status').textContent).toBe('API 403: event type not emittable');
    expect(getLearnedTheme).not.toHaveBeenCalled();
  });
});
