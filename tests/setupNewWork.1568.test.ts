/**
 * crew#1568 D05: Helpers step 5 said new work uses "Claude Code, Codex, Pi CLI and GitHub Copilot CLI" to a person who
 * had installed only Claude Code and Codex. crew's new-work pool draws only from the helpers that can work now (signed
 * in or needing no sign-in, and given job work), so the step names those, and offers to pick only ready helpers.
 */
import { describe, expect, it } from 'vitest';
import type { AgentRow } from '../src/board/agentsModel.js';
import { newWorkHelpers } from '../src/board/firstUse.js';

const row = (key: string, name: string, f: Partial<AgentRow>, auth = 'signed_in'): AgentRow =>
  ({ key, name, picked: true, usable: true, jobWork: true, optIn: false, seat: { key, auth }, ...f }) as unknown as AgentRow;

describe('Helpers step 5 names the helpers new work will use (crew#1568 D05)', () => {
  it('a picked helper that is not installed or not signed in is not named; a ready one left out is offered', () => {
    const rows = [
      row('claude', 'Claude Code', {}),
      row('codex', 'Codex', {}),
      row('pi', 'Pi CLI', { usable: false }),
      row('copilot', 'GitHub Copilot CLI', { usable: false }),
      row('opencode', 'OpenCode', { picked: false, optIn: true }),
      row('gemini', 'Reviewer seat', { jobWork: false }),
    ];
    const { using, off } = newWorkHelpers(rows, true);
    expect(using.map((r) => r.name)).toStrictEqual(['Claude Code', 'Codex']);
    expect(off.map((r) => r.name)).toStrictEqual(['OpenCode']);
  });

  it('the default rule uses an opt-in helper when it is the only ready one; a saved pick, even an empty one, stands', () => {
    const rows = [
      row('claude', 'Claude Code', { usable: false }, 'signed_out'),
      row('codex', 'Codex', { usable: false }, 'signed_out'),
      row('opencode', 'OpenCode', { picked: false, optIn: true }, 'not_required'),
    ];
    expect(newWorkHelpers(rows, true).using.map((r) => r.name)).toStrictEqual(['OpenCode']);
    expect(newWorkHelpers(rows, true).off).toStrictEqual([]);
    const none = rows.map((r) => ({ ...r, picked: false }));
    expect(newWorkHelpers(none, false).using).toStrictEqual([]);
    expect(newWorkHelpers(none, false).off.map((r) => r.name)).toStrictEqual(['OpenCode']);
  });

  it('crew counts a helper whose sign-in cannot be read: then the default rule leaves the opt-in helper out', () => {
    const rows = [
      row('claude', 'Claude Code', { usable: false }, 'unknown'),
      row('opencode', 'OpenCode', { picked: false, optIn: true }, 'not_required'),
    ];
    expect(newWorkHelpers(rows, true).using).toStrictEqual([]);
    expect(newWorkHelpers(rows, true).off.map((r) => r.name)).toStrictEqual(['OpenCode']);
  });
});
