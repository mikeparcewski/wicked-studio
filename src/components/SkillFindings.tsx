import { portabilityReasonCopy, type SkillConflictFinding, type SkillGuardResult, type SkillVerdict } from '../api/skills.js';

/**
 * The guard envelope of ONE write / enable / publish / analyze (`{verdict, findings, revision}` —
 * api-types 0.27.0 `SkillAnalyzeResult`, the base of every mutation result), rendered honestly:
 * the verdict line names the verb and the outcome (`clear` — no findings; `warnings` — proceeded,
 * read them; `blocked` — REFUSED, nothing was written), then every finding GENERICALLY — whatever
 * its `kind` (the contract's `SkillFindingKind` grows; nothing here enumerates it): the guard that
 * fired, its severity, the skill it is about, the OTHER skill it is against (a collision, a core
 * guard — marked when that one is core), the `file:line` the daemon cited, the concrete EVIDENCE
 * (names, paths, the parse error) and the explanation of why it matters. A `non-portable` finding
 * that names WHICH reason it reports (`portabilityReason`, api-types 0.34.0 — one finding per reason
 * per file) wears that token as a chip whose hover is the reason's one-clause "why"; absent on every
 * other kind, and on older daemons.
 */

export const VERDICT_COLOR: Record<SkillVerdict, string> = {
  clear: 'var(--status-done)',
  warnings: 'var(--status-gate)',
  blocked: 'var(--status-fail)',
};

function verdictLine(verb: string, result: SkillGuardResult): string {
  const n = result.findings.length;
  const plural = n === 1 ? 'finding' : 'findings';
  if (result.verdict === 'blocked') return `${verb} blocked — nothing was written (${n} ${plural}).`;
  if (result.verdict === 'warnings') return `${verb} passed with ${n} ${plural} to read.`;
  return n === 0 ? `${verb} clear — no findings.` : `${verb} clear (${n} ${plural}).`;
}

/** `file` alone, or `file:line` when the daemon cited a line. */
export function findingLocation(f: Pick<SkillConflictFinding, 'file' | 'line'>): string | null {
  if (f.file === null) return null;
  return f.line === null ? f.file : `${f.file}:${f.line}`;
}

export function SkillFindings({ verb, result, testId }: {
  /** The verb the result answers — "Save", "Enable", "Reset", "Publish"… */
  verb: string;
  result: SkillGuardResult;
  testId: string;
}): React.ReactElement {
  const color = VERDICT_COLOR[result.verdict];
  const blocking = result.findings.filter((f) => f.severity === 'blocking').length;
  const warnings = result.findings.length - blocking;
  return (
    <div
      data-testid={testId}
      data-verdict={result.verdict}
      data-revision={result.revision}
      role="status"
      className="flex flex-col gap-1.5 rounded px-3 py-2 text-[11px]"
      style={{ background: 'var(--surface-rail)', border: `1px solid ${color}` }}
    >
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold" style={{ color }}>{verdictLine(verb, result)}</span>
        {result.findings.length > 0 && (
          <span data-testid="skills-findings-tally" className="font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            {blocking} blocking · {warnings} {warnings === 1 ? 'warning' : 'warnings'}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }} title="the catalog revision after this call">rev {result.revision}</span>
      </p>
      {result.findings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {result.findings.map((f, i) => {
            const location = findingLocation(f);
            return (
              <li
                key={`${f.kind}-${i}`}
                data-testid="skills-finding"
                data-kind={f.kind}
                data-severity={f.severity}
                className="flex flex-col gap-0.5"
                style={{ color: 'var(--ink-muted)' }}
              >
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="rounded px-1.5 text-[10px] font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)' }}>
                    {f.kind}
                  </span>
                  <span className="text-[10px] font-mono uppercase" style={{ color: f.severity === 'blocking' ? 'var(--status-fail)' : 'var(--status-gate)' }}>
                    {f.severity}
                  </span>
                  {f.skill !== null && (
                    <span data-testid="skills-finding-skill" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>{f.skill}</span>
                  )}
                  {f.againstSkill !== null && (
                    <span data-testid="skills-finding-against" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                      against {f.againstSkill}{f.againstIsCore ? ' (core)' : ''}
                    </span>
                  )}
                  {location !== null && (
                    <code data-testid="skills-finding-location" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>{location}</code>
                  )}
                  {f.portabilityReason != null && (
                    <span
                      data-testid="skills-finding-reason"
                      data-reason={f.portabilityReason}
                      title={portabilityReasonCopy(f.portabilityReason)}
                      className="rounded px-1.5 text-[10px] font-mono"
                      style={{ background: 'var(--status-gate-dim)', color: 'var(--ink-high)', border: '1px solid var(--status-gate)' }}
                    >
                      {f.portabilityReason}
                    </span>
                  )}
                </span>
                {f.evidence !== '' && (
                  <code data-testid="skills-finding-evidence" className="break-all text-[10px] font-mono" style={{ color: 'var(--ink-high)' }}>{f.evidence}</code>
                )}
                <span>{f.explanation}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
