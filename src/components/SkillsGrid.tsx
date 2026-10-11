import { SKILL_KINDS, isSkillKind, skillPortability, type SkillRow } from '../api/skills.js';
import { SectionTitle } from './ui/PageFrame.js';
import { EmptyState } from './ui/StateBanner.js';
import { EnabledToggle, KindChip, ProvenanceChip, SkillFlags } from './SkillChips.js';

/**
 * The skills CATALOG — one row per skill in the manifest: name · kind · provenance · flags (core /
 * not portable · needs Claude harness / conflict / unpublished) · the enabled switch. A row click opens the drawer (the
 * SteeringGrid row/drawer-open idiom); the switch is the ONE inline write — it flips through the
 * daemon's guards and the row shows the manifest's answer, never an optimistic one.
 *
 * Facets stay client-side over the one manifest fetch (FilterStrip: search + ONE chip — every
 * kind, plus the state cuts the KPI tiles open). NOT virtualized on purpose: the catalog is ~140
 * rows.
 */

/** The facet chips — the three kinds plus the state cuts the KPI tiles are doors into. The reach
 *  split (`portable` · `not-portable` · `needs-claude`, 0.34.0 / F-079) replaces `claude-only`. */
export const SKILL_CHIPS = ['all', ...SKILL_KINDS, 'enabled', 'disabled', 'overridden', 'core', 'portable', 'not-portable', 'needs-claude'] as const;

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
    if (f.chip === 'not-portable' && skillPortability(r).reach !== 'not-portable') return false;
    if (f.chip === 'needs-claude' && skillPortability(r).reach !== 'needs-claude') return false;
    if (q !== '' && !r.name.toLowerCase().includes(q) && !r.dir.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function SkillsGrid({ rows, facets, onFacets, selectedName, busyName, frozen, countsKnown = true, onSelect, onToggle }: {
  rows: readonly SkillRow[];
  facets: SkillsFacets;
  onFacets: (next: SkillsFacets) => void;
  /** The skill whose drawer is open — its row reads selected. */
  selectedName: string | null;
  /** The skill with a write in flight — its switch waits. */
  busyName: string | null;
  /** Writes are frozen page-wide (a revision conflict, a stale catalog, a write or page verb in
   *  flight) — every switch waits. */
  frozen: boolean;
  countsKnown?: boolean;
  onSelect: (name: string) => void;
  onToggle: (row: SkillRow) => void;
}): React.ReactElement {
  const shown = filterSkills(rows, facets);
  const count = (chip: SkillChip): number => filterSkills(rows, { query: facets.query, chip }).length;

  return (
    <section data-testid="skills-grid" className="wk-card wk-pg-skills-catalog">
      <SectionTitle>Skill catalog</SectionTitle>
      <div data-testid="skills-filter" data-filter={facets.chip} className="flex min-w-0 flex-col gap-2">
        <label className="wk-pg-skills-search">
          <span className="wk-field-label">Search skills</span>
          <input data-testid="skills-filter-search" className="wk-field" value={facets.query}
            placeholder="Search by skill name or folder" onChange={(e) => onFacets({ ...facets, query: e.target.value })} />
        </label>
        <div className="wk-pg-skills-filters" aria-label="Filter skills">
          {SKILL_CHIPS.filter((c) => !countsKnown || count(c) > 0 || c === facets.chip).map((c) => (
            <button key={c} type="button" data-testid="skills-filter-chip" data-chip={c}
              aria-pressed={facets.chip === c} className={`wk-chip${facets.chip === c ? ' wk-chip--active' : ''}`}
              data-active={facets.chip === c ? 'true' : 'false'}
              onClick={() => onFacets({ ...facets, chip: c })}>
              {c === 'all' ? 'All' : c === 'fork-worker' ? 'Worker' : c === 'needs-claude' ? 'Needs Claude' : c === 'not-portable' ? 'Not portable' : c.charAt(0).toUpperCase() + c.slice(1)} {countsKnown ? count(c) : null}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState data-testid="skills-grid-empty" title={rows.length === 0 ? 'No skills yet' : 'No matching skills'}
          body={rows.length === 0 ? 'Add a skill to make it available to your helpers.' : 'Try another search or filter.'} />
      ) : (
        <ul className="wk-pg-skills-list">
          {shown.map((r) => (
            <li key={r.name} data-testid="skills-row" data-skill={r.name} data-enabled={r.enabled}
              aria-current={r.name === selectedName ? 'true' : undefined} data-selected={r.name === selectedName}
              data-contradiction={skillPortability(r).contradiction ?? undefined}
              className="wk-list-row wk-pg-skills-row" onClick={() => onSelect(r.name)}>
              <div className="min-w-0">
                <button type="button" data-testid="skills-row-name" aria-label={`Open ${r.name}`}
                  className="wk-btn wk-btn--quiet wk-pg-skills-name"
                  onClick={(e) => { e.stopPropagation(); onSelect(r.name); }}>{r.name}</button>
                <div className="wk-list-row-meta flex flex-wrap gap-2">
                  <KindChip kind={r.kind} /><ProvenanceChip provenance={r.provenance} /><SkillFlags skill={r} />
                </div>
              </div>
              <div className="wk-list-row-actions" onClick={(e) => e.stopPropagation()}>
                <EnabledToggle testId="skills-toggle" name={r.name} enabled={r.enabled}
                  busy={frozen || busyName === r.name} onToggle={() => onToggle(r)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
