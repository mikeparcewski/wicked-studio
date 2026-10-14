import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/client.js', () => ({ api: { getRunEvents: vi.fn(async () => ({ events: [] })) }, apiBase: () => 'http://x/api/v1' }));

import { DeskHappening } from '../src/components/desk/DeskHappening.js';
import { resetDeskStream, useDeskStream } from '../src/store/deskStream.js';
import type { CoreEvent } from '../src/api/types.js';

/**
 * r7 #1: Happening now glides back to the newest event as events arrive, holds still while hovered,
 * and jumps (no smooth scroll) under reduced motion.
 */
const frame = (n: number): CoreEvent => ({ type: 'unitDone', session: 'r1', ord: n, ts: Date.now() + n } as unknown as CoreEvent);

function mount(): HTMLElement {
  // The list shows once there is something in it.
  act(() => { useDeskStream.getState().ingest(frame(0)); });
  render(<DeskHappening runs={[]} runsShown={false} navigate={() => {}} now={Date.now()} title={() => 'Job'} pathOf={(id) => `/s/${id}`} agentName={(c) => c} />);
  return screen.getByTestId('desk-stream');
}

function motion(reduce: boolean): void {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

describe('Happening now scrolls to new events', () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    resetDeskStream();
    scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
    motion(false);
  });
  afterEach(() => { cleanup(); });

  it('glides to the top when an event arrives', () => {
    mount();
    scrollTo.mockClear();
    act(() => { useDeskStream.getState().ingest(frame(1)); });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('holds still while hovered and says how many wait', () => {
    const list = mount();
    act(() => { useDeskStream.getState().ingest(frame(1)); });
    fireEvent.mouseEnter(list);
    scrollTo.mockClear();
    act(() => { useDeskStream.getState().ingest(frame(2)); });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('desk-stream-waiting')).toHaveTextContent('1 new');
    fireEvent.mouseLeave(list);
    expect(scrollTo).toHaveBeenCalled();
  });

  it('jumps without animation under reduced motion', () => {
    motion(true);
    mount();
    scrollTo.mockClear();
    act(() => { useDeskStream.getState().ingest(frame(3)); });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });
});
