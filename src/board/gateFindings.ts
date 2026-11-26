import type { TeamRow } from '../api/teamPlan.js';

export interface FindingPosition {
  by: string;
  position: string;
  reason: string | null;
}

export interface FindingCouncil {
  verdict: string | null;
  reason: string | null;
  seats: string[];
  seated: number | null;
  returned: number | null;
  agreementPct: number | null;
  /** (wicked-core#1822) Why, in words, on a `not_convened` no-verdict ("the step ended before its turn"); else null. */
  detail?: string | null;
}

export interface DisputeFinding {
  id: string;
  severity: string | null;
  path: string | null;
  line: number | null;
  claim: string | null;
  raisedBy: string | null;
  positions: FindingPosition[];
  council: FindingCouncil | null;
}

const words = (value: unknown): string | null => typeof value === 'string' ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function newest(rows: readonly TeamRow[], match: (row: TeamRow) => boolean): TeamRow | undefined {
  return rows.reduce<TeamRow | undefined>((best, row) => match(row) && (best === undefined || row.event_id > best.event_id) ? row : best, undefined);
}

/** The newest dispute for this unit pins the attempt; ids and finding subjects are only unique inside it. */
export function disputeFindingsOf(rows: readonly TeamRow[], ord: number, ids: readonly string[]): DisputeFinding[] {
  const unit = rows.filter((r) => r.payload['ord'] === ord);
  const opened = newest(unit, (r) => r.event_type === 'wicked.team.gate.opened' && r.payload['kind'] === 'team_dispute');
  const attempt = number(opened?.payload['attempt']);
  const findingIds = ids.length > 0 ? ids : strings(opened?.payload['finding_ids']);
  return findingIds.map((id) => {
    const raisedId = (r: TeamRow): boolean => r.event_type === 'wicked.team.finding.raised' && r.payload['finding_id'] === id;
    const raised = attempt === null ? undefined
      : newest(unit, (r) => raisedId(r) && r.payload['attempt'] === attempt)
        ?? newest(unit, (r) => raisedId(r) && number(r.payload['attempt']) !== null && (r.payload['attempt'] as number) <= attempt);
    const called = attempt === null ? undefined : newest(unit, (r) => r.event_type === 'wicked.team.council.called'
      && r.payload['finding_id'] === id && r.payload['attempt'] === attempt);
    const ruled = attempt === null || raised === undefined ? undefined : newest(unit, (r) => r.event_type === 'wicked.team.council.ruled'
      && r.payload['subject'] === `finding:${raised.payload['raise_seq']}` && r.payload['attempt'] === attempt);
    const p = raised?.payload;
    const c = ruled?.payload;
    const positions = called?.payload['positions'];
    return {
      id, severity: words(p?.['severity']), path: words(p?.['path']), line: number(p?.['line']), claim: words(p?.['claim']), raisedBy: words(p?.['by']),
      positions: Array.isArray(positions) ? positions.flatMap((position: unknown) => {
        if (typeof position !== 'object' || position === null) return [];
        const v = position as Record<string, unknown>;
        return typeof v['by'] === 'string' && typeof v['position'] === 'string'
          ? [{ by: v['by'], position: v['position'], reason: words(v['reason']) }] : [];
      }) : [],
      council: c === undefined ? null : {
        verdict: words(c['verdict']), reason: words(c['reason']), seats: strings(c['seats']),
        seated: number(c['seated']), returned: number(c['returned']), agreementPct: number(c['agreement_pct']),
        detail: words(c['detail']),
      },
    };
  });
}

/** Say the ballot count, rather than attributing a single seat's ruling to the whole team. */
export function councilLine(c: FindingCouncil): string {
  // (studio#1447 T-S3, wicked-core#1822) No ballot ever started: never a council that sat and could not rule.
  if (c.verdict === 'no_verdict' && c.reason === 'not_convened') return `The council never started${c.detail ? `: ${c.detail}` : ''}`;
  if (c.verdict === 'no_verdict') return `The council could not rule${c.reason === null ? '' : ` (${c.reason.replace(/_/g, ' ')})`}`;
  const count = c.returned ?? c.seated ?? c.seats.length;
  const seated = c.seated ?? c.seats.length;
  const named = c.seats.length > 0 ? ` (${count < seated ? 'seated: ' : ''}${c.seats.join(', ')})` : '';
  const voters = count < seated ? `${count} of ${seated} seats voted${named}` : `${count} seat${count === 1 ? '' : 's'} voted${named}`;
  const ruling = c.verdict ?? 'no verdict recorded';
  const meaning = count === 1 && c.verdict === 'no' ? ', the work does not go on without you'
    : count === 1 && c.verdict === 'yes' ? ', the work can go on'
      : c.agreementPct === null ? '' : `, ${c.agreementPct}% agreed`;
  return `${voters}: ${ruling}${meaning}`;
}

/** The council's two sides in the words on the record, with worker said as builder. */
export function positionLines(positions: readonly FindingPosition[]): string[] {
  return positions.map((p) => {
    const side = /^(worker|monitor)\s+(.+)$/.exec(p.by);
    const who = side === null ? p.by : `${side[2]} (${side[1] === 'worker' ? 'builder' : 'monitor'})`;
    const reason = p.reason === null || p.reason === '' ? '' : ` (${p.reason.length > 200 ? `${p.reason.slice(0, 200)}…` : p.reason})`;
    return `${who}: ${p.position}${reason}`;
  });
}
