// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_DECK } from '../src/editors/fakeAdapter.js';

async function bootDeck(): Promise<void> {
  document.body.replaceChildren();
  const port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(message: { type?: string; id?: string }): void {
      if (message.type !== 'artifact.read') return;
      queueMicrotask(() => port.onmessage?.(new MessageEvent('message', {
        data: {
          p: 'wicked.editor', v: 1, re: message.id, ok: true,
          payload: { version: 1, content: { type: 'html', html: SAMPLE_DECK } },
        },
      })));
    },
  };
  await import('../src/plugins/wicked-deck/plugin.js');
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: {
      p: 'wicked.editor', v: 1, type: 'host.hello',
      payload: { grants: ['artifact.read', 'artifact.write'], size: 'pane', theme: {} },
    },
    ports: [port],
  }));
  await vi.waitFor(() => expect(document.querySelector('[data-testid="deck-editor"]')).toHaveAttribute('data-head', '1'));
}

beforeAll(bootDeck);

describe('editor save markers', () => {
  it('marks the deck Notes toggle to reveal the save-on-blur field', () => {
    const toggle = document.querySelector('#notes-toggle');
    expect(toggle).toBeInstanceOf(HTMLButtonElement);
    expect(toggle).toHaveAttribute('data-wicked-reveal');
  });

  it('marks the deck speaker-notes textarea for the save-on-blur conformance path', () => {
    const notes = document.querySelector('[data-testid="deck-notes"]');
    expect(notes).toBeInstanceOf(HTMLTextAreaElement);
    expect(notes).not.toHaveAttribute('readonly');
    expect(notes).toHaveAttribute('data-wicked-save');
    expect(Array.from(document.querySelectorAll('[data-wicked-save]'))).toEqual([notes]);
  });
});
