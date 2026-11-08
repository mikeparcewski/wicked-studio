import { ago } from './AgeStamp.js';
import {
  SIGNAL_LABEL,
  USAGE_SIGNALS,
  cliFamily,
  cliLabel,
  isUsageUnavailable,
  usageVerdict,
  type SkillUsageResponse,
  type SkillUsageRow,
  type SkillUsageUnavailable,
} from '../api/skillUsage.js';

/**
 * Skill usage on the Skills page (operator 2026-11-08: "so we know which ones we can turn off over time"). Read-only:
 * the page shows the data and the operator decides; nothing here turns a skill off.
 *
 * - {@link UsageChip}: one phrase per catalog row: used N ago by a CLI, not used since generation N, or not observable.
 * - {@link SkillUsagePanel}: the drawer's table: per CLI, each signal's uses in 30 and 90 days and the last time.
 */

/** The row phrase. `now` is passed in so a test pins it. */
export function UsageChip({ row, sinceGen, now }: { row: SkillUsageRow | undefined; sinceGen: number | null; now: number }): React.ReactElement | null {
  const v = usageVerdict(row, sinceGen);
  if (v.kind === 'not-handed') return null;
  if (v.kind === 'used') {
    return (
      <span data-testid="skills-usage-chip" data-usage="used" className="wk-tag" title={`Last opened or run ${new Date(v.at).toLocaleString()} by ${cliLabel(v.cli)}`}>
        Used {ago(v.at, now)} ago · {cliLabel(v.cli)}
      </span>
    );
  }
  if (v.kind === 'unused') {
    return (
      <span data-testid="skills-usage-chip" data-usage="unused" className="wk-tag" style={{ color: 'var(--warn, var(--ink-muted))' }}
        title="Handed to a helper whose use can be seen, and never opened or run since">
        Not used{v.sinceGen !== null ? ` since gen ${v.sinceGen}` : ''}
      </span>
    );
  }
  return (
    <span data-testid="skills-usage-chip" data-usage="not-observable" className="wk-tag" style={{ color: 'var(--ink-dim)' }}
      title="Handed only to helpers whose use cannot be seen, so it cannot be called unused">
      Use not visible
    </span>
  );
}

