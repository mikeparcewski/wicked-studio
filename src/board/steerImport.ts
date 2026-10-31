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

/**
 * The doc format the import takes, as a copy-paste starting point (studio#934): the dialog used to
 * say "one rule per item under ## Rules", and a doc written that way was refused because the
 * service reads a FRONTMATTERED doc (core `crates/wicked-governance/STEERING.md` § Import):
 * `id` and `title` are required; each rule is `` - `ID` (severity): statement ``, severity one of
 * info, warn, error, critical. The dialog's "File them under" sets the type, so the example omits
 * `steering_type`.
 */
export function importExampleDoc(today: Date = new Date()): string {
  return [
    '---',
    'id: team-conventions',
    'title: Team conventions',
    'status: active',
    `date: ${today.toISOString().slice(0, 10)}`,
    '---',
    '# Team conventions',
    '',
    '## Rules',
    '',
    '- `DEV-TEAM-1` (warn): Every exported function has a doc comment that says what it returns.',
    '- `DEV-TEAM-2` (error): No commit adds a secret, token or password to the repository.',
    '',
  ].join('\n');
}

/**
 * One skipped import entry: plain words where we know the cause (the engine's text names
 * invariants like INV-S3; studio#689 row 49), and ALWAYS the service's own reason after them
 * (studio#934), less its leading invariant code. A reason we have no plain words for is shown as the
 * service said it, never swallowed into a generic refusal.
 */
export function plainSkip(index: number, reason: string): string {
  // The service's reason is shown, its invariant code is not (studio#689 row 49): "INV-C1: rule id must not be blank"
  // reads "rule id must not be blank".
  const raw = reason.trim().replace(/^INV-[A-Z]+\d+:\s*/u, '');
  const why = /not a frontmattered rule doc|frontmatter fence/i.test(raw) ? 'it doesn’t start with the frontmatter block the format needs (see “The format” above)'
    : /applies_to/i.test(raw) ? 'it doesn’t say where it applies'
    : /\bid\b[^.]*blank/i.test(raw) ? 'it has no id'
    : /\bid\b.*(exists|duplicate)|duplicate/i.test(raw) ? 'a rule with that id already exists'
    : /statement/i.test(raw) ? 'it has no statement'
    : /\bsteering_type\b|\btype\b.*\bseven\b/i.test(raw) ? 'its type isn’t one of the seven'
    : null;
  const head = `Rule ${index + 1} skipped${why !== null ? `: ${why}` : ''}.`;
  if (raw === '' || raw === 'unspecified error') return `${head} Studio’s service gave no reason.`;
  return `${head} Studio’s service said: ${/[.!?]$/.test(raw) ? raw : `${raw}.`}`;
}

export async function importRuleFile(doc: { name: string; content: string }, type: SteeringType): Promise<ImportNote[]> {
  const isJson = doc.name.toLowerCase().endsWith('.json');
  let parsed: unknown = null;
  if (isJson) {
    try {
      parsed = JSON.parse(doc.content);
    } catch {
      return [{ tone: 'fail', text: `${doc.name} is not valid JSON — fix the batch or attach it for analysis instead.` }];
    }
    // Valid JSON that isn't a list (one rule object, null) says so, not "not valid JSON" (agy r1).
    if (!Array.isArray(parsed)) return [{ tone: 'fail', text: `${doc.name} is not a list of rules.` }];
  }
  const entries = isJson
    ? (parsed as Record<string, unknown>[]).map((rule) => ({ kind: 'rule' as const, rule }))
    : [{ kind: 'doc' as const, name: doc.name, content: doc.content }];
  try {
    const { results } = await importSteeringRules({ type, entries });
    const outcomes = results.map((r) => importEntryOutcome(r));
    const ok = outcomes.filter((o) => o.ok).length;
    return [
      { tone: ok === outcomes.length ? 'work' : 'gate', text: `${doc.name}: ${ok} of ${outcomes.length} entr${outcomes.length === 1 ? 'y' : 'ies'} imported.` },
      // studio#689 row 49: a skipped entry says why in plain words, not the engine's invariant log.
      ...outcomes.map((o, i): ImportNote => ({
        tone: o.ok ? 'work' : 'fail',
        text: o.ok ? o.text : isJson ? plainSkip(i, o.reason ?? '') : plainSkip(i, o.reason ?? '').replace(/^Rule \d+ skipped/, `${doc.name} skipped`),
      })),
    ];
  } catch (e) {
    if (isSteeringUnsupported(e)) return [{ tone: 'gate', text: STEERING_UNSUPPORTED_COPY }];
    throw e;
  }
}
