import { describe, expect, it } from 'vitest';
import type { TeamRow } from '../src/api/teamPlan.js';
import { councilLine, disputeFindingsOf, positionLines } from '../src/board/gateFindings.js';

// abea6262 ord 4: copied team payloads; ids and raise_seq repeat across attempts.
const rows: TeamRow[] = [
  {
    "event_id": 8766,
    "event_type": "wicked.team.finding.raised",
    "payload": {
      "attempt": 2,
      "by": "pi",
      "claim": "CBACT04C is declared in-scope for interest-and-fees, but this change deleted every CBACT04C business rule (interest = TRAN-CAT-BAL*DIS-INT-RATE/1200, disclosure-group rate lookup, fee stub, last-account settlement bug). The extract criterion requires interest and fee calculation rules; none remain, so the required extraction is now missing.",
      "finding_id": "f-3fc9896ded8b83c4",
      "line": 20,
      "ord": 4,
      "path": ".wicked/domain/rules.json",
      "raise_seq": 1,
      "severity": "high"
    }
  },
  {
    "event_id": 8767,
    "event_type": "wicked.team.finding.raised",
    "payload": {
      "attempt": 2,
      "by": "pi",
      "claim": "CBTRN03C is declared in-scope for transaction-reporting, but this change deleted the CBTRN03C transaction-detail-report rule (date-range filtering, xref/type/category lookups, page/grand totals). The criterion requires the transaction detail report rules; none remain after this change.",
      "finding_id": "f-8abb47ca3c3d6243",
      "line": 41,
      "ord": 4,
      "path": ".wicked/domain/rules.json",
      "raise_seq": 2,
      "severity": "high"
    }
  },
  {
    "event_id": 8797,
    "event_type": "wicked.team.council.called",
    "payload": {
      "attempt": 2,
      "by": "engine",
      "finding_id": "f-3fc9896ded8b83c4",
      "ord": 4,
      "positions": [
        {
          "by": "worker claude",
          "position": "YES — the work as submitted stands",
          "reason": "not delivered — no delivery on record"
        },
        {
          "by": "monitor pi",
          "position": "NO — the finding stands",
          "reason": "Confirmed: rules.json has zero CBACT04C rules. CBACT04C.cbl lines 462–466 compute monthly interest as `(TRAN-CAT-BAL * DIS-INT-RATE) / 1200` in 1300-COMPUTE-INTEREST, with the disclosure-group rate lookup at 1200-GET-INTEREST-RATE / 1200-A-GET-DEFAULT-INT-RATE and the fee stub at 1400-COMPUTE-FEES. The program is assigned to interest-and-fees (rules.json:20) and the extract criterion names \"interest and fee calculation (CBACT04C)\" — none of these rules are extracted, so the required extraction is missing."
        }
      ],
      "subject": "finding:1"
    }
  },
  {
    "event_id": 8799,
    "event_type": "wicked.team.council.ruled",
    "payload": {
      "agreement_pct": 100,
      "attempt": 2,
      "by": "council:01795209800517-0000000000000000",
      "ord": 4,
      "reason": null,
      "returned": 1,
      "seated": 1,
      "seats": [
        "codex"
      ],
      "subject": "finding:1",
      "verdict": "no"
    }
  },
  {
    "event_id": 8800,
    "event_type": "wicked.team.council.called",
    "payload": {
      "attempt": 2,
      "by": "engine",
      "finding_id": "f-8abb47ca3c3d6243",
      "ord": 4,
      "positions": [
        {
          "by": "worker claude",
          "position": "YES — the work as submitted stands",
          "reason": "not delivered — no delivery on record"
        },
        {
          "by": "monitor pi",
          "position": "NO — the finding stands",
          "reason": "Confirmed: rules.json has zero CBTRN03C rules. CBTRN03C.cbl lines 173–174 filter on `TRAN-PROC-TS (1:10)` between WS-START-DATE/WS-END-DATE, with page/grand totals (WS-PAGE-TOTAL/WS-GRAND-TOTAL) and the report writer 1100-WRITE-TRANSACTION-REPORT. The program is assigned to transaction-reporting (rules.json:41) and the criterion names \"the transaction detail report (CBTRN03C)\" — none of these rules are extracted."
        }
      ],
      "subject": "finding:2"
    }
  },
  {
    "event_id": 8802,
    "event_type": "wicked.team.council.ruled",
    "payload": {
      "agreement_pct": 100,
      "attempt": 2,
      "by": "council:01795209826278-0000000000000001",
      "ord": 4,
      "reason": null,
      "returned": 1,
      "seated": 1,
      "seats": [
        "codex"
      ],
      "subject": "finding:2",
      "verdict": "no"
    }
  },
  {
    "event_id": 8808,
    "event_type": "wicked.team.gate.opened",
    "payload": {
      "attempt": 2,
      "by": "engine",
      "finding_ids": [
        "f-3fc9896ded8b83c4",
        "f-8abb47ca3c3d6243"
      ],
      "kind": "team_dispute",
      "ord": 4
    }
  },
  {
    "event_id": 8935,
    "event_type": "wicked.team.finding.raised",
    "payload": {
      "attempt": 3,
      "by": "codex",
      "claim": "The extraction contains only seven CBTRN02C close/error-handling rules; the change merely reformats the existing JSON. It omits the requested validation and posting rules, all CBACT04C and CBTRN03C rules, and copybook field traceability. Concrete missing requirements include CBTRN02C 1500-B-LOOKUP-ACCT rejection codes 101–103, CBACT04C 1300-COMPUTE-INTEREST's TRAN-CAT-BAL * DIS-INT-RATE / 1200 formula and DEFAULT disclosure-group fallback, and CBTRN03C's inclusive processing-date filter. The resulting artifact cannot supply the specified business requirements.",
      "finding_id": "f-a330ef2fb1537266",
      "line": 189,
      "ord": 4,
      "path": ".wicked/domain/rules.json",
      "raise_seq": 1,
      "severity": "medium"
    }
  },
  {
    "event_id": 12253,
    "event_type": "wicked.team.finding.raised",
    "payload": {
      "attempt": 7,
      "by": "claude",
      "claim": "The step is to extract rules for CBTRN02C, CBACT04C and CBTRN03C, but the rules array has no entry whose provenance.source is app/cbl/CBTRN02C.cbl, CBACT04C.cbl or CBTRN03C.cbl. The previous version had these programs only as domain assignments, and the change still has no rules for them. The array holds rules for CODATE01, CBEXPORT, CBSTM03A, COACTUPC and others. Many entries also have statement \"\" and confidence 0, for example CBSTM03A 8100-FILE-OPEN. The deliverable therefore misses the posting validation, interest and fee rules, and report rules tied to program, paragraph and copybook fields.",
      "finding_id": "f-a330ef2fb1537266",
      "line": 2356,
      "ord": 4,
      "path": ".wicked/domain/rules.json",
      "raise_seq": 1,
      "severity": "high"
    }
  },
  {
    "event_id": 12365,
    "event_type": "wicked.team.council.called",
    "payload": {
      "attempt": 7,
      "by": "engine",
      "finding_id": "f-a330ef2fb1537266",
      "ord": 4,
      "positions": [
        {
          "by": "worker codex",
          "position": "YES — the work as submitted stands",
          "reason": "not delivered — no delivery on record"
        },
        {
          "by": "monitor claude",
          "position": "NO — the finding stands",
          "reason": "I checked `.wicked/domain/rules.json`. No rule has a `provenance.source` under `app/cbl/CBTRN02C`, `CBACT04C` or `CBTRN03C`. The `source` values cover CBEXPORT, CBIMPORT, CBSTM03A, CBSTM03B, CBTRN01C, COACTUPC and other programs, but none of the three target programs. The three program names do appear 35 times in the file. I did not look at those lines, but the source counts show none of them is a rule entry, so they are most likely domain assignments. The extraction the step asked for is still missing."
        }
      ],
      "subject": "finding:1"
    }
  },
  {
    "event_id": 12393,
    "event_type": "wicked.team.council.ruled",
    "payload": {
      "agreement_pct": 100,
      "attempt": 7,
      "by": "council:01795215141303-0000000000000003",
      "ord": 4,
      "reason": null,
      "returned": 1,
      "seated": 1,
      "seats": [
        "pi"
      ],
      "subject": "finding:1",
      "verdict": "no"
    }
  },
  {
    "event_id": 12400,
    "event_type": "wicked.team.gate.opened",
    "payload": {
      "attempt": 7,
      "by": "engine",
      "finding_ids": [
        "f-a330ef2fb1537266"
      ],
      "kind": "team_dispute",
      "ord": 4
    }
  }
];

