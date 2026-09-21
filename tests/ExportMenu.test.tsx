// Export from the two surfaces the design puts it on — DES-MERGE-001 §4.4, §1.4, §6.4
// slice 15: per-version on Document mode's version strip, and as a quick action on the
// board card's doc tile. The wire underneath is REAL in these cases (only `postExport`
// is stubbed), because the claim being made is that pressing a control on either surface
// produces the same request and the same transcript.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectCard } from '../src/components/ProjectCard.js';
import { VersionStrip } from '../src/components/VersionStrip.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import type { CoreEvent } from '../src/api/types.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';
import { exportKey, useExportAnswers } from '../src/store/exportAnswers.js';

const postExport = vi.fn();
const postFork = vi.fn();

const { ServiceHintError } = vi.hoisted(() => ({
  ServiceHintError: class ServiceHintError extends Error {
    readonly hint: string;
    constructor(message: string, hint: string) {
      super(message);
      this.name = 'ServiceHintError';
      this.hint = hint;
    }
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  postExport: (...a: unknown[]) => postExport(...a),
  postFork: (...a: unknown[]) => postFork(...a),
  // The real resolver's shape (interactive.ts): proxy mount + bridge-root-relative path.
  interactiveUrl: (pid: string, p: string) => `/api/v1/projects/${pid}/interactive${p}`,
  ServiceHintError,
}));

const PROJECT = 'proj-abc';
const DOC = 'roadmap';
const PPTX_HINT = 'pip install python-pptx and export again';

const MANIFEST = {
  head: 3,
  versions: [1, 2, 3].map((version) => ({
    version, parent: version - 1 || null, feedback_file: null,
    html_file: `v${version}.html`, created_at: `2026-08-1${version}T11:30:00Z`,
  })),
};

function reply(file: string, format = 'pdf'): Record<string, string> {
  return { format, path: `/exports/${file}`, file, download: `/d/${DOC}/download/${file}` };
}

function messages(docId = DOC): DocMsg[] {
  return useDocThreadStore.getState().messages[threadKey(PROJECT, docId)] ?? [];
}

function strip(selected = 3): void {
  render(
    <VersionStrip
      projectId={PROJECT}
      docId={DOC}
      manifest={MANIFEST}
      selected={selected}
      navigate={() => {}}
      onForked={() => {}}
    />,
  );
}

/** One board card carrying one document — §1.4's card, at the tile that owns the export.
 *  Doc tiles are ACTIVE-variant furniture (DES-UXFIX-001 §2.1.1, slice 2): a quiet
 *  card is one line and no tiles, so this card is pinned into NEEDS YOU. */
function card(): void {
  const item = {
    project: {
      id: PROJECT, name: 'Wicked', description: null, status: 'active',
      scope: `project:${PROJECT}`, created_at: 1, updated_at: 1,
    },
    repo: null,
    runs: [],
    docs: [{ name: DOC, kind: 'doc' as const, head: 3, versions: 3, updated_at: '2026-08-18T11:30:00Z' }],
    attention: 'drafts' as const,
    score: 40,
    band: 'needs-you' as const,
    signal: { kind: 'running' as const, at: Date.now() },
  } as unknown as BoardProject;
  render(<ProjectCard item={item} navigate={() => {}} />);
}

/** Press one format button inside the menu on screen. */
async function press(format: string, scope?: HTMLElement): Promise<void> {
  const root = scope ?? screen.getByTestId('export-menu');
  const button = within(root).getAllByTestId('export-format')
    .find((b) => b.getAttribute('data-format') === format);
  await userEvent.setup().click(button as HTMLElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Prevent hydrateExports from issuing real network requests in all suites below.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in unit tests')));
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {} });
  useExportAnswers.getState().clear();
  postExport.mockResolvedValue(reply('roadmap_v3.pdf'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('the version strip exports the SELECTED version (§4.4, §4.2)', () => {
  it('AC: all three formats are offered, per version', () => {
    strip();
    const menu = screen.getByTestId('export-menu');
    expect(menu).toHaveAttribute('data-version', '3');
    expect(within(menu).getAllByTestId('export-format').map((b) => b.getAttribute('data-format')))
      .toEqual(['html', 'pdf', 'pptx']);
  });

  it('exports the version the strip has selected, not the manifest head', async () => {
    strip(1);
    await press('pdf');
    await waitFor(() => expect(postExport).toHaveBeenCalledWith(PROJECT, DOC, 1, 'pdf'));
  });

  it('the artifact lands in the thread as a download — and no failure hint renders', async () => {
    strip();
    await press('html');
    postExport.mockResolvedValue(reply('roadmap_v3.html', 'html'));

    await waitFor(() => expect(messages().some((m) => m.kind === 'agent')).toBe(true));
    expect(screen.queryByTestId('export-hint')).toBeNull();
  });

  // DES-UX-001 §7.2 (B5, EC37): the control the finger pressed answers WHERE it
  // was pressed — pending on the clicked control, then the click site itself
  // becoming the download affordance. The thread message still lands (above).
  it('AC §7.2: the clicked control renders export-pending, then BECOMES the download (export-ready)', async () => {
    let release: (v: unknown) => void = () => {};
    postExport.mockImplementation(() => new Promise((res) => { release = res; }));
    strip();
    await press('pdf');

    // PENDING, on that control: the spinner is inside the pdf button itself.
    const pending = screen.getByTestId('export-pending');
    expect(pending.closest('[data-format="pdf"]')).not.toBeNull();

    release(reply('roadmap_v3.pdf'));
    // READY, at the click site: a REAL anchor — href through the one-origin proxy,
    // download attribute naming the artifact — where the pdf button was.
    const ready = await screen.findByTestId('export-ready');
    expect(ready.tagName).toBe('A');
    expect(ready).toHaveAttribute('data-format', 'pdf');
    expect(ready).toHaveAttribute(
      'href', `/api/v1/projects/${PROJECT}/interactive/d/${DOC}/download/roadmap_v3.pdf`);
    expect(ready).toHaveAttribute('download', 'roadmap_v3.pdf');
    // The other formats are still offered beside it.
    expect(screen.getAllByTestId('export-format')).toHaveLength(2);
  });

  // F-4R2-016: readiness is PER FORMAT. Pre-fix, `readyHere` was the FIRST ready answer for
  // the version, so an un-consumed HTML answer shadowed the PDF that finished after it — the
  // PDF button spun for 120 s while the file already sat in the thread.
  it('F-4R2-016: a second format finishing while the first READY answer is un-acted flips ITS OWN chip', async () => {
    strip();
    postExport.mockResolvedValue(reply('roadmap_v3.html', 'html'));
    await press('html');
    const html = await screen.findByTestId('export-ready');
    expect(html).toHaveAttribute('data-format', 'html');

    // The HTML download is NOT clicked (un-consumed) — then the PDF is asked for.
    let release: (v: unknown) => void = () => {};
    postExport.mockImplementation(() => new Promise((res) => { release = res; }));
    await press('pdf');
    expect(screen.getByTestId('export-pending').closest('[data-format="pdf"]')).not.toBeNull();
    release({ ...reply('roadmap_v3.pdf'), layout: 'document', layout_source: 'author @page', page_size: 'A4 portrait', pages: 2 });

    await waitFor(() => expect(screen.getAllByTestId('export-ready')).toHaveLength(2));
    const ready = screen.getAllByTestId('export-ready').map((a) => a.getAttribute('data-format'));
    expect(ready).toEqual(['html', 'pdf']);
    expect(screen.queryByTestId('export-pending')).toBeNull();
    // Only PPTX is still a plain button.
    expect(screen.getAllByTestId('export-format').map((b) => b.getAttribute('data-format'))).toEqual(['pptx']);

    // interactive#219: what the PDF printed — on the anchor and as its own line under the row.
    const pdf = screen.getAllByTestId('export-ready')[1]!;
    expect(pdf).toHaveAttribute('data-pages', '2');
    expect(pdf).toHaveAttribute('data-page-size', 'A4 portrait');
    expect(pdf.getAttribute('title')).toContain('2 pages · A4 portrait — layout from author @page');
    const report = screen.getByTestId('export-report');
    expect(report).toHaveAttribute('data-format', 'pdf');
    expect(report).toHaveTextContent('PDF ready — 2 pages · A4 portrait');
    // The thread line carries it too.
    expect(messages().some((m) => m.kind === 'agent' && m.text === 'PDF export ready — roadmap_v3.pdf · 2 pages · A4 portrait')).toBe(true);
    // The HTML answer (no report on an older bridge's reply) has no report line.
    expect(screen.getAllByTestId('export-report')).toHaveLength(1);
  });

  it('round-3 J3: a new version selection KEEPS the un-acted READY answer, wearing its own version', async () => {
    const { rerender } = render(
      <VersionStrip projectId={PROJECT} docId={DOC} manifest={MANIFEST}
                    selected={3} navigate={() => {}} onForked={() => {}} />,
    );
    await press('pdf');
    await screen.findByTestId('export-ready');

    rerender(
      <VersionStrip projectId={PROJECT} docId={DOC} manifest={MANIFEST}
                    selected={2} navigate={() => {}} onForked={() => {}} />,
    );
    // The round-2 finding: selection moves (incl. head-follow landings) wiped the
    // un-acted answer — with the drawer closed it then lived NOWHERE. It stays at
    // the click site now, labeled with ITS version, so the old §7.2 mislabel rule
    // still holds: a v3 artifact never sits under a bare "Export v2" label.
    const ready = screen.getByTestId('export-ready');
    expect(ready).toHaveAttribute('data-version', '3');
    expect(ready).toHaveTextContent('v3');
    // All three formats are offered for the NEWLY addressed version beside it.
    expect(screen.getAllByTestId('export-format')).toHaveLength(3);
    // Acting on the answer (the download click) is what retires it.
    await userEvent.setup().click(ready);
    expect(screen.queryByTestId('export-ready')).toBeNull();
  });
});

describe('the board card exports without opening the document (§1.4, §4.4)', () => {
  it('AC: the doc tile offers export at that document’s head version', async () => {
    card();
    const menu = within(screen.getByTestId('doc-tile')).getByTestId('export-menu');
    expect(menu).toHaveAttribute('data-doc-id', DOC);
    expect(menu).toHaveAttribute('data-version', '3');

    await press('pdf', menu);
    await waitFor(() => expect(postExport).toHaveBeenCalledWith(PROJECT, DOC, 3, 'pdf'));
    // The transcript is still where it lands, even though no thread is on screen (§2.5).
    await waitFor(() => expect(messages()[1]).toMatchObject({ kind: 'agent', author: 'export' }));
  });

  it('AC: a refusal names its fix ON THE CARD, with the control that retries it adjacent', async () => {
    postExport.mockRejectedValue(new ServiceHintError('API 400: no python-pptx', PPTX_HINT));
    card();
    const menu = within(screen.getByTestId('doc-tile')).getByTestId('export-menu');

    await press('pptx', menu);

    await waitFor(() => expect(within(menu).getByTestId('export-hint')).toHaveTextContent(PPTX_HINT));
    // §3.3: the control is in the same block, so the retry is one press away.
    expect(within(menu).getAllByTestId('export-format')).toHaveLength(3);
    expect(within(menu).getAllByTestId('export-format')[2]).toBeEnabled();
  });
});

describe('export hydration on document open and version change (wicked-studio#234 stopgap probe)', () => {
  // The real interactive proxy URL the test mock produces for a doc-mounted export file.
  const exportHref = (format: string) =>
    `/api/v1/projects/${PROJECT}/interactive/d/${DOC}/api/export/file/roadmap_v3.${format}`;

  function okFetch(): ReturnType<typeof vi.fn> {
    return vi.fn((url: string) => {
      const ct = url.endsWith('.html') ? 'text/html'
        : url.endsWith('.pdf') ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      return Promise.resolve({
        ok: true,
        body: { cancel: () => Promise.resolve() },
        headers: { get: (h: string) => h === 'content-type' ? ct : null },
      });
    });
  }

  it('T1: a 200-answering probe seeds READY for every format and renders the doc-mounted href', async () => {
    vi.stubGlobal('fetch', okFetch());
    strip();
    await waitFor(() => expect(screen.getAllByTestId('export-ready')).toHaveLength(3));
    const ready = screen.getAllByTestId('export-ready');
    const byFormat = (f: string) => ready.find((a) => a.getAttribute('data-format') === f);
    expect(byFormat('html')).toHaveAttribute('href', exportHref('html'));
    expect(byFormat('pdf')).toHaveAttribute('href', exportHref('pdf'));
    expect(byFormat('pptx')).toHaveAttribute('href', exportHref('pptx'));
    // No plain format buttons remain once all three are READY.
    expect(screen.queryByTestId('export-format')).toBeNull();
  });

  it('T2: a 404 probe leaves all three plain format buttons and no export-ready link', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, body: null });
    vi.stubGlobal('fetch', fetchMock);
    strip();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByTestId('export-ready')).toBeNull();
    expect(screen.getAllByTestId('export-format')).toHaveLength(3);
  });

  it('T3: a probe rejection shows no download link and no error card', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'));
    vi.stubGlobal('fetch', fetchMock);
    strip();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByTestId('export-ready')).toBeNull();
    expect(screen.queryByTestId('export-hint')).toBeNull();
  });

  it('T4: hydrate seeds html READY, then a new pdf POST adds a second export-ready without duplicating', async () => {
    vi.stubGlobal('fetch', vi.fn()
      // html probe 200 with correct content-type, pdf/pptx 404
      .mockResolvedValueOnce({
        ok: true,
        body: { cancel: () => Promise.resolve() },
        headers: { get: (h: string) => h === 'content-type' ? 'text/html' : null },
      })
      .mockResolvedValue({ ok: false, body: null }));
    postExport.mockResolvedValue(reply('roadmap_v3.pdf'));
    strip();
    // Wait for html hydration to settle.
    await waitFor(() => {
      const r = screen.getAllByTestId('export-ready');
      expect(r).toHaveLength(1);
      expect(r[0]).toHaveAttribute('data-format', 'html');
    });
    // Now press pdf — the probe already ran, so the store pre-check keeps it from re-probing.
    await press('pdf');
    await waitFor(() => expect(screen.getAllByTestId('export-ready')).toHaveLength(2));
    const formats = screen.getAllByTestId('export-ready').map((a) => a.getAttribute('data-format'));
    expect(formats).toContain('html');
    expect(formats).toContain('pdf');
    // Only pptx remains as a plain button.
    expect(screen.getAllByTestId('export-format').map((b) => b.getAttribute('data-format'))).toEqual(['pptx']);
  });

  it('T5: regression — the POST export path and §7.2 click-site chip are unchanged by hydration', async () => {
    // Probe rejects so no READY is pre-seeded; we verify the POST flow is intact.
    let release: (v: unknown) => void = () => {};
    postExport.mockImplementation(() => new Promise((res) => { release = res; }));
    strip();
    await press('pdf');
    expect(screen.getByTestId('export-pending').closest('[data-format="pdf"]')).not.toBeNull();
    release(reply('roadmap_v3.pdf'));
    const ready = await screen.findByTestId('export-ready');
    expect(ready).toHaveAttribute('data-format', 'pdf');
    expect(ready).toHaveAttribute('data-version', '3');
    expect(ready).toHaveAttribute(
      'href', `/api/v1/projects/${PROJECT}/interactive/d/${DOC}/download/roadmap_v3.pdf`);
  });

  it('T_ct: a 200 probe carrying Content-Type: text/html does not seed READY for pdf or pptx', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      body: { cancel: () => Promise.resolve() },
      headers: { get: (h: string) => h === 'content-type' ? 'text/html; charset=utf-8' : null },
    }));
    vi.stubGlobal('fetch', fetchMock);
    strip();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const ready = screen.queryAllByTestId('export-ready');
    const formats = ready.map((a) => a.getAttribute('data-format'));
    expect(formats).not.toContain('pdf');
    expect(formats).not.toContain('pptx');
    expect(screen.queryByTestId('export-hint')).toBeNull();
  });

  it('T6: regression — ingest(export.generated) adds a thread message but does NOT seed exportAnswers', () => {
    const key = exportKey(PROJECT, DOC);
    useDocThreadStore.getState().ingest({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.export.generated',
        payload: {
          project_id: PROJECT, document_id: DOC,
          format: 'pdf', file: 'roadmap_v3.pdf',
          download: `/d/${DOC}/api/export/file/roadmap_v3.pdf`,
        },
      },
    } as unknown as CoreEvent);
    // The WS frame writes a thread transcript entry (the artifact line)...
    expect(messages().some((m) => m.kind === 'agent' && m.author === 'export')).toBe(true);
    // ...but exportAnswers MUST remain empty — hydrate seeds it via probe, not WS frames.
    expect(useExportAnswers.getState().answers[key] ?? []).toHaveLength(0);
  });
});
