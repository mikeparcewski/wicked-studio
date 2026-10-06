import { describe, expect, it, vi } from 'vitest';
import { focusPlayerOnEntry } from '../src/components/session/WalkthroughEditor.js';

/**
 * studio#509, the keyboard half: a Tab / Shift+Tab into the player lands on one of the native
 * controls' buttons, inside Chromium's UA shadow tree, from where no key event reaches the page. The
 * retargeted focus event on the `<video>` is the one moment the page sees, so an entry from OUTSIDE
 * re-points the focus at the player itself; a focus that is already the player's (or a move between
 * its controls, which Chromium reports with the player as `relatedTarget` when it reports it at all)
 * is left alone.
 */

function event(currentTarget: HTMLVideoElement, relatedTarget: Element | null): React.FocusEvent<HTMLMediaElement> {
  return { currentTarget, relatedTarget, target: currentTarget } as unknown as React.FocusEvent<HTMLMediaElement>;
}

describe('focusPlayerOnEntry (studio#509)', () => {
  it('an entry from outside the player re-points the focus at the player itself', () => {
    const video = document.createElement('video');
    const focus = vi.spyOn(video, 'focus');
    const mark = document.createElement('button');
    focusPlayerOnEntry(event(video, mark));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('an entry from nowhere (the document body) too', () => {
    const video = document.createElement('video');
    const focus = vi.spyOn(video, 'focus');
    focusPlayerOnEntry(event(video, null));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('a move whose origin is the player itself is left alone', () => {
    const video = document.createElement('video');
    const focus = vi.spyOn(video, 'focus');
    focusPlayerOnEntry(event(video, video));
    expect(focus).not.toHaveBeenCalled();
  });
});
