import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSurfaceAdapter } from '../src/editors/adapters/fake.js';
import {
  RUN_TAB, firstTabOf, groupKey, joinGroup, relay, replayGroupSelection, sameTab, useHostChrome, useHostPanel, type OptionsGroup,
} from '../src/editors/hostApi.js';
import type { Surfaces } from '../src/editors/surfaces.js';
import { FullShell } from '../src/components/editorHost/FullShell.js';
import { ControlsTab, HostPanel, swatchHex } from '../src/components/editorHost/HostPanel.js';
// The host's own Versions and Checks tabs register on import (as PluginCard imports them in the app).
import '../src/components/editorHost/hostTabs.js';

/** H2 — the host surfaces' own behaviour (HOST-API rev 2): the stores, the relay, the controls tab, the panel and the
 *  full-screen shell. The plugin side is the conformance journey's. */

const SURF: Surfaces = {
  card: { interactive: true, aspect: '16:9', actions: [] },
  options: { tabs: [
    { id: 'parts', label: 'Parts', render: 'plugin' },
    { id: 'look', label: 'Look', render: 'controls', controls: [{ id: 'caps', label: 'Captions', type: 'toggle' }] },
  ] },
  full: { modes: ['simple', 'advanced'], default: 'simple' },
};

function group(surfaces: Surfaces, protocol = 1): OptionsGroup {
  const adapter = new FakeSurfaceAdapter({ kind: 'page', title: 'T' });
  return {
    key: groupKey('acme-v2', 'k1'), binding: { artifactKey: 'k1', title: 'T', kind: 'page', source: 'fake', projectId: '', composerKey: 'c' },
    editor: { id: 'acme-v2', title: 'Sample', version: '0.1.0', sha256: 'a'.repeat(64), protocol: [1, 2], kinds: ['page'], sizes: ['inline'], first_party: false } as never,
    surfaces, protocol, src: 'about:blank', grants: [], adapter,
  };
}

