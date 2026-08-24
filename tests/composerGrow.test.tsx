// The growing doc composer (operator feedback, doc-surface round): the chat box
// expands with its content from ONE line to a FIVE-line cap, then scrolls —
// "can't stay one line". growComposer is the one measuring function; the
// DocumentThread textarea re-runs it on every text change.
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import {
  COMPOSER_LINE_PX, COMPOSER_MAX_LINES, DocumentThread, growComposer,
} from '../src/components/DocumentThread.js';

/** A textarea whose scrollHeight is scriptable — jsdom does no layout. */
function fakeArea(scrollHeight: number): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  return el;
}

afterEach(cleanup);

describe('growComposer — 1 line minimum, 5 lines maximum, scroll past that', () => {
  it('one line of content keeps a one-line box, no scrollbar', () => {
    const el = fakeArea(COMPOSER_LINE_PX);
    growComposer(el);
    expect(el.style.height).toBe(`${COMPOSER_LINE_PX}px`);
    expect(el.style.overflowY).toBe('hidden');
  });

  it('grows to fit content between the bounds (3 lines → 3 lines tall)', () => {
    const el = fakeArea(3 * COMPOSER_LINE_PX);
    growComposer(el);
    expect(el.style.height).toBe(`${3 * COMPOSER_LINE_PX}px`);
    expect(el.style.overflowY).toBe('hidden');
  });

  it('clamps at COMPOSER_MAX_LINES and switches to its own scroll', () => {
    const el = fakeArea(9 * COMPOSER_LINE_PX);
    growComposer(el);
    expect(el.style.height).toBe(`${COMPOSER_MAX_LINES * COMPOSER_LINE_PX}px`);
    expect(el.style.overflowY).toBe('auto');
  });

  it('a jsdom-style zero scrollHeight still floors at one line — never a 0px box', () => {
    const el = fakeArea(0);
    growComposer(el);
    expect(el.style.height).toBe(`${COMPOSER_LINE_PX}px`);
  });

  it('the cap is the operator’s number: five lines', () => {
    expect(COMPOSER_MAX_LINES).toBe(5);
  });
});

describe('DocumentThread — the composer wears the growth wiring', () => {
  it('re-measures on every change (height set from scrollHeight, capped)', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no wire in this test'))));
    render(
      <DocumentThread projectId="p1" docId={null} selectedVersion={null} navigate={() => {}} />,
    );
    const area = screen.getByTestId('doc-composer') as HTMLTextAreaElement;
    expect(area.getAttribute('data-max-lines')).toBe(String(COMPOSER_MAX_LINES));
    // Simulate real layout: content is 7 lines tall.
    Object.defineProperty(area, 'scrollHeight', {
      configurable: true, get: () => 7 * COMPOSER_LINE_PX,
    });
    fireEvent.change(area, { target: { value: 'a\nb\nc\nd\ne\nf\ng' } });
    expect(area.style.height).toBe(`${COMPOSER_MAX_LINES * COMPOSER_LINE_PX}px`);
    expect(area.style.overflowY).toBe('auto');
    vi.unstubAllGlobals();
  });
});
