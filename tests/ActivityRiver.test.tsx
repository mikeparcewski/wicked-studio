import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { Project } from '../src/api/types.js';
import {
  ActivityRiver,
  buildRiver,
  MAX_LANES,
  RIVER_WINDOW_MS,
} from '../src/components/ActivityRiver.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import type { OpenGate } from '../src/store/gates.js';
import type { LoggedEvent } from '../src/store/runtime.js';
import { makeView } from './factories.js';

/**
 * The activity river's lane model + marks (DES-FEEDBACK-003 §7.3, slice Q):
 * spans on the HONEST observed clocks only — attach times, arrival-stamped
 * frames, the failure tail — clamped at the window edges; clockless runs are
 * excluded and counted; live runs reach "now"; marks sit at observed times in
 * status tokens.
 */

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function project(id: string, name = id): Project {
  return {
    id, name, description: null, status: 'active', scope: `project:${id}`,
    created_at: 1, updated_at: 1,
  };
}

function item(id: string, runs: ReturnType<typeof makeView>[], attachedAt: Record<string, number>): BoardProject {
  return {
    project: project(id), repo: null, runs, docs: [], attachedAt,
    attention: 'quiet', score: 0, band: 'quiet', signal: null,
  };
}

function gate(runId: string, receivedAt: number): OpenGate {
  return { runId, ord: 0, prompt: 'approve?', lifecycle: 'open', receivedAt };
}

function log(ts: number, type = 'cliUsage'): LoggedEvent {
  return { seq: 1, type, ts, detail: type };
}

const EMPTY = { gates: {}, logs: {}, failedAt: {}, landings: [], now: NOW };

