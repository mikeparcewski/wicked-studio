import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { flushDecisionsForTest } from '../src/board/undoQueue.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useGateStore } from '../src/store/gates.js';
import { makeView, makeUnit } from './factories.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); useGateStore.setState({ gates: {} }); });
it('D: a click on the rendered GateRow refuses a store gate that moved on', async () => {
  const runId = 'stale-row';
  const gate = { runId, ord: 2, prompt: 'Proceed?', gateKind: 'consent', lifecycle: 'open', receivedAt: 100, actionsRead: true as const };
  useGateStore.getState().setGate(gate);
  useGateActionStore.setState({ byGate: {} });
  const post = vi.spyOn(api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
  vi.spyOn(api, 'getRunEvents').mockResolvedValue({ events: [] });
  vi.spyOn(api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
  vi.spyOn(api, 'getGate').mockRejectedValue(new Error('no read'));
  render(<GateRow view={makeView({ id: runId, status: 'awaiting_human' }, [makeUnit({ ord: 2 })])} gate={gate} navigate={vi.fn()} />);
  const choice = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-choice-key="approve"]'); expect(el).not.toBeNull(); return el!; });
  fireEvent.click(choice);
  act(() => { useGateStore.getState().setGate({ ...gate, ord: 3, receivedAt: 200 }); });
  fireEvent.click(screen.getByTestId('session-gate-confirm'));
  await act(async () => { await flushDecisionsForTest(); });
  expect(post).not.toHaveBeenCalled();
});
