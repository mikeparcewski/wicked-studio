import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * studio#675 — an archived run opened from the Archived list must resolve via GET /runs/:id,
 * not show "not in the run index yet" forever (archived runs are excluded from the default
 * GET /runs list, crew#265).
 */

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useSheets } = await import('../src/store/sheets.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { makeView } = await import('./factories.js');

const ARC = makeView({ id: 'r-arc', status: 'completed', problem: 'onboarding run', archived_at: 1_759_601_000 } as never);

function stubFetch(serveDetail: boolean) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (serveDetail && /^\/runs\/r-arc$/.test(path)) {
      return Promise.resolve(new Response(JSON.stringify({ run: ARC }),
        { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return Promise.resolve(new Response(JSON.stringify({}),
      { status: 404, headers: { 'content-type': 'application/json' } }));
  }));
}

beforeEach(() => {
  useCapabilities.setState({ loaded: true, runChatId: false });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('studio#675 — an archived run opened from the Archived list resolves', () => {
  it('renders the run (not the pending line) and shows · Archived when getRun serves it', async () => {
    stubFetch(true);
    render(<SessionPage sessionId="run:r-arc" runs={[]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByTestId('session-run-archived');
    expect(screen.queryByTestId('session-run-pending')).toBeNull();
  });

  it('keeps the pending line when getRun 404s', async () => {
    stubFetch(false);
    render(<SessionPage sessionId="run:r-404" runs={[]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByTestId('session-run-pending');
    expect(screen.queryByTestId('session-run-archived')).toBeNull();
  });
  it('a late detail read for one address never shows under the next (studio#675)', async () => {
    let release: (() => void) | null = null;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (/^\/runs\/r-arc$/.test(path)) {
        return new Promise<Response>((res) => { release = () => res(new Response(JSON.stringify({ run: ARC }), { status: 200, headers: { 'content-type': 'application/json' } })); });
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404, headers: { 'content-type': 'application/json' } }));
    }));
    const view = render(<SessionPage sessionId="run:r-arc" runs={[]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await vi.waitFor(() => expect(release).not.toBeNull());
    view.rerender(<SessionPage sessionId="run:r-404" runs={[]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    await screen.findByTestId('session-run-pending');
    release!();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('session-run-archived')).toBeNull();
    expect(screen.getByTestId('session-run-pending')).toBeTruthy();
  });
});
