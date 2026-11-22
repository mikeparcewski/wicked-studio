/**
 * crew#1568 D05: Helpers step 5 said new work uses "Claude Code, Codex, Pi CLI and GitHub Copilot CLI" to a person who
 * had installed only Claude Code and Codex. crew's new-work pool draws only from the helpers that can work now (signed
 * in or needing no sign-in, and given job work), so the step names those, and offers to pick only ready helpers.
 */
import { describe, expect, it } from 'vitest';
import type { AgentRow } from '../src/board/agentsModel.js';
import { newWorkHelpers } from '../src/board/firstUse.js';

const row = (key: string, name: string, f: Partial<AgentRow>): AgentRow =>
  ({ key, name, picked: true, usable: true, jobWork: true, optIn: false, ...f }) as AgentRow;

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
    const { using, off } = newWorkHelpers(rows);
    expect(using.map((r) => r.name)).toStrictEqual(['Claude Code', 'Codex']);
    expect(off.map((r) => r.name)).toStrictEqual(['OpenCode']);
  });
});