describe('buildRiver — lane math on the honest clocks', () => {
  it('a span runs first-observed → last-observed; a live run reaches now', () => {
    const items = [
      item('p-live', [makeView({ id: 'r-live', status: 'executing' })], { 'r-live': NOW - 20 * HOUR }),
      item('p-done', [makeView({ id: 'r-done', status: 'completed' })], { 'r-done': NOW - 10 * HOUR }),
    ];
    const logs = { 'r-done': [log(NOW - 8 * HOUR)] };
    const m = buildRiver({ items, runs: items.flatMap((i) => i.runs), ...EMPTY, logs });
    expect(m.lanes.map((l) => l.projectId)).toEqual(['p-live', 'p-done']);
    const live = m.lanes[0]!.spans[0]!;
    expect(live.start).toBe(NOW - 20 * HOUR);
    expect(live.end).toBe(NOW); // live → the span reaches "now"
    expect(live.live).toBe(true);
    const done = m.lanes[1]!.spans[0]!;
    expect(done.start).toBe(NOW - 10 * HOUR);
    expect(done.end).toBe(NOW - 8 * HOUR); // last OBSERVED frame, not now
    expect(done.live).toBe(false);
  });

  it('clamps spans at the window edges and drops runs entirely outside it', () => {
    const items = [
      // Attached 30h ago but still executing — the span clamps to the left edge.
      item('p-old-live', [makeView({ id: 'r-a', status: 'executing' })], { 'r-a': NOW - 30 * HOUR }),
      // Terminal with every clock older than 24h — entirely outside, no lane.
      item('p-gone', [makeView({ id: 'r-b', status: 'failed' })], { 'r-b': NOW - 30 * HOUR }),
    ];
    const m = buildRiver({ items, runs: items.flatMap((i) => i.runs), ...EMPTY });
    expect(m.lanes.map((l) => l.projectId)).toEqual(['p-old-live']);
    expect(m.lanes[0]!.spans[0]!.start).toBe(NOW - RIVER_WINDOW_MS); // clamped
    expect(m.quiet).toBe(1); // p-gone has nothing in-window
  });

  it('excludes clockless runs from every lane and counts them data-unplaced', () => {
    const orphan = makeView({ id: 'r-orphan', status: 'executing' });
    const items = [item('p', [makeView({ id: 'r-1', status: 'executing' })], { 'r-1': NOW - HOUR })];
    const m = buildRiver({ items, runs: [...items[0]!.runs, orphan], ...EMPTY });
    expect(m.lanes).toHaveLength(1);
    expect(m.lanes[0]!.spans.map((s) => s.runId)).toEqual(['r-1']); // never painted
    expect(m.unplaced).toBe(1);
  });

  it('caps lanes at 6 in the given (board) order; the rest count quiet', () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      item(`p-${i}`, [makeView({ id: `r-${i}`, status: 'executing' })], { [`r-${i}`]: NOW - HOUR }));
    const m = buildRiver({ items, runs: items.flatMap((i) => i.runs), ...EMPTY });
    expect(m.lanes).toHaveLength(MAX_LANES);
    expect(m.lanes.map((l) => l.projectId)).toEqual(['p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
    expect(m.quiet).toBe(3);
  });

  it('places marks at observed clocks: waiting gate at receivedAt, ✗ at the failure tail', () => {
    const items = [
      item('p-gate', [makeView({ id: 'r-gate', status: 'awaiting_human' })], { 'r-gate': NOW - 2 * HOUR }),
      item('p-fail', [makeView({ id: 'r-fail', status: 'failed' })], { 'r-fail': NOW - 6 * HOUR }),
    ];
    const m = buildRiver({
      items, runs: items.flatMap((i) => i.runs), ...EMPTY,
      gates: { 'r-gate': gate('r-gate', NOW - HOUR) },
      failedAt: { 'r-fail': NOW - 5 * HOUR },
    });
    const gateMarks = m.lanes[0]!.spans[0]!.marks;
    expect(gateMarks).toEqual([{ kind: 'gate', at: NOW - HOUR, waiting: true }]);
    const failSpan = m.lanes[1]!.spans[0]!;
    expect(failSpan.end).toBe(NOW - 5 * HOUR); // the tail extends the span
    expect(failSpan.marks).toEqual([{ kind: 'fail', at: NOW - 5 * HOUR, waiting: false }]);
  });

  it('a failed run with no backfilled tail marks ✗ at its last OBSERVED point — never an invented time', () => {
    const items = [item('p', [makeView({ id: 'r-f', status: 'failed' })], { 'r-f': NOW - 3 * HOUR })];
    const m = buildRiver({ items, runs: items[0]!.runs, ...EMPTY });
    expect(m.lanes[0]!.spans[0]!.marks).toEqual([{ kind: 'fail', at: NOW - 3 * HOUR, waiting: false }]);
  });

  it('version landings mark the owning project lane — doc vs demo kinds, window-scoped', () => {
    const items = [item('p-doc', [makeView({ id: 'r-1', status: 'executing' })], { 'r-1': NOW - HOUR })];
    const m = buildRiver({
      items, runs: items[0]!.runs, ...EMPTY,
      landings: [
        { projectId: 'p-doc', version: 2, kind: 'generated', at: NOW - 2 * HOUR },
        { projectId: 'p-doc', version: 1, kind: 'demo', at: NOW - 3 * HOUR },
        { projectId: 'p-doc', version: 1, kind: 'generated', at: NOW - 30 * HOUR }, // outside
        { projectId: 'p-other', version: 1, kind: 'generated', at: NOW - HOUR },    // not this lane
      ],
    });
    expect(m.lanes[0]!.marks).toEqual([
      { kind: 'doc', at: NOW - 2 * HOUR, version: 2 },
      { kind: 'demo', at: NOW - 3 * HOUR, version: 1 },
    ]);
  });

  it('a lane can exist on a version landing alone (a doc landed, no runs moved)', () => {
    const items = [item('p-only-doc', [], {})];
    const m = buildRiver({
      items, runs: [], ...EMPTY,
      landings: [{ projectId: 'p-only-doc', version: 1, kind: 'generated', at: NOW - HOUR }],
    });
    expect(m.lanes.map((l) => l.projectId)).toEqual(['p-only-doc']);
    expect(m.quiet).toBe(0);
  });

  it('skips archived runs entirely', () => {
    const items = [item('p', [makeView({ id: 'r-x', status: 'completed', archived_at: 123 })], { 'r-x': NOW - HOUR })];
    const m = buildRiver({ items, runs: items[0]!.runs, ...EMPTY });
    expect(m.lanes).toHaveLength(0);
    expect(m.unplaced).toBe(0);
  });
});

