/**
 * Memory capture and the table edit stay usable while a request is out; its answer clears only what it carried
 * (codex on #937, two P2s): words and files picked during a capture are the next capture's, and edits typed during
 * a table save, or that failed, are kept.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const postCapture = vi.fn();
const editMemory = vi.fn();
vi.mock('../src/api/capture.js', () => ({ postCapture, toCaptureFile: async (f: File) => ({ name: f.name, content: 'x' }) }));
vi.mock('../src/api/memory.js', async (orig) => ({ ...(await orig<typeof import('../src/api/memory.js')>()), editMemory }));
vi.mock('../src/api/proposals.js', async (orig) => ({ ...(await orig<typeof import('../src/api/proposals.js')>()), listProposals: vi.fn(async () => []) }));
vi.mock('../src/api/client.js', () => ({ api: { getRun: vi.fn(() => new Promise(() => undefined)) } }));

const { MemoryCaptureAdd, MemoryTable } = await import('../src/components/memory/MemoryAdd.js');

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const mem = (id: string, content: string) => ({ id, content, tier: 'semantic', scope: '', facets: {} }) as never;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('a capture clears only what it sent', () => {
  it('chat: words typed while the capture is out stay in the box', async () => {
    const d = deferred<{ runId: string }>();
    postCapture.mockReturnValue(d.promise);
    render(<MemoryCaptureAdd mode="chat" project="default" projects={[]} onClose={() => {}} onKept={() => {}} />);
    const box = screen.getByTestId('memory-add-text') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'we deploy on Tuesdays' } });
    fireEvent.click(screen.getByTestId('memory-add-send'));
    fireEvent.change(box, { target: { value: 'and never on Fridays' } });
    await act(async () => { d.resolve({ runId: 'r1' }); await d.promise; });
    expect(box.value).toBe('and never on Fridays');
  });

  it('chat: the words that went out are cleared when nothing new was typed', async () => {
    postCapture.mockResolvedValue({ runId: 'r1' });
    render(<MemoryCaptureAdd mode="chat" project="default" projects={[]} onClose={() => {}} onKept={() => {}} />);
    const box = screen.getByTestId('memory-add-text') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'we deploy on Tuesdays' } });
    fireEvent.click(screen.getByTestId('memory-add-send'));
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('import: a file and a note picked while the first import is out are kept for the next one', async () => {
    const d = deferred<{ runId: string }>();
    postCapture.mockReturnValue(d.promise);
    const { container } = render(<MemoryCaptureAdd mode="import" project="default" projects={[]} onClose={() => {}} onKept={() => {}} />);
    const picker = container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(['a'], 'first.md')] } });
    fireEvent.click(screen.getByTestId('memory-add-send'));
    await waitFor(() => expect(postCapture).toHaveBeenCalled());
    fireEvent.change(picker, { target: { files: [new File(['b'], 'second.md')] } });
    fireEvent.change(screen.getByTestId('memory-add-text'), { target: { value: 'the second is the runbook' } });
    await act(async () => { d.resolve({ runId: 'r1' }); await d.promise; });
    expect(screen.getByTestId('memory-import-files').textContent).toBe('second.md');
    expect((screen.getByTestId('memory-add-text') as HTMLTextAreaElement).value).toBe('the second is the runbook');
    expect(postCapture.mock.calls[0]![1].files.map((f: { name: string }) => f.name)).toEqual(['first.md']);
  });
});

describe('a table save clears only what it saved', () => {
  it('a row typed during the save, and a row whose save failed, keep their words', async () => {
    const first = deferred<{ memory_id: string; retired: string }>();
    editMemory.mockImplementation(({ memory_id }: { memory_id: string }) =>
      memory_id === 'm1' ? first.promise : Promise.reject(new Error('estate down')));
    const memories = [mem('m1', 'deploy Tuesdays'), mem('m2', 'use pnpm'), mem('m3', 'owner is Sam')];
    const { rerender } = render(<MemoryTable memories={memories} onSaved={() => {}} onClose={() => {}} />);
    const rows = (): HTMLTextAreaElement[] => screen.getAllByTestId('memory-table-text') as HTMLTextAreaElement[];
    fireEvent.change(rows()[0]!, { target: { value: 'deploy Tuesdays and Thursdays' } });
    fireEvent.change(rows()[1]!, { target: { value: 'use pnpm 10' } });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    // while m1's save is out: m1 changes again, and m3 is edited for the first time
    fireEvent.change(rows()[0]!, { target: { value: 'deploy Tuesdays and Thursdays, never Friday' } });
    fireEvent.change(rows()[2]!, { target: { value: 'owner is Sam and Ana' } });
    await act(async () => { first.resolve({ memory_id: 'm1b', retired: 'm1' }); await first.promise; });
    await waitFor(() => expect(screen.getByTestId('memory-table-note').textContent).toMatch(/Saved 1; 1 did not: estate down/));
    // m2 failed: its draft stays; m3 was never sent: it stays
    expect(rows()[1]!.value).toBe('use pnpm 10');
    expect(rows()[2]!.value).toBe('owner is Sam and Ana');
    // before the list is read again, m1's row still shows the newer words (never the old memory's)
    expect(rows()[0]!.value).toBe('deploy Tuesdays and Thursdays, never Friday');
    // typed while the list is being read again: kept, and it is the new memory it will save
    fireEvent.change(rows()[0]!, { target: { value: 'deploy Tuesdays and Thursdays, never Friday or Monday' } });
    rerender(<MemoryTable memories={[mem('m1b', 'deploy Tuesdays and Thursdays'), memories[1]!, memories[2]!]} onSaved={() => {}} onClose={() => {}} />);
    expect(rows()[0]!.value).toBe('deploy Tuesdays and Thursdays, never Friday or Monday');
  });

  it('a row saved and not touched again goes back to the saved words', async () => {
    editMemory.mockResolvedValue({ memory_id: 'm1b', retired: 'm1' });
    const { rerender } = render(<MemoryTable memories={[mem('m1', 'deploy Tuesdays')]} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('memory-table-text'), { target: { value: 'deploy Thursdays' } });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    await waitFor(() => expect(screen.getByTestId('memory-table-note').textContent).toBe('Saved 1 change.'));
    // before the refresh the row shows the saved words, and is not a change to save again (its memory was retired)
    expect((screen.getByTestId('memory-table-text') as HTMLTextAreaElement).value).toBe('deploy Thursdays');
    expect(screen.getByTestId('memory-table-save').textContent).toBe('Save changes');
    // a further edit before the refresh saves the NEW memory
    fireEvent.change(screen.getByTestId('memory-table-text'), { target: { value: 'deploy Thursdays only' } });
    editMemory.mockResolvedValue({ memory_id: 'm1c', retired: 'm1b' });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    await waitFor(() => expect(editMemory).toHaveBeenLastCalledWith({ memory_id: 'm1b', content: 'deploy Thursdays only' }));
    rerender(<MemoryTable memories={[mem('m1c', 'deploy Thursdays only')]} onSaved={() => {}} onClose={() => {}} />);
    expect((screen.getByTestId('memory-table-text') as HTMLTextAreaElement).value).toBe('deploy Thursdays only');
    expect(screen.getByTestId('memory-table-save').textContent).toBe('Save changes');
  });

  it('a refresh that lands during a second save keeps the chain: the row shows and edits the newest memory (codex + agy r2)', async () => {
    editMemory.mockResolvedValueOnce({ memory_id: 'm1b', retired: 'm1' });
    const { rerender } = render(<MemoryTable memories={[mem('m1', 'v1')]} onSaved={() => {}} onClose={() => {}} />);
    const box = (): HTMLTextAreaElement => screen.getByTestId('memory-table-text') as HTMLTextAreaElement;
    fireEvent.change(box(), { target: { value: 'v2' } });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    await waitFor(() => expect(screen.getByTestId('memory-table-note').textContent).toBe('Saved 1 change.'));
    // save two goes out on the new memory, from the row still showing m1
    const second = deferred<{ memory_id: string; retired: string }>();
    editMemory.mockReturnValueOnce(second.promise);
    fireEvent.change(box(), { target: { value: 'v3' } });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    expect(editMemory).toHaveBeenLastCalledWith({ memory_id: 'm1b', content: 'v3' });
    // the first refresh lands now: the row is m1b
    rerender(<MemoryTable memories={[mem('m1b', 'v2')]} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.change(box(), { target: { value: 'v4' } });
    await act(async () => { second.resolve({ memory_id: 'm1c', retired: 'm1b' }); await second.promise; });
    // the newest words stay on screen, and the next save goes to m1c
    expect(box().value).toBe('v4');
    editMemory.mockResolvedValueOnce({ memory_id: 'm1d', retired: 'm1c' });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    await waitFor(() => expect(editMemory).toHaveBeenLastCalledWith({ memory_id: 'm1c', content: 'v4' }));
  });

  it('a multi-row save publishes each row as it answers: words typed on its new memory are not overwritten (codex r3)', async () => {
    const m2 = deferred<{ memory_id: string; retired: string }>();
    editMemory.mockImplementation(({ memory_id }: { memory_id: string }) =>
      memory_id === 'm1' ? Promise.resolve({ memory_id: 'm1b', retired: 'm1' }) : m2.promise);
    const { rerender } = render(<MemoryTable memories={[mem('m1', 'a1'), mem('m2', 'b1')]} onSaved={() => {}} onClose={() => {}} />);
    const rows = (): HTMLTextAreaElement[] => screen.getAllByTestId('memory-table-text') as HTMLTextAreaElement[];
    fireEvent.change(rows()[0]!, { target: { value: 'a2' } });
    fireEvent.change(rows()[1]!, { target: { value: 'b2' } });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    await waitFor(() => expect(editMemory).toHaveBeenCalledWith({ memory_id: 'm2', content: 'b2' }));
    // m1 answered, m2 still out: typed on the row (still listed as m1), then a refresh lists m1b and more is typed
    fireEvent.change(rows()[0]!, { target: { value: 'a2x' } });
    rerender(<MemoryTable memories={[mem('m1b', 'a2'), mem('m2', 'b1')]} onSaved={() => {}} onClose={() => {}} />);
    expect(rows()[0]!.value).toBe('a2x');
    fireEvent.change(rows()[0]!, { target: { value: 'a3' } });
    await act(async () => { m2.resolve({ memory_id: 'm2b', retired: 'm2' }); await m2.promise; });
    expect(rows()[0]!.value).toBe('a3');
    expect(rows()[1]!.value).toBe('b2');
  });

  it('refreshes landing out of order keep the chain: a late, older list still edits the newest memory (agy r3)', async () => {
    editMemory.mockResolvedValueOnce({ memory_id: 'm1b', retired: 'm1' }).mockResolvedValueOnce({ memory_id: 'm1c', retired: 'm1b' });
    const { rerender } = render(<MemoryTable memories={[mem('m1', 'v1')]} onSaved={() => {}} onClose={() => {}} />);
    const box = (): HTMLTextAreaElement => screen.getByTestId('memory-table-text') as HTMLTextAreaElement;
    fireEvent.change(box(), { target: { value: 'v2' } });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    await waitFor(() => expect(editMemory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('memory-table-note').textContent).toBe('Saved 1 change.'));
    fireEvent.change(box(), { target: { value: 'v3' } });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    await waitFor(() => expect(editMemory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('memory-table-save').textContent).toBe('Save changes'));
    // the newer list lands first, then the older one
    rerender(<MemoryTable memories={[mem('m1c', 'v3')]} onSaved={() => {}} onClose={() => {}} />);
    rerender(<MemoryTable memories={[mem('m1b', 'v2')]} onSaved={() => {}} onClose={() => {}} />);
    expect(box().value).toBe('v3');
    fireEvent.change(box(), { target: { value: 'v4' } });
    editMemory.mockResolvedValueOnce({ memory_id: 'm1d', retired: 'm1c' });
    fireEvent.click(screen.getByTestId('memory-table-save'));
    await waitFor(() => expect(editMemory).toHaveBeenLastCalledWith({ memory_id: 'm1c', content: 'v4' }));
  });
});
