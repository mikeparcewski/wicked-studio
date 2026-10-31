import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/client.js', () => ({ api: { getRunEvents: vi.fn(async () => ({ events: [] })), listClis: vi.fn(async () => []) } }));

import { RunPhaseRows, RunPluginJumpRows, RunPluginSection, attributionLine, showInDetails } from '../src/components/session/RunThreadPlugin.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useHostPanel } from '../src/editors/hostApi.js';
import { useRunPanel } from '../src/store/runPanel.js';
import { RUN_PLUGINS, topicWords } from '../src/plugins/runPlugins.js';
import { pluginSections, sectionKey, type PluginSection } from '../src/board/runPluginPanels.js';
import { readPinned, resetRunPluginView, useRunPluginView, type RunPhase } from '../src/store/runPluginView.js';

/** Run plugins as sections of the run's Details panel (program DES-LEARN §1.2; operator 2026-10-30). */

const RUN = 'run-1';
const PR = 'wicked-phase-report';
const plugin = RUN_PLUGINS.find((x) => x.id === PR)!;
const WHOLE = sectionKey(PR, 'phase', null);
const phase = (key: RunPhase['key'], label: string, ords: number[], current: boolean): RunPhase => ({ key, label, ords, current });

function only(phases: RunPhase[] = []): PluginSection[] { return pluginSections([plugin], phases); }

beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined });
  window.localStorage.clear();
  resetRunPluginView();
});
afterEach(() => { document.body.innerHTML = ''; });

