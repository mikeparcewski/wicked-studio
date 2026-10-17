/**
 * Studio's own setup items in Needs you (operator 2026-10-17): live, from the agents' standing and the
 * memory read — never a stored message — and gone once fixed. Memory fires on EMPTY ("if user just
 * installed it's not unreachable, just may not have data"), and says unreachable only when the read fails.
 */
import { describe, expect, it } from 'vitest';
import { setupChores, type MemoryReading } from '../src/board/deskModel.js';

const PATHS = { agents: '/?tab=agents&at=%2Fagents%3Fsetup%3D1', memory: '/?tab=repositories' };
const ok = (total: number): MemoryReading => ({ state: 'ok', total });
const agents = (usable: string[], total: number, known = true) => ({ known, usable: usable.map((name) => ({ name })), total });

describe('setupChores', () => {
  it('no agent able to work: set them up, with how many are signed in', () => {
    const [c] = setupChores(agents([], 4), ok(10), PATHS);
    expect(c).toMatchObject({ key: 'agents', tone: 'fail', title: 'Set up your agents — none can work yet (0 of 4 ready)', action: { label: 'Set up agents', path: PATHS.agents } });
    expect(setupChores(agents([], 0), ok(10), PATHS)[0]!.title).toBe('Set up your agents — none is set up yet');
  });

  it('exactly one able agent: a second to review the work', () => {
    const out = setupChores(agents(['claude'], 4), ok(10), PATHS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: 'second-agent', title: 'Only claude can work — jobs need a second agent to review the work', action: { label: 'Sign in another' } });
  });

  it('two able agents and memory with something in it: nothing', () => {
    expect(setupChores(agents(['claude', 'codex'], 4), ok(267), PATHS)).toEqual([]);
  });

  it('memory: empty asks to build it; a failed read says unreachable with the reason; unknown says nothing', () => {
    expect(setupChores(agents(['a', 'b'], 2), ok(0), PATHS)).toMatchObject([{ key: 'memory-empty', action: { label: 'Build memory', path: PATHS.memory } }]);
    expect(setupChores(agents(['a', 'b'], 2), { state: 'down', reason: 'estate unreachable' }, PATHS)).toMatchObject([{ key: 'memory-down', line: 'estate unreachable' }]);
    expect(setupChores(agents(['a', 'b'], 2), { state: 'unknown' }, PATHS)).toEqual([]);
  });

  it('an unread roster claims nothing about agents', () => {
    expect(setupChores(agents([], 0, false), { state: 'unknown' }, PATHS)).toEqual([]);
  });
});
