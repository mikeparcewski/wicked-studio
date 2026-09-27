// Wave C, idea 12 — TAKES, NOT VERSIONS. The compare split's two versions are takes: each pane
// carries "Pick take N", whose consequence is shown before anything is sent; confirming files a
// preference MEMORY PROPOSAL through crew's `POST /proposals` and makes the take the working
// version (the bridge's fork when it is not the head). "Remix" sends ONE steer to the document
// agent: "Build on take 2 (v2), and keep take 1's (v3) headline."
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentCanvas } from '../src/components/DocumentCanvas.js';
import type { VersionManifest } from '../src/api/interactive.js';
import {
  asksByVersion, pickConsequence, preferenceContent, remixBlockedReason, remixSteer, takesOf,
} from '../src/interactive/takes.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';

const PROJECT = 'northwind';
const DOC = 'q3-report';

function entry(version: number, parent: number | null) {
  return { version, parent, feedback_file: null, html_file: `v${version}.html`,
           created_at: `2026-08-1${version}T09:00:00Z` };
}
const LINEAR: VersionManifest = { head: 3, versions: [entry(1, null), entry(2, 1), entry(3, 2)] };

type Call = { method: string; url: string; body: unknown };

function stubFetch(manifest: VersionManifest, proposalStatus = 201): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null;
    calls.push({ method, url, body });
    const reply = (status: number, payload: unknown) => Promise.resolve({
      ok: status >= 200 && status < 300, status, statusText: String(status),
      text: () => Promise.resolve(JSON.stringify(payload)),
      json: () => Promise.resolve(payload),
    });
    if (method === 'GET' && url.includes('/api/versions')) return reply(200, manifest);
    if (method === 'POST' && url.endsWith('/api/v1/proposals')) {
      return proposalStatus === 201 ? reply(201, { id: 'prop-9' }) : reply(proposalStatus, { error: 'estate is down' });
    }
    if (method === 'POST' && url.includes('/api/fork')) return reply(200, { version: 4, parent: 2 });
    if (method === 'POST' && url.includes('/api/events')) return reply(200, { ok: true });
    return Promise.reject(new Error(`unrouted fetch: ${method} ${url}`));
  }));
  return calls;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  Object.defineProperty(window, 'location', {
    value: new URL('http://127.0.0.1:7788/'), writable: true, configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ── The model, pure ───────────────────────────────────────────────────────────

describe('takes model', () => {
  const asks = new Map([[3, 'Tighten   the headline\non slide one']]);
  const [t1, t2] = takesOf(3, 2, asks);

  it('left pane is take 1, right pane take 2, each with the ask that made it when known', () => {
    expect(t1).toEqual({ n: 1, version: 3, ask: 'Tighten   the headline\non slide one' });
    expect(t2).toEqual({ n: 2, version: 2, ask: null });
  });

  it('the preference names the picked take, the one it beat, and the ask (flattened)', () => {
    expect(preferenceContent(DOC, t1, t2)).toBe(
      'Prefers takes like v3 of “q3-report” (picked over v2): the take made from “Tighten the headline on slide one”.');
    expect(preferenceContent(DOC, t2, t1)).toBe('Prefers takes like v2 of “q3-report” (picked over v3).');
  });

  it('the consequence says a non-head pick forks and the head pick does not', () => {
    expect(pickConsequence(LINEAR, t2, t1)).toMatch(/^v2 becomes the latest version \(a fork of it; v3 stays in the history\)/);
    expect(pickConsequence(LINEAR, t1, t2)).toMatch(/^v3 is already the latest version/);
    expect(pickConsequence(LINEAR, t2, t1)).toContain('nothing is learned until you accept it');
  });

  it('the remix steer is verbatim, and is blocked with a reason while gated or with nothing named', () => {
    expect(remixSteer(t2, t1, '  its   headline ')).toBe("Build on take 2 (v2), and keep take 1's (v3) its headline.");
    expect(remixBlockedReason('terminal', '')).toBe('Name what to keep from the other take.');
    expect(remixBlockedReason('gated', 'headline')).toMatch(/answer it first/);
    expect(remixBlockedReason('generating', 'headline')).toBeNull();
  });

  it('asks come only from tagged user messages', () => {
    const map = asksByVersion([
      { kind: 'user', id: 'a', text: 'make v2', version: 2 },
      { kind: 'user', id: 'b', text: 'untagged' },
      { kind: 'agent', id: 'c', author: 'x', text: 'not an ask' },
    ]);
    expect([...map.entries()]).toEqual([[2, 'make v2']]);
  });
});

// ── The surface ───────────────────────────────────────────────────────────────

async function openTakes(calls: Call[]): Promise<ReturnType<typeof vi.fn>> {
  const navigate = vi.fn();
  render(<DocumentCanvas projectId={PROJECT} docId={DOC} version={3} navigate={navigate} />);
  await screen.findByTestId('doc-canvas');
  await userEvent.click(document.querySelector('[data-testid="panel-rail-tab"][data-tab="compare"]') as HTMLElement);
  await userEvent.click(screen.getByTestId('version-compare-toggle'));
  expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  return navigate;
}

describe('takes on the compare split', () => {
  it('two takes render side by side, each pane with its own Pick', async () => {
    const calls = stubFetch(LINEAR);
    await openTakes(calls);
    const headers = screen.getAllByTestId('take-header');
    expect(headers.map((h) => h.getAttribute('data-take'))).toEqual(['1', '2']);
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringContaining('Take 1v3 (selected)'), expect.stringContaining('Take 2v2 (parent)'),
    ]);
    expect(screen.getAllByTestId('take-pick')).toHaveLength(2);
    const panes = screen.getAllByTestId('compare-pane');
    expect(panes.map((p) => p.getAttribute('data-version'))).toEqual(['3', '2']);
  });

  it('picking shows the consequence first; confirming files the preference proposal and forks the take', async () => {
    const calls = stubFetch(LINEAR);
    const navigate = await openTakes(calls);

    await userEvent.click(screen.getAllByTestId('take-pick')[1]!);
    expect(screen.getByTestId('take-pick-consequence').textContent).toContain('v2 becomes the latest version');
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]); // nothing sent on preview

    await userEvent.click(screen.getByTestId('take-pick-confirm'));
    await waitFor(() => expect(screen.getByTestId('takes-receipt')).toBeTruthy());

    const filed = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/v1/proposals'));
    expect(filed).toHaveLength(1);
    expect(filed[0]!.body).toEqual({
      content: 'Prefers takes like v2 of “q3-report” (picked over v3).',
      project: PROJECT,
      source: 'doc:q3-report@v2',
    });
    const forks = calls.filter((c) => c.method === 'POST' && c.url.includes('/api/fork'));
    expect(forks.map((c) => c.body)).toEqual([{ from: 2 }]);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=4`);
    expect(screen.getByTestId('takes-receipt').getAttribute('data-proposal')).toBe('prop-9');
    expect(screen.getByTestId('takes-receipt-working').textContent).toContain('as v4');
    // The pick closes the split: the working version is back on the solo canvas.
    expect(screen.queryByTestId('compare-panes')).toBeNull();
  });

  it('a failed filing is said in the receipt, which comes into view even from another tab', async () => {
    const calls = stubFetch(LINEAR, 502);
    await openTakes(calls);
    await userEvent.click(screen.getAllByTestId('take-pick')[1]!);
    // The person moved the panel to Chat while the split stays on the canvas.
    await userEvent.click(document.querySelector('[data-testid="panel-tab"][data-tab="chat"]') as HTMLElement);
    await userEvent.click(screen.getByTestId('take-pick-confirm'));
    await waitFor(() => expect(screen.getByTestId('doc-panel').getAttribute('data-tab')).toBe('compare'));
    const filed = screen.getByTestId('takes-receipt-proposal');
    expect(filed.getAttribute('data-failed')).toBe('true');
    expect(filed.textContent).toMatch(/^The preference was not filed: .+/);
    // The fork is independent of the filing and still happened.
    expect(screen.getByTestId('takes-receipt-working').textContent).toContain('as v4');
  });

  it('cancel sends nothing', async () => {
    const calls = stubFetch(LINEAR);
    await openTakes(calls);
    await userEvent.click(screen.getAllByTestId('take-pick')[0]!);
    await userEvent.click(screen.getByTestId('take-pick-cancel'));
    expect(screen.queryByTestId('take-pick-preview')).toBeNull();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('remix sends one steer to the document agent, forking from the take it builds on', async () => {
    const calls = stubFetch(LINEAR);
    const navigate = await openTakes(calls);
    const send = screen.getByTestId('takes-remix-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(screen.getByTestId('takes-remix-keep'), 'headline');
    expect(screen.getByTestId('takes-remix-steer').textContent)
      .toBe("Sends to the document agent: “Build on take 2 (v2), and keep take 1's (v3) headline.”");
    await userEvent.click(send);

    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/events'))).toBe(true));
    const forks = calls.filter((c) => c.method === 'POST' && c.url.includes('/api/fork'));
    expect(forks).toHaveLength(1);
    expect((forks[0]!.body as { from: number }).from).toBe(2);
    const steer = calls.find((c) => c.url.includes('/api/events'))!.body as {
      event_type: string; payload: { text: string; document_id: string };
    };
    expect(steer.event_type).toBe('wicked.interactive.chat.posted');
    expect(steer.payload).toMatchObject({ text: "Build on take 2 (v2), and keep take 1's (v3) headline.", document_id: DOC });
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=4`);
    // The steer is on the thread, as the composer's own sends are.
    const msgs = useDocThreadStore.getState().messages[threadKey(PROJECT, DOC)] ?? [];
    expect(msgs.some((m) => m.kind === 'user' && m.text.startsWith('Build on take 2'))).toBe(true);
    // No proposal on a remix: only a pick records a preference.
    expect(calls.some((c) => c.url.endsWith('/api/v1/proposals'))).toBe(false);
  });
});
