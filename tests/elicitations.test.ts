// DES-002 Studio half: the three race guards, each written so removing the guard fails it.
//
// These are not incidental correctness. The design's changelog records the exact production race
// behind each one, and every one of them is a "stale write wins" bug — the class where the UI shows
// an operator a prompt that no longer exists, or eats an answer they already gave.
//
// The store is a compare-and-swap on a per-run generation counter. What must hold is that EVERY
// mutation bumps, so an async GET that started before the mutation can never write after it.

import { beforeEach, describe, expect, it } from 'vitest';
import { useElicitationStore, type OpenElicitation } from '../src/store/elicitations.js';

const RUN = 'run-1';

function elicitation(id: string, over: Partial<OpenElicitation> = {}): OpenElicitation {
  return {
    runId: RUN,
    elicitationId: id,
    message: `question ${id}`,
    options: null,
    receivedAt: '2026-08-05T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  useElicitationStore.setState({ elicitations: {}, generations: {} });
});

describe('v0.23 — a GET in flight must not resurrect a resolved prompt', () => {
  /// The production race: operator answers A, the resolve clears it, and a rehydration GET issued
  /// BEFORE the answer lands afterwards. A naive "if empty, set it" check puts A back on screen.
  it('setFromGetIfUnchanged is a no-op when the run mutated mid-flight', () => {
    const s = useElicitationStore.getState();
    s.setElicitation(elicitation('A'));

    const gen = useElicitationStore.getState().getRunGen(RUN); // snapshot, as the GET caller does
    useElicitationStore.getState().clearElicitation(RUN); // …operator answers, WS clears it

    const applied = useElicitationStore.getState().setFromGetIfUnchanged(RUN, gen, elicitation('A'));

    expect(applied, 'a stale GET must not write').toBe(false);
    expect(useElicitationStore.getState().elicitations[RUN]).toBeUndefined();
  });

  /// The other half: with nothing racing, the GET MUST apply — or late-join rehydration is dead
  /// and an operator who opens a run mid-elicitation sees nothing.
  it('setFromGetIfUnchanged applies when nothing moved', () => {
    const gen = useElicitationStore.getState().getRunGen(RUN);
    const applied = useElicitationStore.getState().setFromGetIfUnchanged(RUN, gen, elicitation('A'));

    expect(applied).toBe(true);
    expect(useElicitationStore.getState().elicitations[RUN]?.elicitationId).toBe('A');
  });

  /// `clearElicitation` must bump EVEN WHEN there was nothing to clear. Otherwise a GET that
  /// snapshotted before a resolve-of-nothing still writes, which is the same resurrection.
  it('clearing an absent entry still bumps the generation', () => {
    const before = useElicitationStore.getState().getRunGen(RUN);
    useElicitationStore.getState().clearElicitation(RUN);

    expect(useElicitationStore.getState().getRunGen(RUN)).toBeGreaterThan(before);
  });
});

describe('v0.22 — 409 recovery must not clobber a newer prompt', () => {
  /// Stale tab answers A, gets 409, refetches and swaps in B. Correct.
  it('swapFromGet replaces the entry it believes is stale', () => {
    useElicitationStore.getState().setElicitation(elicitation('A'));

    const ok = useElicitationStore.getState().swapFromGet(RUN, 'A', elicitation('B'));

    expect(ok).toBe(true);
    expect(useElicitationStore.getState().elicitations[RUN]?.elicitationId).toBe('B');
  });

  /// THE race: while the 409 recovery was in flight, a WebSocket frame delivered C. The recovery
  /// must lose. Without the stale-id guard it overwrites C with its own stale view.
  it('swapFromGet refuses when a WS frame already replaced the entry', () => {
    useElicitationStore.getState().setElicitation(elicitation('A'));
    useElicitationStore.getState().setElicitation(elicitation('C')); // WS wins the race

    const ok = useElicitationStore.getState().swapFromGet(RUN, 'A', elicitation('B'));

    expect(ok, 'recovery for a stale id must not overwrite a newer elicitation').toBe(false);
    expect(useElicitationStore.getState().elicitations[RUN]?.elicitationId).toBe('C');
  });

  it('swapFromGet with null clears when the server has none', () => {
    useElicitationStore.getState().setElicitation(elicitation('A'));

    expect(useElicitationStore.getState().swapFromGet(RUN, 'A', null)).toBe(true);
    expect(useElicitationStore.getState().elicitations[RUN]).toBeUndefined();
  });
});

