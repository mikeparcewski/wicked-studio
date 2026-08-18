import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MODES } from '../src/hooks/useRoute.js';
import { MODE_SPECS, ModeSwitcher } from '../src/components/ModeSwitcher.js';

afterEach(cleanup);

describe('ModeSwitcher (DES-MERGE-001 §1.3)', () => {
  it('shows exactly four tabs, in mode order', () => {
    render(<ModeSwitcher mode="chat" onSelect={() => {}} />);
    const tabs = screen.getByTestId('mode-switcher').querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(4);
    expect([...tabs].map((t) => t.getAttribute('data-mode'))).toEqual(['chat', 'build', 'document', 'video']);
    expect([...tabs].map((t) => t.textContent)).toEqual(['Chat', 'Build', 'Document', 'Video']);
  });

  it('marks the active mode selected', () => {
    render(<ModeSwitcher mode="build" onSelect={() => {}} />);
    expect(screen.getByTestId('mode-tab-build')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mode-tab-chat')).toHaveAttribute('aria-selected', 'false');
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
