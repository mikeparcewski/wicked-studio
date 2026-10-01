import { describe, expect, it } from 'vitest';
import { PLAIN_WORDS, plainWord } from '../src/board/plainWords.js';

/**
 * DES-studio-rebuild S3: "plainWords covers every DESIGN-simple §3 term". The list below is the
 * §3 table's first column, verbatim and in order (DESIGN-simple.md rev 2, 35 rows). A row added to
 * or dropped from the model without the design changing fails here, and so does a plain wording
 * that still says the technical word it replaces.
 */
const DESIGN_SIMPLE_S3_TERMS = [
  'PLAN GATE / gate / effect gate',
  'unit (U1–U6)',
  'worker (w1–w6)',
  'seat (claude, codex, pi, agy, copilot)',
  'seat lapsed · 401',
  'lane A / B',
  'worktree',
  'run id (r-88)',
  'DoD 4/9 claimed · 3 verified',
  'CLAIMED / VERIFIED / CONTRADICTED / STALLED 18M',
  'REFUSED BY GATE · POL-kes-0019',
  'OOM · killed · retried',
  'policy / POL-kes-0019 / cand-kes-0007',
  'ADVISORY / BLOCKING',
  'CANDIDATE · QUEUED',
  'scope (project / all)',
  'ORIGIN · stance · recall · steer type',
  'D·G·C·R detector, dry run',
  'recurrence ↺',
  'mode codes RS PL EX PT BR VB CH',
  'phase / wave',
  'artifact / brief v3 / plan v1',
  'sha a41c9e2 · matches main',
  'tokens',
  'PTY / terminal',
  'transcript',
  'diff / merge-base',
  'CoreEvents tail',
  'daemon · version · uptime · dead letters · outbox · freeze · stall escalation · restart / upgrade',
  'host disk · reclaim · stores inventory',
  'fleet table',
  'queue / J then 1–4 / status bar',
  'keycaps everywhere',
  'decision record D-ced-14 · choice',
  'verifier ≠ creator · replay p95 −48%',
] as const;

/** Words a plain wording must never fall back on (the default layer shows 0 technical terms). */
const BANNED_IN_PLAIN = [
  'gate', 'unit', 'seat', 'worker', 'worktree', 'sha', 'daemon', 'policy', 'artifact',
  'transcript', 'tokens', 'diff', 'dod', 'lane', 'pty', 'oom', 'run id', 'verifier',
];

describe('plainWords: DESIGN-simple §3 coverage', () => {
  it('has exactly one row per §3 term, in the design order', () => {
    expect(PLAIN_WORDS.map((r) => r.term)).toEqual([...DESIGN_SIMPLE_S3_TERMS]);
  });

  it('every row says where the term still lives, and has plain wording unless the design hides it', () => {
    for (const row of PLAIN_WORDS) {
      expect(row.where.trim(), row.term).not.toBe('');
      expect(row.aliases.length, row.term).toBeGreaterThan(0);
      if (row.plain === null) continue; // "not shown" in the default layer (tokens, ORIGIN …)
      expect(row.plain.length, row.term).toBeGreaterThan(0);
      for (const p of row.plain) expect(p.trim(), row.term).not.toBe('');
    }
  });

  it('no plain wording still says a technical word', () => {
    for (const row of PLAIN_WORDS) {
      for (const p of row.plain ?? []) {
        for (const w of BANNED_IN_PLAIN) {
          expect(new RegExp(`\\b${w}\\b`, 'i').test(p), `${row.term}: "${p}" says "${w}"`).toBe(false);
        }
      }
    }
  });

  it('every alias resolves to exactly one row', () => {
    const seen = new Map<string, string>();
    for (const row of PLAIN_WORDS) {
      for (const a of row.aliases) {
        expect(seen.get(a), `alias "${a}" in two rows`).toBeUndefined();
        seen.set(a, row.term);
      }
    }
  });
});

describe('plainWord (lookup)', () => {
  it('maps the technical handles the tech-details surfaces show to their plain words', () => {
    expect(plainWord('seat')).toBe('an AI helper');
    expect(plainWord('run id')).toBe('the build');
    expect(plainWord('unit')).toBe('step');
    expect(plainWord('worker')).toBe('helper');
    expect(plainWord('sha')).toBe('the latest version');
    expect(plainWord('worktree')).toBe('its own copy of the code');
  });

  it('is case- and space-insensitive, and answers null for a hidden or unknown term', () => {
    expect(plainWord('  Seat ')).toBe('an AI helper');
    expect(plainWord('PLAN GATE')).toBe(plainWord('gate'));
    expect(plainWord('tokens')).toBeNull();
    expect(plainWord('no such term')).toBeNull();
  });
});
