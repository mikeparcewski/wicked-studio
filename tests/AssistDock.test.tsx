import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssistDock, useAssistDockOpen, type AssistVerbs } from '../src/components/AssistDock.js';
import { useGateStore } from '../src/store/gates.js';

/**
 * The GENERIC assist-dock contract (DES-ASSIST-DOCK §3) — fixture verbs, no wire module:
 *  - a typed message fires `verbs.send(text, documents)` and mounts the run block for the
 *    returned run id (the narrator components take it from there);
 *  - attachments: `importable(name)` files offer the Import-directly vs Analyze-with-chat
 *    fork; Import fires `verbs.importDirect` and echoes its notes; plain files attach for
 *    analysis with no fork; analysis documents ride the NEXT send and clear with it;
 *  - a gate keyed to the active run renders in the PINNED ApprovalDock inside the panel
 *    (a structural sibling of the thread scroll), and resolving fires `onRunResolved`;
 *  - collapse is a per-surface persisted preference (localStorage), restored across mounts.
 *
 * The Steering BINDING of these verbs (author/import wires, types, 501 copy) is pinned in
 * SteeringPage.manage.test.tsx — this file owns the surface-agnostic mechanics.
 */

const confirmGate = vi.fn();
const cancelRun = vi.fn();
const getRun = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    confirmGate: (...a: unknown[]) => confirmGate(...a),
    cancelRun: (...a: unknown[]) => cancelRun(...a),
    getRun: (...a: unknown[]) => getRun(...a),
  },
  apiFetch: vi.fn(() => Promise.reject(new Error('no wire in this rig'))),
}));

function verbs(over: Partial<AssistVerbs> = {}): AssistVerbs & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn().mockResolvedValue({ runId: 'run-x1' }),
    ...over,
  } as AssistVerbs & { send: ReturnType<typeof vi.fn> };
}

function dock(v: AssistVerbs, over: Partial<{ importable: (n: string) => boolean; open: boolean; onOpenChange: (o: boolean) => void }> = {}): void {
  render(
    <AssistDock
      context={{
        surface: 'rig',
        title: 'Assistant',
        contextLabel: 'Rig · Fixture',
        placeholder: 'Type here…',
        hint: 'the fixture hint',
      }}
      verbs={v}
      importable={over.importable}
      open={over.open ?? true}
      onOpenChange={over.onOpenChange ?? ((): void => undefined)}
    />,
  );
}

beforeEach(() => {
  confirmGate.mockReset();
  cancelRun.mockReset();
  getRun.mockReset();
  getRun.mockRejectedValue(new Error('no run snapshot in this rig'));
  useGateStore.setState({ gates: {}, approaching: {} });
  try { localStorage.clear(); } catch { /* jsdom always has it */ }
});

describe('AssistDock — send', () => {
  it('a typed message fires verbs.send and mounts the run block for the returned id', async () => {
    const user = userEvent.setup();
    const v = verbs();
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'author three rules');
    await user.click(screen.getByTestId('assist-send'));

    await waitFor(() => expect(v.send).toHaveBeenCalledWith('author three rules', []));
    expect(screen.getByTestId('assist-user-msg')).toHaveTextContent('author three rules');
    expect(await screen.findByTestId('assist-run')).toHaveAttribute('data-run-id', 'run-x1');
    // The composer cleared for the next message.
    expect(screen.getByTestId('assist-input')).toHaveValue('');
  });

  it('a failed send echoes a fail note and keeps NO run block', async () => {
    const user = userEvent.setup();
    const v = verbs({ send: vi.fn().mockRejectedValue(new Error('engine busy')) });
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'x');
    await user.click(screen.getByTestId('assist-send'));

    const note = await screen.findByTestId('assist-note');
    expect(note).toHaveAttribute('data-tone', 'fail');
    expect(note).toHaveTextContent('engine busy');
    expect(screen.queryByTestId('assist-run')).toBeNull();
  });
});

