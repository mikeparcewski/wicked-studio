import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { useChatWindow } from '../src/store/chatWindow.js';

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));
vi.mock('../src/hooks/useRuns.js', () => {
  const state = { runs: [], loaded: true, error: null, refresh: () => undefined };
  return { useRuns: () => state };
});

beforeEach(() => {
  useChatWindow.setState({ mode: 'closed' });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No daemon in shell test')));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function shell(phone: boolean, path: string): Promise<HTMLElement> {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: phone && q.includes('767'), media: q,
    addEventListener: () => undefined, removeEventListener: () => undefined,
  }));
  window.history.replaceState(null, '', path);
  await act(async () => { render(<App />); });
  return document.getElementById('main')!;
}

describe('the shell reserves the phone Ask bubble band', () => {
  it('marks main while the phone bubble is shown', async () => {
    const main = await shell(true, '/repos');
    expect(screen.getByTestId('ask-launcher')).toBeInTheDocument();
    expect(main).toHaveAttribute('data-ask-bubble', 'true');
  });

  it.each([
    ['desktop', false, '/repos'],
    ['session', true, '/s/chat-1'],
  ] as const)('%s leaves main unmarked with no bubble', async (_name, phone, path) => {
    const main = await shell(phone, path);
    expect(screen.queryByTestId('ask-launcher')).toBeNull();
    expect(main).not.toHaveAttribute('data-ask-bubble');
  });

  it('removes the reserved band when chat is minimized', async () => {
    const main = await shell(true, '/repos');
    expect(main).toHaveAttribute('data-ask-bubble', 'true');
    await act(async () => { useChatWindow.setState({ mode: 'minimized' }); });
    expect(screen.queryByTestId('ask-launcher')).toBeNull();
    expect(main).not.toHaveAttribute('data-ask-bubble');
  });
});