describe('v0.25 — reconcile must bump for runs it drops', () => {
  /// The zombie-prompt case: a run goes terminal while a GET for it is in flight. Reconcile drops
  /// the entry, but unless it BUMPS, the GET writes the prompt back for a finished run.
  it('a dropped run cannot be written back by an in-flight GET', () => {
    useElicitationStore.getState().setElicitation(elicitation('A'));
    const gen = useElicitationStore.getState().getRunGen(RUN); // GET starts

    useElicitationStore.getState().reconcile([]); // run terminal/absent

    const applied = useElicitationStore.getState().setFromGetIfUnchanged(RUN, gen, elicitation('A'));
    expect(applied, 'reconcile must bump so a late GET cannot resurrect').toBe(false);
    expect(useElicitationStore.getState().elicitations[RUN]).toBeUndefined();
  });

  it('a live run survives reconcile', () => {
    useElicitationStore.getState().setElicitation(elicitation('A'));
    useElicitationStore.getState().reconcile([RUN]);

    expect(useElicitationStore.getState().elicitations[RUN]?.elicitationId).toBe('A');
  });
});

describe('ingest', () => {
  it('opens on elicitationCreated', () => {
    useElicitationStore.getState().ingest({
      type: 'elicitationCreated',
      session: RUN,
      elicitationId: 'A',
      message: 'pick one',
      options: ['yes', 'no'],
    } as never);

    const e = useElicitationStore.getState().elicitations[RUN];
    expect(e?.elicitationId).toBe('A');
    expect(e?.options).toEqual(['yes', 'no']);
  });

  it('closes on terminal session events', () => {
    useElicitationStore.getState().setElicitation(elicitation('A'));
    useElicitationStore.getState().ingest({ type: 'sessionCompleted', session: RUN } as never);

    expect(useElicitationStore.getState().elicitations[RUN]).toBeUndefined();
  });

  /// An unrelated event must NOT clear a live prompt — clearing on anything unknown would drop the
  /// operator's question on every heartbeat.
  it('leaves the prompt alone on unrelated events', () => {
    useElicitationStore.getState().setElicitation(elicitation('A'));
    useElicitationStore.getState().ingest({ type: 'unitPlanned', session: RUN } as never);

    expect(useElicitationStore.getState().elicitations[RUN]?.elicitationId).toBe('A');
  });
});

describe('the component is actually reachable', () => {
  /// Review caught the original PR shipping ElicitationPrompt without ever rendering it — the
  /// component existed, the tests passed, and Studio still had no way to answer an elicitation.
  /// That is "presence, not substance": a thing built and not wired. A source audit is the honest
  /// instrument, in the same shape as wicked-core's spawn_audit.
  it('ElicitationPrompt is mounted somewhere, with a key', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const files = (function walk(d: string): string[] {
      return readdirSync(d).flatMap((e) => {
        const p = join(d, e);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
      });
    })(SRC).filter((f) => !f.endsWith('ElicitationPrompt.tsx'));

    const mounts = files.filter((f) => /<ElicitationPrompt\b/.test(readFileSync(f, 'utf8')));
    expect(
      mounts.length,
      'ElicitationPrompt is defined but never rendered — Studio has no operator surface',
    ).toBeGreaterThan(0);

    // `key` is not cosmetic here: without it React reuses the instance and a half-typed answer to
    // elicitation A survives into B (DES-002 v0.24 F3).
    for (const f of mounts) {
      const jsx = /<ElicitationPrompt\b[^>]*/.exec(readFileSync(f, 'utf8'))?.[0] ?? '';
      expect(jsx, `mount in ${f} is missing key={...}`).toMatch(/\bkey=\{/);
    }
  });
});
