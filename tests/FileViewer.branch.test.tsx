import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileViewer } from '../src/components/FileViewer.js';
import { RightPanel } from '../src/components/RightPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The files/diff view once the worktree is gone (wave 6 — F-7R2-013, api-types 0.36.0
 * `RunDiff.source`): a `source: "branch"` answer is labelled as the run branch vs its base
 * (committed work IS shown), a `worktree`/absent answer keeps the HEAD-baseline note, and the
 * run page's Files section offers the Full diff on EVERY state — the empty one included, which is
 * exactly the completed run the phase7-r2 rig found with no files view.
 */

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

const DIFF = 'diff --git a/tests/x.test.ts b/tests/x.test.ts\n--- a/tests/x.test.ts\n+++ b/tests/x.test.ts\n@@ -0,0 +1 @@\n+it(\'x\', () => {});\n';

describe('FileViewer — the diff source (F-7R2-013)', () => {
  it('source: "branch" ⇒ the baseline note says the run branch vs its base, committed work shown', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: DIFF, truncated: false, source: 'branch' } as never);
    render(<FileViewer runId="r-gt-done" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);
    const note = await screen.findByTestId('diff-baseline-note');
    expect(note).toHaveAttribute('data-source', 'branch');
    expect(note).toHaveTextContent('showing the run branch vs its base — the worktree is gone, so this is the committed work the run left on its branch');
    expect(screen.getByTestId('diff-line-add')).toBeInTheDocument();
  });

  it('source: "branch" with an empty diff ⇒ "the run branch carries no change over its base."', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false, source: 'branch' } as never);
    render(<FileViewer runId="r-gt-done" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);
    expect(await screen.findByTestId('viewer-clean-tree')).toHaveTextContent('the run branch carries no change over its base.');
  });

  it('source: "worktree" and a pre-0.36 answer (no source) keep the HEAD-baseline note (data-source=worktree)', async () => {
    const getRunDiff = vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    render(<FileViewer runId="r-1" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);
    const note = await screen.findByTestId('diff-baseline-note');
    expect(note).toHaveAttribute('data-source', 'worktree');
    expect(note).toHaveTextContent('showing uncommitted changes vs HEAD; committed work is not shown here');
    expect(screen.getByTestId('viewer-clean-tree')).toHaveTextContent('clean tree — no changes.');
    cleanup();
    getRunDiff.mockResolvedValue({ diff: DIFF, truncated: false, source: 'worktree' } as never);
    render(<FileViewer runId="r-1" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);
    expect(await screen.findByTestId('diff-baseline-note')).toHaveAttribute('data-source', 'worktree');
  });

  it('a pre-0.36 daemon\'s 409 "workdir no longer exists" cause card names the run branch and the upgrade', async () => {
    const { ApiError } = await import('../src/api/errors.js');
    vi.spyOn(client.api, 'getRunDiff').mockRejectedValue(new ApiError(409, "run r-1's workdir no longer exists: /w/r-1"));
    render(<FileViewer runId="r-1" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);
    const card = await screen.findByTestId('diff-named-cause');
    expect(card).toHaveAttribute('data-cause', 'workdir-gone');
    expect(card).toHaveTextContent('the run branch (wicked/<run id>) still holds the committed work; a daemon with the wave-6 diff route serves that branch here instead of this refusal (upgrade wicked-crew)');
  });
});

describe('RightPanel Files — the Full diff on the EMPTY state (F-7R2-013)', () => {
  it('a completed run whose units recorded no file reads still offers Full diff, and it opens the viewer on the diff tab', async () => {
    const view = makeView({ id: 'r-gt-done', status: 'completed' }, [makeUnit({ id: 'r-gt-done:u0', ord: 0, status: 'done' })]);
    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'getRun').mockResolvedValue({ run: view });
    const getRunDiff = vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: DIFF, truncated: false, source: 'branch' } as never);
    render(<RightPanel view={view} />);
    fireEvent.click(screen.getByRole('button', { name: /files/i }));
    const empty = await screen.findByTestId('files-empty');
    expect(empty).toHaveTextContent('No files recorded by the units.');
    expect(empty).toHaveTextContent('the run\'s changeset, if any, is on its branch: open the full diff');
    expect(getRunDiff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('files-full-diff'));
    expect(await screen.findByTestId('file-viewer')).toBeInTheDocument();
    expect(await screen.findByTestId('diff-baseline-note')).toHaveAttribute('data-source', 'branch');
    expect(getRunDiff).toHaveBeenCalledExactlyOnceWith('r-gt-done', undefined);
  });

  it('an ACTIVE run with no files yet keeps "No files changed yet." and the affordance', async () => {
    const view = makeView({ id: 'r-live', status: 'executing' }, [makeUnit({ id: 'r-live:u0', ord: 0, status: 'distributed' })]);
    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'getRun').mockResolvedValue({ run: view });
    render(<RightPanel view={view} />);
    fireEvent.click(screen.getByRole('button', { name: /files/i }));
    const empty = await screen.findByTestId('files-empty');
    expect(empty).toHaveTextContent('No files changed yet.');
    expect(empty).not.toHaveTextContent('open the full diff');
    expect(screen.getByTestId('files-full-diff')).toBeInTheDocument();
  });
});
