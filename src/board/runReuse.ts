import type { SessionView } from '../api/types.js';
import type { Preset } from '../api/teamPlan.js';

/**
 * Next-use moves on a finished run (Wave C, idea 11). A finished run on the Runs list carries
 * what it can become, with the consequence said first:
 *
 *   Reuse as preset — saves the run's plan (its catalog-composed steps) as a user preset through
 *                     crew's `PUT /presets/:name`; a later launch names it.
 *   Draft update    — the outbound draft (`GET /runs/:id/deliver-text`) with Copy; sends nothing.
 *
 * ("Turn into eval case" is not offered: crew has no route that takes a run as an eval case — its
 * only eval write, `POST /testing/corpora/import`, takes steering samples, not runs.)
 */

/** One step of a preset, as `PUT /presets/:name` takes it. */
export interface PresetStepDraft {
  catalog: string;
  id: string;
}

/** Steps a launch adds on its own, never part of the plan a person reuses: the PA's scoping
 *  step (added while the plan has no touch set) and delivery (chosen per launch). */
const RUN_MACHINERY = new Set(['pa-scope', 'deliver']);

const FINISHED = new Set(['completed', 'failed', 'cancelled']);

export function isFinished(status: string): boolean {
  return FINISHED.has(status);
}

/**
 * The run's plan as preset steps: its units that were planned from the phase catalog (a preset or
 * a user plan carries `catalog` on each), in order, one per step id. Empty for a run on a
 * registered workflow or the free-text planner — there is no catalog plan to reuse.
 */
export function presetStepsOf(view: SessionView): PresetStepDraft[] {
  const runId = view.session.id;
  const seen = new Set<string>();
  const out: PresetStepDraft[] = [];
  for (const u of [...view.units].sort((a, b) => a.ord - b.ord)) {
    const catalog = (u as { catalog?: unknown }).catalog;
    if (typeof catalog !== 'string' || catalog === '') continue;
    const id = u.id.startsWith(`${runId}:`) ? u.id.slice(runId.length + 1) : u.id;
    if (id === '' || seen.has(id) || RUN_MACHINERY.has(id) || RUN_MACHINERY.has(catalog)) continue;
    seen.add(id);
    out.push({ catalog, id });
  }
  return out;
}

/** The engine's rule for a preset name. */
export const PRESET_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** A name to start from: the run's intent as a slug, else `run-<short id>`. */
export function defaultPresetName(view: SessionView): string {
  const slug = (view.session.problem ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug !== '' ? slug : `run-${view.session.id.slice(0, 8)}`;
}

export interface ReuseConsequence {
  text: string;
  /** The save cannot be sent as it stands (a bad name, a built-in's name, no steps). */
  blocked: boolean;
  /** Blocked only until the presets are read — not a refusal. */
  waiting?: boolean;
}

/**
 * What "Save preset" will do, said before it is pressed. `existing` is the daemon's global preset
 * list (`GET /presets`), `'loading'` while it is being read (the save waits), or `null` when it
 * could not be read (then a same-named preset may be replaced, and the line says so).
 */
export function reuseConsequence(
  steps: readonly PresetStepDraft[],
  name: string,
  existing: readonly Preset[] | 'loading' | null,
): ReuseConsequence {
  if (steps.length === 0) return { text: 'This run has no catalog plan to reuse.', blocked: true };
  const trimmed = name.trim();
  if (!PRESET_NAME_RE.test(trimmed)) {
    return { text: 'A preset name is 1 to 64 letters, digits, dots, dashes or underscores.', blocked: true };
  }
  const plural = steps.length === 1 ? 'step' : 'steps';
  const chain = steps.map((s) => s.id).join(' → ');
  const list = Array.isArray(existing) ? existing : null;
  const same = list?.find((p) => p.name === trimmed && p.scope === 'global');
  if (same !== undefined && same.created_by === 'builtin') {
    return { text: `“${trimmed}” is a built-in preset and cannot be replaced. Pick another name.`, blocked: true };
  }
  const base = `Saves this run's ${steps.length} ${plural} (${chain}) as the preset “${trimmed}” for every project. `
    + 'A launch that names it runs the same plan; this run is not changed.';
  if (same !== undefined) {
    return { text: `${base} Replaces your preset “${trimmed}” (${same.steps.length} ${same.steps.length === 1 ? 'step' : 'steps'}).`, blocked: false };
  }
  // Still reading the presets: say nothing about a replacement yet, and hold the save until it is known.
  if (existing === 'loading') return { text: base, blocked: true, waiting: true };
  if (existing === null) return { text: `${base} A preset already named “${trimmed}” would be replaced.`, blocked: false };
  return { text: base, blocked: false };
}
