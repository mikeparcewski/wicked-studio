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
  return await screen.findByTitle(`Open with system default app: ${FILE}`);
}

describe('RightPanel Files tab — open with the system default app (crew#273)', () => {
  it('clicking a file asks the daemon to open it with the OS default application', async () => {
    const openPath = vi.spyOn(client.api, 'openPath').mockResolvedValue({ status: 'opened' });
    const row = await renderFilesTab();

    fireEvent.click(row);
    expect(openPath).toHaveBeenCalledWith(FILE, 'run-1');
    expect(await screen.findByText('✓ opened')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to copying the path when the daemon has no /open route', async () => {
    vi.spyOn(client.api, 'openPath').mockRejectedValue(new Error('API 404: Not Found'));
    const row = await renderFilesTab();

    fireEvent.click(row);
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
});
