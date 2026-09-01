// Unit tests for the doc/demo delete affordance (studio#119) — DocDelete.tsx.
//
// The contract under test, one concern per describe:
//   1. Destructive-action grammar: the trigger NEVER deletes — it opens a confirm
//      that NAMES the artifact; Cancel and Escape close it with NOTHING on the wire.
//   2. The confirm speaks the governed crew route once, with a named loading
//      state, and reports the settled delete to its owner (cache row dropped).
//   3. Failure states each render their own shape: the 500 PARTIAL is loud and
//      VERBATIM with the retry still armed; a bridge 503 shows its runnable hint;
//      any other refusal shows the EC33-translated sentence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteDocButton } from '../src/components/DocDelete.js';
import { useDocsCache } from '../src/store/docsCache.js';
import type { DocDeleteResult } from '../src/api/interactive.js';

const PROJECT = 'proj-abc-123';
const DOC = 'q3-report';

/** Point jsdom's window.location at an arbitrary origin (as client.resolver does). */
function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
    configurable: true,
  });
}

interface Call { url: string; init: RequestInit | undefined }

/** Stub fetch with a fixed response; returns the log of calls it received. */
function stubFetch(body: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    });
  }));
  return calls;
}

const RETIRED = {
  name: DOC,
  kind: 'doc',
  retired: true,
  already_retired: false,
  retired_at: '2026-09-01T10:00:00.000Z',
  head: 3,
  versions: 3,
  event_id: 41,
  ledger: { ok: true, removed_keys: [DOC] },
};

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

function renderTrigger(onDeleted: (r: DocDeleteResult) => void = () => {}): void {
  render(
    <DeleteDocButton
      projectId={PROJECT}
      docId={DOC}
      subject="document"
      variant="row"
      onDeleted={onDeleted}
    />,
  );
}

