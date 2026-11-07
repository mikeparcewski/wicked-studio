import { describe, expect, it } from 'vitest';

import { contextWords, sectionEffect, seenByWords, steerNote, trailLines, type DocContext, type DocView } from '../src/plugins/wicked-phase-report/workingDoc.js';

/**
 * context-doc-switch (operator 2026-11-06): the run's working document is its CONTEXT DOCUMENT. With the engine's
 * context block, the person's Goal, Approach and Constraints reach every agent of the job; the document says so, says
 * when a version did not make it (and why), names the cut sections, and who has seen it.
 */

const ctx = (over: Partial<DocContext> = {}): DocContext => ({ engine: true, version: 4, sections: ['goal', 'constraints'], cut: [], at: 1, error: null, seenBy: [], ...over });
const view = (over: Partial<DocView> = {}): DocView => ({ doc: { head: 4 }, sections: null, trail: [], steers: [], ...over });

describe('the context document’s words', () => {
  it('with the block, saving Goal, Approach or Constraints says every agent; Next still the next step', () => {
    const v = view({ context: ctx() });
    expect(sectionEffect(v, 'constraints')).toBe('Saving puts it in every agent’s context for this job.');
    expect(sectionEffect(v, 'goal')).toBe('Saving puts it in every agent’s context for this job.');
    expect(sectionEffect(v, 'next')).toBe('Saving tells the next step.');
    expect(steerNote(v)).toMatch(/^Your Goal, Approach and Constraints are in the context of every agent this job starts/u);
    // An older crew or an engine with no block: unchanged.
    expect(sectionEffect(view(), 'goal')).toBe('Saving tells the next step.');
    expect(steerNote(view())).toBe('Edits steer the next step. They can raise rigor, never lower it.');
  });

  it('says what is in every agent’s context, and which sections were cut', () => {
    expect(contextWords(ctx())).toEqual({ text: 'In every agent’s context from version 4: Goal and Constraints and steering.', bad: false });
    expect(contextWords(ctx({ cut: ['constraints'] }))?.text).toMatch(/Constraints and steering was cut to fit; the text says where\.$/u);
    expect(contextWords(ctx({ version: null, sections: [] }))?.text).toMatch(/^Nothing of yours is in agents’ context yet/u);
    expect(contextWords(undefined)).toBeNull();
    expect(contextWords(ctx({ engine: false }))).toBeNull();
  });

  it('a refused version is said with the engine’s reason, that the earlier context was taken out, and what to do', () => {
    const w = contextWords(ctx({ version: 5, sections: [], error: { version: 5, reason: 'the block renders to 16384 bytes of UTF-8 with its framing; at most 15360 (it must fit beside the largest judge prompt in one argument)', at: 2, cleared: true } }));
    expect(w?.bad).toBe(true);
    expect(w?.text).toMatch(/^Version 5 is not in agents’ context: the block renders to 16384 bytes/u);
    expect(w?.text).toMatch(/The earlier context was taken out, so agents do not follow words you replaced\. Shorten Goal, Approach or Constraints and save again\.$/u);
    // A later version in force: the old refusal is no longer the news.
    expect(contextWords(ctx({ version: 6, error: { version: 5, reason: 'x', at: 2, cleared: true } }))?.bad).toBe(false);
  });

  it('seen by: steps by their name, roles in words, seats by product name, each once', () => {
    const c = ctx({ seenBy: [
      { recipient: 'unit', cli: 'claude', ord: 2 }, { recipient: 'judge', cli: 'codex', ord: 2 }, { recipient: 'unit', cli: 'claude', ord: 2 },
      { recipient: 'qe', cli: 'pi', ord: 5 }, { recipient: 'team_review', cli: '', ord: 3 },
    ] });
    expect(seenByWords(c, (ord) => (ord === 2 ? 'Fix' : null))).toBe('Seen by: Fix (Claude Code), judge (Codex), QE (Pi CLI) and team review.');
    expect(seenByWords(ctx())).toBeNull();
  });

  it('the trail says a person’s context edit went into every agent’s context, or did not', () => {
    const trail = [
      { version: 3, author: { kind: 'human' as const, id: 'local' }, surface: null, sections: ['constraints' as const], at: 0, steerId: null },
      { version: 4, author: { kind: 'human' as const, id: 'local' }, surface: null, sections: ['goal' as const], at: 0, steerId: null },
      { version: 5, author: { kind: 'human' as const, id: 'local' }, surface: null, sections: ['approach' as const], at: 0, steerId: null },
    ];
    const lines = trailLines(view({ trail, context: ctx({ error: { version: 5, reason: 'too long', at: 1, cleared: true } }) }));
    expect(lines[0]).toMatch(/^v5 · You · Approach · \d\d:\d\d · not in agents’ context$/u);
    expect(lines[1]).toMatch(/^v4 · You · Goal · \d\d:\d\d · in every agent’s context$/u);
    expect(lines[2]).toMatch(/^v3 · You · Constraints and steering · \d\d:\d\d$/u);
  });
});
