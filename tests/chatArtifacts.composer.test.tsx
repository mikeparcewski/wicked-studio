import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerSend } from '../src/components/session/Composer.js';
import { addAboutChip, useComposerChips } from '../src/store/composerChips.js';
import { registerInView, resetInView } from '../src/store/artifactInView.js';
import { artifactChip } from '../src/board/aboutChips.js';
import { setCachedRoster } from '../src/store/rosterCache.js';

/** DES-CHAT-ARTIFACTS-001 §5.1 (A1): the session composer hands its message over with the artifact it is about — the
 *  chip's (with the parts selected in it), else the card its surface shows — so the chat names it. */

function Harness({ onSend }: { onSend: (m: string, o: ComposerSend) => void }): React.ReactElement {
  const [text, setText] = useState('');
  return <Composer composerKey="s1" text={text} setText={setText} onSend={onSend} runs={[]} placeholder="p" ariaLabel="a" variant="session" navigate={() => {}} />;
}

function sendText(text: string): void {
  const box = screen.getByTestId('session-composer-input') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

const place = (ref: string, composerKey: string): void => {
  registerInView({ key: `k:${ref}`, ref, title: 't', composerKey, surface: () => 'inline', shown: () => 2, flush: async () => 2 });
};

beforeEach(() => {
  resetInView();
  useComposerChips.setState({ byComposer: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the session composer hands its artifact over', () => {
  it('the chip’s artifact and the parts selected in it', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    addAboutChip('s1', artifactChip('mikes/deck', 'Deck'));
    addAboutChip('s1', { kind: 'about', key: 'el:deck/w4', label: 'slide 4', ref: 'mikes/deck', wid: 'w4' });
    sendText('what does it say?');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toBe('About Deck and slide 4: what does it say?');
    expect(onSend.mock.calls[0]![1]).toMatchObject({ artifact: { ref: 'mikes/deck', anchors: ['w4'], composerKey: 's1' } });
  });

  it('else the card this composer’s surface shows; nothing when none is', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    sendText('hello');
    expect(onSend.mock.calls[0]![1]).not.toHaveProperty('artifact');
    place('mikes/page', 's1');
    place('mikes/other', 'someone-else');
    sendText('and this page?');
    expect(onSend.mock.calls[1]![1]).toMatchObject({ artifact: { ref: 'mikes/page', anchors: [], composerKey: 's1' } });
  });
});
