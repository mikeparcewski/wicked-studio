// The doc picker's per-row delete (studio#119): the affordance lives where the
// docs live; a settled delete re-runs the picker's ONE list load, so the row is
// gone because the wire says so — never because the client guessed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentCanvas } from '../src/components/DocumentCanvas.js';
import { useDocsCache } from '../src/store/docsCache.js';
import type { DocSummary } from '../src/api/interactive.js';

const PROJECT = 'proj-abc-123';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
    configurable: true,
  });
}

function docRow(name: string, updated_at: string | null): DocSummary {
  return { name, kind: 'doc', head: 1, versions: 1, updated_at };
}

interface Call { url: string; method: string }

/**
 * A stateful stub: `GET …/interactive/api/docs` serves the CURRENT list;
 * `DELETE …/interactive/docs/:doc` answers the retire and removes the row —
 * so a re-list after the delete honestly reflects the wire.
 */
function stubWire(initial: DocSummary[]): { calls: Call[]; docs: () => DocSummary[] } {
  let docs = initial;
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    const reply = (status: number, body: unknown): Promise<Response> =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
      } as unknown as Response);
    if (method === 'DELETE' && url.includes('/interactive/docs/')) {
      const name = decodeURIComponent(url.split('/interactive/docs/')[1] ?? '');
      docs = docs.filter((d) => d.name !== name);
      return reply(200, {
        name, kind: 'doc', retired: true, already_retired: false,
        retired_at: '2026-09-01T10:00:00.000Z', head: 1, versions: 1, event_id: 7,
        ledger: { ok: true, removed_keys: [name] },
      });
    }
    if (url.includes('/interactive/api/docs')) return reply(200, docs);
    return Promise.reject(new Error(`unrouted fetch: ${method} ${url}`));
  }));
  return { calls, docs: () => docs };
}

beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  setLocation('http://127.0.0.1:7788/');
  useDocsCache.setState({ byProject: {}, fanoutDone: false, fanoutProgress: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('DocumentCanvas picker — per-row delete (studio#119)', () => {
  it('every row carries the confirm-gated trigger; a settled delete RE-LISTS and the row is gone', async () => {
    const wire = stubWire([docRow('q3-report', '2026-08-30T09:00:00Z'), docRow('brief', null)]);
    render(<DocumentCanvas projectId={PROJECT} docId={null} navigate={() => {}} />);

    const triggers = await screen.findAllByTestId('doc-delete-trigger');
    expect(triggers.map((t) => t.getAttribute('data-doc-id'))).toEqual(['q3-report', 'brief']);

    await userEvent.click(triggers[0]!);
    expect(screen.getByTestId('doc-delete-confirm')).toHaveAttribute('data-doc-id', 'q3-report');
    await userEvent.click(screen.getByTestId('doc-delete-go'));

    // The row disappears because the RE-LIST said so (one DELETE + a second GET).
    await waitFor(() => {
      expect(screen.getAllByTestId('doc-picker-row').map((r) => r.getAttribute('data-doc-id')))
        .toEqual(['brief']);
    });
    expect(wire.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(wire.calls.filter((c) => c.method === 'GET' && c.url.includes('/interactive/api/docs')).length)
      .toBeGreaterThanOrEqual(2);
    // The session doc cache agrees with the wire (the re-list deposits).
    await waitFor(() => {
      expect(useDocsCache.getState().byProject[PROJECT]!.map((d) => d.name)).toEqual(['brief']);
    });
  });

  it('the trigger does NOT navigate into the doc (it is a sibling of the row button)', async () => {
    stubWire([docRow('q3-report', null)]);
    const navigate = vi.fn();
    render(<DocumentCanvas projectId={PROJECT} docId={null} navigate={navigate} />);

    await userEvent.click(await screen.findByTestId('doc-delete-trigger'));
    expect(navigate).not.toHaveBeenCalled();
    // …while the row itself still navigates.
    await userEvent.click(screen.getByTestId('doc-delete-cancel'));
    await userEvent.click(screen.getByTestId('doc-picker-row'));
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/q3-report`);
  });

  it('Escape cancels: the list is untouched and nothing was deleted', async () => {
    const wire = stubWire([docRow('q3-report', null)]);
    render(<DocumentCanvas projectId={PROJECT} docId={null} navigate={() => {}} />);

    await userEvent.click(await screen.findByTestId('doc-delete-trigger'));
    await screen.findByTestId('doc-delete-confirm');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByTestId('doc-delete-confirm')).toBeNull();
    expect(wire.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(screen.getAllByTestId('doc-picker-row')).toHaveLength(1);
  });
});
