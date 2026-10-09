// S16a-4b: the full-size artifact lists its versions; `?v=N` is a read-only lens; "Make this the
// working version" is the one write (a fork with the expected head) — none on render.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { artifactPath, readArtifactAddress, versionOf } from '../src/board/artifactAddress.js';
import { ArtifactVersions, lensVersion } from '../src/components/session/ArtifactVersions.js';
import * as interactive from '../src/api/interactive.js';

vi.mock('../src/api/interactive.js', async (orig) => {
  const real = await orig<typeof import('../src/api/interactive.js')>();
  return { ...real, postFork: vi.fn(), getVersions: vi.fn() };
});

const LIST = [
  { version: 2, parent: 1, feedback_file: null, html_file: 'v2.html', created_at: '2026-10-08T10:00:00Z' },
  { version: 1, parent: null, feedback_file: null, html_file: 'v1.html', created_at: '2026-10-08T09:00:00Z' },
];

afterEach(() => { cleanup(); vi.mocked(interactive.postFork).mockReset(); });

describe('S16a-4b — the version in the address', () => {
  it('v rides beside size and reads back; a bad v is the head', () => {
    const p = artifactPath('run:r1', 'r1:notes/doc', 'full', 1);
    expect(p).toBe('/s/run%3Ar1/a/r1%3Anotes%2Fdoc?size=full&v=1');
    const [path, q] = p.split('?');
    expect(readArtifactAddress(path!, `?${q}`)).toMatchObject({ size: 'full', version: 1 });
    for (const bad of ['?v=0', '?v=-1', '?v=1.5', '?v=x', '']) expect(versionOf(bad), bad).toBeNull();
  });

  it('the lens is a real, non-head version; anything else reads as the head', () => {
    expect(lensVersion(1, 2, LIST)).toBe(1);
    expect(lensVersion(2, 2, LIST)).toBeNull();
    expect(lensVersion(9, 2, LIST)).toBeNull();
    expect(lensVersion(1, 2, null)).toBeNull();
  });
});

describe('S16a-4b — the version list', () => {
  it('lists newest first with the head marked working; picking one asks for the lens; nothing is POSTed on render', async () => {
    const onLook = vi.fn();
    render(<ArtifactVersions projectId="notes" docId="doc" head={2} list={LIST} lens={null} onLook={onLook} onRestored={vi.fn()} />);
    const rows = screen.getAllByTestId('artifact-version-row');
    expect(rows.map((r) => r.dataset.version)).toEqual(['2', '1']);
    expect(rows[0]!.dataset.working).toBe('true');
    expect(interactive.postFork).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByTestId('artifact-version-lens')[1]!);
    expect(onLook).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getAllByTestId('artifact-version-lens')[0]!);
    expect(onLook).toHaveBeenLastCalledWith(null);
  });

  it('"Make this the working version" forks once with the expected head; success reports the new head', async () => {
    vi.mocked(interactive.postFork).mockResolvedValue({ version: 3, parent: 1 });
    const onRestored = vi.fn();
    render(<ArtifactVersions projectId="notes" docId="doc" head={2} list={LIST} lens={1} onLook={vi.fn()} onRestored={onRestored} />);
    await userEvent.click(screen.getByTestId('artifact-version-restore'));
    expect(interactive.postFork).toHaveBeenCalledExactlyOnceWith('notes', 'doc', 1, undefined, 2);
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(3));
    expect(screen.getByTestId('artifact-version-line')).toHaveTextContent('Version 1 is the working version again — as version 3.');
  });

  it('a moved head refuses the restore: said, nothing reported restored', async () => {
    vi.mocked(interactive.postFork).mockRejectedValue(new interactive.HeadMovedError(4));
    const onRestored = vi.fn();
    render(<ArtifactVersions projectId="notes" docId="doc" head={2} list={LIST} lens={1} onLook={vi.fn()} onRestored={onRestored} />);
    await userEvent.click(screen.getByTestId('artifact-version-restore'));
    expect(await screen.findByTestId('artifact-version-line')).toHaveTextContent('Not restored — version 4 landed since. Look again.');
    expect(onRestored).not.toHaveBeenCalled();
    expect(interactive.postFork).toHaveBeenCalledTimes(1);
  });
});