describe('<ActivityRiver> — the SVG picture (EC15 tokens, EC19 question, the one loop)', () => {
  afterEach(cleanup);

  const items = [
    item('p-live', [makeView({ id: 'r-live', status: 'executing', problem: 'ship it' })], { 'r-live': NOW - 20 * HOUR }),
    item('p-gate', [makeView({ id: 'r-gate', status: 'awaiting_human' })], { 'r-gate': NOW - 2 * HOUR }),
  ];

  function draw(): HTMLElement {
    const { container } = render(
      <ActivityRiver
        items={items}
        runs={items.flatMap((i) => i.runs)}
        gates={{ 'r-gate': gate('r-gate', NOW - HOUR) }}
        logs={{}}
        failedAt={{}}
        landings={[{ projectId: 'p-live', version: 2, kind: 'generated', at: NOW - 4 * HOUR }]}
        navigate={() => {}}
        now={NOW}
      />,
    );
    return container;
  }

  it('carries the §7.3 named question, lane counts, and lanes in board order', () => {
    const c = draw();
    const river = c.querySelector('[data-testid="activity-river"]')!;
    expect(river.getAttribute('data-question')).toBe('What ran, when, and how did it end?');
    expect(river.getAttribute('data-lanes')).toBe('2');
    const lanes = [...c.querySelectorAll('[data-testid="river-lane"]')];
    expect(lanes.map((l) => l.getAttribute('data-project-id'))).toEqual(['p-live', 'p-gate']);
  });

  it('a live span reaches the now edge and carries the breach arrowhead', () => {
    const c = draw();
    const live = c.querySelector('[data-testid="river-span"][data-run-id="r-live"]')!;
    expect(live.getAttribute('data-live')).toBe('true');
    expect(live.querySelector('[data-testid="river-now-arrow"]')).not.toBeNull();
    // Every span is a real link with a title tooltip (intent · phase · project).
    expect(live.getAttribute('href')).toBe('/p/p-live/build/r-live');
    expect(live.querySelector('title')!.textContent).toContain('ship it');
  });

  it('the waiting gate mark is a --status-gate diamond that pulses (the one loop) and links run+#gate', () => {
    const c = draw();
    const mark = c.querySelector('[data-testid="river-gate-mark"]')!;
    expect(mark.getAttribute('data-waiting')).toBe('true');
    expect(mark.getAttribute('href')).toBe('/p/p-gate/build/r-gate#gate');
    const diamond = mark.querySelector('polygon')!;
    expect(diamond.getAttribute('fill')).toBe('var(--status-gate)');
    expect(diamond.getAttribute('class')).toBe('wk-river-gate-waiting');
  });

  it('renders version marks in --ink-muted, the quiet-lane count, and only token paints (EC15)', () => {
    const c = draw();
    const version = c.querySelector('[data-testid="river-version-mark"]')!;
    expect(version.getAttribute('data-kind')).toBe('doc');
    expect(c.querySelector('[data-testid="river-quiet"]')!.getAttribute('data-count')).toBe('0');
    // EC15: every painted fill/stroke in the river is a var() reference.
    const painted = [...c.querySelectorAll('rect, line, polygon, circle')];
    expect(painted.length).toBeGreaterThan(4);
    for (const el of painted) {
      for (const attr of ['fill', 'stroke'] as const) {
        const v = el.getAttribute(attr);
        expect(v === null || v === 'none' || v.startsWith('var(--')).toBe(true);
      }
    }
  });
});