describe('T8 dispute evidence follows the gate attempt', () => {
  it('reads the two attempt-2 findings, their positions and council', () => {
    const found = disputeFindingsOf(rows.filter((r) => Number(r.payload['attempt']) <= 2), 4, []);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ id: 'f-3fc9896ded8b83c4', severity: 'high', path: '.wicked/domain/rules.json', line: 20, raisedBy: 'pi',
      claim: expect.stringContaining('deleted every CBACT04C business rule'),
      council: { verdict: 'no', seats: ['codex'], seated: 1, returned: 1, agreementPct: 100 } });
    expect(positionLines(found[0]!.positions)).toContain('claude (builder): YES — the work as submitted stands (not delivered — no delivery on record)');
  });

  it('uses the attempt-7 claim, not attempt 3, regardless of row order or another ord', () => {
    const wrongOrd = rows.filter((r) => r.payload['attempt'] === 3).map((r) => ({ ...r, event_id: r.event_id + 20000, payload: { ...r.payload, ord: 5, attempt: 7 } }));
    const [found] = disputeFindingsOf([...rows, ...wrongOrd].reverse(), 4, []);
    expect(found).toMatchObject({ id: 'f-a330ef2fb1537266', severity: 'high', line: 2356, raisedBy: 'claude',
      claim: expect.stringContaining('rules array has no entry whose provenance.source'), council: { seats: ['pi'] } });
    expect(found!.claim).not.toContain('only seven');
  });

  it('carries the newest raised row from an earlier attempt but never a future attempt', () => {
    const carried = rows.filter((r) => r.payload['attempt'] === 3 || r.event_id === 12400);
    expect(disputeFindingsOf(carried, 4, [])[0]).toMatchObject({ line: 189, council: null });
    const beforeLaterGate = rows.filter((r) => r.event_type !== 'wicked.team.gate.opened' || r.payload['attempt'] === 2);
    expect(disputeFindingsOf(beforeLaterGate, 4, ['f-a330ef2fb1537266'])[0]).toMatchObject({ claim: null, council: null });
    expect(disputeFindingsOf([], 4, ['missing'])[0]).toMatchObject({ id: 'missing', claim: null, council: null });
  });
});

