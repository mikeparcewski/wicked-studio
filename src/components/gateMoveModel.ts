import type { CoreEvent, WorkUnit } from '../api/types.js';
import { DELIVER_STEP, type PlanGateView } from '../board/planModel.js';
import { checkOutcome, phaseLabel, type GateVerdictView } from './gateVerdictModel.js';

/**
 * The ONE recommended move at a gate (brainstorm-actionable idea 1) and the verdict diff beside it
 * (idea 2). Pure: every input is already on the card (the verdict fold, the run's units, the plan
 * gate view, the deliver diff), so this module makes zero requests.
 *
 * The card used to show state (a NOT PASS verdict, a floor that failed) and leave the operator to
 * work out the answer and type the note. Now the gate's kind and verdict pick the move, the move
 * names itself on the primary button, the consequence line says what happens before it is taken,
 * and the note arrives pre-filled with the reviewer's failing lines. The other answers stay, as
 * secondary buttons.
 *
 * The moves, each answered on a crew route the card already speaks (`POST /runs/:id/gate`):
 *  - `send-back`       an evaluator said NOT PASS → `{approve:false, action:'request_changes', amend}`:
 *                      the creator phase reruns with the failing items, the reviewer re-reviews;
 *  - `retry-findings`  a validator / repository checks rejected the unit (or a legacy NOT PASS gate
 *                      whose approve retries) → an approve carrying the findings as the note;
 *  - `approve-plan`    a plan gate at a low band → a plain approve of the plan as shown;
 *  - `deliver`         the gate before the deliver unit → review the diff, then approve.
 * `null` everywhere else: the card keeps its existing layout and nothing is recommended.
 */

export type GateMoveKind = 'send-back' | 'retry-findings' | 'approve-plan' | 'deliver';

export interface GateMove {
  kind: GateMoveKind;
  /** The primary button's text — the move, named. */
  label: string;
  /** The consequence line rendered above the button, before the move is taken. */
  consequence: string;
  /** The note the steer box is pre-filled with (`null` = the move takes no note). */
  prefill: string | null;
  /** The reviewer's failing items the move carries (empty for plan / deliver). */
  items: string[];
}

