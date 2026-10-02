import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';

import {
  decideTyped,
  isTypedCharacter,
  peekTypedSeed,
  takeTypedSeed,
  useTypeToComposer,
} from '../src/hooks/useTypeToComposer.js';
import { setShortcutsPaletteOpen } from '../src/hooks/useGlobalShortcuts.js';
import { useLayerStore } from '../src/store/layers.js';

/**
 * DES-STUDIO-REBUILD-001 §5.6 rule 4 (slice S2b): letters always type. A printable key with
 * no modifier, with focus outside any editable and outside a key-claiming composite, lands in
 * a composer — the open Ask dock, else the page's composer, else the Ask dock opened with it.
 * The gate card's steer box (whose send approves) never opts in: typing never answers a gate.
 */

const key = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

/** What a browser does with a keystroke the page did not prevent: type it into the focused field. */
function typeLikeABrowser(text: string): void {
  for (const ch of text) {
    const target = (document.activeElement ?? document.body) as HTMLElement;
    const e = key({ key: ch });
    act(() => { target.dispatchEvent(e); });
    const el = document.activeElement;
    if (!e.defaultPrevented && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      act(() => {
        setter?.call(el, el.value + ch);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
  }
}

function Composer({ testid, target }: { testid: string; target?: 'page' | 'ask' }): React.ReactElement {
  const [v, setV] = useState('');
  return (
    <textarea
      data-testid={testid}
      {...(target !== undefined ? { 'data-type-target': target } : {})}
      value={v}
      onChange={(e) => setV(e.target.value)}
    />
  );
}

function Harness({ openAsk, page = true, gateBox = true }: { openAsk: () => void; page?: boolean; gateBox?: boolean }): React.ReactElement {
  useTypeToComposer(openAsk);
  return (
    <div>
      <div data-testid="card" tabIndex={0} data-kbd-item="beta">a card</div>
      <button type="button" data-testid="approve" onClick={() => { throw new Error('approve pressed'); }}>Approve</button>
      {/* The gate card's steer box: its send approves, so it never opts in. */}
      {gateBox && <Composer testid="gate-composer" />}
      {page && <Composer testid="page-composer" target="page" />}
      <div role="radiogroup" data-testid="radios">
        <button type="button" role="radio" aria-checked="true" data-testid="radio-1">One</button>
      </div>
    </div>
  );
}

beforeEach(() => {
  takeTypedSeed();
  setShortcutsPaletteOpen(false);
  useLayerStore.setState({ shortcutOverlayOpen: false, modalIds: [] });
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('isTypedCharacter — the printable-key predicate', () => {
  it('a letter, a capital, a digit and a symbol type; Space, named keys and modified chords do not', () => {
    for (const k of ['a', 'A', '1', '?', '/', 'é']) expect(isTypedCharacter(key({ key: k })), k).toBe(true);
    expect(isTypedCharacter(key({ key: 'A', shiftKey: true }))).toBe(true);
    for (const k of [' ', 'Enter', 'Escape', 'ArrowDown', 'Tab', 'Dead']) expect(isTypedCharacter(key({ key: k })), k).toBe(false);
    expect(isTypedCharacter(key({ key: 'a', altKey: true }))).toBe(false);
    expect(isTypedCharacter(key({ key: 'k', metaKey: true }))).toBe(false);
    expect(isTypedCharacter(key({ key: 'k', ctrlKey: true }))).toBe(false);
  });
});

describe('type-to-composer (§5.6 rule 4)', () => {
  it('with body focus, "approve this" lands in the page composer — never in the gate steer box', () => {
    const openAsk = vi.fn();
    render(<Harness openAsk={openAsk} />);
    (document.activeElement as HTMLElement | null)?.blur();
    typeLikeABrowser('approve this');
    expect((screen.getByTestId('page-composer') as HTMLTextAreaElement).value).toBe('approve this');
    expect((screen.getByTestId('gate-composer') as HTMLTextAreaElement).value).toBe('');
    expect(document.activeElement).toBe(screen.getByTestId('page-composer'));
    expect(openAsk).not.toHaveBeenCalled();
  });

  it('a focused card or button no longer swallows letters', () => {
    render(<Harness openAsk={vi.fn()} />);
    screen.getByTestId('card').focus();
    typeLikeABrowser('ab');
    expect((screen.getByTestId('page-composer') as HTMLTextAreaElement).value).toBe('ab');

    act(() => { screen.getByTestId('approve').focus(); });
    typeLikeABrowser('cd'); // a throw in the button's onClick would fail this test
    expect((screen.getByTestId('page-composer') as HTMLTextAreaElement).value).toBe('abcd');
  });

  it('with no page composer, the letters open the Ask dock and wait in its seed', () => {
    const openAsk = vi.fn();
    render(<Harness openAsk={openAsk} page={false} />);
    (document.activeElement as HTMLElement | null)?.blur();
    typeLikeABrowser('hi');
    expect(openAsk).toHaveBeenCalled();
    expect(peekTypedSeed()).toBe('hi');
    expect(takeTypedSeed()).toBe('hi');
    expect(peekTypedSeed()).toBe('');
    expect((screen.getByTestId('gate-composer') as HTMLTextAreaElement).value).toBe('');
  });

  it('the open Ask dock wins over the page composer', () => {
    render(
      <>
        <Harness openAsk={vi.fn()} />
        <Composer testid="assist-input" target="ask" />
      </>,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    typeLikeABrowser('q');
    expect((screen.getByTestId('assist-input') as HTMLTextAreaElement).value).toBe('q');
    expect((screen.getByTestId('page-composer') as HTMLTextAreaElement).value).toBe('');
  });

  it('a busy open dock (send in flight) takes nothing, and nothing falls through to the page or a seed (codex review)', () => {
    const openAsk = vi.fn();
    render(
      <>
        <Harness openAsk={openAsk} />
        <textarea data-testid="assist-input" data-type-target="ask" disabled defaultValue="" />
      </>,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    typeLikeABrowser('q');
    expect((screen.getByTestId('page-composer') as HTMLTextAreaElement).value).toBe('');
    expect(peekTypedSeed()).toBe('');
    expect(openAsk).not.toHaveBeenCalled();
  });

  it('a composer inside a hidden region is not the page composer (codex review)', () => {
    const openAsk = vi.fn();
    render(
      <>
        <Harness openAsk={openAsk} page={false} />
        <div hidden><Composer testid="hidden-composer" target="page" /></div>
        <div aria-hidden="true"><Composer testid="aria-hidden-composer" target="page" /></div>
      </>,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    typeLikeABrowser('q');
    expect((screen.getByTestId('hidden-composer') as HTMLTextAreaElement).value).toBe('');
    expect(openAsk).toHaveBeenCalled(); // no composer on screen → the Ask dock
    expect(takeTypedSeed()).toBe('q');
  });

  it('inside a focused composite, letters and digits stay with it (rule 2)', () => {
    const openAsk = vi.fn();
    render(<Harness openAsk={openAsk} />);
    screen.getByTestId('radio-1').focus();
    const e1 = key({ key: '1' });
    const ex = key({ key: 'x' });
    act(() => { screen.getByTestId('radio-1').dispatchEvent(e1); });
    act(() => { screen.getByTestId('radio-1').dispatchEvent(ex); });
    expect(e1.defaultPrevented || ex.defaultPrevented).toBe(false);
    expect((screen.getByTestId('page-composer') as HTMLTextAreaElement).value).toBe('');
    expect(document.activeElement).toBe(screen.getByTestId('radio-1'));
    expect(openAsk).not.toHaveBeenCalled();
  });

  it('typing in an editable, Space, modified chords, and an owning layer are all left alone', () => {
    const openAsk = vi.fn();
    render(<Harness openAsk={openAsk} />);
    const gateBox = screen.getByTestId('gate-composer') as HTMLTextAreaElement;
    gateBox.focus();
    typeLikeABrowser('ok'); // the operator's own typing in the steer box stays there
    expect(gateBox.value).toBe('ok');
    expect((screen.getByTestId('page-composer') as HTMLTextAreaElement).value).toBe('');

    act(() => { screen.getByTestId('card').focus(); });
    for (const init of [{ key: ' ' }, { key: 'a', altKey: true, code: 'KeyA' }, { key: 'k', metaKey: true }]) {
      expect(decideTyped(key(init)).kind, JSON.stringify(init)).toBe('none');
    }
    setShortcutsPaletteOpen(true);
    expect(decideTyped(key({ key: 'a' })).kind).toBe('none');
    setShortcutsPaletteOpen(false);
    useLayerStore.setState({ modalIds: [1] });
    expect(decideTyped(key({ key: 'a' })).kind).toBe('none');
    useLayerStore.setState({ modalIds: [], shortcutOverlayOpen: true });
    expect(decideTyped(key({ key: 'a' })).kind).toBe('none');
    useLayerStore.setState({ shortcutOverlayOpen: false });
    expect(decideTyped(key({ key: 'a' })).kind).toBe('type');
    expect(openAsk).not.toHaveBeenCalled();
  });
});
