import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/client.js', () => ({ api: { getRunEvents: vi.fn(async () => ({ events: [] })), listClis: vi.fn(async () => []) } }));

import { PinnedRunPlugins, RunPluginJumpRows, RunThreadPlugins, attributionLine } from '../src/components/session/RunThreadPlugin.js';
import { useConnectionStore } from '../src/store/connection.js';
import { RUN_PLUGINS, topicWords } from '../src/plugins/runPlugins.js';
import { readPinned, useRunPluginView } from '../src/store/runPluginView.js';

/** The run-thread slot (DES-PLUGIN-EVENTS spike 1; operator placement 2026-10-28). */

const RUN = 'run-1';
const PR = 'wicked-phase-report';

beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined });
  window.localStorage.clear();
  useRunPluginView.setState({ blocks: {} });
});
afterEach(() => { document.body.innerHTML = ''; });

describe('the run-thread plugin slot', () => {
  it('ships the phase report built in, pre-granted exactly its manifest’s topics, said in words', () => {
    const p = RUN_PLUGINS.find((x) => x.id === PR)!;
    expect(p).toMatchObject({ inline: 'run-thread', grantedBy: 'built-in', firstParty: true });
    expect(p.granted).toEqual(p.observe.map((o) => o.topic));
    for (const t of p.granted) expect(topicWords(t)).not.toBe(t);
    expect(attributionLine({ title: 'Phase report', version: '0.13.1' })).toBe('From plugin · Phase report 0.13.1 · observes run events');
  });

  it('mounts one sandboxed block at the first unit, folded, with the attribution and the grant label', () => {
    render(<RunThreadPlugins runId={RUN} placement="thread" />);
    const block = screen.getByTestId('run-plugin');
    expect(block.dataset['plugin']).toBe(PR);
    expect(block.dataset['folded']).toBe('true');
    expect(block.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(screen.getByTestId('run-plugin-attribution').textContent).toMatch(/^From plugin · Phase report \S+ · observes run events$/u);
    expect(screen.getByTestId('run-plugin-grant').textContent).toBe('Built in · pre-granted');
    expect(render(<RunThreadPlugins runId={RUN} placement="pinned" />).container.innerHTML).toBe('');
  });

  it('folds and unfolds from the keyboard-reachable host buttons', () => {
    render(<RunThreadPlugins runId={RUN} placement="thread" />);
    const fold = screen.getByTestId('run-plugin-fold');
    expect(fold.tagName).toBe('BUTTON');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(screen.getByTestId('run-plugin').dataset['folded']).toBe('false');
    expect(screen.getByTestId('run-plugin-fold').getAttribute('aria-expanded')).toBe('true');
  });

  it('pins to the top folded, remembers it per run and plugin, and unpins back to its place', () => {
    const view = render(<><RunThreadPlugins runId={RUN} placement="pinned" /><RunThreadPlugins runId={RUN} placement="thread" /></>);
    fireEvent.click(screen.getByTestId('run-plugin-fold'));
    fireEvent.click(screen.getByTestId('run-plugin-pin'));
    const pinned = screen.getByTestId('run-plugin');
    expect(pinned.dataset['placement']).toBe('pinned');
    expect(pinned.dataset['folded']).toBe('true');
    expect(screen.getByTestId('run-plugin-pin').getAttribute('aria-pressed')).toBe('true');
    expect(readPinned(RUN, PR)).toBe(true);
    expect(readPinned('run-2', PR)).toBe(false);
    // A new page (the store forgotten) reads the pin back.
    view.unmount();
    useRunPluginView.setState({ blocks: {} });
    render(<><RunThreadPlugins runId={RUN} placement="pinned" /><RunThreadPlugins runId={RUN} placement="thread" /></>);
    expect(screen.getByTestId('run-plugin').dataset['placement']).toBe('pinned');
    fireEvent.click(screen.getByTestId('run-plugin-pin'));
    expect(screen.getByTestId('run-plugin').dataset['placement']).toBe('thread');
    expect(readPinned(RUN, PR)).toBe(false);
  });

  it('a later update is a jump row at its step that unfolds and highlights the block; pinned, there are none', () => {
    render(<><RunThreadPlugins runId={RUN} placement="pinned" /><RunThreadPlugins runId={RUN} placement="thread" /><RunPluginJumpRows runId={RUN} ords={[6]} /></>);
    expect(screen.queryByTestId('run-plugin-updated')).toBeNull();
    act(() => useRunPluginView.getState().heard(RUN, PR, [6], true));
    const row = screen.getByTestId('run-plugin-updated');
    expect(row.textContent).toMatch(/Phase report updated/u);
    expect(row.dataset['ord']).toBe('6');
    fireEvent.click(screen.getByTestId('run-plugin-jump'));
    const block = screen.getByTestId('run-plugin');
    expect(block.dataset['folded']).toBe('false');
    expect(block.dataset['flash']).toBe('highlight');
    fireEvent.click(screen.getByTestId('run-plugin-pin'));
    expect(screen.queryByTestId('run-plugin-updated')).toBeNull();
    act(() => useRunPluginView.getState().heard(RUN, PR, [7], true));
    expect(screen.getByTestId('run-plugin').dataset['flash']).toBe('pulse');
  });

  it('two runs pinned share ONE sticky strip, stacked, so neither covers the other', () => {
    useRunPluginView.getState().setPinned('run-a', PR, true);
    useRunPluginView.getState().setPinned('run-b', PR, true);
    render(<PinnedRunPlugins runIds={['run-a', 'run-b']} />);
    expect(screen.getAllByTestId('run-plugins-pinned')).toHaveLength(1);
    expect(screen.getAllByTestId('run-plugin').map((b) => b.dataset['runId'])).toEqual(['run-a', 'run-b']);
    window.localStorage.clear();
  });

  it('nothing pinned draws no strip', () => {
    const { container } = render(<PinnedRunPlugins runIds={[RUN]} />);
    expect(container.innerHTML).toBe('');
  });

  it('an unpinned block counts no pulse, and a remount never replays an old pulse or highlight', () => {
    act(() => useRunPluginView.getState().heard(RUN, PR, [6], true));
    expect(useRunPluginView.getState().view(RUN, PR).pulse).toBe(0);
    act(() => useRunPluginView.getState().jump(RUN, PR));
    render(<RunThreadPlugins runId={RUN} placement="thread" />);
    expect(screen.getByTestId('run-plugin').dataset['flash']).toBeUndefined();
  });

  it('after the socket was lost and came back, the block is rebuilt from the durable log (a new frame)', () => {
    act(() => useConnectionStore.getState().setStatus('connected'));
    render(<RunThreadPlugins runId={RUN} placement="thread" />);
    const first = screen.getByTestId('run-plugin').querySelector('iframe');
    act(() => useConnectionStore.getState().setStatus('disconnected'));
    expect(screen.getByTestId('run-plugin').querySelector('iframe')).toBe(first);
    act(() => useConnectionStore.getState().setStatus('connected'));
    const second = screen.getByTestId('run-plugin').querySelector('iframe');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('a jump is spent once the thread has scrolled to it', () => {
    useRunPluginView.getState().jump(RUN, PR);
    expect(useRunPluginView.getState().lastJump).not.toBeNull();
    useRunPluginView.getState().clearJump();
    expect(useRunPluginView.getState().lastJump).toBeNull();
  });
});
