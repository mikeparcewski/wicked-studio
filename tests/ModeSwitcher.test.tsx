import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MODES } from '../src/hooks/useRoute.js';
import { MODE_SPECS, ModeSwitcher } from '../src/components/ModeSwitcher.js';

afterEach(cleanup);

describe('ModeSwitcher (DES-MERGE-001 §1.3)', () => {
  it('shows exactly four segments, in mode order, each glyph + label (§2.5 rule 4)', () => {
    render(<ModeSwitcher mode="chat" onSelect={() => {}} />);
    const tabs = screen.getByTestId('mode-switcher').querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(4);
    expect([...tabs].map((t) => t.getAttribute('data-mode'))).toEqual(['chat', 'build', 'document', 'video']);
    // Each segment carries the mode's glyph AND its label — the same four symbols
    // the board quick actions and doc tiles use (the spine, DES-UXFIX-001 §2.5).
    expect([...tabs].map((t) => t.textContent)).toEqual(
      MODES.map((m) => `${MODE_SPECS[m].glyph}${MODE_SPECS[m].label}`),
    );
  });

  it('marks the active mode selected', () => {
    render(<ModeSwitcher mode="build" onSelect={() => {}} />);
    expect(screen.getByTestId('mode-tab-build')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mode-tab-chat')).toHaveAttribute('aria-selected', 'false');
  });

  it('fills the active segment and greys none of the rest — F8, the weight fix (§2.5)', () => {
    render(<ModeSwitcher mode="document" onSelect={() => {}} />);
    // The slice-4 DOM AC verbatim: the active segment's background is FILLED,
    // not transparent — the switcher reads as a control, not as text links.
    const ACCENT = /#ffda19|rgb\(255,\s*218,\s*25\)/;
    const active = screen.getByTestId('mode-tab-document');
    expect(active.style.background).toMatch(ACCENT);
    const inactive = screen.getByTestId('mode-tab-chat');
    expect(inactive.style.background).not.toMatch(ACCENT);
    expect(inactive.style.background).not.toBe('transparent');
  });

  it('keeps the active mode’s summary ON SCREEN, not tooltip-only (§2.5 rule 2)', () => {
    render(<ModeSwitcher mode="chat" onSelect={() => {}} />);
    const summary = screen.getByTestId('mode-summary');
    expect(summary).toHaveTextContent(MODE_SPECS.chat.summary);
  });

  it('the summary follows the active mode', () => {
    const { rerender } = render(<ModeSwitcher mode="chat" onSelect={() => {}} />);
    rerender(<ModeSwitcher mode="video" onSelect={() => {}} />);
    expect(screen.getByTestId('mode-summary')).toHaveTextContent(MODE_SPECS.video.summary);
  });

  it('selects a mode on click', () => {
    const onSelect = vi.fn();
    render(<ModeSwitcher mode="chat" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('mode-tab-build'));
    expect(onSelect).toHaveBeenCalledWith('build');
  });

  it('every mode is a live tab — slice 13 retired the disabled/placeholder path', () => {
    const onSelect = vi.fn();
    render(<ModeSwitcher mode="chat" onSelect={onSelect} />);
    for (const m of MODES) {
      const tab = screen.getByTestId(`mode-tab-${m}`);
      // Rule 3 was never "hide it": every mode is on screen, and now every one of them
      // has a real surface behind it (Video landed in slice 13). A mode that genuinely
      // cannot open is slice 17's preflight gate — which knows what is installed.
      expect(tab).toBeInTheDocument();
      expect(tab).toBeEnabled();
      // §3.3: the tooltip names what the mode IS, with its subject — never "coming soon".
      expect(tab).toHaveAttribute('title', MODE_SPECS[m].summary);
      expect(MODE_SPECS[m].summary).not.toMatch(/coming soon|not connected/i);
    }
    fireEvent.click(screen.getByTestId('mode-tab-video'));
    expect(onSelect).toHaveBeenCalledWith('video');
  });
});