describe('the confirm step (destructive-action grammar)', () => {
  it('the trigger only OPENS a confirm that NAMES the doc — nothing on the wire yet', async () => {
    const calls = stubFetch(RETIRED);
    renderTrigger();
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));

    const dialog = await screen.findByTestId('doc-delete-confirm');
    expect(dialog).toHaveAttribute('data-doc-id', DOC);
    // The confirm names its subject — both the title and the armed button say WHICH doc.
    expect(dialog.textContent).toContain(`Delete “${DOC}”?`);
    expect(screen.getByTestId('doc-delete-go').textContent).toBe(`Delete ${DOC}`);
    expect(calls).toHaveLength(0);
  });

  it('Cancel closes the confirm with NOTHING deleted', async () => {
    const calls = stubFetch(RETIRED);
    const onDeleted = vi.fn();
    renderTrigger(onDeleted);
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await userEvent.click(screen.getByTestId('doc-delete-cancel'));

    expect(screen.queryByTestId('doc-delete-confirm')).toBeNull();
    expect(calls).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('Escape closes the confirm with NOTHING deleted (modal-family contract)', async () => {
    const calls = stubFetch(RETIRED);
    renderTrigger();
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await screen.findByTestId('doc-delete-confirm');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByTestId('doc-delete-confirm')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('the delete itself', () => {
  it('confirm fires ONE governed DELETE, reports the result, and drops the cache row', async () => {
    useDocsCache.getState().deposit(PROJECT, [
      { name: DOC, kind: 'doc', head: 3, versions: 3, updated_at: '2026-08-30T00:00:00Z' },
      { name: 'other', kind: 'doc', head: 1, versions: 1, updated_at: null },
    ]);
    const calls = stubFetch(RETIRED);
    const onDeleted = vi.fn();
    renderTrigger(onDeleted);
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await userEvent.click(screen.getByTestId('doc-delete-go'));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(RETIRED));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe('DELETE');
    expect(calls[0]!.url).toBe(
      `http://127.0.0.1:7788/api/v1/projects/${PROJECT}/interactive/docs/${DOC}`,
    );
    // The session cache agrees with the wire without a refetch.
    expect(useDocsCache.getState().byProject[PROJECT]!.map((d) => d.name)).toEqual(['other']);
    // The settled delete closes the confirm.
    expect(screen.queryByTestId('doc-delete-confirm')).toBeNull();
  });

  it('while in flight: a NAMED loading state, both buttons disarmed', async () => {
    let release: (v: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((res) => { release = res; })));
    renderTrigger();
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await userEvent.click(screen.getByTestId('doc-delete-go'));

    expect(screen.getByTestId('doc-delete-go').textContent).toBe('Deleting…');
    expect(screen.getByTestId('doc-delete-go')).toBeDisabled();
    expect(screen.getByTestId('doc-delete-cancel')).toBeDisabled();
    release({
      ok: true, status: 200, statusText: '200',
      text: () => Promise.resolve(JSON.stringify(RETIRED)),
      json: () => Promise.resolve(RETIRED),
    });
    await waitFor(() => expect(screen.queryByTestId('doc-delete-confirm')).toBeNull());
  });

  it("the ghost 404 (interactive's own unknown-doc body) settles as deleted too", async () => {
    const onDeleted = vi.fn();
    stubFetch({ error: 'unknown doc', name: DOC, ledger: { ok: true, removed_keys: [DOC] } }, 404);
    renderTrigger(onDeleted);
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await userEvent.click(screen.getByTestId('doc-delete-go'));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith({
      ghost: true, name: DOC, ledger: { ok: true, removed_keys: [DOC] },
    }));
  });
});

describe('failure states', () => {
  it('500 PARTIAL: the wire sentence renders VERBATIM in its loud box, retry stays armed', async () => {
    const wire = `partial delete: wicked-interactive retired '${DOC}' but crew could not drop `
      + 'every handoff-ledger row. Re-issue this DELETE to retry the sweep.';
    stubFetch({
      error: wire,
      name: DOC,
      interactive: RETIRED,
      ledger: { ok: false, removed_keys: [], errors: [{ ledger: 'draft', error: 'EACCES' }] },
    }, 500);
    const onDeleted = vi.fn();
    renderTrigger(onDeleted);
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await userEvent.click(screen.getByTestId('doc-delete-go'));

    const loud = await screen.findByTestId('doc-delete-partial');
    // VERBATIM — the sentence names which half happened and the retry instruction;
    // paraphrasing a divergence would hide it (the route's loud-on-partial spine).
    expect(loud.textContent).toContain(wire);
    expect(onDeleted).not.toHaveBeenCalled();
    // The dialog stays up with the re-issue armed (retire + sweep are idempotent).
    expect(screen.getByTestId('doc-delete-go').textContent).toBe(`Retry delete ${DOC}`);
    expect(screen.getByTestId('doc-delete-go')).toBeEnabled();
  });

  it('503 bridge_unavailable: the runnable hint, verbatim', async () => {
    stubFetch({ code: 'bridge_unavailable', hint: 'npm i -g wicked-interactive' }, 503);
    renderTrigger();
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await userEvent.click(screen.getByTestId('doc-delete-go'));

    const hint = await screen.findByTestId('doc-delete-bridge-hint');
    expect(hint.textContent).toContain('npm i -g wicked-interactive');
  });

  it('any other refusal (409 build in flight): the translated sentence, dialog still open', async () => {
    stubFetch({ error: 'doc has a build in flight — wait for it to settle', document_id: DOC }, 409);
    renderTrigger();
    await userEvent.click(screen.getByTestId('doc-delete-trigger'));
    await userEvent.click(screen.getByTestId('doc-delete-go'));

    const err = await screen.findByTestId('doc-delete-error');
    // EC33: the translated frame carrying the daemon's sentence whole — never `API 409:`.
    expect(err.textContent).toContain('the daemon refused this — doc has a build in flight');
    expect(err.textContent).not.toContain('API 409');
    expect(screen.getByTestId('doc-delete-confirm')).toBeInTheDocument();
  });
});
