import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchTheme } from '../src/components/editorPorts/MatchTheme.js';
import { getLearnedTheme, putLearnedTheme } from '../src/api/interactive.js';
import { learnThemeFromThread } from '../src/interactive/themeWire.js';
import { pollLearnedTheme } from '../src/theming/learnPoll.js';

vi.mock('../src/api/interactive.js', async (original) => ({
  ...await original<typeof import('../src/api/interactive.js')>(), getLearnedTheme: vi.fn(), putLearnedTheme: vi.fn(),
}));
vi.mock('../src/interactive/themeWire.js', async (original) => ({
  ...await original<typeof import('../src/interactive/themeWire.js')>(), learnThemeFromThread: vi.fn(),
}));
vi.mock('../src/theming/learnPoll.js', () => ({ pollLearnedTheme: vi.fn() }));

const learned = { document_id: 'doc', learned_at: '2026-10-14T12:00:00Z', tokens: { name: 'matched' } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getLearnedTheme).mockResolvedValue(null);
  vi.mocked(learnThemeFromThread).mockResolvedValue({ ok: true });
  vi.mocked(pollLearnedTheme).mockResolvedValue({ kind: 'learned', result: learned });
  vi.mocked(putLearnedTheme).mockResolvedValue({ document_id: 'doc', written: true, version: 8, parent: 7, kind: 'theme' });
});
afterEach(() => cleanup());
const submit = (onVersion = vi.fn()) => {
  const view = render(<MatchTheme projectId="project" docId="doc" onVersion={onVersion} />);
  fireEvent.change(screen.getByTestId('match-theme-input'), { target: { value: 'https://example.com' } });
  fireEvent.click(screen.getByTestId('match-theme-go'));
  return view;
};

describe('Match theme cancellation', () => {
  it('does not start learning after unmount during the baseline read', async () => {
    const pending = deferred<Awaited<ReturnType<typeof getLearnedTheme>>>();
    vi.mocked(getLearnedTheme).mockReturnValue(pending.promise);
    const view = submit(); await waitFor(() => expect(getLearnedTheme).toHaveBeenCalledOnce());
    view.unmount(); await act(async () => { pending.resolve(null); });
    expect(learnThemeFromThread).not.toHaveBeenCalled(); expect(putLearnedTheme).not.toHaveBeenCalled();
  });
  it('does not poll or apply after unmount during the learn request', async () => {
    const pending = deferred<Awaited<ReturnType<typeof learnThemeFromThread>>>();
    vi.mocked(learnThemeFromThread).mockReturnValue(pending.promise);
    const view = submit(); await waitFor(() => expect(learnThemeFromThread).toHaveBeenCalledOnce());
    view.unmount(); await act(async () => { pending.resolve({ ok: true }); });
    expect(pollLearnedTheme).not.toHaveBeenCalled(); expect(putLearnedTheme).not.toHaveBeenCalled();
  });
  it('aborts polling and does not PUT when a learned result arrives after unmount', async () => {
    const pending = deferred<Awaited<ReturnType<typeof pollLearnedTheme>>>();
    vi.mocked(pollLearnedTheme).mockReturnValue(pending.promise);
    const view = submit(); await waitFor(() => expect(pollLearnedTheme).toHaveBeenCalledOnce());
    const signal = vi.mocked(pollLearnedTheme).mock.calls[0]![0].signal;
    expect(signal.aborted).toBe(false); view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve({ kind: 'learned', result: learned }); });
    expect(putLearnedTheme).not.toHaveBeenCalled();
  });
  it('applies and announces a learned version while mounted', async () => {
    const onVersion = vi.fn(); submit(onVersion);
    await waitFor(() => expect(onVersion).toHaveBeenCalledWith(8));
    expect(putLearnedTheme).toHaveBeenCalledExactlyOnceWith('project', 'doc', learned.tokens, true);
  });
});
