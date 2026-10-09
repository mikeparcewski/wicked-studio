import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';

/**
 * studio#236 — Export is not offered on the version-0 placeholder ("Building…").
 * studio#234 — the files already exported for the version shown are read from the bridge's listing
 * (`GET /d/:doc/api/export`, wicked-interactive#236) whenever the artifact is open, so a download
 * made in an earlier session survives a reload; a listing that fails shows nothing.
 */

const head = { value: 1 };
vi.mock('../src/components/session/PageEditor.js', () => ({
  PageEditor: ({ onHead }: { onHead: (h: number) => void }) => {
    useEffect(() => { onHead(head.value); }, [onHead]);
    return <div data-testid="editor-stub" />;
  },
}));
vi.mock('../src/store/editors.js', () => ({
  useEditorFor: () => null,
  useEditors: (sel: (s: { reason: null }) => unknown) => sel({ reason: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
  apiBase: () => '/api/v1',
}));
vi.mock('../src/api/interactive.js', async (orig) => {
  const real = await orig<typeof import('../src/api/interactive.js')>();
  return { ...real, listExports: vi.fn(), postExport: vi.fn(), listVersions: vi.fn(() => Promise.resolve([])) };
});

const interactive = await import('../src/api/interactive.js');
const { ArtifactMorph } = await import('../src/components/session/ArtifactMorph.js');
const { resetArtifactSizes, setArtifactSize } = await import('../src/store/artifactSizes.js');

const KEY = 'p1/brochure';
const Doc = (): React.ReactElement => (
  <ArtifactMorph artifactKey={KEY} title="Brochure" projectId="p1" docId="brochure" composerKey="s:brochure" kind="document" />
);

beforeEach(() => {
  resetArtifactSizes();
  head.value = 1;
  vi.mocked(interactive.listExports).mockReset();
  vi.mocked(interactive.postExport).mockReset();
});
afterEach(() => { cleanup(); resetArtifactSizes(); });

describe('Export on the placeholder (studio#236)', () => {
  it('version 0 offers no Export and reads no listing; version 1 does', async () => {
    head.value = 0;
    vi.mocked(interactive.listExports).mockResolvedValue([]);
    render(<Doc />);
    act(() => setArtifactSize(KEY, 'pane'));
    await screen.findByTestId('editor-stub');
    expect(screen.queryByTestId('artifact-export')).toBeNull();
    expect(interactive.listExports).not.toHaveBeenCalled();
    cleanup();
    head.value = 1;
    render(<Doc />);
    act(() => setArtifactSize(KEY, 'pane'));
    expect(await screen.findByTestId('artifact-export')).toBeInTheDocument();
  });
});

describe('downloads survive a reload (studio#234)', () => {
  it('an open artifact lists the files on disk for the version shown — other versions are not offered', async () => {
    head.value = 2;
    vi.mocked(interactive.listExports).mockResolvedValue([
      { version: 1, format: 'pdf', name: 'brochure_v1.pdf', bytes: 9, generated_at: 't' },
      { version: 2, format: 'pdf', name: 'brochure_v2.pdf', bytes: 9, generated_at: 't' },
      { version: 2, format: 'html', name: 'brochure_v2.html', bytes: 9, generated_at: 't' },
    ]);
    render(<Doc />);
    expect(interactive.listExports).not.toHaveBeenCalled(); // the inline preview reads nothing
    act(() => setArtifactSize(KEY, 'pane'));
    const strip = await screen.findByTestId('artifact-exports');
    expect(strip).toHaveTextContent('Exported version 2: PDF · HTML');
    const links = screen.getAllByTestId('artifact-export-file');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/api/v1/projects/p1/interactive/d/brochure/api/export/file/brochure_v2.pdf',
      '/api/v1/projects/p1/interactive/d/brochure/api/export/file/brochure_v2.html',
    ]);
    expect(links.map((a) => a.getAttribute('download'))).toEqual(['brochure_v2.pdf', 'brochure_v2.html']);
  });

  it('a failed listing shows nothing — never a guessed link', async () => {
    vi.mocked(interactive.listExports).mockRejectedValue(new Error('404'));
    render(<Doc />);
    act(() => setArtifactSize(KEY, 'pane'));
    await waitFor(() => expect(interactive.listExports).toHaveBeenCalled());
    expect(screen.queryByTestId('artifact-exports')).toBeNull();
  });

  it('an export re-reads the listing whatever its answer — a refused POST whose file landed is still found', async () => {
    vi.mocked(interactive.listExports).mockResolvedValueOnce([]).mockResolvedValue([
      { version: 1, format: 'pdf', name: 'brochure_v1.pdf', bytes: 9, generated_at: 't' },
    ]);
    vi.mocked(interactive.postExport).mockRejectedValue(new Error('upstream timed out'));
    render(<Doc />);
    act(() => setArtifactSize(KEY, 'pane'));
    await userEvent.click(await screen.findByTestId('artifact-export'));
    await userEvent.click(screen.getAllByTestId('artifact-export-format')[0]!);
    expect(await screen.findByTestId('artifact-export-line')).toHaveAttribute('data-state', 'failed');
    expect(await screen.findByTestId('artifact-exports')).toHaveTextContent('Exported version 1: PDF');
    expect(interactive.listExports).toHaveBeenCalledTimes(2);
  });

  it('a READY export links its file once — the strip leaves out what the result line already links', async () => {
    vi.mocked(interactive.listExports).mockResolvedValueOnce([]).mockResolvedValue([
      { version: 1, format: 'pdf', name: 'brochure_v1.pdf', bytes: 9, generated_at: 't' },
    ]);
    vi.mocked(interactive.postExport).mockResolvedValue({ format: 'pdf', path: '/x', file: 'brochure_v1.pdf', download: '/d/brochure/api/export/file/brochure_v1.pdf' });
    render(<Doc />);
    act(() => setArtifactSize(KEY, 'pane'));
    await userEvent.click(await screen.findByTestId('artifact-export'));
    await userEvent.click(screen.getAllByTestId('artifact-export-format')[0]!);
    expect(await screen.findByTestId('artifact-export-line')).toHaveAttribute('data-state', 'ready');
    await waitFor(() => expect(interactive.listExports).toHaveBeenCalledTimes(2));
    expect(screen.getAllByTestId('artifact-export-download')).toHaveLength(1);
    expect(screen.queryByTestId('artifact-exports')).toBeNull();
  });
});