const council = { verdict: 'no', reason: null, seats: ['codex'], seated: 1, returned: 1, agreementPct: 100 };
it('says who and how many voted without calling one seat the team', () => {
  expect(councilLine(council)).toBe('1 seat voted (codex): no, the work does not go on without you');
  expect(councilLine({ ...council, seats: ['claude', 'codex', 'pi'], seated: 3, returned: 3, agreementPct: 67 })).toBe('3 seats voted (claude, codex, pi): no, 67% agreed');
  expect(councilLine({ ...council, seats: ['agy', 'codex', 'pi'], seated: 3, returned: 1 })).toBe('1 of 3 seats voted (seated: agy, codex, pi): no, the work does not go on without you');
  expect(councilLine({ ...council, verdict: 'no_verdict', reason: 'no_quorum', returned: 0 })).toBe('The council could not rule (no quorum)');
});
it('names the monitor and builder and clips long reasons', () => {
  expect(positionLines([{ by: 'monitor pi', position: 'NO — the finding stands', reason: null }])).toEqual(['pi (monitor): NO — the finding stands']);
  const [line] = positionLines([{ by: 'worker claude', position: 'YES', reason: 'x'.repeat(201) }]);
  expect(line).toBe(`claude (builder): YES (${'x'.repeat(200)}…)`);
});
