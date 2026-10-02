import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { api } from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { WatchRunLines } from '../src/components/WatchLines.js';

/** TR-W8: the run page's coverage line says what was not checked, and never reads a failed read as "all checked". */
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('WatchRunLines', () => {
  it('names what was not checked', async () => {
    vi.spyOn(api, 'getWatch').mockResolvedValue({ findings: [], coverage: [{ entry_id: 'scope-drift', state: 'not_checked', reason: 'no declared scope' }] });
    render(<WatchRunLines runId="r1" jumped={false} />);
    await waitFor(() => expect(screen.getByTestId('watch-coverage').textContent).toBe('Not checked on this run: scope drift (no declared scope)'));
  });

  it('a daemon without the registry shows nothing; any other failure is said (Copilot)', async () => {
    vi.spyOn(api, 'getWatch').mockRejectedValue(new ApiError(404, 'Not Found'));
    const { unmount } = render(<WatchRunLines runId="r1" jumped={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('watch-coverage')).toBeNull();
    unmount();
    vi.spyOn(api, 'getWatch').mockRejectedValue(new ApiError(500, 'watch fold unavailable'));
    render(<WatchRunLines runId="r2" jumped={false} />);
    await waitFor(() => expect(screen.getByTestId('watch-coverage').textContent).toContain('Could not read what was checked on this run'));
  });
});