/** The drawer's usage table for one skill. */
export function SkillUsagePanel({ usage, name, now }: { usage: SkillUsageResponse | SkillUsageUnavailable | undefined; name: string; now: number }): React.ReactElement {
  const heading = <h3 id="skills-usage-heading" className="wk-field-label">Usage</h3>;
  if (usage === undefined) {
    return (
      <section data-testid="skills-usage" data-state="loading" aria-labelledby="skills-usage-heading" className="flex flex-col gap-1">
        {heading}
        <p className="wk-field-note">Reading usage…</p>
      </section>
    );
  }
  if (isUsageUnavailable(usage)) {
    return (
      <section data-testid="skills-usage" data-state={usage.unavailable} aria-labelledby="skills-usage-heading" className="flex flex-col gap-1">
        {heading}
        <p className="wk-field-note">
          {usage.unavailable === 'unsupported'
            ? 'This crew does not record skill usage yet. Update wicked-crew to see which helpers use this skill.'
            : 'Usage could not be read just now. Refresh to try again.'}
        </p>
      </section>
    );
  }
  const row = usage.skills.find((r) => r.name === name);
  const clis = Object.keys(row?.byCli ?? {}).sort((a, b) => cliLabel(a).localeCompare(cliLabel(b)));
  const since = usage.recordingSince;
  return (
    <section data-testid="skills-usage" data-state="ready" aria-labelledby="skills-usage-heading" className="flex flex-col gap-2">
      {heading}
      <p data-testid="skills-usage-summary" className="wk-field-note">
        {row?.lastUsed ? <>Last used {ago(row.lastUsed.at, now)} ago by {cliLabel(row.lastUsed.cli)}. </> : <>No use recorded. </>}
        {row?.introduced ? <>Introduced in generation {row.introduced.seeded ? '≤ ' : ''}{row.introduced.gen}. </> : null}
        {since !== null ? <>Recording since {since.gen !== null ? `generation ${since.gen}, ` : ''}{new Date(since.at).toLocaleDateString()}.</> : null}
      </p>
      {row?.unusedSince.all && (
        <p data-testid="skills-usage-unused" className="wk-field-note">
          Handed to {row.unusedSince.byCli.map(cliLabel).join(', ')}, with no opening or script run recorded {usage.sinceGen !== null ? `since generation ${usage.sinceGen}` : 'since recording began'}.
        </p>
      )}
      {row?.unusedSince.notObservable && (
        <p data-testid="skills-usage-not-observable" className="wk-field-note">Handed only to helpers whose use cannot be seen, so it cannot be called unused.</p>
      )}
      {clis.length === 0 ? (
        <p className="wk-field-note">No helper was handed or used this skill since recording began.</p>
      ) : (
        <div className="wk-table-wrap" style={{ overflowX: 'auto' }}>
          {/* A phone reads one helper per block; a wider drawer reads the table. */}
          <ul data-testid="skills-usage-stack" className="flex flex-col gap-2 sm:hidden" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {clis.map((cli) => {
              const c = row?.byCli[cli];
              if (c === undefined) return null;
              const lastAt = Math.max(c.opened.lastAt ?? 0, c.ran.lastAt ?? 0);
              const seen = (usage.observable[cliFamilyOf(cli, usage)]?.signals.length ?? 0) > 0;
              return (
                <li key={cli} data-testid="skills-usage-cli-stack" data-cli={cli} className="flex flex-col gap-1" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <span style={{ fontWeight: 'var(--weight-semi)' }}>
                    {cliLabel(cli)}
                    {!seen && <span className="wk-field-note"> (use not visible)</span>}
                    <span className="wk-field-note"> · last used {!seen ? 'not visible' : lastAt > 0 ? `${ago(lastAt, now)} ago` : 'never'}</span>
                  </span>
                  <span className="wk-field-note" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {USAGE_SIGNALS.map((s) => `${SIGNAL_LABEL[s]} ${c[s].d30} · ${c[s].d90}`).join('  ·  ')}
                  </span>
                </li>
              );
            })}
          </ul>
          <table data-testid="skills-usage-table" className="wk-table hidden sm:table" style={{ fontSize: 'var(--text-sm)', width: '100%' }}>
            <caption className="sr-only">Uses per helper: each cell is the last 30 days, then the last 90 days. Opened and ran a script count as use.</caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left' }}>Helper</th>
                {USAGE_SIGNALS.map((s) => (
                  <th key={s} scope="col" style={{ textAlign: 'right' }} title="Uses in the last 30 days · last 90 days">{SIGNAL_LABEL[s]}</th>
                ))}
                <th scope="col" style={{ textAlign: 'right' }}>Last used</th>
              </tr>
            </thead>
            <tbody>
              {clis.map((cli) => {
                const c = row?.byCli[cli];
                if (c === undefined) return null;
                const lastAt = Math.max(c.opened.lastAt ?? 0, c.ran.lastAt ?? 0);
                const seen = (usage.observable[cliFamilyOf(cli, usage)]?.signals.length ?? 0) > 0;
                return (
                  <tr key={cli} data-testid="skills-usage-cli" data-cli={cli}>
                    <th scope="row" style={{ textAlign: 'left', fontWeight: 'var(--weight-semi)' }}>
                      {cliLabel(cli)}
                      {!seen && <span className="wk-field-note"> (use not visible)</span>}
                    </th>
                    {USAGE_SIGNALS.map((s) => (
                      <td key={s} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} data-signal={s}>
                        {c[s].d30} · {c[s].d90}
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{!seen ? 'not visible' : lastAt > 0 ? `${ago(lastAt, now)} ago` : 'never'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="wk-field-note">Each cell: uses in the last 30 days · last 90 days. Opened and ran count as use; told to use and looked over do not.</p>
        </div>
      )}
    </section>
  );
}

/** The `observable` family a seat key belongs to (`codex-2` → `codex`). */
function cliFamilyOf(cli: string, usage: SkillUsageResponse): string {
  const { family } = cliFamily(cli);
  return Object.hasOwn(usage.observable, family) ? family : cli.toLowerCase();
}
