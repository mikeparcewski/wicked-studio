// Unit tests: FileViewer honest states (DES-FEEDBACK-002 §3.4/§3.7, slice I) —
// text with line numbers, binary (no mojibake), truncation banners, the error
// ladder surfaced VERBATIM (403/409), the route-absent-404 fallback, and the
// gesture-gated fetches (no prefetch; the inactive tab never fetches).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileViewer } from '../src/components/FileViewer.js';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';

const PATH = '/work/src/foo.ts';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('FileViewer — File tab states', () => {
  it('renders mono content with line numbers; the Diff tab does NOT fetch until activated', async () => {
    const getRunFile = vi.spyOn(client.api, 'getRunFile').mockResolvedValue({
      path: PATH, content: 'line one\n// a comment\nline three', size: 32,
      truncated: false, binary: false,
    });
    const getRunDiff = vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    render(<FileViewer runId="r-1" path={PATH} defaultTab="file" onClose={() => {}} onUnsupported={() => {}} />);

    expect(await screen.findByText('line one')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // the third line number
    expect(getRunFile).toHaveBeenCalledExactlyOnceWith('r-1', PATH);
    expect(getRunDiff).not.toHaveBeenCalled(); // inactive tab: no fetch

    // Switching IS the gesture — now the diff fetch fires, narrowed to the path.
    fireEvent.click(screen.getByTestId('viewer-tab-diff'));
    expect(await screen.findByText('no changes to this file.')).toBeInTheDocument();
    expect(getRunDiff).toHaveBeenCalledExactlyOnceWith('r-1', PATH);
  });

  it('binary: honest label with the byte size, never the (empty) content', async () => {
    vi.spyOn(client.api, 'getRunFile').mockResolvedValue({
      path: PATH, content: '', size: 20480, truncated: false, binary: true,
    });
    render(<FileViewer runId="r-1" path={PATH} defaultTab="file" onClose={() => {}} onUnsupported={() => {}} />);

    const pane = await screen.findByTestId('viewer-binary');
    expect(pane).toHaveTextContent('binary file — 20.0 KB');
    expect(screen.getByRole('button', { name: /open externally$/i })).toBeInTheDocument();
  });

  it('truncated: a labeled banner names the cap and the FULL size', async () => {
    vi.spyOn(client.api, 'getRunFile').mockResolvedValue({
      path: PATH, content: 'first half…', size: 700 * 1024, truncated: true, binary: false,
    });
    render(<FileViewer runId="r-1" path={PATH} defaultTab="file" onClose={() => {}} onUnsupported={() => {}} />);

    const banner = await screen.findByTestId('viewer-truncation-banner');
    expect(banner).toHaveTextContent('showing first 512 KB — open externally for the full file (700.0 KB total)');
    expect(screen.getByText('first half…')).toBeInTheDocument(); // content still shown
  });

  it('403: the daemon sentence surfaces whole in the EC33 translated frame, never swallowed', async () => {
    // Slice X2 re-scope (DES-UX-001 §7.10): the raw `API 403:` framing retires;
    // the daemon's own sentence still surfaces verbatim inside the translation.
    vi.spyOn(client.api, 'getRunFile').mockRejectedValue(new ApiError(
      403, "path is outside every allowed root (the run's workdir/write roots and the registered repos)",
    ));
    render(<FileViewer runId="r-1" path={PATH} defaultTab="file" onClose={() => {}} onUnsupported={() => {}} />);

    const el = await screen.findByTestId('viewer-error');
    expect(el).toHaveTextContent(
      "the daemon refused this — path is outside every allowed root (the run's workdir/write roots and the registered repos)",
    );
    expect(document.body.textContent).not.toContain('API 403');
  });

  it('route-absent 404 ("Not Found", unnamed) calls onUnsupported instead of rendering a shell', async () => {
    vi.spyOn(client.api, 'getRunFile').mockRejectedValue(new ApiError(404, 'Not Found'));
    const onUnsupported = vi.fn();
    render(<FileViewer runId="r-1" path={PATH} defaultTab="file" onClose={() => {}} onUnsupported={onUnsupported} />);

    await vi.waitFor(() => expect(onUnsupported).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('viewer-error')).not.toBeInTheDocument();
  });

  it('a NAMED 404 (real answer from a daemon WITH the route) surfaces, translated', async () => {
    vi.spyOn(client.api, 'getRunFile').mockRejectedValue(new ApiError(404, `no such file: ${PATH}`));
    const onUnsupported = vi.fn();
    render(<FileViewer runId="r-1" path={PATH} defaultTab="file" onClose={() => {}} onUnsupported={onUnsupported} />);

    expect(await screen.findByTestId('viewer-error')).toHaveTextContent(
      `the daemon refused this — no such file: ${PATH}`);
    expect(onUnsupported).not.toHaveBeenCalled();
  });
});

describe('FileViewer — Diff tab states', () => {
  // RE-SCOPED by slice R (DES-UX-001 §1.3-4a / §11.2): this assertion used to pin
  // the 409 surfacing VERBATIM. The design supersedes that — the daemon's two diff
  // 409s become NAMED-CAUSE cards, and the raw `API 409` / `has no workdir` strings
  // never reach the DOM (EC33). The verbatim contract still holds for every other
  // error (the named-404 test below is unchanged).
  it('409 (workdir reaped): the named-cause card, never the raw wire string', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockRejectedValue(new ApiError(
      409, "run r-1's workdir no longer exists: /tmp/wt",
    ));
    render(<FileViewer runId="r-1" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);

    const card = await screen.findByTestId('diff-named-cause');
    expect(card).toHaveAttribute('data-cause', 'workdir-gone');
    expect(card).toHaveTextContent('This run’s workdir no longer exists.');
    expect(document.body.textContent).not.toContain('API 409');
    expect(screen.queryByTestId('viewer-error')).not.toBeInTheDocument();
  });

  it('409 (no workdir attached): the no-repository named cause, raw strings absent', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockRejectedValue(new ApiError(
      409, 'run r-1 has no workdir — nothing to diff',
    ));
    const onClose = vi.fn();
    render(<FileViewer runId="r-1" defaultTab="diff" onClose={onClose} onUnsupported={() => {}} />);

    const card = await screen.findByTestId('diff-named-cause');
    expect(card).toHaveAttribute('data-cause', 'no-repo');
    expect(card).toHaveTextContent('This run had no repository attached — nothing was produced to review.');
    expect(document.body.textContent).not.toContain('API 409');
    expect(document.body.textContent).not.toContain('has no workdir');
    // The remediation link resolves (closes back to the run page's transcripts).
    screen.getByTestId('diff-cause-remediation').click();
    expect(onClose).toHaveBeenCalled();
  });

  it('colors added/removed/hunk lines from the classifier and banners diff truncation', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx\n-removed\n+added',
      truncated: true,
    });
    render(<FileViewer runId="r-1" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);

    expect(await screen.findByTestId('diff-line-add')).toHaveTextContent('+added');
    expect(screen.getByTestId('diff-line-del')).toHaveTextContent('-removed');
    expect(screen.getByTestId('diff-line-hunk')).toHaveTextContent('@@ -1,2 +1,2 @@');
    expect(screen.getByTestId('viewer-truncation-banner')).toHaveTextContent(
      'diff truncated at 1 MB — narrow to a single file for the rest',
    );
  });

  it('a clean tree ({diff:""}) is a real answer, not an error', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    render(<FileViewer runId="r-1" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);

    expect(await screen.findByTestId('viewer-clean-tree')).toHaveTextContent('clean tree — no changes.');
    expect(screen.queryByTestId('viewer-error')).not.toBeInTheDocument();
  });

  it('with no path there is no File tab and no open/copy affordance', async () => {
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    render(<FileViewer runId="r-1" defaultTab="diff" onClose={() => {}} onUnsupported={() => {}} />);

    await screen.findByTestId('viewer-clean-tree');
    expect(screen.queryByTestId('viewer-tab-file')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open externally/ })).not.toBeInTheDocument();
  });
});
