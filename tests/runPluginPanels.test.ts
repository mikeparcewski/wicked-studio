import { describe, expect, it } from 'vitest';
import {
  PLUGIN_OPEN_RUNS, defaultOpen, panelRows, parsePanels, parsePluginOpen, pluginSectionOpen, pluginSections, rememberPluginOpen, sectionKey,
  type PanelDecl,
} from '../src/board/runPluginPanels.js';
import type { RunPhase } from '../src/store/runPluginView.js';

/** The `panels[]` manifest contract and the Details panel's order (program DES-LEARN §1.2). */

const decl = (over: Partial<PanelDecl> = {}): PanelDecl => ({ slot: 'run.details', id: 'phase', title: '{phase}', instances: 'per-phase', order: 10, defaultOpen: 'current', summary: 'plugin', ...over });
const ph = (key: RunPhase['key'], label: string, current = false): RunPhase => ({ key, label, ords: [1], current });

describe('parsePanels', () => {
  it('reads a well-formed entry and fills the defaults', () => {
    expect(parsePanels([{ slot: 'run.details', id: 'phase', title: '{phase}', instances: 'per-phase', order: 10, defaultOpen: 'current', summary: 'plugin' }])).toEqual([decl()]);
    expect(parsePanels([{ slot: 'run.details', id: 'cost', title: 'Cost', order: 45 }])).toEqual([
      { slot: 'run.details', id: 'cost', title: 'Cost', instances: 'single', order: 45, defaultOpen: 'never', summary: 'none' },
    ]);
  });

  it('drops a slot outside the closed list, a bad id or title, a duplicate id, and anything that is not a list', () => {
    expect(parsePanels([{ slot: 'report.item', id: 'x', title: 'X', order: 10 }])).toEqual([]);
    expect(parsePanels([{ slot: 'run.details', id: 'Bad Id', title: 'X', order: 10 }])).toEqual([]);
    expect(parsePanels([{ slot: 'run.details', id: 'x', title: '<b>x</b>', order: 10 }])).toEqual([]);
    expect(parsePanels([{ slot: 'run.details', id: 'x', title: 'X', order: 1.5 }])).toEqual([]);
    expect(parsePanels([{ slot: 'run.details', id: 'x', title: 'X', order: 10 }, { slot: 'run.details', id: 'x', title: 'Y', order: 11 }])).toHaveLength(1);
    expect(parsePanels({ slot: 'run.details' })).toEqual([]);
  });

  it('a plugin can never take Now’s place (0) or leave the panel’s range', () => {
    expect(parsePanels([{ slot: 'run.details', id: 'a', title: 'A', order: 0 }])[0]!.order).toBe(1);
    expect(parsePanels([{ slot: 'run.details', id: 'a', title: 'A', order: -5 }])[0]!.order).toBe(1);
    expect(parsePanels([{ slot: 'run.details', id: 'a', title: 'A', order: 500 }])[0]!.order).toBe(99);
  });
});

describe('pluginSections and the panel order', () => {
  const pr = { id: 'wicked-phase-report', title: 'Phase report', panels: [decl()] };

  it('per-phase: one section per phase, titled by it; with no phases, one titled by the plugin', () => {
    const s = pluginSections([pr], [ph('intake', 'Intake'), ph('build', 'Build', true)]);
    expect(s.map((x) => [x.key, x.title])).toEqual([['wicked-phase-report:phase:intake', 'Intake'], ['wicked-phase-report:phase:build', 'Build']]);
    expect(pluginSections([pr], []).map((x) => [x.key, x.title])).toEqual([['wicked-phase-report:phase', 'Phase report']]);
    expect(sectionKey('a', 'b', null)).toBe('a:b');
  });

  it('ties break by plugin id, then by the phase’s place; core sections hold their places and win a tie', () => {
    const other = { id: 'acme-cost', title: 'Cost', panels: [decl({ id: 'cost', title: 'Cost', instances: 'single', order: 10 })] };
    const late = { id: 'acme-late', title: 'Late', panels: [decl({ id: 'l', title: 'Late', instances: 'single', order: 30 })] };
    const s = pluginSections([pr, other, late], [ph('intake', 'Intake'), ph('build', 'Build')]);
    expect(s.map((x) => x.key)).toEqual(['acme-cost:cost', 'wicked-phase-report:phase:intake', 'wicked-phase-report:phase:build', 'acme-late:l']);
    const rows = panelRows(s, () => false).map((r) => (r.kind === 'core' ? r.id : r.section.key));
    expect(rows).toEqual(['now', 'acme-cost:cost', 'wicked-phase-report:phase:intake', 'wicked-phase-report:phase:build', 'plan', 'changes', 'acme-late:l', 'checks', 'agents', 'record']);
  });

  it('a pinned section leads the panel, before Now', () => {
    const s = pluginSections([pr], [ph('intake', 'Intake'), ph('build', 'Build')]);
    const rows = panelRows(s, (k) => k.endsWith(':build')).map((r) => (r.kind === 'core' ? r.id : r.section.key));
    expect(rows.slice(0, 3)).toEqual(['wicked-phase-report:phase:build', 'now', 'wicked-phase-report:phase:intake']);
  });
});

describe('open or folded', () => {
  it('defaultOpen: current opens the running phase (a single section: while live); always, never, while-live', () => {
    expect(defaultOpen({ panel: decl(), phase: ph('build', 'Build', true) }, true)).toBe(true);
    expect(defaultOpen({ panel: decl(), phase: ph('intake', 'Intake', false) }, true)).toBe(false);
    expect(defaultOpen({ panel: decl(), phase: null }, true)).toBe(true);
    expect(defaultOpen({ panel: decl(), phase: null }, false)).toBe(false);
    expect(defaultOpen({ panel: decl({ defaultOpen: 'always' }), phase: null }, false)).toBe(true);
    expect(defaultOpen({ panel: decl({ defaultOpen: 'never' }), phase: ph('build', 'Build', true) }, true)).toBe(false);
    expect(defaultOpen({ panel: decl({ defaultOpen: 'while-live' }), phase: null }, false)).toBe(false);
  });

  it('the operator’s choice for the run wins; Show in Details always opens', () => {
    const s = { key: 'k', panel: decl(), phase: ph('build', 'Build', true) };
    expect(pluginSectionOpen(s, true, false)).toBe(false);
    expect(pluginSectionOpen({ ...s, phase: ph('intake', 'Intake') }, true, true)).toBe(true);
    expect(pluginSectionOpen(s, true, false, true)).toBe(true);
  });

  it('the per-run memory keeps only well-formed rows and forgets the oldest runs past the cap', () => {
    expect(parsePluginOpen('{"r1":{"a:b:build":true,"bad key":true,"a:b":"yes"},"bad run!":{"a:b":true}}')).toEqual({ r1: { 'a:b:build': true } });
    expect(parsePluginOpen('nope')).toEqual({});
    let m = {};
    for (let i = 0; i < PLUGIN_OPEN_RUNS + 5; i += 1) m = rememberPluginOpen(m, `r${i}`, 'a:b', true);
    expect(Object.keys(m)).toHaveLength(PLUGIN_OPEN_RUNS);
    expect(Object.keys(m)[0]).toBe('r5');
    // Touching an old run moves it to the newest place.
    m = rememberPluginOpen(m, 'r5', 'a:b', false);
    expect(Object.keys(m).at(-1)).toBe('r5');
  });
});
