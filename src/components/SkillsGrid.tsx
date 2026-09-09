import { SKILL_KINDS, isSkillKind, type SkillRow } from '../api/skills.js';
import { FilterStrip } from './dashboardKit.js';
import { EnabledToggle, KindChip, ProvenanceChip, SkillFlags } from './SkillChips.js';

/**
 * The skills CATALOG — one row per skill in the manifest: name · kind · provenance · flags (core /
 * claude-only / conflict / unpublished) · the enabled switch. A row click opens the drawer (the
 * SteeringGrid row/drawer-open idiom); the switch is the ONE inline write — it flips through the
 * daemon's guards and the row shows the manifest's answer, never an optimistic one.
 *
 * Facets stay client-side over the one manifest fetch (FilterStrip: search + ONE chip — every
 * kind, plus the state cuts the KPI tiles open). NOT virtualized on purpose: the catalog is ~140
 * rows.
 */

/** The facet chips — the three kinds plus the state cuts the KPI tiles are doors into. */
export const SKILL_CHIPS = ['all', ...SKILL_KINDS, 'enabled', 'disabled', 'overridden', 'core', 'portable', 'claude-only'] as const;

export type SkillChip = (typeof SKILL_CHIPS)[number];

export interface SkillsFacets {
  query: string;
  chip: SkillChip;
}

export const SKILLS_FACETS_DEFAULT: SkillsFacets = { query: '', chip: 'all' };

/** The facet predicate over the manifest rows — pinned by unit test so the chip counts, the
 *  KPI tiles and the table agree. */
export function filterSkills(rows: readonly SkillRow[], f: SkillsFacets): SkillRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (isSkillKind(f.chip) && r.kind !== f.chip) return false;
    if (f.chip === 'enabled' && !r.enabled) return false;
    if (f.chip === 'disabled' && r.enabled) return false;
    if (f.chip === 'overridden' && r.provenance !== 'override') return false;
    if (f.chip === 'core' && !r.core) return false;
    if (f.chip === 'portable' && !r.portable) return false;
    if (f.chip === 'claude-only' && r.portable) return false;
    if (q !== '' && !r.name.toLowerCase().includes(q) && !r.dir.toLowerCase().includes(q)) return false;
    return true;
  });
}

const TH: React.CSSProperties = {
  color: 'var(--ink-dim)',
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 'var(--weight-semi)',
  textAlign: 'left',
};

export function SkillsGrid({ rows, facets, onFacets, selectedName, busyName, frozen, onSelect, onToggle }: {
  rows: readonly SkillRow[];
  facets: SkillsFacets;
  onFacets: (next: SkillsFacets) => void;
  /** The skill whose drawer is open — its row reads selected. */
  selectedName: string | null;
  /** The skill with a write in flight — its switch waits. */
  busyName: string | null;
  /** The catalog changed under the page (a revision conflict) — every switch waits for the reload. */
  frozen: boolean;
  onSelect: (name: string) => void;
  onToggle: (row: SkillRow) => void;
}): React.ReactElement {
  const shown = filterSkills(rows, facets);
  const count = (chip: SkillChip): number => filterSkills(rows, { query: facets.query, chip }).length;

  return (
    <div data-testid="skills-grid" className="flex min-w-0 flex-col gap-2">
      <FilterStrip
        testId="skills-filter"
        query={facets.query}
        onQuery={(q) => onFacets({ ...facets, query: q })}
        placeholder="Search skill name or dir…"
        chips={SKILL_CHIPS.map((c) => ({ id: c, label: c, count: count(c) }))}
        active={facets.chip}
        onChip={(id) => onFacets({ ...facets, chip: id as SkillChip })}
      />

      {shown.length === 0 ? (
        <p data-testid="skills-grid-empty" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          {rows.length === 0 ? 'The manifest lists no skills.' : 'No skills match these filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--surface-raised)' }}>
          <table className="w-full border-collapse" style={{ minWidth: '40rem' }}>
            <thead>
              <tr style={{ background: 'var(--surface-rail)' }}>
                <th className="px-2 py-1.5" style={TH}>Skill</th>
                <th className="px-2 py-1.5" style={TH}>Kind</th>
                <th className="px-2 py-1.5" style={TH}>Provenance</th>
                <th className="px-2 py-1.5" style={TH}>Flags</th>
                <th className="px-2 py-1.5" style={{ ...TH, textAlign: 'right' }}>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const selected = r.name === selectedName;
                return (
                  <tr
                    key={r.name}
                    data-testid="skills-row"
                    data-skill={r.name}
                    data-enabled={r.enabled}
                    aria-selected={selected}
                    onClick={() => onSelect(r.name)}
                    className="cursor-pointer align-middle transition-colors"
                    style={{
                      borderTop: '1px solid var(--surface-raised)',
                      background: selected ? 'var(--accent-subtle)' : 'transparent',
                      opacity: r.enabled ? 1 : 0.6,
                    }}
                  >
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        data-testid="skills-row-name"
                        aria-label={`Open ${r.name}`}
                        onClick={(e) => { e.stopPropagation(); onSelect(r.name); }}
                        className="block max-w-[28rem] truncate text-left font-mono text-[11px] hover:underline focus:outline-none focus-visible:ring-1"
                        style={{ color: 'var(--ink-high)', background: 'transparent' }}
                        title={r.dir}
                      >
                        {r.name}
                      </button>
                      <span className="block truncate font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>{r.dir}</span>
                    </td>
                    <td className="px-2 py-1.5"><KindChip kind={r.kind} /></td>
                    <td className="px-2 py-1.5"><ProvenanceChip provenance={r.provenance} /></td>
                    <td className="px-2 py-1.5"><SkillFlags skill={r} /></td>
                    <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <EnabledToggle
                        testId="skills-toggle"
                        name={r.name}
                        enabled={r.enabled}
                        busy={frozen || busyName === r.name}
                        onToggle={() => onToggle(r)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
