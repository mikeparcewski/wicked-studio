/**
 * studio#1162 D13: with the voice setup banner showing, the transcript must not be squeezed into a sliver. jsdom does no
 * layout, so this asserts the DOM structure and the CSS source that produce the layout (banner and transcript frame are
 * flex siblings in one column; the frame takes the remaining height; only the scroller inside it scrolls). The visual proof
 * is the before/after screenshots in the PR.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { VoiceFullScreen } from '../src/components/voice/VoiceFullScreen.js';
import { resetVoice } from '../src/voice/controller.js';
import { useVoiceStore } from '../src/store/voice.js';

const css = readFileSync(resolve(process.cwd(), 'src/styles/sections/voice.css'), 'utf8');
const rule = (selector: string): string => {
  const esc = selector.replace(/[.>]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (m === null) throw new Error(`no rule for ${selector}`);
  return m[1]!;
};

afterEach(() => { cleanup(); resetVoice(); vi.restoreAllMocks(); });

describe('voice full screen layout with the setup banner', () => {
  it('puts the banner and the transcript frame side by side in the centre column, scroller inside the frame', () => {
    useVoiceStore.setState({
      phase: 'full', micOn: true, statusError: 'The speech engine could not be checked.',
      lines: [{ id: 1, who: 'it', text: 'You are in voice mode.' }],
    } as never);
    render(<VoiceFullScreen />);
    const banner = screen.getByTestId('voice-setup');
    const frame = screen.getByTestId('voice-trans-frame');
    const scroller = screen.getByTestId('voice-trans');
    expect(banner.parentElement).toBe(frame.parentElement);
    expect(banner.parentElement?.className).toBe('wk-voice-center');
    expect(scroller.parentElement).toBe(frame);
  });

  it('banner keeps its natural height; the frame takes the rest and the scroller scrolls inside it', () => {
    expect(rule('.wk-voice-center > .wk-voice-setup')).toMatch(/flex:\s*0 0 auto/);
    expect(rule('.wk-voice-center > .wk-voice-setup')).toMatch(/max-height:\s*40vh/);
    expect(rule('.wk-voice-center > .wk-voice-setup')).toMatch(/overflow-y:\s*auto/);
    const frameCss = rule('.wk-voice-trans-frame');
    expect(frameCss).toMatch(/flex:\s*1 1 auto/);
    expect(frameCss).toMatch(/min-height:\s*0/);
    expect(frameCss).toMatch(/padding:\s*16px 18px/);
    const scrollCss = rule('.wk-voice-trans');
    expect(scrollCss).toMatch(/flex:\s*1 1 auto/);
    expect(scrollCss).toMatch(/min-height:\s*0/);
    expect(scrollCss).toMatch(/overflow-y:\s*auto/);
    // The card padding lives on the frame: only a 4px focus gutter (offset by a -4px margin) stays on the scroller.
    expect(scrollCss).toMatch(/padding:\s*4px/);
    expect(scrollCss).toMatch(/margin:\s*-4px/);
    // Nothing overlays the transcript: no rule for the banner or the frame positions them out of flow.
    for (const m of css.matchAll(/([^{}]*wk-voice-(?:setup|trans-frame)[^{}]*)\{([^}]*)\}/g)) expect(m[2]).not.toMatch(/position:\s*(absolute|fixed|sticky)/);
  });
});

describe('voice transcript new turns', () => {
  function sizes(): void {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
    useVoiceStore.setState({ phase: 'full', lines: [] });
  }

  it('keeps the first new line visible when a new turn is taller than the transcript', () => {
    sizes();
    render(<VoiceFullScreen />);
    act(() => useVoiceStore.setState({ lines: [
      { id: 1, who: 'it', text: 'Around us is what is happening now.' },
      { id: 2, who: 'it', text: 'How should I listen?' },
    ] }));
    expect(screen.getByTestId('voice-trans').scrollTop).toBe(0);
  });

  it('scrolls to the bottom when the new lines fit in the transcript', () => {
    sizes();
    useVoiceStore.setState({ lines: [{ id: 1, who: 'you', text: 'Earlier turn' }] });
    render(<VoiceFullScreen />);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.classList.contains('wk-voice-line') ? 750 : 0 } as DOMRect;
    });
    act(() => useVoiceStore.setState({ lines: [
      ...useVoiceStore.getState().lines,
      { id: 2, who: 'it', text: 'A short reply.' },
    ] }));
    expect(screen.getByTestId('voice-trans').scrollTop).toBe(600);
  });

  it('uses viewport positions and existing scroll when line and scroller have different offset parents', () => {
    sizes();
    useVoiceStore.setState({ lines: [{ id: 1, who: 'you', text: 'Earlier turn' }] });
    render(<VoiceFullScreen />);
    const scroller = screen.getByTestId('voice-trans');
    scroller.scrollTop = 200;
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.classList.contains('wk-voice-line') ? 250 : 100 } as DOMRect;
    });
    act(() => useVoiceStore.setState({ lines: [
      ...useVoiceStore.getState().lines,
      { id: 2, who: 'it', text: 'A reply taller than the remaining space.' },
    ] }));
    expect(scroller.scrollTop).toBe(350);
  });

  it('lets the transcript frame fill the column without a viewport height cap', () => {
    expect(rule('.wk-voice-trans-frame')).not.toMatch(/max-height:/);
  });
});
