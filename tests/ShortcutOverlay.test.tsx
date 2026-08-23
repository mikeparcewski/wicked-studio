import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutOverlay, chordLabel, overlayRows } from '../src/components/ShortcutOverlay.js';
import { registerShortcuts, type ShortcutEntry } from '../src/hooks/useGlobalShortcuts.js';
import { useLayerStore } from '../src/store/layers.js';

/**
 * DES-UX-001 §7.7 (slice AC, EC42) — the '?' overlay renders FROM the slice-G
 * registry's own registrations (never a hand list), '?' toggles it on any
 * surface, and Escape closes it FIRST in the layer chain.
 */

let unregister: (() => void) | null = null;

beforeEach(() => {
  useLayerStore.setState({ shortcutOverlayOpen: false, bellOpen: false });
});

afterEach(() => {
  unregister?.();
  unregister = null;
});

describe('overlayRows / chordLabel (the registry fold)', () => {
  it('groups by the entry group and folds same-description chords into one row', () => {
    const entries: ShortcutEntry[] = [
      { id: 'a1', chord: { key: 'j' }, group: 'triage', description: 'Next card', handler: () => {} },
      { id: 'a2', chord: { key: 'arrowdown' }, group: 'triage', description: 'Next card', handler: () => {} },
      { id: 'b', chord: { key: 'k', ctrlOrMeta: true }, group: 'palette', description: 'Open palette', handler: () => {} },
      { id: 'c', chord: { key: 'escape' }, description: 'Close something', handler: () => {} },
    ];
    const groups = overlayRows(entries);
    expect(groups.map((g) => g.group)).toEqual(['triage', 'palette', 'panels']);
    const triage = groups[0]!.rows;
    expect(triage).toHaveLength(1);
    expect(triage[0]!.keys).toEqual(['J', '↓']);
    // Untagged entries land under "panels" — nothing registered is ever omitted.
    expect(groups[2]!.rows[0]!.description).toBe('Close something');
  });

  it('spells chords the way they are typed', () => {
    expect(chordLabel({ key: 'k', ctrlOrMeta: true })).toBe('Ctrl/⌘+K');
    expect(chordLabel({ key: 'f', ctrlOrMeta: true, shift: true })).toBe('Ctrl/⌘+Shift+F');
    expect(chordLabel({ key: ' ' })).toBe('Space');
    expect(chordLabel({ key: 'escape' })).toBe('Esc');
    // '?' already spells its shift — never "Shift+?".
    expect(chordLabel({ key: '?', shift: true })).toBe('?');
  });
});

describe('ShortcutOverlay (the ? surface)', () => {
  it("'?' opens the overlay and it lists what the registry holds right now", () => {
    const spy = vi.fn();
    unregister = registerShortcuts([
      { id: 'test-key', chord: { key: 'g' }, group: 'gates', description: 'A registered test key', handler: spy },
    ]);
    render(<ShortcutOverlay />);
    expect(screen.queryByTestId('shortcut-overlay')).toBeNull();

    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(screen.getByTestId('shortcut-overlay')).toBeInTheDocument();
    // Registry-rendered, not hand-kept: the entry registered above is listed.
    expect(screen.getByTestId('shortcut-group-gates').textContent).toContain('A registered test key');
    // …and the overlay documents itself.
    expect(screen.getByText('Keyboard shortcuts (this overlay)')).toBeInTheDocument();
  });

  it("Escape closes the overlay (first rung of the §7.7 chain); '?' toggles", () => {
    render(<ShortcutOverlay />);
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(screen.getByTestId('shortcut-overlay')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('shortcut-overlay')).toBeNull();

    // layouts that emit '?' without shift open it too, and '?' closes it again
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('shortcut-overlay')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.queryByTestId('shortcut-overlay')).toBeNull();
  });

  it('never opens from a typing context (the one EC21 guard)', () => {
    render(
      <>
        <input data-testid="field" />
        <ShortcutOverlay />
      </>,
    );
    const field = screen.getByTestId('field');
    field.focus();
    fireEvent.keyDown(field, { key: '?', shiftKey: true });
    expect(screen.queryByTestId('shortcut-overlay')).toBeNull();
  });
});
