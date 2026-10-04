import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S15d — Amendment 5 item 1: the session IS the running chat. The run's block in the thread no
 * longer sends the operator elsewhere ("Open the run page →"); what the old run page carried that an
 * operator needs — every step in order and what each did, the changes, the evidence — is under the
 * session's look-underneath sheet (S11), in plain words, reached from the block itself.
 */

vi.mock('../src/api/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...mod, downloadRunEvidence: (runId: string) => evidence(runId) };
});
const evidence = vi.fn<(runId: string) => Promise<void>>(() => Promise.resolve());

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { ObjectSheet } = await import('../src/components/sheets/ObjectSheet.js');
const { RAW_CONTROLS, SHEET_TABS } = await import('../src/board/objectActions.js');
const { closeSheet, useSheets } = await import('../src/store/sheets.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { makeUnit, makeView } = await import('./factories.js');

const RUN = makeView({ id: 'r1', status: 'executing', problem: 'fix the double charge', unit_ix: 1, created_at: 1_700_000_000 } as never, [
  makeUnit({ id: 'r1:u0', session_id: 'r1', ord: 0, status: 'done', assigned_cli: 'claude', description: 'understand — fix it' }),
  makeUnit({ id: 'r1:u1', session_id: 'r1', ord: 1, status: 'distributed', assigned_cli: 'codex', description: 'build — fix it' }),
  makeUnit({ id: 'r1:u2', session_id: 'r1', ord: 2, status: 'pending', assigned_cli: null, description: 'review — fix it' }),
]);

// A chat holding an older run and a newer one (codex r1): each block's ⋯ must open ITS run's depth.
const OLD = makeView({ id: 'r-old', status: 'completed', problem: 'rename the invoice fields', chat_id: 'chat-x', created_at: 1_600_000_000 } as never, [
  makeUnit({ id: 'r-old:u0', session_id: 'r-old', ord: 0, status: 'done', assigned_cli: 'claude', description: 'build — rename' }),
]);
const NEW = makeView({ id: 'r-new', status: 'executing', problem: 'fix the double charge', unit_ix: 0, chat_id: 'chat-x', created_at: 1_700_000_000 } as never, [
  makeUnit({ id: 'r-new:u0', session_id: 'r-new', ord: 0, status: 'distributed', assigned_cli: 'codex', description: 'understand — fix it' }),
  makeUnit({ id: 'r-new:u1', session_id: 'r-new', ord: 1, status: 'pending', assigned_cli: null, description: 'build — fix it' }),
]);

beforeEach(() => {
  evidence.mockClear();
  useCapabilities.setState({ loaded: true, runChatId: true });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const body = path.endsWith('/events') ? { events: [] } : path.includes('/output') ? { output: 'it read the code' }
      : path.startsWith('/chats/') ? { scope: { kind: 'project' }, messages: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: path.endsWith('/team') ? 404 : 200, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); closeSheet(); });

function page() {
  return render(
    <>
      <SessionPage sessionId="run:r1" runs={[RUN]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />
      <ObjectSheet runs={[RUN]} navigate={() => {}} needCount={0} />
    </>,
  );
}

describe('the run block stays in the thread', () => {
  it('offers no run page; its ⋯ opens the session sheet on the steps', () => {
    page();
    expect(screen.queryByTestId('session-run-open')).toBeNull();
    expect(screen.queryByText(/Open the run page/)).toBeNull();
    fireEvent.click(screen.getByTestId('session-run-look'));
    const open = useSheets.getState().open;
    expect(open?.ref).toStrictEqual({ kind: 'session', sessionId: 'run:r1' });
    expect(open?.tab).toBe('steps');
    expect(screen.getByTestId('sheet-body').getAttribute('data-tab')).toBe('steps');
  });
});

describe('in a chat with two runs, each block opens its own run', () => {
  it('the older run’s ⋯ shows the older run’s steps, not the newest run’s', async () => {
    render(
      <>
        <SessionPage sessionId="chat-x" runs={[OLD, NEW]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />
        <ObjectSheet runs={[OLD, NEW]} navigate={() => {}} needCount={0} />
      </>,
    );
    const blocks = await screen.findAllByTestId('session-run');
    expect(blocks.map((b) => b.getAttribute('data-run-id'))).toStrictEqual(['r-old', 'r-new']);
    fireEvent.click(blocks[0]!.querySelector('[data-testid="session-run-look"]') as HTMLElement);
    expect(useSheets.getState().open?.ref).toStrictEqual({ kind: 'session', sessionId: 'run:r-old' });
    expect(screen.getByTestId('sheet-title').textContent).toBe('rename the invoice fields');
    expect(screen.getAllByTestId('sheet-step-row').map((r) => r.textContent)).toStrictEqual(['Build — done · claude']);
    act(() => closeSheet());
    fireEvent.click(blocks[1]!.querySelector('[data-testid="session-run-look"]') as HTMLElement);
    expect(useSheets.getState().open?.ref).toStrictEqual({ kind: 'session', sessionId: 'run:r-new' });
    expect(screen.getAllByTestId('sheet-step-row').map((r) => r.textContent)).toStrictEqual(['Research — working · codex', 'Build — not started']);
  });
});

describe('the session sheet carries what the run page had', () => {
  it('Steps: every step in order, in plain words, each a way into its own sheet', () => {
    page();
    act(() => useSheets.setState({ open: { ref: { kind: 'session', sessionId: 'run:r1' }, tab: 'steps' }, pointed: null, stopping: {} }));
    const rows = screen.getAllByTestId('sheet-step-row');
    expect(rows.map((r) => r.textContent)).toStrictEqual([
      'Research — done · claude',
      'Build — working · codex',
      'Review — not started',
    ]);
    fireEvent.click(screen.getAllByTestId('sheet-step-open')[1]!);
    expect(useSheets.getState().open?.ref).toStrictEqual({ kind: 'step', runId: 'r1', ord: 1 });
    expect(useSheets.getState().open?.tab).toBe('did');
  });

  it('Changes and Evidence are tabs; Evidence downloads the run’s bundle', () => {
    page();
    const tabs = SHEET_TABS.session.map((t) => t.id);
    expect(tabs.slice(0, 7)).toStrictEqual(['goal', 'steps', 'helpers', 'changes', 'evidence', 'activity', 'signins']);
    act(() => useSheets.setState({ open: { ref: { kind: 'session', sessionId: 'run:r1' }, tab: 'evidence' }, pointed: null, stopping: {} }));
    fireEvent.click(screen.getByTestId('sheet-evidence-download'));
    expect(evidence).toHaveBeenCalledWith('r1');
  });

  it('the old run page’s timeline and evidence have sheet homes in the §5 table', () => {
    const homes = (control: string) => RAW_CONTROLS.find((r) => r.control.startsWith(control))?.homes ?? [];
    expect(homes('Timeline')).toContainEqual({ on: 'session', tab: 'steps' });
    expect(homes('Evidence bundle')).toContainEqual({ on: 'session', tab: 'evidence' });
    expect(homes('Diff')).toContainEqual({ on: 'session', tab: 'changes' });
  });
});
