import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import {
  BATCH_ROWS, REPLAY_OVERLAP_MS, RUN_TOPICS, RunEventFeed, grantedTopics, sourceTypes, toRow, topicMatches, validPattern, type EventsBatch,
} from '../src/editors/runEvents.js';
import fixture from './fixtures/runEvents-crew-fix.json';

/** Program DES-PLUGIN-EVENTS spike 1: run events, as an observing plugin hears them. */

const RUN = 'run-2410';
const events = fixture as unknown as CoreEvent[];

/** Drive a feed by hand: the history answers when told, live frames are pushed. */
function harness(granted: readonly string[], history: readonly CoreEvent[] | Error = events, clock = { t: 1_000 }) {
  const batches: EventsBatch[] = [];
  const asked: string[][] = [];
  let push: (e: CoreEvent) => void = () => undefined;
  let release: () => void = () => undefined;
  const feed = new RunEventFeed({
    runId: RUN,
    granted,
    history: (types) => {
      asked.push([...types]);
      return new Promise((resolve, reject) => { release = () => (history instanceof Error ? reject(history) : resolve(history)); });
    },
    live: (on) => { push = on; return () => { push = () => undefined; }; },
    deliver: (b) => batches.push(b),
    now: () => clock.t,
  });
  feed.start();
  return { feed, batches, asked, push: (e: CoreEvent) => push(e), release: () => release() };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const rowsOf = (batches: EventsBatch[]) => batches.flatMap((b) => b.rows);
/** The live copy of a recorded frame: no `ts`, no `seq`. */
const liveCopy = (e: CoreEvent): CoreEvent => {
  const rest = { ...(e as unknown as Record<string, unknown>) };
  delete rest['ts'];
  delete rest['seq'];
  return rest as unknown as CoreEvent;
};

describe('topic patterns', () => {
  it('matches one segment with *, any rest with a final **, and nothing with an invalid pattern', () => {
    expect(topicMatches('wicked.run.unit.*', 'wicked.run.unit.started')).toBe(true);
    expect(topicMatches('wicked.run.unit.*', 'wicked.run.unit')).toBe(false);
    expect(topicMatches('wicked.run.unit.*', 'wicked.run.checks.evaluated')).toBe(false);
    expect(topicMatches('wicked.run.**', 'wicked.run.checks.evaluated')).toBe(true);
    expect(topicMatches('wicked.**', 'wicked.run.unit.started')).toBe(true);
    expect(topicMatches('wicked.run.checks.evaluated', 'wicked.run.checks.evaluated')).toBe(true);
    for (const bad of ['', 'run.unit.*', 'wicked', 'wicked.**.unit', 'wicked.run..x', 'wicked.Run.unit', '**', 'wicked.run.unit.*\n']) {
      expect(validPattern(bad), JSON.stringify(bad)).toBe(false);
      expect(topicMatches(bad, 'wicked.run.unit.started'), JSON.stringify(bad)).toBe(false);
    }
  });

  it('reads only the source types the granted topics are made from', () => {
    expect(sourceTypes(['wicked.run.checks.evaluated'])).toEqual(['repoChecksEvaluated']);
    expect(sourceTypes(['wicked.run.unit.*']).sort()).toEqual(['stepFailed', 'unitDenied', 'unitDistributed', 'unitDone', 'unitExecuting', 'unitPlanned'].sort());
    expect(sourceTypes([])).toEqual([]);
    expect(grantedTopics(['wicked.**'])).toEqual(Object.keys(RUN_TOPICS));
  });
});

describe('a row is a closed projection of its frame', () => {
  it('carries no prompt, path, log tail, argv or environment', () => {
    for (const e of events) {
      const row = toRow(e, RUN, 0, 'x');
      if (row === null) continue;
      const text = JSON.stringify(row);
      expect(text, e.type).not.toMatch(/\/home\/|someone|secret|stdoutTail|argv|env|prompt|criterion/u);
    }
    const plan = toRow(events.find((e) => e.type === 'unitPlanned')!, RUN, 0, 'x');
    expect(plan?.data['step']).toBe('pa-scope');
    const verify = events.filter((e) => e.type === 'repoChecksEvaluated').at(-1)!;
    expect(toRow(verify, RUN, 0, 'x')?.data['reusedFrom']).toEqual({ phase: 'fix', ord: 6, attempt: 0, reused: ['typecheck', 'lint', 'test_targeted'], fresh: ['install'] });
  });

  it('maps nothing it does not know', () => {
    expect(toRow({ type: 'unitOutputDelta', session: RUN, ord: 1, delta: 'hi' } as unknown as CoreEvent, RUN, 0, 'x')).toBeNull();
    expect(toRow({ type: 'governanceHookFired', session: RUN } as unknown as CoreEvent, RUN, 0, 'x')).toBeNull();
  });
});

describe('the feed', () => {
  it('replays the durable log first, in seq order, then live frames, each once', async () => {
    const h = harness(['wicked.run.**']);
    // A live frame raced the replay: it is held, and dropped once the replay shows it already holds it.
    const last = events.at(-1)!;
    h.push(liveCopy(last));
    expect(h.batches).toHaveLength(0);
    h.release();
    await flush();
    expect(h.batches[0]?.replay).toBe(true);
    const replayed = rowsOf(h.batches);
    const seqs = replayed.map((r) => r.seq!);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(h.batches.filter((b) => !b.replay)).toHaveLength(0);
    // A genuinely new frame arrives live, once, stamped with the receipt time.
    h.push({ type: 'unitExecuting', session: RUN, ord: 11 } as unknown as CoreEvent);
    const live = h.batches.filter((b) => !b.replay);
    expect(live).toHaveLength(1);
    expect(live[0]?.rows[0]).toMatchObject({ topic: 'wicked.run.unit.started', ord: 11, seq: null, at: 1_000, id: 'l1' });
    // The same emission heard twice live is two emissions (it was not in the replay): ids stay unique.
    h.push({ type: 'unitExecuting', session: RUN, ord: 11 } as unknown as CoreEvent);
    const ids = rowsOf(h.batches).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a step re-run INSIDE the overlap is heard: an old recorded frame can never arrive live again', async () => {
    // The clock is just after the fixture's last frame; ord 2's starts are far older than the overlap.
    const last = Math.max(...events.map((e) => (e as unknown as { ts: number }).ts));
    const clock = { t: last + 2_000 };
    const h = harness(['wicked.run.unit.started'], events, clock);
    h.release();
    await flush();
    h.push({ type: 'unitExecuting', session: RUN, ord: 2 } as unknown as CoreEvent);
    expect(h.batches.filter((b) => !b.replay).flatMap((b) => b.rows).map((r) => r.ord)).toEqual([2]);
  });

  it('a recent recorded frame that raced the replay is still dropped once, inside the overlap', async () => {
    const recent = [{ type: 'unitExecuting', session: RUN, seq: 1, ts: 10_000, ord: 4 }] as unknown as CoreEvent[];
    const clock = { t: 10_500 };
    const h = harness(['wicked.run.unit.started'], recent, clock);
    h.release();
    await flush();
    h.push({ type: 'unitExecuting', session: RUN, ord: 4 } as unknown as CoreEvent);
    expect(h.batches.filter((b) => !b.replay)).toHaveLength(0);
    h.push({ type: 'unitExecuting', session: RUN, ord: 4 } as unknown as CoreEvent);
    expect(h.batches.filter((b) => !b.replay)).toHaveLength(1);
  });

  it('a step re-run (the same content again, after the overlap) is a new emission and is heard', async () => {
    const clock = { t: 1_000 };
    const h = harness(['wicked.run.unit.started'], events, clock);
    h.release();
    await flush();
    // ord 2 started twice in the recorded log; the page joined late, so neither live copy ever came.
    const again = { type: 'unitExecuting', session: RUN, ord: 2 } as unknown as CoreEvent;
    clock.t += REPLAY_OVERLAP_MS + 1;
    h.push(again);
    expect(h.batches.filter((b) => !b.replay).flatMap((b) => b.rows).map((r) => r.ord)).toEqual([2]);
  });

  it('asks the log only for the types its grant needs', async () => {
    const h = harness(['wicked.run.checks.evaluated', 'wicked.run.human.awaited']);
    expect(h.asked).toHaveLength(1);
    expect([...h.asked[0]!].sort()).toEqual(['awaitingHuman', 'repoChecksEvaluated']);
  });

  it('never delivers a row on a topic it was not granted, replayed or live, for any grant', async () => {
    const all = Object.keys(RUN_TOPICS);
    const grants: string[][] = [
      [], ['wicked.run.unit.started'], ['wicked.run.unit.*'], ['wicked.run.checks.evaluated', 'wicked.run.usage.reported'],
      ['wicked.run.session.*'], ['not.a.pattern', 'wicked.**.bad'], ...all.map((t) => [t]),
    ];
    for (const g of grants) {
      // The history hands back EVERYTHING (a server that ignored the type filter): the feed still filters.
      const h = harness(g);
      h.release();
      await flush();
      for (const e of events) h.push(liveCopy({ ...e, ord: 99 } as unknown as CoreEvent));
      for (const e of events) h.push({ ...liveCopy(e), session: 'another-run' } as unknown as CoreEvent);
      const rows = rowsOf(h.batches);
      for (const r of rows) {
        expect(g.some((p) => topicMatches(p, r.topic)), `${JSON.stringify(g)} got ${r.topic}`).toBe(true);
        expect(r.runId).toBe(RUN);
      }
      if (g.length === 0 || g[0] === 'not.a.pattern') expect(rows).toHaveLength(0);
      h.feed.stop();
    }
  });

  it('a replay that cannot be read says so, then goes live', async () => {
    const h = harness(['wicked.run.unit.*'], new Error('503'));
    h.release();
    await flush();
    expect(h.batches[0]).toMatchObject({ replay: true, rows: [], gap: 'history-unavailable' });
    h.push({ type: 'unitDone', session: RUN, ord: 3 } as unknown as CoreEvent);
    expect(h.batches[1]?.rows[0]?.topic).toBe('wicked.run.unit.finished');
  });

  it('splits a long replay into batches and stops hearing after stop()', async () => {
    const many = Array.from({ length: BATCH_ROWS + 5 }, (_, i) => ({ type: 'cliUsage', session: RUN, seq: i, ts: i, ord: 1, costUsd: 0.01 })) as unknown as CoreEvent[];
    const h = harness(['wicked.run.usage.reported'], many);
    h.release();
    await flush();
    expect(h.batches.map((b) => b.rows.length)).toEqual([BATCH_ROWS, 5]);
    h.feed.stop();
    h.push({ type: 'cliUsage', session: RUN, ord: 2, costUsd: 1 } as unknown as CoreEvent);
    expect(h.batches).toHaveLength(2);
  });
});
