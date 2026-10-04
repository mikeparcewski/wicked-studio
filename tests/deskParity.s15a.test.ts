import { describe, expect, it } from 'vitest';
import type { DiagnosticsGovernance } from '../src/api/types.js';
import { deadletterChore } from '../src/board/repairMoves.js';

/**
 * S15a (DES-STUDIO-REBUILD-001 §6.4): before the flip, every repair move Home carried has a Desk
 * home. The Command Deck's Governed tile offered "Replay" for dead-lettered governance events; the
 * Desk has no tiles, so the move is a chore "for whoever runs studio" — under the SAME condition.
 */

const gov = (over: Partial<DiagnosticsGovernance> = {}): DiagnosticsGovernance => ({
  store: { path: 'governance.db' },
  counts: null,
  deadletters: { count: 128, truncated: true },
  findings: [{ kind: 'governance.deadletter', severity: 'error', message: 'run wicked-crew governance replay' }],
  ...over,
} as unknown as DiagnosticsGovernance);

describe('the Desk dead-letter chore', () => {
  it('says the count (capped reads keep their +) and that a dry run comes first', () => {
    expect(deadletterChore(gov())).toStrictEqual({
      title: 'Governance evidence is not landing',
      line: '128+ governance events dead-lettered — a dry run shows what a replay would move before anything does.',
    });
    expect(deadletterChore(gov({ deadletters: { count: 3, truncated: false } } as Partial<DiagnosticsGovernance>))?.line)
      .toMatch(/^3 governance events dead-lettered/);
  });

  it('is absent when nothing is dead-lettered, the finding is not an error, there is no store, or no report', () => {
    expect(deadletterChore(gov({ deadletters: { count: 0, truncated: false } } as Partial<DiagnosticsGovernance>))).toBeNull();
    expect(deadletterChore(gov({ findings: [{ kind: 'governance.deadletter', severity: 'warn', message: '' }] } as unknown as Partial<DiagnosticsGovernance>))).toBeNull();
    expect(deadletterChore(gov({ findings: [] }))).toBeNull();
    expect(deadletterChore(gov({ store: null } as Partial<DiagnosticsGovernance>))).toBeNull();
    expect(deadletterChore(null)).toBeNull();
    expect(deadletterChore(undefined)).toBeNull();
  });
});
