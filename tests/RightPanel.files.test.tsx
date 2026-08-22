import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RightPanel } from '../src/components/RightPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView, makeUnit } from './factories.js';
import type { SessionView } from '../src/api/types.js';

const FILE = '/work/report.md';

function seededView(): SessionView {
  return makeView({ status: 'completed' }, [
    makeUnit({ id: 'run-1:u0', ord: 0, status: 'done', assigned_cli: 'claude' }),
  ]);
}

let writeText: Mock;

beforeEach(() => {
  vi.restoreAllMocks();
  // Seed the run's event log with a dataUsed frame so the Files panel has a file.
  useRunEventStore.setState({ byRun: {} });
  useRunEventStore.getState().hydrate('run-1', [
    { type: 'dataUsed', session: 'run-1', ord: 0, files: [FILE] },
  ]);
  // jsdom has no clipboard — install a spyable stub (fireEvent, not userEvent, so
  // user-event's own clipboard stub never replaces this one).
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  vi.spyOn(client.api, 'getRun').mockResolvedValue({ run: seededView() });
});

async function renderFilesTab(): Promise<HTMLElement> {
  render(<RightPanel view={seededView()} />);
  fireEvent.click(screen.getByRole('button', { name: /files/i }));
  // The row itself is the VIEW affordance now (slice I, DES-FEEDBACK-002 §3.4).
  return await screen.findByTitle(`View ${FILE}`);
}

describe('RightPanel Files tab — slice I inline viewer + preserved openPath/copy', () => {
  it('clicking a file row opens the INLINE viewer (no external-open call)', async () => {
    const openPath = vi.spyOn(client.api, 'openPath').mockResolvedValue({ status: 'opened' });
    const getRunFile = vi.spyOn(client.api, 'getRunFile').mockResolvedValue({
      path: FILE, content: 'hello\nworld', size: 11, truncated: false, binary: false,
    });
    const row = await renderFilesTab();

    // Nothing fetched before the gesture (no prefetch on panel mount).
    expect(getRunFile).not.toHaveBeenCalled();

    fireEvent.click(row);
    expect(await screen.findByTestId('file-viewer')).toBeInTheDocument();
    // A referenced-only file defaults to the File tab → the content fetch fires.
    expect(await screen.findByText('hello')).toBeInTheDocument();
    expect(getRunFile).toHaveBeenCalledWith('run-1', FILE);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('the hover ↗ icon still asks the daemon to open externally (crew#273 preserved)', async () => {
    const openPath = vi.spyOn(client.api, 'openPath').mockResolvedValue({ status: 'opened' });
    await renderFilesTab();

    fireEvent.click(screen.getByRole('button', { name: `Open externally: ${FILE}` }));
    expect(openPath).toHaveBeenCalledWith(FILE, 'run-1');
    expect(await screen.findByText('✓ opened')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('↗ falls back to copying the path when the daemon has no /open route', async () => {
    vi.spyOn(client.api, 'openPath').mockRejectedValue(new Error('API 404: Not Found'));
    await renderFilesTab();

    fireEvent.click(screen.getByRole('button', { name: `Open externally: ${FILE}` }));
    expect(await screen.findByText(/open unavailable — path copied/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(FILE);
  });

  it('the explicit copy button copies the path without attempting an open', async () => {
    const openPath = vi.spyOn(client.api, 'openPath').mockResolvedValue({ status: 'opened' });
    await renderFilesTab();

    fireEvent.click(screen.getByRole('button', { name: `Copy path ${FILE}` }));
    expect(await screen.findByText('✓ copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(FILE);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('a daemon WITHOUT the file routes (generic 404): the row click falls back to the external open', async () => {
    // Fastify's route-absent 404 carries no named error — exactly "Not Found".
    vi.spyOn(client.api, 'getRunFile').mockRejectedValue(new Error('API 404: Not Found'));
    const openPath = vi.spyOn(client.api, 'openPath').mockResolvedValue({ status: 'opened' });
    const row = await renderFilesTab();

    fireEvent.click(row);
    // The viewer never renders an empty shell — it closes and today's exact
    // behavior runs (openPath external launch + feedback).
    expect(await screen.findByText('✓ opened')).toBeInTheDocument();
    expect(openPath).toHaveBeenCalledWith(FILE, 'run-1');
    expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument();
  });

  it('Escape closes the viewer and focus returns to the row', async () => {
    vi.spyOn(client.api, 'getRunFile').mockResolvedValue({
      path: FILE, content: 'x', size: 1, truncated: false, binary: false,
    });
    const row = await renderFilesTab();

    fireEvent.click(row);
    await screen.findByTestId('file-viewer');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(row);
  });

  it('the [Full diff] header button opens the viewer on the whole-run diff', async () => {
    const getRunDiff = vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new',
      truncated: false,
    });
    await renderFilesTab();

    expect(getRunDiff).not.toHaveBeenCalled(); // gesture-gated
    fireEvent.click(screen.getByTestId('files-full-diff'));
    expect(await screen.findByTestId('file-viewer')).toBeInTheDocument();
    expect(await screen.findByTestId('diff-line-add')).toHaveTextContent('+new');
    // Whole-run: NO path argument rides the call.
    expect(getRunDiff).toHaveBeenCalledWith('run-1', undefined);
  });
});
