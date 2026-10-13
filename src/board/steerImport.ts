import {
  importEntryOutcome,
  importSteeringRules,
  isSteeringUnsupported,
  STEERING_UNSUPPORTED_COPY,
  type SteeringType,
} from '../api/steering.js';

/**
 * ONE import path for rule files (DES-steer-eval §2.3), shared by the Import dialog and the
 * assistant's "Import directly" fork: a `.json` file is a rule batch (each object its own entry,
 * so a half-good batch reports per rule), anything else is one markdown doctrine doc. Both go
 * through crew's `POST /governance/rules/import` (the governed operator path).
 */

export interface ImportNote { tone: 'work' | 'gate' | 'fail'; text: string }

/** One skipped import entry, in plain words (the engine's text names invariants like INV-S3). */
export function plainSkip(index: number, raw: string): string {
  const why = /applies_to/i.test(raw) ? 'it doesn’t say where it applies'
    : /\bid\b[^.]*blank/i.test(raw) ? 'it has no id'
    : /\bid\b.*(exists|duplicate)|duplicate/i.test(raw) ? 'a rule with that id already exists'
    : /statement/i.test(raw) ? 'it has no statement'
    : /type/i.test(raw) ? 'its type isn’t one of the seven'
    : 'Studio’s service refused it';
  return `Rule ${index + 1} skipped: ${why}.`;
}

export async function importRuleFile(doc: { name: string; content: string }, type: SteeringType): Promise<ImportNote[]> {
  let entries;
  try {
    entries = doc.name.toLowerCase().endsWith('.json')
      ? (JSON.parse(doc.content) as Record<string, unknown>[]).map((rule) => ({ kind: 'rule' as const, rule }))
      : [{ kind: 'doc' as const, name: doc.name, content: doc.content }];
  } catch {
    return [{ tone: 'fail', text: `${doc.name} is not valid JSON — fix the batch or attach it for analysis instead.` }];
  }
  if (!Array.isArray(entries)) return [{ tone: 'fail', text: `${doc.name} is not a list of rules.` }];
  try {
    const { results } = await importSteeringRules({ type, entries });
    const outcomes = results.map((r) => importEntryOutcome(r));
    const ok = outcomes.filter((o) => o.ok).length;
    return [
      { tone: ok === outcomes.length ? 'work' : 'gate', text: `${doc.name}: ${ok} of ${outcomes.length} entr${outcomes.length === 1 ? 'y' : 'ies'} imported.` },
      // studio#689 row 49: a skipped entry says why in plain words, not the engine's invariant log.
      ...outcomes.map((o, i): ImportNote => ({ tone: o.ok ? 'work' : 'fail', text: o.ok ? o.text : plainSkip(i, o.text) })),
    ];
  } catch (e) {
    if (isSteeringUnsupported(e)) return [{ tone: 'gate', text: STEERING_UNSUPPORTED_COPY }];
    throw e;
  }
}
