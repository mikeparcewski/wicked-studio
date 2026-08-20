import { describe, it, expect } from 'vitest';
import type { DocSummary } from '../src/api/interactive.js';
import type { Project, SessionView } from '../src/api/types.js';
import {
  deriveAttention,
  interactiveRootOf,
  type Attention,
} from '../src/hooks/useBoardModel.js';
import { ago } from '../src/components/ProjectCard.js';
import { makeView } from './factories.js';

const doc: DocSummary = { name: 'deck', kind: 'doc', head: 1, versions: 1, updated_at: null };

function project(over: Partial<Project> & { id: string }): Project {
  return {
    name: over.id,
    description: null,
    status: 'active',
    scope: `project:${over.id}`,
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

describe('deriveAttention (DES-MERGE-001 §1.4 sort key)', () => {
  const cases: [string, SessionView[], DocSummary[], Attention][] = [
    ['a waiting gate outranks everything', [makeView({ id: 'r1', status: 'executing' }), makeView({ id: 'r2', status: 'awaiting_human' })], [doc], 'gate'],
    ['a failure outranks a live run', [makeView({ id: 'r1', status: 'executing' }), makeView({ id: 'r2', status: 'failed' })], [], 'failing'],
    ['planning counts as running', [makeView({ id: 'r1', status: 'planning' })], [], 'running'],
    ['finished runs plus a doc are idle-with-drafts', [makeView({ id: 'r1', status: 'completed' })], [doc], 'drafts'],
    ['nothing anywhere is quiet', [], [], 'quiet'],
    ['a completed run with no docs is still quiet', [makeView({ id: 'r1', status: 'completed' })], [], 'quiet'],
  ];

  for (const [why, runs, docs, expected] of cases) {
    it(why, () => expect(deriveAttention(runs, docs)).toBe(expected));
  }
});

// The fixed-bucket `sortByAttention` is gone (DES-UXFIX-001 slice 1): ordering is
// the decayed-score comparator, pinned in `boardAttention.test.ts`. The bucket
// itself survives above as a labelling concern (D8), tests kept as-is.

describe('interactiveRootOf', () => {
  it('reads either spelling of the forward-additive project setting', () => {
    expect(interactiveRootOf(project({ id: 'a', interactiveRoot: '/tmp/wi' }))).toBe('/tmp/wi');
    expect(interactiveRootOf(project({ id: 'b', interactive_root: '/tmp/wi' }))).toBe('/tmp/wi');
  });

  it('treats an absent, blank, or non-string root as unbound', () => {
    expect(interactiveRootOf(project({ id: 'c' }))).toBeNull();
    expect(interactiveRootOf(project({ id: 'd', interactiveRoot: '   ' }))).toBeNull();
    expect(interactiveRootOf(project({ id: 'e', interactiveRoot: 42 }))).toBeNull();
  });
});

describe('ago', () => {
  const now = 1_000_000_000_000;
  it('is coarse and never negative', () => {
    expect(ago(now, now)).toBe('0s');
    expect(ago(now + 5_000, now)).toBe('0s'); // a clock skew reads as "just now", not "-5s"
    expect(ago(now - 45_000, now)).toBe('45s');
    expect(ago(now - 90_000, now)).toBe('1m');
    expect(ago(now - 7_200_000, now)).toBe('2h');
    expect(ago(now - 3 * 86_400_000, now)).toBe('3d');
  });
});
