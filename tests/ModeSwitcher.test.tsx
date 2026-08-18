import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MODES } from '../src/hooks/useRoute.js';
import { MODE_SPECS, ModeSwitcher } from '../src/components/ModeSwitcher.js';
import { ModePlaceholder } from '../src/components/ModePlaceholder.js';

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

  it('DISABLES an unavailable mode instead of hiding it, and names the enabling action', () => {
    render(<ModeSwitcher mode="chat" onSelect={() => {}} />);
    for (const m of MODES) {
      const tab = screen.getByTestId(`mode-tab-${m}`);
      // Rule 3: never hidden — every mode is on screen whether or not it is available.
      expect(tab).toBeInTheDocument();
      if (MODE_SPECS[m].available) continue;
      expect(tab).toBeDisabled();
      expect(tab).toHaveAttribute('title', expect.stringMatching(/install|connect|create/i));
    }
  });

  it('does not fire onSelect for a disabled mode', () => {
    const onSelect = vi.fn();
    render(<ModeSwitcher mode="chat" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('mode-tab-video'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('ModePlaceholder (§3.3 — every state names a subject)', () => {
  // Document left the placeholder in slice 8 (§6.3) — Video is the only mode still on it.
  it('states what the mode is and the one action that enables it', () => {
    render(<ModePlaceholder mode="video" />);
    const card = screen.getByTestId('mode-placeholder-video');
    expect(card).toHaveTextContent(/storyboard/i);
    expect(screen.getByTestId('mode-enabling-action-video')).toHaveTextContent(/install/i);
  });

  it('carries the SAME enabling action as the disabled tab tooltip — one source of truth', () => {
    render(<ModePlaceholder mode="video" />);
    expect(screen.getByTestId('mode-enabling-action-video')).toHaveTextContent(MODE_SPECS.video.enables);
  });

  it('renders no spinner and no subject-less status', () => {
    const { container } = render(<ModePlaceholder mode="video" />);
    expect(container.querySelector('[class*="spin"], [class*="animate-"]')).toBeNull();
    expect(container.textContent).not.toMatch(/^\s*(working|loading)…?\s*$/i);
  });
});
