import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A document opened on the Made list (`?open=<doc>`, MadeOpen): Esc from full screen comes back to the card (the
 * shell's own Esc, DES §7.3); Esc on the card, or Close, closes it to the list — never while full screen holds the
 * Esc, never while this card's own Options group is open, never for an Esc something else spent (a menu, FullShell),
 * never from an input. Another page's left-over group does not hold it (codex h4-fix r1 P2).
 */

vi.mock('../src/components/session/ArtifactMorph.js', () => ({ ArtifactMorph: () => <div data-testid="morph-stub"><input data-testid="stub-input" /></div> }));
vi.mock('../src/components/editorHost/HostPanel.js', () => ({ HostPanel: () => <aside data-testid="host-panel" /> }));

const { MadeOpen } = await import('../src/components/everything/MadeOpen.js');
const { useHostChrome, useHostPanel, RUN_TAB } = await import('../src/editors/hostApi.js');
const { artifactKey, resetArtifactSizes, setArtifactSize } = await import('../src/store/artifactSizes.js');

const KEY = artifactKey('p1', 'notes', 'made');
const group = (key: string) => ({ key: `g::${key}`, binding: { artifactKey: key } }) as never;

beforeEach(() => {
  resetArtifactSizes();
  useHostChrome.setState({ navCollapsed: false, full: null, chatOpen: false, navBefore: false });
  useHostPanel.setState({ group: null, tab: RUN_TAB, folded: false });
});
afterEach(() => { cleanup(); resetArtifactSizes(); });

function mount(): ReturnType<typeof vi.fn> {
  const onClose = vi.fn();
  render(<MadeOpen projectId="p1" docId="notes" title="Notes" style={null} onClose={onClose} />);
  return onClose;
}
const esc = (target: Element | Document = document.body): void => { fireEvent.keyDown(target, { key: 'Escape' }); };

describe('MadeOpen: Esc goes back one step', () => {
  it('not while the deep link is about to open full screen, nor while it is full screen; on the card it closes', () => {
    const onClose = mount();
    esc(); // the size store says full, the shell has not opened yet
    expect(onClose).not.toHaveBeenCalled();
    act(() => useHostChrome.getState().enterFull(KEY));
    esc();
    expect(onClose).not.toHaveBeenCalled();
    act(() => { useHostChrome.getState().exitFull(); setArtifactSize(KEY, 'inline'); });
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an Esc something else spent, or one typed in an input, does not close', () => {
    const onClose = mount();
    act(() => setArtifactSize(KEY, 'inline'));
    const spent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    spent.preventDefault();
    document.body.dispatchEvent(spent);
    esc(screen.getByTestId('stub-input'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('its own Options group holds the Esc and shows the panel; another page\'s left-over group does not', () => {
    const onClose = mount();
    act(() => setArtifactSize(KEY, 'inline'));
    act(() => useHostPanel.setState({ group: group(KEY) }));
    expect(screen.getByTestId('host-panel')).toBeTruthy();
    esc();
    expect(onClose).not.toHaveBeenCalled();
    act(() => useHostPanel.setState({ group: group('r1:p2/other') }));
    expect(screen.queryByTestId('host-panel')).toBeNull();
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Close closes, and its own group goes with it', () => {
    const onClose = mount();
    act(() => useHostPanel.setState({ group: group(KEY) }));
    fireEvent.click(screen.getByTestId('everything-made-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    expect(useHostPanel.getState().group).toBeNull();
  });
});