describe('AssistDock — the import-vs-analyze fork', () => {
  const md = (): File => new File(['# rules'], 'doctrine.md', { type: 'text/markdown' });

  it('an importable file offers BOTH verbs; Import directly fires importDirect and echoes its notes', async () => {
    const user = userEvent.setup();
    const importDirect = vi.fn().mockResolvedValue([
      { tone: 'work', text: 'imported PAT-900' },
      { tone: 'fail', text: 'rejected entry 1 — bad frontmatter' },
    ]);
    dock(verbs({ importDirect }), { importable: (n) => n.endsWith('.md') });

    await user.upload(screen.getByTestId('assist-attach'), md());
    const chip = await screen.findByTestId('assist-attachment-chip');
    expect(chip).toHaveAttribute('data-mode', 'ask');
    await user.click(within(chip).getByTestId('assist-import-now'));

    await waitFor(() => expect(importDirect).toHaveBeenCalledWith({ name: 'doctrine.md', content: '# rules' }));
    const notes = await screen.findAllByTestId('assist-note');
    expect(notes.some((n) => (n.textContent ?? '').includes('imported PAT-900'))).toBe(true);
    expect(notes.some((n) => n.getAttribute('data-tone') === 'fail' && (n.textContent ?? '').includes('bad frontmatter'))).toBe(true);
    // Consumed: the chip is gone and the file does NOT also ride the next send.
    expect(screen.queryByTestId('assist-attachment-chip')).toBeNull();
  });

  it('Analyze with chat keeps the file as an analysis document riding the next send, then clears it', async () => {
    const user = userEvent.setup();
    const v = verbs({ importDirect: vi.fn() });
    dock(v, { importable: (n) => n.endsWith('.md') });

    await user.upload(screen.getByTestId('assist-attach'), md());
    await user.click(await screen.findByTestId('assist-analyze'));
    expect(screen.getByTestId('assist-attachment-chip')).toHaveAttribute('data-mode', 'analyze');

    await user.type(screen.getByTestId('assist-input'), 'derive rules');
    await user.click(screen.getByTestId('assist-send'));

    await waitFor(() =>
      expect(v.send).toHaveBeenCalledWith('derive rules', [{ name: 'doctrine.md', content: '# rules' }]),
    );
    expect(screen.queryByTestId('assist-attachment-chip')).toBeNull();
  });

  it('a plain file attaches for analysis with no fork; without importDirect NOTHING forks', async () => {
    const user = userEvent.setup();
    // importable says .md forks — but the surface wired no importDirect verb, so it must not.
    dock(verbs(), { importable: (n) => n.endsWith('.md') });

    await user.upload(screen.getByTestId('assist-attach'), md());
    const chip = await screen.findByTestId('assist-attachment-chip');
    expect(chip).toHaveAttribute('data-mode', 'analyze');
    expect(within(chip).queryByTestId('assist-import-now')).toBeNull();
  });
});

describe('AssistDock — the pinned gate', () => {
  it('a gate keyed to the active run renders in the panel-pinned ApprovalDock; resolving fires onRunResolved', async () => {
    const user = userEvent.setup();
    confirmGate.mockResolvedValue({ status: 'ok' });
    const onRunResolved = vi.fn();
    const v = verbs({ onRunResolved });
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'go');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-run');

    act(() => {
      useGateStore.getState().ingest({
        type: 'awaitingHuman',
        session: 'run-x1',
        ord: 0,
        prompt: 'Approve the proposal?',
      } as never);
    });

    const gate = await screen.findByTestId('steering-gate');
    expect(gate).toHaveAttribute('data-run-id', 'run-x1');
    // Structural (DES-RUN-NARRATOR §2): pinned BELOW the thread scroll, never inside it.
    expect(screen.getByTestId('assist-thread').contains(gate)).toBe(false);

    await user.click(within(gate).getByTestId('steering-approve'));
    await waitFor(() => expect(confirmGate).toHaveBeenCalledWith('run-x1', { approve: true }));
    expect(onRunResolved).toHaveBeenCalledTimes(1);
  });
});

describe('AssistDock — collapse persistence', () => {
  function Host(): React.ReactElement {
    const [open, setOpen] = useAssistDockOpen('rig');
    return (
      <AssistDock
        context={{ surface: 'rig', title: 'Assistant', contextLabel: 'Rig', placeholder: 'Type…' }}
        verbs={verbs()}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }

  it('collapsing persists per surface and restores on the next mount', async () => {
    const user = userEvent.setup();
    render(<Host />);
    expect(screen.getByTestId('assist-dock')).toBeInTheDocument();

    await user.click(screen.getByTestId('assist-dock-toggle'));
    expect(screen.queryByTestId('assist-dock')).toBeNull();
    expect(screen.getByTestId('assist-dock-rail')).toBeInTheDocument();
    expect(localStorage.getItem('wicked.assist.rig.open')).toBe('false');

    // A fresh mount (a reload) restores the remembered collapse.
    cleanup();
    render(<Host />);
    expect(screen.queryByTestId('assist-dock')).toBeNull();
    expect(screen.getByTestId('assist-dock-rail')).toBeInTheDocument();

    // Re-opening persists too.
    await user.click(screen.getByTestId('assist-dock-toggle'));
    expect(screen.getByTestId('assist-dock')).toBeInTheDocument();
    expect(localStorage.getItem('wicked.assist.rig.open')).toBe('true');
  });
});