/** Denial layers that are an evaluator's judgement of the work (the creator should fix it). */
const EVALUATOR_SOURCES = new Set(['evaluator_verdict', 'agent_validator', 'evaluator']);
/** Denial layers that are a deterministic validator of the work (retry with what it found). */
const VALIDATOR_SOURCES = new Set(['repo_checks', 'repo_checks_timeout', 'pinned_validator', 'substance', 'deliverables']);

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;
/** A `-` / `*` / `•` bullet — never a section heading, unlike a numbered line (`1. Findings`). */
const MARK_BULLET = /^\s*[-*•]\s+/;
/** Lines that frame a verdict rather than state a finding. */
const FRAME = /^(?:the evaluator'?s verdict is\b|verdict\s*[:=]|agent judge:\s*fail\s*$|not pass\b|reviewed\b|findings?:?$)/i;

function lines(text: string | null | undefined): string[] {
  return (text ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

/**
 * The lines of a report OUTSIDE its known non-finding sections (R4, ship-prove-4), split into
 * bullets and prose, in order, deduplicated. A heading — `Commands run`, `## Evidence`,
 * `**Verified:**`, a bulleted `- Suggestions:` — switches the reading off until a heading that is
 * not one of them; an inline lead (`Counts: derived 1 …`, `Verified: …`) is skipped on its own.
 * So "Read governed-worker skill — exit 0." under Commands run is never a finding, whatever else
 * the report holds — with or without a Findings section.
 */
/** A line's Markdown heading level (`## X` → 2), or 0 when it is not a `#` heading. */
function mdLevel(line: string): number {
  const m = /^(#{1,6})\s/.exec(line.trim());
  return m !== null ? m[1]!.length : 0;
}

function outsideNonFinding(text: string | null | undefined): { bullets: string[]; prose: string[] } {
  const out = { bullets: [] as string[], prose: [] as string[] };
  let excluded = false;
  /** The indent of the heading that switched the reading off: a deeper heading (`  Test suite:`
   *  under `Commands run:`) is nested in it and stays excluded (codex review). */
  let excludedIndent = -1;
  /** The Markdown level of that heading (0 = not a `#` heading): a deeper `###` under `## Commands
   *  run` is nested in it too (Copilot). */
  let excludedLevel = 0;
  /** The indent of an inline non-finding / passing bullet (`- Commands run: npm test`): its deeper
   *  children (`  - exit 0`) are part of it (Copilot). */
  let skipDeeper: number | null = null;
  const raws = (text ?? '').replace(/\r/g, '').split('\n').filter((r) => r.trim() !== '');
  for (const raw of raws) {
    const l = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    const m = BULLET.exec(l);
    const body = m !== null ? m[1]! : l.replace(/^agent judge:\s*fail\s*[—-]\s*/i, '');
    const t = plain(body);
    const head = NON_FINDING_HEAD.test(t) ? t : subHeadingOf(body);
    // An inline finding (`Finding: cache invalidation is broken`) is an item wherever it sits.
    if (skipDeeper !== null) {
      if (indent > skipDeeper) continue;
      skipDeeper = null;
    }
    const lead = FINDING_LEAD.exec(t);
    if (lead !== null) {
      excluded = false;
      if (NO_FINDING.test(lead[1]!.trim())) continue; // "Concerns: none."
    } else if (head !== null && head.length <= 80) {
      // Inside an excluded section only a real section boundary ends it: a Markdown `#` heading at
      // its level or above, or a findings heading. A deeper heading (`  Test suite:`) or a bare
      // label (`npm test:`) is part of it (codex review).
      const level = mdLevel(body);
      const boundary =
        FINDINGS_HEAD.test(head.replace(/\s*:$/, '')) || (level > 0 && (excludedLevel === 0 || level <= excludedLevel));
      if (excluded && (indent > excludedIndent || !boundary)) continue;
      const name = head.replace(/\s*:$/, '');
      excluded = NON_FINDING_HEAD.test(name) || PASSING_GROUP.test(name);
      excludedIndent = indent;
      excludedLevel = level;
      continue;
    }
    if (excluded || FRAME.test(body)) continue;
    if (INLINE_PASSING.test(t) || NON_FINDING_LEAD.test(t)) {
      skipDeeper = indent;
      continue;
    }
    const into = m !== null ? out.bullets : out.prose;
    if (!into.includes(body)) into.push(body);
  }
  return out;
}

/** The bulleted findings in a reviewer's text, in order, deduplicated — non-finding sections out. */
function bullets(text: string | null | undefined): string[] {
  return outsideNonFinding(text).bullets;
}

/** A reviewer's prose findings when it wrote no bullets: every line that is not a frame line, a
 *  heading, or part of a non-finding section. */
function proseFindings(text: string | null | undefined): string[] {
  return outsideNonFinding(text).prose;
}

/**
 * R4 (ship-prove-3) — a governed evaluator writes a SECTIONED report (garden `governed-worker`
 * output contract: What I did / Commands run / Counts / Findings / Open questions / VERDICT). Only
 * the Findings section is what failed; reading every bullet of the whole report made "Read
 * `…/SKILL.md` — exit 0." the headline of a send-back while the real Critical finding sat below it.
 */
/** Markdown dress stripped before a line is read as a heading: a leading `#…` and the emphasis
 *  wrapper around the line's LEAD only (`**Findings:**`, `**Critical:** body`, `**Critical**: body`),
 *  so `### Findings` and `Findings` read alike (codex review). Markers inside the body stay —
 *  `src/__tests__/math.test.ts` is a path, not emphasis (Copilot). */
function plain(line: string): string {
  const t = line.trim().replace(/^#{1,6}\s*/, '').trim();
  const m = /^(\*\*|__)(.+?)\1(.*)$/.exec(t);
  return (m !== null ? `${m[2]}${m[3]}` : t).trim();
}
/** Severity words a findings heading may carry before or after its noun. */
const SEVERITY_WORD = String.raw`(?:critical|blocking|blockers?|major|high(?:[- ]severity)?|severe|must[- ]fix|medium|low)`;
/** A findings-section heading, read on {@link plain} text, tolerant of how a reviewer writes it
 *  (R4, ship-prove-4 — "Critical finding:" was not read, so the send-back led with "Commands run"):
 *  singular or plural, an optional severity before (`Critical finding`, `Blocking issues`) or after
 *  (`Findings (critical)`, `Findings — blocking`), a trailing colon or none. Group 1 is the noun. */
/** The marks that say a findings heading is NOT failing (`minor`, `optional`, `low-severity`, …). */
const PASSING_MARK = String.raw`(?:non[- ]blocking|optional|minor|nits?|low(?:[- ]severity)?|informational|cosmetic)`;
const FINDINGS_HEAD = new RegExp(
  String.raw`^(?:\d+[.)]\s*)?(?:${SEVERITY_WORD}\s+)?(?:[a-z][\w-]*\s+){0,2}?(findings?(?:\s+or\s+plan)?|concerns?|issues?|problems?|blockers?)` +
    // A trailing mark may be a severity (`Findings (critical)`) or a passing one (`Issues — minor`),
    // so the latter reaches the passing-boundary logic (Copilot).
    String.raw`(?:\s*\((?:${PASSING_MARK}|${SEVERITY_WORD})\)|\s*[—–-]\s*(?:${PASSING_MARK}|${SEVERITY_WORD}))?\s*:?$`,
  'i',
);
/** The sections of the output contract that are NEVER findings, whatever the report holds
 *  (R4): what the reviewer did, ran, checked or counted, its evidence, notes, summary, questions. */
const NON_FINDING_NAMES = String.raw`what (?:i|you) did|what (?:i|you) checked|commands? run|(?:run-record )?evidence|counts?|notes?|summary`;
/** A qualifier that turns a non-finding name INTO a finding: `Missing test evidence:` heads the
 *  absence of evidence, which is what failed (codex review). */
const LACKING_WORD = String.raw`(?:missing|no|lacking|insufficient|absent|incomplete|inadequate|weak|unverified|stale)`;
/** The participles an evidence heading may trail with: `Evidence collected:`, `Evidence reviewed`. */
const GATHERED_WORD = String.raw`(?:collected|gathered|reviewed|checked|considered|used|run)`;
/** A non-finding section heading, read on {@link plain} text. As a whole-line heading it may carry
 *  up to two qualifier words that are not severities — `Test evidence`, `Build notes`, `Final
 *  summary` (codex review) — while an inline lead stays exact, so `Missing test evidence: …` is
 *  still a finding. */
const NON_FINDING_HEAD = new RegExp(
  String.raw`^(?:\d+[.)]\s*)?(?:(?:(?!(?:${SEVERITY_WORD}|${LACKING_WORD})\b)[a-z][\w-]*\s+){0,2}` +
    String.raw`(?:commands? (?:run|executed)|evidence(?:\s+${GATHERED_WORD})?|notes?|summary)|${NON_FINDING_NAMES}|open questions?\b.*?)\s*:?$`,
  'i',
);
/** A finding written inline, its body on the same line: `Finding: …`, `Critical issue — …`. */
const FINDING_LEAD = new RegExp(String.raw`^(?:${SEVERITY_WORD}\s+)?(?:findings?|issues?|concerns?|problems?)\s*[:—–]\s*(\S.*)$`, 'i');
/** A non-finding section written inline, its body on the same line: `Counts: derived 1 / …`,
 *  `What I did: Evaluator role. …`, `Open question: "character" could mean …`. */
const NON_FINDING_LEAD = new RegExp(String.raw`^(?:\d+[.)]\s*)?(?:${NON_FINDING_NAMES}|open questions?)\s*:\s*\S`, 'i');
const VERDICT_LINE = /^verdict\s*[:=]/i;
/** A sub-heading inside Findings ("Critical:", "**Concerns:**", "Verified from the build evidence:"),
 *  read on {@link plain} text: a non-bullet line ending in a colon. */
const SUB_HEAD = /^([^-*•\d].*?)\s*:$/;
/** The severities that FAIL a review (`Suggestion` does not; neither does a "Verified …" list). */
const FAILING_SEVERITY = /^(?:critical|blockers?|blocking|must[- ]fix|high|major|concerns?|conditions?)\b/i;
/** The MUST-FIX tier: when a report names any, its Concerns are not the reason it failed (the
 *  governed-worker contract — FAIL needs a Critical or a CONDITIONS list; Copilot). */
const MUST_FIX = /^(?:critical|blockers?|blocking|must[- ]fix|high|major|conditions?)\b/i;
/** Groups that are explicitly NOT failures: what the reviewer verified, praised or only suggests. */
const PASSING_GROUP = /^(?:(?:verified|confirmed)(?:\s+(?:from|against|in|by|on|with)\b.*)?|pass(?:es|ed|ing)?|strengths?|what (?:works|passed)|ok|good|suggestions?|nits?|non[- ]blocking(?:\s+(?:notes?|suggestions?))?|optional(?:\s+(?:notes?|suggestions?))?)$/i;
/** A passing group named bare, no colon or `#`: `Verified`, `Suggestions`. */
const BARE_PASSING_HEAD = /^(?:verified|confirmed|suggestions?|nits?|strengths?|non[- ]blocking(?:\s+(?:notes?|suggestions?))?)$/i;
/** A passing lead that carries its item on the same line: `Verified: src/math.ts validates…`,
 *  `- **Suggestion:** rename it` — the item is a pass, never a finding (Copilot). */
const INLINE_PASSING = /^(?:verified|confirmed|suggestions?|nits?|non[- ]blocking|optional)\s*[:—–]\s*\S/i;
/** An inline severity lead, on {@link plain} text: "Critical — src/text.ts:26 slices …",
 *  "Concern: …". A bare "Critical:" has no body and is a sub-heading instead. */
const INLINE_SEVERITY = /^((?:critical|blockers?|blocking|must[- ]fix|high|major|concerns?|conditions?)\b[^—:]*?)(?:\s*[—–:]|\s+-)\s*(.*\S)\s*$/i;
/** "Concerns: none." states no finding. */
const NO_FINDING = /^(?:none|n\/a|nil|no (?:critical |blocking )?(?:findings?|issues?|concerns?))\b[.!]?$/i;

/** `[test/math.test.ts](/abs/worktree/test/math.test.ts:9)` → `test/math.test.ts:9`: the link text,
 *  plus the target's line when the text lacks one. The absolute worktree path is never shown. */
function unlink(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, target: string) => {
    const line = /:(\d+(?::\d+)?)$/.exec(target);
    return line !== null && !/:\d+(?::\d+)?$/.test(label) ? `${label}:${line[1]}` : label;
  });
}

/** Where a non-finding section starts: its heading, or its inline lead (`Counts: derived 1 …`). */
function endsFindings(line: string): boolean {
  const t = plain(line);
  return NON_FINDING_HEAD.test(t) || NON_FINDING_LEAD.test(t) || VERDICT_LINE.test(t);
}

/** A findings heading the reviewer marks as NOT failing — `Non-blocking findings`, `Optional
 *  issues`, `Minor findings`, `Resolved findings` (Copilot): a boundary, never a failure section. */
const PASSING_FINDINGS = /^(?:\d+[.)]\s*)?(?:non[- ]blocking|optional|minor|nits?|low(?:[- ]severity)?|informational|cosmetic|resolved|addressed|fixed|no)\b/i;

/** The same mark trailing a findings heading: `Findings (low)`, `Issues — minor` (Copilot). */
const PASSING_SUFFIX = new RegExp(String.raw`(?:\(\s*${PASSING_MARK}\s*\)|[—–-]\s*${PASSING_MARK})\s*:?$`, 'i');

/**
 * The Findings sections of a sectioned report — each one's heading and lines — or `null` when it
 * has none. EVERY `finding(s)` heading opens one (`Critical findings` then `Major findings` both
 * count); without any, every `Concerns` / `Issues` / `Problems` / `Blockers` heading does — with a
 * `finding(s)` heading present those words are its sub-headings instead (Critical outranks a
 * Concern inside it). A heading marked as not failing ({@link PASSING_FINDINGS}) opens nothing and
 * ends the section above it. A section also ends at a non-finding section ({@link NON_FINDING_HEAD}
 * — Commands run, Evidence, Notes, Summary, …) or the VERDICT line. `[]` = the report has findings
 * headings but none that fails.
 */
function findingsSections(text: string | null | undefined): Array<{ head: string; lines: string[] }> | null {
  // Indentation is KEPT (trailing whitespace only is dropped): a nested bullet under a bulleted
  // sub-heading is told from a top-level sibling by it (Copilot).
  const all = (text ?? '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const heads: Array<{ at: number; finding: boolean; passing: boolean }> = [];
  for (let i = 0; i < all.length; i++) {
    // A `-`/`*` bullet is an item, never a heading; a NUMBERED line may be one (`1. Findings`).
    if (MARK_BULLET.test(all[i]!)) continue;
    const t = plain(all[i]!);
    const m = FINDINGS_HEAD.exec(t);
    if (m !== null) heads.push({ at: i, finding: /^finding/i.test(m[1]!), passing: PASSING_FINDINGS.test(t) || PASSING_SUFFIX.test(t) });
  }
  if (heads.length === 0) return null;
  /** The lines of the section headed at `at`, up to the next of `boundary` or a non-finding one. */
  const body = (at: number, boundary: ReadonlySet<number>): string[] => {
    const out: string[] = [];
    for (let i = at + 1; i < all.length; i++) {
      const l = all[i]!;
      if (boundary.has(i)) break;
      // A `-` bullet never ends the section; a NUMBERED line ends it only as a heading (`2. Notes`),
      // never as an inline lead (`2. Evidence: npm test passed` is an item, read below — codex review).
      if (!MARK_BULLET.test(l) && (BULLET.test(l) ? NON_FINDING_HEAD.test(plain(l)) : endsFindings(l))) break;
      out.push(l);
    }
    return out;
  };
  const headOf = (at: number): string => plain(all[at]!).replace(/\s*:$/, '');
  const findings = heads.filter((h) => h.finding);
  // A heading marked as not failing ends the section above it whatever its noun: `Findings` then
  // `Optional issues` must not read the nit as a finding (Copilot).
  const passingAt = heads.filter((h) => h.passing).map((h) => h.at);
  const findingBoundary = new Set([...findings.map((h) => h.at), ...passingAt]);
  const sections: Array<{ at: number; head: string; lines: string[] }> = [];
  /** The line indexes the `finding(s)` sections cover: a Concerns/Issues heading inside one is its
   *  sub-heading; one outside every one is a section of its own (codex review). */
  const covered = new Set<number>();
  for (const h of findings) {
    const lines = body(h.at, findingBoundary);
    lines.forEach((_l, k) => covered.add(h.at + 1 + k));
    if (!h.passing) sections.push({ at: h.at, head: headOf(h.at), lines });
  }
  const aliases = heads.filter((h) => !h.finding && !covered.has(h.at));
  const allBoundary = new Set([...findingBoundary, ...aliases.map((h) => h.at)]);
  for (const h of aliases) {
    if (!h.passing) sections.push({ at: h.at, head: headOf(h.at), lines: body(h.at, allBoundary) });
  }
  return sections.sort((a, b) => a.at - b.at).map(({ head, lines }) => ({ head, lines }));
}

/**
 * The failing items of a sectioned report's Findings section, best reading first:
 *  1. the items under a failing severity — a severity sub-heading's bullets, or a line that leads
 *     with one ("Critical — …"); a "Verified …" or Suggestion group is not a failure;
 *  2. else every bullet in the section;
 *  3. else its prose lines.
 * `null` when the report has no Findings section (the caller keeps its older readings); `[]` when
 * it has one that names no failure — then the rest of the report (Commands run, evidence) is still
 * not a finding (codex review, HIGH).
 */
/** The text of a Findings sub-heading, or `null`: a non-bullet line ending in a colon, or a
 *  Markdown `#` heading with or without one (`### Critical`) — codex review; Copilot. */
function subHeadingOf(raw: string): string | null {
  const t = plain(raw);
  const m = SUB_HEAD.exec(t);
  if (m !== null) return m[1]!.trim();
  // A bare passing name on its own line (`Verified`, `Suggestions`) heads its group too (Copilot).
  if (BARE_PASSING_HEAD.test(t)) return t;
  return /^#{1,6}\s/.test(raw.trim()) && t !== '' && !/[.!?]$/.test(t) ? t : null;
}

/** What a Findings sub-heading opens: a failing group (and whether it is the must-fix tier), a
 *  passing one, or a neutral one. */
function groupOf(head: string): { group: 'failing' | 'passing' | 'other'; groupMust: boolean } {
  // A non-finding name nested in Findings (`- Commands run:`, `Evidence:` as a sub-heading) reads
  // as a pass: its items are never findings (R4; codex review).
  const group = FAILING_SEVERITY.test(head) ? 'failing' : PASSING_GROUP.test(head) || NON_FINDING_HEAD.test(head) ? 'passing' : 'other';
  return { group, groupMust: group === 'failing' && MUST_FIX.test(head) };
}

/** A findings heading with its severity moved to the front, so {@link groupOf} reads a trailing
 *  one too: `Findings (critical)` / `Findings — blocking` open the must-fix tier like
 *  `Critical findings` (Copilot). */
function severityFirst(head: string): string {
  const m = new RegExp(String.raw`(?:\(\s*(${SEVERITY_WORD})\s*\)|[—–-]\s*(${SEVERITY_WORD}))\s*$`, 'i').exec(head);
  const sev = m !== null ? (m[1] ?? m[2]) : undefined;
  return sev !== undefined ? `${sev} ${head}` : head;
}

function findingsItems(text: string | null | undefined): string[] | null {
  const sections = findingsSections(text);
  if (sections === null) return null;
  const mustFix: string[] = [];
  const severe: string[] = [];
  const allBullets: string[] = [];
  const prose: string[] = [];
  let opening: ReturnType<typeof groupOf> = { group: 'other', groupMust: false };
  let group: 'failing' | 'passing' | 'other' | null = null;
  /** Whether the current failing group is the must-fix tier (Critical…), not a Concern. */
  let groupMust = false;
  const push = (into: string[], item: string): void => {
    const clean = unlink(item).trim();
    if (clean !== '' && !NO_FINDING.test(clean) && !into.includes(clean)) into.push(clean);
  };
  const failing = (item: string, must: boolean): void => {
    push(severe, item);
    if (must) push(mustFix, item);
  };
  /** The indent of the bulleted sub-heading whose group is open, or `null` (a plain heading's
   *  group, or none): a bullet back at that indent or shallower is a sibling, not its child. */
  let headIndent: number | null = null;
  for (const section of sections) {
    // Each section's own heading sets its opening group: "Critical finding:" opens the must-fix
    // tier, "Concerns:" a failing one, a plain "Findings" a neutral one.
    opening = groupOf(severityFirst(section.head));
    ({ group, groupMust } = opening);
    headIndent = null;
    /** The indent of a PLAIN passing sub-heading (`Verified`): a deeper heading under it
     *  (`  Test suite:`) is still part of the pass (Copilot). */
    let plainPassIndent: number | null = null;
    /** …and its Markdown level: a deeper `###` under `## Verified` is part of the pass. */
    let plainPassLevel = 0;
    for (const raw of section.lines) {
      const indent = raw.length - raw.trimStart().length;
      const l = raw.trim();
      const bullet = BULLET.exec(l);
      if (headIndent !== null && indent <= headIndent) {
        // Back at a bulleted sub-heading's own level — a sibling bullet or top-level prose: this
        // line is outside its group, back in the section's own (Copilot).
        group = opening.group;
        groupMust = opening.groupMust;
        headIndent = null;
      }
      // A "Verified …" / Suggestion group's bullets are never failures, whatever they lead with —
      // "- Critical: boundary handling is fixed." or a nested "- Critical:" sub-heading under
      // "Verified:" is still part of the pass (codex review, MEDIUM; Copilot).
      if (bullet !== null && group === 'passing') continue;
      // `- **Verified:** src/math.ts validates…` is a pass carried inline (Copilot).
      // `- Commands run: npm test` likewise; either one also owns the deeper bullets nested under
      // it (`  - exit 0`), as a passing group at its indent (codex review).
      if (bullet !== null && (INLINE_PASSING.test(plain(bullet[1]!)) || NON_FINDING_LEAD.test(plain(bullet[1]!)))) {
        group = 'passing';
        groupMust = false;
        headIndent = indent;
        continue;
      }
      // A bulleted sub-heading (`- **Verified:**`, `- Critical:`) opens a group like a plain one;
      // its nested bullets are the deeper-indented ones that follow (codex review; Copilot).
      const bulletHead = bullet !== null ? subHeadingOf(bullet[1]!) : null;
      if (bulletHead !== null && bulletHead.length <= 80) {
        ({ group, groupMust } = groupOf(bulletHead));
        headIndent = indent;
        continue;
      }
      if (bullet !== null) {
        const body = bullet[1]!;
        const inline = INLINE_SEVERITY.exec(plain(body));
        if (inline !== null) failing(inline[2]!, MUST_FIX.test(inline[1]!));
        else if (group === 'failing') failing(body, groupMust);
        push(allBullets, inline !== null ? inline[2]! : body);
        continue;
      }
      if (INLINE_PASSING.test(plain(l))) continue;
      const inline = INLINE_SEVERITY.exec(plain(l));
      if (inline !== null) {
        // A severity-led LINE (not a bullet) is a new finding at the section's top level, the way
        // the run-2 report wrote "Critical — …": it ends any group above it.
        group = 'failing';
        groupMust = MUST_FIX.test(inline[1]!);
        headIndent = null;
        failing(inline[2]!, groupMust);
        continue;
      }
      const sub = subHeadingOf(l);
      if (sub !== null) {
        const level = mdLevel(raw);
        const nestedInPass =
          group === 'passing' &&
          ((headIndent !== null && indent > headIndent) ||
            (plainPassIndent !== null && (indent > plainPassIndent || (plainPassLevel > 0 && level > plainPassLevel))));
        if (nestedInPass) continue;
        ({ group, groupMust } = groupOf(sub));
        headIndent = null;
        plainPassIndent = group === 'passing' ? indent : null;
        plainPassLevel = group === 'passing' ? level : 0;
        continue;
      }
      if (group !== 'passing' && !FRAME.test(l)) push(prose, l);
    }
  }
  // The must-fix tier is why the review failed; its Concerns ride beside it, labelled, so nothing
  // the reviewer raised is silently out of scope (studio#559 F24). `failing()` pushes every item to
  // `severe` and the must-fix ones to `mustFix` too, so severe ⊇ mustFix: a must-fix-only verdict
  // takes this branch (and `tiered` returns it bare).
  if (severe.length > 0) return tiered(mustFix, severe);
  if (allBullets.length > 0) return allBullets;
  return prose;
}

/** studio#559 (F28): one bold lead of a paragraph-form verdict — `**Critical — X.**`, `**Concern:**`,
 *  `**Condition to pass:**` — at a paragraph's start (a line's start, or glued straight after a
 *  sentence's end when the capture lost its newlines). A bullet's bold lead is not one. */
const BOLD_LEAD = /\*\*([^*\n]{1,240}?)\*\*/g;
const BOLD_SEVERITY = /^(critical(?:\s+findings?)?|blockers?|blocking|must[- ]fix|high|major|concerns?)\b\s*(?:[—–:-]\s*(.*?))?\s*$/i;
const BOLD_CONDITION = /^conditions?\b[^:]*:?\s*$/i;
/** The tier word for a labelled item (`Critical: …` / `Concern: …`). */
const TIER_LEAD = /^(Critical|Concern): /;

function atParagraphStart(text: string, at: number): boolean {
  const before = text.slice(0, at).replace(/[ \t]+$/, '');
  return before === '' || before.endsWith('\n') || /[.!?)`]$/.test(before);
}

/**
 * studio#559 (F28): the findings of a verdict written as bold-led PARAGRAPHS — one per finding,
 * `**Critical — wrong run's diff can appear.** body` / `**Concern — …** body` — so the count is the
 * finding count, not one item per paragraph (what-I-did, commands, conditions, counts). A
 * "Condition(s) to pass" paragraph is the finding only when the verdict names no severity
 * paragraph (it restates them otherwise). `null` when the text is not in this form, or when a bold
 * severity lead is a HEADING over a list (`**Critical findings**` then bullets) — the list readers
 * own that shape.
 */
function boldParagraphFindings(text: string | null | undefined): string[] | null {
  const t = (text ?? '').replace(/\r/g, '');
  if (t.trim() === '') return null;
  const leads = [...t.matchAll(BOLD_LEAD)].filter((m) => atParagraphStart(t, m.index));
  if (leads.length === 0) return null;
  const must: string[] = [];
  const concerns: string[] = [];
  const conditions: string[] = [];
  for (let i = 0; i < leads.length; i++) {
    const m = leads[i]!;
    const inner = m[1]!.trim();
    const end = m.index + m[0].length;
    const next = i + 1 < leads.length ? leads[i + 1]!.index : t.length;
    // The paragraph's body: up to the next bold lead, a blank line, or the verdict/advice trailer.
    const body = unlink(t.slice(end, next).split(/\n\s*\n|\n(?=VERDICT\b|ADVICE\b)|(?=VERDICT:)/)[0]!.replace(/\s+/g, ' ').trim());
    const sev = BOLD_SEVERITY.exec(inner);
    if (sev !== null) {
      const title = (sev[2] ?? '').replace(/[.:]\s*$/, '').trim();
      // `**Critical findings**` with nothing after it on its line heads a list: not this form.
      if (title === '' && body === '') return null;
      if (title === '' && /^\s*\n\s*(?:[-*•]|\d+[.)])\s/.test(t.slice(end, next))) return null;
      const item = title !== '' ? (body !== '' ? `${title} — ${body}` : title) : body;
      (MUST_FIX.test(sev[1]!) ? must : concerns).push(item);
      continue;
    }
    if (BOLD_CONDITION.test(inner) && body !== '') conditions.push(body);
  }
  if (must.length > 0 || concerns.length > 0) return tiered(must, concerns);
  return conditions.length > 0 ? conditions : null;
}

/** studio#559 (F24): both tiers ride, LABELLED, when a verdict names Criticals AND Concerns — the
 *  creator fixes the enumerated list, so a dropped tier cost a full round. One tier rides bare. */
function tiered(must: readonly string[], concerns: readonly string[]): string[] {
  const rest = concerns.filter((c) => !must.includes(c));
  if (must.length > 0 && rest.length > 0) {
    return [...must.map((i) => `Critical: ${i}`), ...rest.map((i) => `Concern: ${i}`)];
  }
  return must.length > 0 ? [...must] : [...rest];
}

/**
 * The newest `gateEscalated.verdictSummary` for `ord` — the engine's copy of the reviewer's words on
 * the escalation it opened. `null` when the log holds none for that unit.
 */
export function escalationSummaryFor(events: readonly CoreEvent[], ord: number | null | undefined): string | null {
  if (typeof ord !== 'number') return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'gateEscalated' && e.ord === ord && typeof e.verdictSummary === 'string' && e.verdictSummary.trim() !== '') {
      return e.verdictSummary;
    }
  }
  return null;
}

/**
 * The reviewer's failing items for a failed verdict, best source first:
 *  0. the Findings section of a sectioned report (denial reason, then summary) — {@link findingsItems};
 *  1. the bullets of the denial's reason (the evaluator's own findings — `VERDICT: FAIL` output);
 *  2. the bullets of `gateEscalated.verdictSummary`;
 *  3. the failing repository checks of the floor (`name — how it ended`);
 *  4. the bullets, then the prose, of the judge's reasoning;
 *  5. the prose of the denial reason / summary, minus the frame lines.
 * Empty for a passing (or absent) verdict: there is nothing to send back.
 */
export function failingItems(verdict: GateVerdictView | null, verdictSummary?: string | null): string[] {
  if (verdict === null || verdict.outcome !== 'fail') return [];
  const reason = verdict.denial?.reason ?? null;
  // A sectioned report's Findings section outranks every other reading (R4). When the report HAS
  // one, its other sections (Commands run, evidence, counts) are never read as findings — even if
  // the section itself names nothing; the floor's checks and the judge still speak below.
  const fromFindings = findingsItems(reason);
  if (fromFindings !== null && fromFindings.length > 0) return fromFindings;
  const fromSummaryFindings = findingsItems(verdictSummary);
  if (fromSummaryFindings !== null && fromSummaryFindings.length > 0) return fromSummaryFindings;
  const sectioned = fromFindings !== null || fromSummaryFindings !== null;
  if (!sectioned) {
    const fromBold = boldParagraphFindings(reason) ?? boldParagraphFindings(verdictSummary);
    if (fromBold !== null && fromBold.length > 0) return fromBold;
    const fromBullets = bullets(reason);
    if (fromBullets.length > 0) return fromBullets;
    const fromSummary = bullets(verdictSummary);
    if (fromSummary.length > 0) return fromSummary;
  }
  const checks = (verdict.floor?.checks ?? [])
    .filter((c) => !checkOutcome(c).ok)
    .map((c) => `${c.name} — ${checkOutcome(c).word}`);
  if (checks.length > 0) return checks;
  const judge = bullets(verdict.agentReasoning);
  if (judge.length > 0) return judge;
  if (verdict.agentReasoning !== null && verdict.agentReasoning.trim() !== '' && verdict.denial?.source === 'agent_validator') {
    return proseFindings(verdict.agentReasoning);
  }
  // A validator's prose ("Repository checks failed on head") is a headline, not a finding: without
  // its checks there is nothing to carry, so the card recommends nothing rather than echo it.
  if (verdict.denial?.source != null && VALIDATOR_SOURCES.has(verdict.denial.source)) return [];
  if (sectioned) return [];
  const prose = proseFindings(reason);
  return prose.length > 0 ? prose : proseFindings(verdictSummary);
}

/** The note a send-back / retry carries: the failing items, one per line, under one plain ask. */
export function findingsNote(items: readonly string[], who: 'reviewer' | 'validator'): string {
  // studio#559: a two-tier list says its tiers in the ask ("Critical (3) · Concerns (3)").
  const crit = items.filter((i) => TIER_LEAD.exec(i)?.[1] === 'Critical').length;
  const conc = items.filter((i) => TIER_LEAD.exec(i)?.[1] === 'Concern').length;
  const tiers = crit > 0 && conc > 0 ? ` (Critical (${crit}) · Concerns (${conc}))` : '';
  return [`Fix the ${who}'s failing items${tiers}:`, ...items.map((i) => `- ${i}`)].join('\n');
}

/**
 * The creator phase a send-back reruns: the newest unit before `ord` whose role is `creator`, else
 * the newest `build`-stage unit before it; `null` when the units cannot say (no units, no ord).
 */
export function creatorUnitBefore(units: readonly WorkUnit[], ord: number | null): WorkUnit | null {
  if (ord === null) return null;
  const before = units.filter((u) => u.ord < ord).sort((a, b) => b.ord - a.ord);
  return before.find((u) => u.role === 'creator') ?? before.find((u) => u.stage === 'build' && u.role !== 'evaluator') ?? null;
}

/** A plan band is LOW when the plan is not high risk and the band tops out below 40 (`0-19`, `20-39`). */
export function isLowBand(view: PlanGateView): boolean {
  if (view.highRisk) return false;
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(view.band.trim());
  return m !== null && Number(m[2]) < 40;
}

/** Whether the gate is the pre-run gate on the run's deliver unit. */
export function isDeliverGate(runId: string, units: readonly WorkUnit[], ord: number | null | undefined): boolean {
  if (typeof ord !== 'number') return false;
  return units.some((u) => u.ord === ord) && phaseLabel(runId, units, ord) === 'deliver';
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The engine's single-line segment marker between a unit's description and its phase's
 *  instructions (wicked-core `plan::INSTRUCTION_SEP`). Never rendered. */
export const INSTRUCTION_SEP = ' ||| ';

/** The head of an approved intent amendment's segment (wicked-core `INTENT_AMENDMENT_PREFIX`). */
const INTENT_AMENDMENT_HEAD = 'APPROVED INTENT AMENDMENT';

/**
 * What THIS deliver push will actually do, as the workflow's own gate card says it (N3, ship
 * re-proof) — the first part of the deliver unit's instructions, up to the push-identity sentence:
 * crew's `newPrTargetSentence`, e.g. "Pushes the run branch wicked/<run> to origin (…) — a local
 * path, so no pull request can be opened against it: …". `null` when the unit carries no card (a
 * def authored without instructions) — the caller then claims no pull request at all.
 *
 * The consent line used to be the diffstat alone while the prompt said both "no pull request can
 * be opened" (behind "show the full prompt" and a raw ` ||| `) and "…opens a pull request".
 */
export function deliverTargetOf(units: readonly WorkUnit[], ord: number | null | undefined): string | null {
  if (typeof ord !== 'number') return null;
  const desc = units.find((u) => u.ord === ord)?.description ?? '';
  // Segment 0 is `deliver — <intent>`; an approved intent amendment adds its own
  // `APPROVED INTENT AMENDMENT …` segment, which is never the card (Copilot on core#684).
  const card = desc
    .split(INSTRUCTION_SEP)
    .slice(1)
    .map((s) => s.trim())
    .find((s) => s !== '' && !s.startsWith(INTENT_AMENDMENT_HEAD));
  if (card === undefined) return null;
  const identity = card.indexOf(' Push identity:');
  const target = (identity === -1 ? card : card.slice(0, identity)).trim();
  return target === '' ? null : target;
}

/** A note's longest verdict body. The engine keeps only the TAIL of a long note (~4 KB), so a
 *  longer verdict is clipped here, from the front — where Commands run / What I did sit — rather
 *  than mid-way through whatever the reviewer concluded. */
const NOTE_VERDICT_MAX = 3000;
function clipNote(text: string): string {
  if (text.length <= NOTE_VERDICT_MAX) return text;
  let from = text.length - NOTE_VERDICT_MAX + 1;
  // Never start on the low half of a surrogate pair (Copilot): that would be malformed UTF-16.
  const c = text.charCodeAt(from);
  if (c >= 0xdc00 && c <= 0xdfff) from++;
  return `…${text.slice(from)}`;
}

/** The first item, clipped for a button, with how many more ride along. */
function itemsLabel(items: readonly string[]): string {
  const first = items[0] ?? '';
  // Never cut a surrogate pair in half (Copilot): keep the clip on a code-point boundary.
  const cut = first.length > 56 && /[\ud800-\udbff]/.test(first.charAt(54)) ? 54 : 55;
  const clipped = first.length > 56 ? `${first.slice(0, cut).trimEnd()}…` : first;
  return items.length > 1 ? `${clipped} (+${items.length - 1} more)` : clipped;
}

export interface GateMoveInput {
  runId: string;
  ord: number | undefined;
  units: readonly WorkUnit[];
  /** The deciding verdict (`gateVerdictFor`) — `null` on a plan gate or an evaluation-less log. */
  verdict: GateVerdictView | null;
  /** `gateEscalated.verdictSummary` for the verdict's unit (`escalationSummaryFor`). */
  verdictSummary: string | null;
  /** The card's `isEscalationGate` reading (the four-verb layout). */
  escalationGate: boolean;
  /** Whether the gate has a deliver-lift story (a failed deliver — the engine's remedy governs). */
  hasLift: boolean;
  /** The worktree-guard restored-tree retry — the card already relabels Approve for it. */
  restoredRetry: boolean;
  isPlanGate: boolean;
  planView: PlanGateView | null;
  /** The deliver gate's diffstat label (`2 files changed, +3, −1`), when the diff was read. */
  diffstat: string | null;
}

/** The ONE recommended move for this gate, or `null` when the card should recommend nothing. */
export function recommendGateMove(input: GateMoveInput): GateMove | null {
  const { runId, ord, units, verdict, verdictSummary, escalationGate, hasLift, restoredRetry } = input;

  if (input.isPlanGate) {
    const view = input.planView;
    if (view === null || !isLowBand(view)) return null;
    // F4 — THE CONSEQUENCE IS DERIVED FROM THE PLAN IT GATES, never from the editor's seed.
    //
    // This read `view.editSeed`, which is what the plan EDITOR is filled with: it strips the two
    // steps an operator cannot author (`pa-scope`, the launch's `deliver`) and names steps by
    // CATALOG. Used as the plan it said "approve runs 6 phases: understand → design → build →
    // review → test → critique" over a plan of `pa-scope → clarify → design → build →
    // adversarial-review → test → review → deliver` — the wrong count, the wrong names, and
    // `deliver`, the only phase with an external side effect, absent from the line that gates it.
    //
    // The names the card shows are step IDS; the floor's additions and the deliver step are named
    // by CATALOG. Mixing the two namespaces double-counts a floor addition already in the plan and
    // reads the side effect off the wrong field (codex review of this PR, two MEDIUMs), so each
    // question is answered from the field that can answer it. A step the payload could not name is
    // still counted, and said to be unnamed rather than dropped or invented.
    const named = view.planSteps.map((st) => st.id ?? '(unnamed phase)');
    const inPlan = new Set<string>(
      view.planSteps.flatMap((st) => [st.id, st.catalog].filter((n): n is string => n !== null)),
    );
    const phases = [...named, ...view.floorAdded.filter((p) => !inPlan.has(p))];
    // Said out loud rather than left to be spotted in an eight-item arrow list: this is a consent
    // line, and one of those names reaches outside the machine.
    const delivers =
      view.planSteps.some((st) => st.catalog === DELIVER_STEP) || view.floorAdded.includes(DELIVER_STEP);
    const sideEffect = delivers
      ? `; its ${DELIVER_STEP} phase is the one with an external side effect`
      : '';
    return {
      kind: 'approve-plan',
      label: 'Approve the plan',
      consequence: phases.length > 0
        ? `Band ${view.band}, low risk — approve runs ${plural(phases.length, 'phase')}: ${phases.join(' → ')}${sideEffect}`
        : `Band ${view.band}, low risk — approve runs the plan as shown`,
      prefill: null,
      items: [],
    };
  }

  if (hasLift || restoredRetry) return null;

  // A failed verdict on THIS gate's unit (an escalation, or a legacy NOT PASS gate whose approve retries).
  const own = verdict !== null && verdict.outcome === 'fail' && typeof ord === 'number' && verdict.ord === ord;
  const source = verdict?.denial?.source ?? null;
  // Only a judgement of the WORK recommends a move: a worktree-guard, governance or worker-failure
  // denial is about how the phase ran, and the card's own remedy for it stands.
  const judged = source !== null && (EVALUATOR_SOURCES.has(source) || VALIDATOR_SOURCES.has(source));
  // core#469: a floor that did not FINISH judged nothing — "retry with its findings" would re-run the
  // seat over a timeout. The card's extend / targeted / accept arms are that gate's moves.
  if (own && source === 'repo_checks_timeout') return null;
  // studio#601: an agent JUDGE that refused a review whose evaluator itself said PASS
  // (`gateEvaluated.evaluatorVerdict: "PASS"`, `denial.source: agent_validator`) is not a reviewer
  // FAIL: there is no reviewer finding to send back, and the layers disagree — nothing is suggested.
  if (own && source === 'agent_validator' && (verdict.evaluatorVerdict ?? '').trim().toUpperCase() === 'PASS') return null;
  if (own && judged) {
    const items = failingItems(verdict, verdictSummary);
    const reviewer = phaseLabel(runId, units, verdict.ord);
    const sendBack = escalationGate && EVALUATOR_SOURCES.has(source);
    if (items.length === 0 && !sendBack) return null;
    if (sendBack) {
      const creator = creatorUnitBefore(units, verdict.ord);
      const creatorName = creator === null ? 'the creator' : phaseLabel(runId, units, creator.ord);
      if (items.length === 0) {
        // R4: the review failed but names no finding outside its Commands run / evidence / notes.
        // The headline says so plainly and points at the verdict — it never lists commands; the
        // note carries the reviewer's full verdict rather than a guessed finding.
        const full = (verdict.denial?.reason ?? verdictSummary ?? '').trim();
        return {
          kind: 'send-back',
          label: 'Send back to the creator: the review failed — read its full verdict on this card',
          consequence: `${creatorName} reruns with the reviewer's full verdict as its note; ${reviewer} re-reviews`,
          prefill: full !== ''
            ? `The reviewer failed this work without a separate findings list. Its full verdict:\n${clipNote(full)}`
            : "The reviewer failed this work without a separate findings list; address the reviewer's full verdict.",
          items: [],
        };
      }
      return {
        kind: 'send-back',
        label: `Send back to the creator: ${itemsLabel(items)}`,
        consequence: `${creatorName} reruns with ${plural(items.length, 'item')}; ${reviewer} re-reviews`,
        prefill: findingsNote(items, 'reviewer'),
        items,
      };
    }
    const validator = VALIDATOR_SOURCES.has(source);
    const who = validator ? 'validator' : 'reviewer';
    return {
      kind: 'retry-findings',
      label: `Retry with the ${who}'s findings`,
      consequence: `${reviewer} reruns with ${plural(items.length, validator && verdict.floor !== null ? 'failing check' : 'finding')} as its note`,
      prefill: findingsNote(items, who),
      items,
    };
  }

  if (!escalationGate && isDeliverGate(runId, units, ord)) {
    const diff = input.diffstat !== null ? input.diffstat : 'no diff read for it yet';
    const target = deliverTargetOf(units, ord);
    return {
      kind: 'deliver',
      label: 'Review the diff, then deliver',
      // N3: the visible consent line states what will ACTUALLY happen on this origin, then what
      // the push carries. Without the workflow's card it claims no pull request either way.
      consequence: target !== null
        ? `${target} The push carries: ${diff}`
        : input.diffstat !== null
          ? `Deliver pushes the run branch: ${input.diffstat}`
          : 'Deliver pushes the run branch (no diff read for it yet)',
      prefill: null,
      items: [],
    };
  }
  return null;
}

// ── Idea 2: the verdict diff ────────────────────────────────────────────────────────────────────

/** One failing criterion beside what the creator claimed about it. */
export interface VerdictDiffRow {
  criterion: string;
  /** The creator's line that speaks to it (best word overlap), or `null` — it claimed nothing on it. */
  claim: string | null;
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'still', 'have', 'has', 'was', 'were',
  'are', 'not', 'but', 'its', 'now', 'all', 'any', 'every', 'each', 'should', 'would', 'missing',
]);

function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9_./-]+/).map((w) => w.replace(/^[./-]+|[./-]+$/g, ''))
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/**
 * What the creator claimed: the bullets of its output when it wrote any, else its non-empty lines —
 * the `VERDICT:` line and fenced-code markers dropped.
 */
