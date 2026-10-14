import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * studio#234 on the protocol-2 card: the files already exported for the version shown come from the bridge's listing
 * (`GET /d/:doc/api/export`), through the adapter, so a download made in an earlier session survives a reload. Only
 * the version shown, only the formats the kind offers, and a failed listing rejects (the card then shows nothing).
 */

vi.mock('../src/api/interactive.js', async (orig) => {
  const real = await orig<typeof import('../src/api/interactive.js')>();
  return { ...real, listExports: vi.fn() };
});

const interactive = await import('../src/api/interactive.js');
const { InteractiveDocSurfaceAdapter } = await import('../src/editors/adapters/interactiveDoc.js');

const binding = (kind: string, docId = 'brochure') => ({ artifactKey: `r1:p1/${docId}`, title: 'Brochure', kind, source: 'interactive-doc' as const, projectId: 'p1', docId, composerKey: 'c' });
const row = (version: number, format: string) => ({ version, format, name: `brochure_v${version}.${format}`, bytes: 10, generated_at: '2026-10-14T00:00:00Z' });

beforeEach(() => { vi.mocked(interactive.listExports).mockReset(); });

describe('InteractiveDocSurfaceAdapter.exported', () => {
  it('lists the files on disk for the version asked, in the kind\'s own words, with their download address', async () => {
    vi.mocked(interactive.listExports).mockResolvedValue([row(1, 'pdf'), row(2, 'pdf'), row(2, 'html'), row(2, 'pptx')] as never);
    const files = await new InteractiveDocSurfaceAdapter(binding('document')).exported(2);
    expect(files.map((f) => [f.format, f.label, f.name])).toEqual([['pdf', 'PDF', 'brochure_v2.pdf'], ['html', 'Web page', 'brochure_v2.html']]);
    expect(files[0]!.href).toBe(interactive.exportFileUrl('p1', 'brochure', 'brochure_v2.pdf'));
  });

  it('a kind with no export reads no listing', async () => {
    const files = await new InteractiveDocSurfaceAdapter(binding('page')).exported(1);
    expect(files).toEqual([]);
    expect(interactive.listExports).not.toHaveBeenCalled();
  });

  it('a listing that fails rejects: the card shows nothing, never a guessed link', async () => {
    vi.mocked(interactive.listExports).mockRejectedValue(new Error('404'));
    await expect(new InteractiveDocSurfaceAdapter(binding('deck')).exported(1)).rejects.toThrow('404');
  });
});
