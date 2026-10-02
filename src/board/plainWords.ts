/**
 * The vocabulary model (DES-studio-rebuild S3; DESIGN-simple §3): every technical term the
 * platform speaks, the plain wording the default layer uses instead, and where the term itself
 * still lives (in technical details, or in an object's sheet). One row per §3 row, in order;
 * `tests/plainWords.test.ts` pins the list against the design.
 *
 * Pure data plus one lookup. Surfaces that replace a technical word ask `plainWord(term)`;
 * the technical word itself goes into a `<Tech>` handle, shown only with technical details on.
 */

export interface PlainWordRow {
  /** The §3 "Technical term" cell, verbatim. */
  term: string;
  /** Lower-case lookup keys for the term (each key belongs to exactly one row). */
  aliases: readonly string[];
  /** The plain wording, first is the usual one; `null` = not shown in the default layer. */
  plain: readonly string[] | null;
  /** Where the technical term still lives. */
  where: string;
  /** For rows whose `plain` entries are parallel alternatives (one per alias, e.g. the mode
   *  codes or ADVISORY / BLOCKING): alias → index into `plain`, or `null` when the design gives
   *  that alias no plain wording. An alias not listed here gets the usual wording, `plain[0]`. */
  aliasPlain?: Readonly<Record<string, number | null>>;
}