export function creatorClaims(output: string | null | undefined): string[] {
  const all = lines(output).filter((l) => !/^verdict\s*[:=]/i.test(l) && !l.startsWith('```'));
  const fromBullets = all.map((l) => BULLET.exec(l)?.[1] ?? null).filter((l): l is string => l !== null);
  return fromBullets.length > 0 ? fromBullets : all;
}

/**
 * Each failing criterion beside the creator's claim that shares the most words with it (at least
 * one), so "why it failed" reads without the timeline: the reviewer says the test is missing, the
 * creator said it added the test.
 */
export function verdictDiff(items: readonly string[], creatorOutput: string | null | undefined): VerdictDiffRow[] {
  const claims = creatorClaims(creatorOutput).map((c) => ({ text: c, words: words(c) }));
  return items.map((criterion) => {
    const want = words(criterion);
    let best: string | null = null;
    let bestScore = 0;
    for (const c of claims) {
      let score = 0;
      for (const w of want) if (c.words.has(w)) score++;
      if (score > bestScore) { bestScore = score; best = c.text; }
    }
    return { criterion, claim: best };
  });
}

// ── The Home gate row's verb ──────────────────────────────────────────────────────────────────

/**
 * The Home "Needs you" gate row's verb, naming the move the gate card will recommend, read off the
 * gate record the row already holds (the prompt the engine wrote and the live frame's kind). The row
 * still OPENS the gate — the trailing ellipsis says the answer is given there; nothing is sent from
 * Home. `null` = the prompt names no move this can read (the row keeps "Open gate ›").
 */
export function gateRowVerb(prompt: string | undefined, gateKind?: string): string | null {
  const p = prompt ?? '';
  if (gateKind === 'plan_approval' || /^\s*Approve plan rev\b/i.test(p)) {
    const band = /\bband\s+(\d+)\s*-\s*(\d+)/i.exec(p);
    return band !== null && Number(band[2]) < 40 ? 'Approve plan… ›' : null;
  }
  if (/^\s*Unit\s+\d+\s+verdict is NOT PASS/i.test(p)) {
    // The worktree-guard mutation gate retries against the restored tree; every other NOT PASS
    // goes back to the creator.
    return /restored|changed the tree/i.test(p) ? 'Retry… ›' : 'Send back… ›';
  }
  if (/^\s*Unit\s+\d+\s+(?:failed and triage escalated|failed its deterministic floor)/i.test(p)) return 'Retry… ›';
  if (/^\s*Approve unit\s+\d+\s+before it runs:\s*deliver\b/i.test(p)) return 'Review diff… ›';
  // The engine's own deliver-gate prompt (`deliver_gate_prompt`).
  if (/^\s*Approve delivery before unit\s+\d+\s+runs\b/i.test(p)) return 'Review diff… ›';
  return null;
}