function wide(narrow: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: narrow && q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

beforeEach(() => {
  useHostPanel.setState({ group: null, tab: RUN_TAB, folded: false });
  useHostChrome.setState({ navCollapsed: false, full: null, chatOpen: false, navBefore: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('host chrome: full screen collapses the nav and restores what it was', () => {
  it('collapses on enter and restores an open nav on exit', () => {
    useHostChrome.getState().enterFull('a');
    expect(useHostChrome.getState()).toMatchObject({ full: 'a', navCollapsed: true });
    useHostChrome.getState().exitFull();
    expect(useHostChrome.getState()).toMatchObject({ full: null, navCollapsed: false });
  });
  it('a nav that was already collapsed stays collapsed, also after switching artifacts', () => {
    useHostChrome.setState({ navCollapsed: true });
    useHostChrome.getState().enterFull('a');
    useHostChrome.getState().enterFull('b');
    useHostChrome.getState().exitFull();
    expect(useHostChrome.getState().navCollapsed).toBe(true);
  });
});

describe('host panel store: tabs by owner', () => {
  it('Options focuses the first plugin tab', () => {
    useHostPanel.getState().openGroup(group(SURF));
    expect(useHostPanel.getState().tab).toEqual({ owner: 'plugin', id: 'parts' });
  });
  it('with no plugin tab, Options focuses the first host tab, not Run (codex api-r1 P2)', () => {
    const g = group({ ...SURF, options: null });
    // The fake adapter earns no host tab: Run is the honest fallback.
    expect(firstTabOf(g)).toEqual(RUN_TAB);
    const caps = vi.spyOn(g.adapter, 'capabilities').mockReturnValue(['read', 'checks']);
    expect(firstTabOf(g)).toEqual({ owner: 'host', id: 'checks' });
    caps.mockRestore();
  });
  it('a plugin tab named "run" is not the Run tab (codex api-r1 P1)', () => {
    expect(sameTab({ owner: 'plugin', id: 'run' }, RUN_TAB)).toBe(false);
    expect(sameTab({ owner: 'host', id: 'checks' }, { owner: 'host', id: 'checks' })).toBe(true);
  });
  it('closing the group goes back to Run', () => {
    useHostPanel.getState().openGroup(group(SURF));
    useHostPanel.getState().closeGroup();
    expect(useHostPanel.getState()).toMatchObject({ group: null, tab: RUN_TAB });
  });
});

describe('the group relay', () => {
  it('replays the latest selection once connected, inside its group only', () => {
    const card = vi.fn(); const options = vi.fn(); const other = vi.fn();
    let connected = false;
    const offCard = joinGroup('late', 'card', card);
    relay('late', 'card', { type: 'selection', anchors: [{ kind: 'element', id: 'section-0' }] });
    const offOptions = joinGroup('late', 'options', options, () => connected);
    const offOther = joinGroup('other', 'options', other);
    const latest = { type: 'selection' as const, anchors: [{ kind: 'element' as const, id: 'section-2' }] };
    relay('late', 'card', latest);
    expect(options).not.toHaveBeenCalled();
    connected = true;
    replayGroupSelection('late', 'options');
    replayGroupSelection('late', 'options');
    expect(options).toHaveBeenCalledExactlyOnceWith(latest);
    expect(other).not.toHaveBeenCalled();
    offOther(); offOptions(); offCard();
  });

  it('does not replay a cleared selection or retain it after the last instance leaves', () => {
    const offCard = joinGroup('cleared', 'card', vi.fn());
    relay('cleared', 'card', { type: 'selection', anchors: [{ kind: 'element', id: 'section-2' }] });
    relay('cleared', 'card', { type: 'selection', anchors: [] });
    const options = vi.fn();
    const offOptions = joinGroup('cleared', 'options', options);
    expect(options).not.toHaveBeenCalled();
    relay('cleared', 'card', { type: 'selection', anchors: [{ kind: 'element', id: 'section-1' }] });
    offOptions(); offCard();
    const next = vi.fn();
    const offNext = joinGroup('cleared', 'card', next);
    expect(next).not.toHaveBeenCalled();
    offNext();
  });

  it('reaches the other instances of the same group only', () => {
    const a = vi.fn(); const b = vi.fn(); const other = vi.fn();
    const off = [joinGroup('g1', 'card', a), joinGroup('g1', 'options', b), joinGroup('g2', 'card', other)];
    relay('g1', 'card', { type: 'selection', anchors: [{ kind: 'element', id: 'x' }] });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith({ type: 'selection', anchors: [{ kind: 'element', id: 'x' }] });
    expect(other).not.toHaveBeenCalled();
    for (const f of off) f();
    relay('g1', 'card', { type: 'changed', head: 2, kind: 'fork' });
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('ControlsTab', () => {
  const tab = SURF.options!.tabs[1]!;
  it('shows pending, then the confirmed value', async () => {
    let done: (v: boolean) => void = () => undefined;
    const change = vi.fn(() => new Promise<boolean>((r) => { done = r; }));
    const { rerender } = render(<ControlsTab tab={tab} confirmed={{ caps: false }} change={change} />);
    fireEvent.click(screen.getByLabelText('Captions'));
    expect(screen.getByTestId('host-control').dataset['state']).toBe('pending');
    expect(change).toHaveBeenCalledWith('caps', true);
    await act(async () => { done(true); });
    rerender(<ControlsTab tab={tab} confirmed={{ caps: true }} change={change} />);
    expect(screen.getByTestId('host-control').dataset['state']).toBe('confirmed');
    expect((screen.getByLabelText('Captions') as HTMLInputElement).checked).toBe(true);
  });
  it('reverts to the confirmed value when the plugin refuses', async () => {
    const change = vi.fn(async () => false);
    render(<ControlsTab tab={tab} confirmed={{ caps: false }} change={change} />);
    await act(async () => { fireEvent.click(screen.getByLabelText('Captions')); });
    expect(screen.getByTestId('host-control').dataset['state']).toBe('reverted');
    expect((screen.getByLabelText('Captions') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Not changed')).toBeTruthy();
  });
});

describe('HostPanel', () => {
  it('wide: Run, the plugin tabs dot-marked, and × removes the group', () => {
    wide(false);
    render(<HostPanel runTab={<p>run body</p>} ribbon={<span>ribbon</span>} />);
    // The run's details alone are no choice of tabs: no strip until a plugin's options join them.
    expect(screen.queryAllByTestId('host-panel-tab')).toHaveLength(0);
    act(() => { useHostPanel.getState().openGroup(group(SURF)); });
    const tabs = screen.getAllByTestId('host-panel-tab');
    expect(tabs.map((t) => `${t.dataset['group']}:${t.dataset['tab']}`)).toEqual(['run:run', 'plugin:parts', 'plugin:look']);
    // A v1 group mounts no options frame: its plugin tab says it opens full screen.
    expect(screen.getByTestId('host-panel-v1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('host-panel-close'));
    expect(screen.queryAllByTestId('host-panel-tab')).toHaveLength(0);
    expect(screen.getByText('run body')).toBeTruthy();
  });
  it('a protocol-1 pane-only plugin (no full screen) gets its pane as the Options frame, not a dead end (codex fu r4)', () => {
    wide(false);
    render(<HostPanel runTab={<p>run body</p>} ribbon={<span>ribbon</span>} />);
    const paneOnly: Surfaces = { card: { interactive: false, aspect: '16:9', actions: [] }, options: { tabs: [{ id: 'editor', label: 'Editor', render: 'plugin' }] }, full: null };
    act(() => { useHostPanel.getState().openGroup(group(paneOnly)); });
    expect(screen.queryByTestId('host-panel-v1')).toBeNull();
    const frame = screen.getByTestId('host-panel-frame');
    expect(frame.hidden).toBe(false);
    // Run shown: the same frame stays mounted, hidden (codex fu r5 P2).
    act(() => { useHostPanel.getState().setTab(RUN_TAB); });
    expect(screen.getByTestId('host-panel-frame')).toBe(frame);
    expect(frame.hidden).toBe(true);
  });
  it('below 1200 px it is the ribbon, which opens the panel', () => {
    wide(true);
    render(<HostPanel runTab={<p>run body</p>} ribbon={<span>ribbon line</span>} />);
    expect(screen.queryByTestId('host-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('host-panel-ribbon'));
    expect(screen.getByTestId('host-panel').dataset['narrow']).toBe('true');
  });
});

describe('FullShell', () => {
  it('keeps the frame in the same node open and closed (the iframe never re-parents)', () => {
    const onExit = vi.fn();
    const { rerender } = render(<FullShell open={false} tag="Sample" title="T" onExit={onExit}><div data-testid="frame" /></FullShell>);
    const node = screen.getByTestId('frame');
    rerender(<FullShell open tag="Sample" title="T" onExit={onExit} modes={['simple', 'advanced']} mode="simple" chat={<p>chat</p>}><div data-testid="frame" /></FullShell>);
    expect(screen.getByTestId('frame')).toBe(node);
    rerender(<FullShell open={false} tag="Sample" title="T" onExit={onExit}><div data-testid="frame" /></FullShell>);
    expect(screen.getByTestId('frame')).toBe(node);
  });
  it('Simple/Advanced only when declared; Chat only with a drawer; Esc exits', () => {
    const onExit = vi.fn(); const onMode = vi.fn();
    const { rerender } = render(<FullShell open tag="Sample" title="T" onExit={onExit}><div /></FullShell>);
    expect(screen.queryAllByTestId('full-shell-mode')).toHaveLength(0);
    expect(screen.queryByTestId('full-shell-chat')).toBeNull();
    rerender(<FullShell open tag="Sample" title="T" onExit={onExit} modes={['simple', 'advanced']} mode="simple" onMode={onMode} chat={<p>the thread</p>}><div /></FullShell>);
    fireEvent.click(screen.getAllByTestId('full-shell-mode')[1]!);
    expect(onMode).toHaveBeenCalledWith('advanced');
    expect(screen.queryByTestId('full-shell-drawer')).toBeNull();
    fireEvent.click(screen.getByTestId('full-shell-chat'));
    expect(screen.getByTestId('full-shell-drawer').textContent).toContain('the thread');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onExit).toHaveBeenCalled();
  });
});

describe('composer bridge (ev2-ports follow-ups)', () => {
  it('elements and chapters both become about: chips in the host words', async () => {
    const { chipsToComposer } = await import('../src/components/editorHost/composerBridge.js');
    const { useComposerChips } = await import('../src/store/composerChips.js');
    chipsToComposer({ artifactKey: 'k', title: 'T', kind: 'demo-video', source: 'fake', projectId: 'p', docId: 'd', composerKey: 'ck' }, [
      { anchor: { kind: 'element', id: 'hero' }, label: 'the hero heading' },
      { anchor: { kind: 'chapter', id: 'c2' }, label: 'Enter the bill' },
    ]);
    const chips = JSON.stringify(useComposerChips.getState());
    expect(chips).toContain('el:d/hero');
    expect(chips).toContain('ch:d/c2');
    expect(chips).toContain('Enter the bill');
  });
  it('without a plugin group the panel is headed Details, with no one-tab strip (one name for one panel)', () => {
    wide(false);
    render(<HostPanel runTab={<p>run body</p>} ribbon={<span>r</span>} />);
    expect(screen.getByTestId('host-panel-heading')).toHaveTextContent('Details');
    expect(screen.queryAllByTestId('host-panel-tab')).toHaveLength(0);
    act(() => { useHostPanel.getState().openGroup(group(SURF)); });
    expect(screen.getAllByTestId('host-panel-tab')[0]).toHaveTextContent('Details');
  });
});

describe('a colour control shows the colour it holds', () => {
  it('converts #rgb and rgb() (the studio skin resolved to plain colours), never black for a real colour', () => {
    expect(swatchHex('#1A2B3C')).toBe('#1a2b3c');
    expect(swatchHex('#abc')).toBe('#aabbcc');
    expect(swatchHex('rgb(17, 24, 39)')).toBe('#111827');
    expect(swatchHex('rgba(255,255,255,0.5)')).toBe('#ffffff');
    expect(swatchHex('rgb(17 24 39 / 50%)')).toBe('#111827');
    expect(swatchHex('rgb(100%, 0%, 0%)')).toBe('#ff0000');
    expect(swatchHex('rgb(17.5, 24, 39)')).toBe('#121827');
    expect(swatchHex('rgb(.5, 24, 39)')).toBe('#011827');
    expect(swatchHex('rgb(50%, 50%, 50%)')).toBe('#808080');
    expect(swatchHex('rgb(300, -1, 39)')).toBe('#000000'); // a minus sign is not a colour
    expect(swatchHex('var(--x)')).toBe('#000000');
    expect(swatchHex(undefined)).toBe('#000000');
  });
});