export const PLAIN_WORDS: readonly PlainWordRow[] = [
  { term: 'PLAN GATE / gate / effect gate', aliases: ['plan gate', 'gate', 'effect gate'],
    plain: ['Waiting on you', 'the check before it counts as done'], where: 'Tech · question sheet › What it’s based on' },
  { term: 'unit (U1–U6)', aliases: ['unit'], plain: ['step'], where: 'Tech · step sheet' },
  { term: 'worker (w1–w6)', aliases: ['worker'], plain: ['helper'], where: 'Tech · session sheet › Helpers' },
  { term: 'seat (claude, codex, pi, agy, copilot)', aliases: ['seat'],
    plain: ['an AI helper'], where: 'Tech (rail subline) · helper sheet › Sign-in and allowance' },
  { term: 'seat lapsed · 401', aliases: ['seat lapsed', '401'],
    plain: ['An AI helper needs signing in again'], where: 'Tech · Sign-ins sheet' },
  { term: 'lane A / B', aliases: ['lane'], plain: ['first part', 'second part'], where: 'Tech · plan timeline' },
  { term: 'worktree', aliases: ['worktree'],
    plain: ['its own copy of the code', 'copies of finished work'], where: 'Tech · helper terminal header · Space sheet' },
  { term: 'run id (r-88)', aliases: ['run id'], plain: ['the build'], where: 'Tech (header, progress line)' },
  { term: 'DoD 4/9 claimed · 3 verified', aliases: ['dod'],
    plain: ['N of M steps done and checked', 'N more say they’re done but aren’t checked yet'], where: 'Tech (progress line)' },
  { term: 'CLAIMED / VERIFIED / CONTRADICTED / STALLED 18M', aliases: ['claimed', 'verified', 'contradicted', 'stalled'],
    plain: ['says it’s done, being checked', 'done and checked', 'says it’s finished, but nothing new in a while'],
    aliasPlain: { claimed: 0, verified: 1, contradicted: null, stalled: 2 },
    where: 'Tech · step sheet › Live events' },
  { term: 'REFUSED BY GATE · POL-kes-0019', aliases: ['refused by gate'],
    plain: ['Sent back by your rule'], where: 'Tech · rule sheet › Where it was used' },
  { term: 'OOM · killed · retried', aliases: ['oom', 'killed', 'retried'],
    plain: ['One helper hit a snag and restarted itself', 'Fixed'], where: 'Tech · Watchtower' },
  { term: 'policy / POL-kes-0019 / cand-kes-0007', aliases: ['policy', 'policy id', 'candidate rule id'],
    plain: ['a rule for this project', 'a rule waiting for your yes'],
    aliasPlain: { policy: 0, 'policy id': 0, 'candidate rule id': 1 }, where: 'Tech · rule sheet › History' },
  { term: 'ADVISORY / BLOCKING', aliases: ['advisory', 'blocking'],
    plain: ['Yes (helpers follow it)', 'Yes, and hold work to it'],
    aliasPlain: { advisory: 0, blocking: 1 }, where: 'Rule sheet › How it’s held' },
  { term: 'CANDIDATE · QUEUED', aliases: ['candidate', 'queued'],
    plain: ['Saved for later; it’s waiting on the Desk'], where: 'Tech' },
  { term: 'scope (project / all)', aliases: ['scope'],
    plain: ['for this project', 'Use it in all your projects?'], where: 'Rule sheet' },
  { term: 'ORIGIN · stance · recall · steer type', aliases: ['origin', 'stance', 'recall', 'steer type'],
    plain: null, where: 'Rule sheet › History (tech line) · the Rules page' },
  { term: 'D·G·C·R detector, dry run', aliases: ['detector', 'dry run'],
    plain: ['How we worded it', 'Right now this would send a step back'], where: 'Rule offer' },
  { term: 'recurrence ↺', aliases: ['recurrence'],
    plain: ['You’ve said this before.', 'You already have this rule.'], where: 'Rule offer' },
  { term: 'mode codes RS PL EX PT BR VB CH', aliases: ['mode code', 'rs', 'pl', 'ex', 'pt', 'br', 'vb', 'ch'],
    plain: ['Research', 'Plan', 'Build', 'Write a proposal', 'Brainstorm', 'Make a demo', 'Just ask'],
    aliasPlain: { rs: 0, pl: 1, ex: 2, pt: 3, br: 4, vb: 5, ch: 6 }, where: 'none needed' },
  { term: 'phase / wave', aliases: ['phase', 'wave'],
    plain: ['the stage names in the title row'], where: 'Tech (wave N)' },
  { term: 'artifact / brief v3 / plan v1', aliases: ['artifact', 'artifact version'],
    plain: ['the brief', 'the plan', 'Version N'], where: 'Tech' },
  { term: 'sha a41c9e2 · matches main', aliases: ['sha', 'commit', 'matches main'],
    plain: ['the latest version'], where: 'Tech (preview stamp, stage) · file sheet › Versions' },
  { term: 'tokens', aliases: ['tokens'], plain: null, where: 'Tech (rail, message footers, transcript)' },
  { term: 'PTY / terminal', aliases: ['pty', 'terminal'],
    plain: ['Terminal (read-only; typing into it is off unless you turn it on)'], where: 'Helper sheet › Terminal' },
  { term: 'transcript', aliases: ['transcript'], plain: ['What it did'], where: 'Helper sheet' },
  { term: 'diff / merge-base', aliases: ['diff', 'merge-base'],
    plain: ['Changes: files changed, lines added and removed'], where: 'Step sheet › Changes (code shown)' },
  { term: 'CoreEvents tail', aliases: ['coreevents', 'coreevents tail', 'event tail'],
    plain: ['Live events, in sentences'], where: 'Step / session sheets · Watchtower (tech adds the event type)' },
  { term: 'daemon · version · uptime · dead letters · outbox · freeze · stall escalation · restart / upgrade',
    aliases: ['daemon', 'version', 'uptime', 'dead letters', 'outbox', 'freeze', 'stall escalation', 'restart', 'upgrade'],
    plain: ['Studio itself'], where: 'Studio sheet › Right now / › Restart or update' },
  { term: 'host disk · reclaim · stores inventory', aliases: ['host disk', 'reclaim', 'stores inventory'],
    plain: ['This computer is almost out of space', 'What can go', 'Every database'],
    where: 'Space sheet (from the disk problem, or session sheet › This computer)' },
  { term: 'fleet table', aliases: ['fleet table', 'fleet'], plain: ['Helpers'], where: 'Session sheet › Helpers' },
  { term: 'queue / J then 1–4 / status bar', aliases: ['queue', 'status bar'], plain: ['Needs you'], where: 'none' },
  { term: 'keycaps everywhere', aliases: ['keycaps'],
    plain: ['tooltips and the shortcuts sheet'], where: '⌥/' },
  { term: 'decision record D-ced-14 · choice', aliases: ['decision record', 'choice'],
    plain: ['Saved as a choice, not a rule'], where: 'Tech' },
  { term: 'verifier ≠ creator · replay p95 −48%', aliases: ['verifier ≠ creator', 'evaluator ≠ creator', 'replay p95'],
    plain: ['checked against a replay of real traffic'], where: 'Delivery sheet › How it was checked' },
];

function norm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

const BY_ALIAS: ReadonlyMap<string, PlainWordRow> = new Map(
  PLAIN_WORDS.flatMap((row) => row.aliases.map((a) => [norm(a), row] as const)),
);

/** The usual plain wording for a technical term; `null` when the default layer does not show
 *  the term at all, or the term is unknown. */
export function plainWord(term: string): string | null {
  const key = norm(term);
  const row = BY_ALIAS.get(key);
  if (!row?.plain) return null;
  const hit = row.aliasPlain
    ? Object.entries(row.aliasPlain).find(([a]) => norm(a) === key)
    : undefined;
  if (hit && hit[1] === null) return null;
  return row.plain[hit?.[1] ?? 0] ?? null;
}
