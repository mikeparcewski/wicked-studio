import { describe, expect, it } from 'vitest';
import type { AgentSession } from '../src/api/types.js';
import { humanTitle, onboardTitle, runTitle } from '../src/components/runIdentity.js';
import { plainRunTitle } from '../src/board/deskWords.js';

/**
 * studio#510 — an onboarding run names its repository everywhere a run is titled. `humanTitle`
 * keeps the clause before the first `: `, which for "Onboard repository: notes-b" is exactly the
 * part every onboarding shares; #423 fixed the Desk rail with "Set up notes-b", and the Everything
 * page (S15c) re-introduced the dropped name through `runTitle` (the finished rows) and `humanTitle`
 * (the Archived lens). The fold is ONE helper, used by both.
 */

function session(problem: string, id = 'f16285ab-0000-4000-8000-000000000001'): AgentSession {
  return { id, problem, attempt: 0 } as unknown as AgentSession;
}

describe('onboardTitle', () => {
  it('names the repository of an onboarding run, and nothing else', () => {
    expect(onboardTitle('Onboard repository: notes-b')).toBe('Set up notes-b');
    expect(onboardTitle('  Onboard repository: offsite-plan\nIndex it fully.')).toBe('Set up offsite-plan');
    expect(onboardTitle('Fix the login redirect')).toBeNull();
    expect(onboardTitle('Onboard repository:')).toBeNull();
  });
});

describe('runTitle (§7.5) on an onboarding run', () => {
  it('reads "Set up <repo> · short-id · #n", never the shared clause', () => {
    expect(runTitle(session('Onboard repository: notes-b'))).toBe('Set up notes-b · f16285 · #1');
    expect(runTitle(session('Onboard repository: notes-a'))).toBe('Set up notes-a · f16285 · #1');
  });

  it('keeps to the title-length budget — a long repository name is trimmed like any clause (codex round 1)', () => {
    expect(runTitle(session('Onboard repository: very-long-repository-name'), 8)).toBe('Set up… · f16285 · #1');
    expect(runTitle(session('Onboard repository: very-long-repository-name'), 40)).toBe('Set up very-long-repository-name · f16285 · #1');
  });

  it('every other run keeps the one human-title derivation', () => {
    expect(runTitle(session('Fix the login redirect. Then test it.'))).toBe(`${humanTitle('Fix the login redirect. Then test it.')} · f16285 · #1`);
  });

  it('agrees with the Desk rail\'s word (plainRunTitle, #423)', () => {
    expect(plainRunTitle('Onboard repository: notes-b')).toBe('Set up notes-b');
    expect(runTitle(session('Onboard repository: notes-b')).startsWith(plainRunTitle('Onboard repository: notes-b'))).toBe(true);
  });
});
