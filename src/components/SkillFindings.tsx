import type { SkillFinding, SkillGuardResult, SkillVerdict } from '../api/skills.js';

/**
 * The guard envelope of ONE write / enable / publish / analyze, rendered honestly: the verdict
 * line names the verb and the outcome (`clear` — no findings; `warnings` — passed, read them;
 * `blocked` — REFUSED, nothing was written), then every finding with the guard that fired, its
 * severity, the skill it is against, and the `file:line` the daemon cited.
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
export function findingLocation(f: SkillFinding): string | null {
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
  return (
    <div
      data-testid={testId}
      data-verdict={result.verdict}
      role="status"
      className="flex flex-col gap-1.5 rounded px-3 py-2 text-[11px]"
      style={{ background: 'var(--surface-rail)', border: `1px solid ${color}` }}
    >
      <p className="font-semibold" style={{ color }}>{verdictLine(verb, result)}</p>
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
                  <span className="text-[10px] font-mono uppercase" style={{ color: f.severity === 'blocking' ? 'var(--status-fail)' : 'var(--ink-dim)' }}>
                    {f.severity}
                  </span>
                  {f.skill !== null && (
                    <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>against {f.skill}</span>
                  )}
                  {location !== null && (
                    <code data-testid="skills-finding-location" className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>{location}</code>
                  )}
                </span>
                <span>{f.explanation}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