describe('a run plugin as a Details panel section', () => {
  it('ships the phase report built in, pre-granted exactly its manifest’s topics, registered as a per-phase section', () => {
    expect(plugin).toMatchObject({ inline: 'run-thread', grantedBy: 'built-in', firstParty: true });
    expect(plugin.granted).toEqual(plugin.observe.map((o) => o.topic));
    for (const t of plugin.granted) expect(topicWords(t)).not.toBe(t);
    expect(plugin.panels).toEqual([{ slot: 'run.details', id: 'phase', title: '{phase}', instances: 'per-phase', order: 10, defaultOpen: 'current', summary: 'plugin' }]);
    expect(plugin.visuals.icon).toMatch(/^data:image\/svg\+xml;base64,/u);
    expect(plugin.visuals).toMatchObject({ color: '#4f46e5', live: true });
    expect(attributionLine({ title: 'Phase report', version: '0.13.1' })).toBe('From plugin · Phase report 0.13.1 · observes run events');
  });

  it('draws the host chrome around one sandboxed frame: title, Plugin mark, pin, attribution; open while the run is live', () => {
    render(<RunPluginSection runId={RUN} plugin={plugin} section={only()[0]!} live />);
    const s = screen.getByTestId('run-plugin');
    expect(s.dataset['plugin']).toBe(PR);
    expect(s.dataset['sectionKey']).toBe(WHOLE);
    expect(s.dataset['open']).toBe('true');
    expect(s.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(screen.getByTestId('run-plugin-title').textContent).toBe('Phase report');
    expect(screen.getByTestId('run-plugin-grant').textContent).toContain('Plugin');
    expect(screen.getByTestId('run-plugin-attribution').textContent).toMatch(/^From plugin · Phase report \S+ · observes run events$/u);
  });

  it('a finished run’s section starts folded; the heading folds and opens it, remembered for THIS run only', () => {
    const view = render(<RunPluginSection runId={RUN} plugin={plugin} section={only()[0]!} live={false} />);
    const fold = screen.getByTestId('run-plugin-fold');
    expect(fold.tagName).toBe('BUTTON');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    // Folded, the frame stays mounted (it keeps hearing the run and says its heading's line); its region is hidden.
    expect(screen.getByTestId('run-plugin').querySelector('iframe')).not.toBeNull();
    fireEvent.click(fold);
    expect(screen.getByTestId('run-plugin').dataset['open']).toBe('true');
    expect(JSON.parse(window.localStorage.getItem('studio.runPanel.pluginOpen.v1')!)).toEqual({ [RUN]: { [WHOLE]: true } });
    view.unmount();
    resetRunPluginView();
    render(<><RunPluginSection runId={RUN} plugin={plugin} section={only()[0]!} live={false} /><RunPluginSection runId="run-2" plugin={plugin} section={only()[0]!} live={false} /></>);
    expect(screen.getAllByTestId('run-plugin').map((s) => s.dataset['open'])).toEqual(['true', 'false']);
  });

  it('per phase: one section each, titled by the phase, the current one open and the rest folded', () => {
    const phases = [phase('intake', 'Intake', [1], false), phase('build', 'Build', [2], true), phase('checks', 'Checks', [2], false)];
    render(<>{only(phases).map((s) => <RunPluginSection key={s.key} runId={RUN} plugin={plugin} section={s} live />)}</>);
    expect(screen.getAllByTestId('run-plugin-title').map((t) => t.textContent)).toEqual(['Intake', 'Build', 'Checks']);
    expect(screen.getAllByTestId('run-plugin').map((s) => s.dataset['open'])).toEqual(['false', 'true', 'false']);
  });

  it('pins to the top of the panel, remembered per run and section', () => {
    render(<RunPluginSection runId={RUN} plugin={plugin} section={only()[0]!} live />);
    fireEvent.click(screen.getByTestId('run-plugin-pin'));
    expect(screen.getByTestId('run-plugin').dataset['pinned']).toBe('true');
    expect(screen.getByTestId('run-plugin-pin').getAttribute('aria-pressed')).toBe('true');
    expect(readPinned(RUN, WHOLE)).toBe(true);
    expect(readPinned('run-2', WHOLE)).toBe(false);
  });

  it('shows the plugin’s own line (panel.summary) in the heading, with its tone', () => {
    render(<RunPluginSection runId={RUN} plugin={plugin} section={only()[0]!} live />);
    expect(screen.queryByTestId('run-plugin-summary')).toBeNull();
    act(() => useRunPluginView.getState().said(RUN, WHOLE, { text: 'checkpoint 3 · working', tone: 'run' }));
    const sum = screen.getByTestId('run-plugin-summary');
    expect(sum.textContent).toBe('working: checkpoint 3 · working');
    expect(sum.dataset['tone']).toBe('run');
  });

  it('a pinned section pulses on a live update; an unpinned one counts none, and a remount replays no old highlight', () => {
    act(() => useRunPluginView.getState().heard(RUN, WHOLE, [6], true));
    expect(useRunPluginView.getState().view(RUN, WHOLE).pulse).toBe(0);
    act(() => useRunPluginView.getState().reveal(RUN, WHOLE));
    render(<RunPluginSection runId={RUN} plugin={plugin} section={only()[0]!} live />);
    expect(screen.getByTestId('run-plugin').dataset['flash']).toBeUndefined();
    fireEvent.click(screen.getByTestId('run-plugin-pin'));
    act(() => useRunPluginView.getState().heard(RUN, WHOLE, [7], true));
    expect(screen.getByTestId('run-plugin').dataset['flash']).toBe('pulse');
  });

  it('after the socket was lost and came back, the section is rebuilt from the durable log (a new frame)', () => {
    act(() => useConnectionStore.getState().setStatus('connected'));
    render(<RunPluginSection runId={RUN} plugin={plugin} section={only()[0]!} live />);
    const first = screen.getByTestId('run-plugin').querySelector('iframe');
    act(() => useConnectionStore.getState().setStatus('disconnected'));
    expect(screen.getByTestId('run-plugin').querySelector('iframe')).toBe(first);
    act(() => useConnectionStore.getState().setStatus('connected'));
    const second = screen.getByTestId('run-plugin').querySelector('iframe');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });
});

describe('the thread keeps slim rows: Show in Details', () => {
  it('a phased run: an update is a row at its step; Show in Details opens the panel on the run, opens and lights the section', () => {
    useHostPanel.setState({ folded: true });
    render(<><RunPluginSection runId={RUN} plugin={plugin} section={only()[0]!} live={false} /><RunPluginJumpRows sessionId="s-1" runId={RUN} ords={[6]} /></>);
    expect(screen.queryByTestId('run-plugin-updated')).toBeNull();
    act(() => useRunPluginView.getState().heard(RUN, WHOLE, [6], true, { 6: 'Review' }));
    const row = screen.getByTestId('run-plugin-updated');
    expect(row.textContent).toBe('Phase report updated · ReviewShow in Details');
    expect(row.dataset['ord']).toBe('6');
    expect(screen.getByTestId('run-plugin').dataset['open']).toBe('false');
    fireEvent.click(screen.getByTestId('run-plugin-jump'));
    expect(useHostPanel.getState().folded).toBe(false);
    expect(useRunPanel.getState().picked).toEqual({ sessionId: 's-1', runId: RUN });
    const s = screen.getByTestId('run-plugin');
    expect(s.dataset['open']).toBe('true');
    expect(s.dataset['flash']).toBe('highlight');
  });

  it('a power build: one row per phase, "updated" while it is the running phase (with its line), else "finished"', () => {
    const build = phase('build', 'Build', [2], true);
    const intake = phase('intake', 'Intake', [1], false);
    act(() => useRunPluginView.getState().said(RUN, sectionKey(PR, 'phase', build), { text: 'checkpoint 3', tone: 'run' }));
    render(<><RunPhaseRows sessionId="s-1" runId={RUN} phase={intake} live /><RunPhaseRows sessionId="s-1" runId={RUN} phase={build} live /></>);
    expect(screen.getAllByTestId('run-plugin-updated').map((r) => r.querySelector('.wk-runplugin-updated-text')!.textContent))
      .toEqual(['Phase report · Intake finished', 'Phase report · Build updated · checkpoint 3']);
    expect(screen.getAllByTestId('run-plugin-updated').map((r) => r.dataset['sectionKey'])).toEqual([`${PR}:phase:intake`, `${PR}:phase:build`]);
    fireEvent.click(screen.getAllByTestId('run-plugin-jump')[1]!);
    expect(useRunPluginView.getState().open[RUN]).toEqual({ [`${PR}:phase:build`]: true });
    // Still the current phase by the run's units, but its report says it is done: it reads as finished.
    act(() => useRunPluginView.getState().said(RUN, sectionKey(PR, 'phase', build), { text: 'Claude Code · done', tone: 'ok' }));
    expect(screen.getAllByTestId('run-plugin-updated')[1]!.querySelector('.wk-runplugin-updated-text')!.textContent).toBe('Phase report · Build finished');
  });

  it('a phone opens the panel as its overlay', () => {
    const was = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
    useHostPanel.setState({ overlay: false });
    showInDetails(null, RUN, WHOLE);
    expect(useHostPanel.getState().overlay).toBe(true);
    window.matchMedia = was;
  });
});
