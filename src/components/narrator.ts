import type { CoreEvent, SessionView, WorkUnit } from '../api/types.js';

/**
 * The run narrator (DES-RUN-NARRATOR §4-§6): a DETERMINISTIC template layer —
 * no LLM call anywhere — that turns the run's CoreEvent trail into the short
 * human status lines the narrated feed renders. Pure functions only: the feed,
 * the now-bar and the tests all derive from the same derivations here.
 */

/** The §4 tone layer: which status color a narration line wears. */
export type NarrationTone = 'info' | 'work' | 'gate' | 'fail' | 'human';

export interface NarrationLine {
  /** The short human line ("Worker started clarify — survey the repo"). */
  text: string;
  tone: NarrationTone;
  /** The unit the line is about, when the frame named one. */
  ord: number | null;
  /** The raw frame, for the feed's raw-view toggle. */
  event: CoreEvent;
}

/** Resolves an ord to the phase vocabulary the stepper already speaks. */
export interface NarratorContext {
  /** Phase name for a unit ord (unit-id suffix, stage fallback) — '?'-safe. */
  phaseOf: (ord: number | null | undefined) => string;
  /**
   * The run's intent (`session.problem`), when the caller has it. The daemon's
   * `unitPlanned.description` is "<phase> — <the full intent>" for every unit
   * of a planned workflow; with the intent known, the narrator drops that
   * restatement — the intent bubble already opens the feed, and six identical
   * raw-prompt lines are exactly the noise the usability review flagged.
   */
  intent?: string | null;
}

/** Longest free-text fragment kept on one narration line. */
const CLIP = 140;

function clip(text: string, max = CLIP): string {
  const line = text.replace(/\r/g, '').split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when one string restates the other's head — either may be the daemon's
 * truncated copy of the other. Requires ≥24 significant chars in common so a
 * short genuine description never false-positives against a long intent.
 */
function restates(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  const n = Math.min(na.length, nb.length);
  if (n < 24) return false;
  return na.slice(0, n) === nb.slice(0, n);
}

/**
 * The gate prompt's actionable headline — the bracketed architectural footnote
 * (the SteeringGate's `cleanPrompt` contract) stays out of the one-liner.
 */
function promptHeadline(raw: string): string {
  const bracket = raw.indexOf('[');
  return clip((bracket === -1 ? raw : raw.slice(0, bracket)).trim());
}

/**
 * One CoreEvent → one short narration line, or `null` for frames the feed does
 * not speak (deltas, heartbeats, terminal bytes, burn — those have their own
 * panels). Unknown/future frame types are silent: additive-safe (§5.1).
 */
export function narrate(event: CoreEvent, ctx: NarratorContext): NarrationLine | null {
  const ord = num(event.ord);
  const phase = ctx.phaseOf(ord);
  const line = (text: string, tone: NarrationTone): NarrationLine => ({ text, tone, ord, event });

  switch (event.type) {
    case 'sessionStarted':
      return line('Run started', 'work');
    case 'workflowSelected': {
      const id = str(event.workflowId) || str(event.workflow_id);
      const n = num(event.unitCount);
      return line(`Workflow "${id || 'unnamed'}"${n !== null ? ` — ${n} phase${n === 1 ? '' : 's'} planned` : ''}`, 'info');
    }
    case 'unitPlanned': {
      // The daemon writes description as "<phase> — <intent…>"; the narrator
      // already speaks the phase, so the duplicated prefix goes.
      let raw = str(event.description);
      const dash = raw.indexOf('—');
      if (dash > 0 && raw.slice(0, dash).trim().toLowerCase() === phase.toLowerCase()) {
        raw = raw.slice(dash + 1).trim();
      }
      // A description that merely restates the run's intent says nothing the
      // feed's opening bubble didn't — "Planned <phase>" alone is the story.
      if (restates(raw, str(ctx.intent ?? ''))) raw = '';
      const desc = clip(raw, 120);
      return line(`Planned ${phase}${desc ? ` — ${desc}` : ''}`, 'info');
    }
    case 'councilConvened': {
      const n = Array.isArray(event.clis) ? event.clis.length : null;
      return line(`Council convened — polling ${n ?? '?'} agent${n === 1 ? '' : 's'}`, 'info');
    }
    case 'councilDeliberated':
      return line(
        `Ballot ${num(event.round) ?? '?'}: ${num(event.agreementPct) ?? '?'}% — below the ${num(event.neededPct) ?? 75}% bar, runoff`,
        'info',
      );
    case 'councilVoted':
      return line(
        `Council voted — ${num(event.agreementPct) ?? '?'}% agreement (${num(event.votes) ?? '?'} vote${num(event.votes) === 1 ? '' : 's'})`,
        'info',
      );
    case 'councilSeatFailed':
      return line(`Seat ${str(event.cli) || '?'} did not vote (${str(event.kind) || 'unreported'})`, 'fail');
    case 'unitDistributed': {
      const pct = num(event.agreement_pct);
      return line(
        `${phase} routed to ${str(event.cli) || '?'}${pct !== null ? ` — council ${pct}%` : ''}`,
        'info',
      );
    }
    case 'unitDispatched': {
      const attempt = num(event.attempt) ?? 0;
      return attempt > 0
        ? line(`${phase} re-dispatched (attempt ${attempt + 1})`, 'work')
        : line(`Worker started ${phase}`, 'work');
    }
    case 'unitExecuting':
      return line(`${phase} is running`, 'work');
    case 'unitOutputCaptured': {
      const kb = num(event.outputBytes) !== null ? `${Math.max(1, Math.round((event.outputBytes as number) / 1024))} KB` : null;
      if (event.stepStatus === 'failed') return line(`${phase} finished with errors`, 'fail');
      if (event.stepStatus === 'cancelled') return line(`${phase} was cancelled mid-step`, 'info');
      return line(`${phase} finished — output captured${kb !== null ? ` (${kb})` : ''}`, 'work');
    }
    case 'dataUsed': {
      const n = Array.isArray(event.files) ? event.files.length : 0;
      if (n === 0) return null;
      return line(`${phase} touched ${n} file${n === 1 ? '' : 's'}`, 'info');
    }
    case 'gateEscalated':
      return line(`Gate approaching — ${clip(str(event['condition'])) || 'a check escalated to you'}`, 'gate');
    case 'awaitingHuman':
      return line(`Gate: waiting on you${str(event.prompt) ? ` — ${promptHeadline(str(event.prompt))}` : ''}`, 'gate');
    case 'gateEvaluated':
      return event.combined === false
        ? line(`Checks ran on ${phase} — deny${str(event.denialReason ?? '') ? `: ${clip(str(event.denialReason ?? ''))}` : ''}`, 'fail')
        : line(`Checks ran on ${phase} — pass`, 'work');
    case 'gateDecided':
      return event.allow === true ? line('Gate: approved', 'work') : line('Gate: denied', 'fail');
    case 'unitReworkAmended':
      return line(`You amended ${phase} — re-dispatching with your note`, 'human');
    case 'unitDone':
      return line(`${phase} approved and done`, 'work');
    case 'unitDenied':
      return line(`${phase} denied`, 'fail');
    case 'unitReassigned': {
      const next = str(event['newCli']);
      return line(`${phase} reassigned ${str(event['previousCli']) || '?'} → ${next || 'council re-vote'}`, 'info');
    }
    case 'resumed':
      return line('Run resumed', 'work');
    case 'stepFailed':
      return line(`Step failed on ${phase}${str(event.detail) ? ` — ${clip(str(event.detail))}` : ''}`, 'fail');
    case 'crashRecoveryRedrive':
      return line(`Engine restarted — re-dispatching ${phase} (attempt ${num(event.attempt) ?? 1})`, 'fail');
    case 'workerStalled':
      return line(
        `Worker quiet for ${num(event.stalledSecs) ?? '?'}s — may be waiting at a prompt (open Term or send a message)`,
        'gate',
      );
    case 'failureTriaged':
      return line(
        `Failure triaged: ${str(event.decision) || '?'}${str(event.analysis) ? ` — ${clip(str(event.analysis), 120)}` : ''}`,
        'info',
      );
    case 'workerMessageQueued':
      return line(`Your message is queued for ${str(event['target']) || 'all'}'s next turn`, 'human');
    case 'workerMessageInjected':
      return line(`Your message was delivered to ${str(event['target']) || 'all'}`, 'human');
    case 'elicitationCreated':
      return line(`The agent asks: ${promptHeadline(str(event.message) || str(event.prompt)) || '(a question)'}`, 'gate');
    case 'elicitationResolved':
      return line('Answer sent — the agent continues', 'human');
    case 'governanceHookFired':
      // Allows are the noise floor; only a deny is a story beat.
      return event['decision'] === 'deny'
        ? line(`Blocked a tool call${str(event['denyingPolicy']) ? ` — ${str(event['denyingPolicy'])}` : ''}`, 'fail')
        : null;
    case 'governanceUnenforced':
      return line(`Governance was requested but is not enforced for ${str(event.cli) || 'this seat'}`, 'gate');
    case 'sessionCompleted':
      return line('Run completed', 'work');
    case 'sessionFailed':
      return line('Run failed', 'fail');
    case 'runCancelled':
      return line('Run cancelled', 'info');
    case 'error':
      return line(`Error: ${clip(str(event.message)) || 'unspecified'}`, 'fail');
    default:
      return null; // silent: deltas, heartbeat, terminal*, cliUsage, workerSession*, acp*, …
  }
}

/**
 * Stable feed order (DES-RUN-NARRATOR §3 rule 2): frames that BOTH carry the
 * durable run-wide `seq` (replayed from `GET /runs/:id/events`) compare by it;
 * every other pair keeps input order — live `/ws` frames carry no comparable
 * clock (`CoreEvent.seq` is terminal-scoped when present live), so arrival IS
 * their order and fabricating a key would scramble it. `Array.prototype.sort`
 * is stable, so the two regimes interleave without tearing.
 */
export function sortFeedEvents(events: readonly CoreEvent[]): CoreEvent[] {
  return [...events].sort((a, b) => {
    const as = typeof a.ts === 'number' && typeof a.seq === 'number' ? a.seq : null;
    const bs = typeof b.ts === 'number' && typeof b.seq === 'number' ? b.seq : null;
    if (as === null || bs === null) return 0;
    return as - bs;
  });
}

// ── Feed composition (§5) ────────────────────────────────────────────────────

export interface FeedLineItem {
  kind: 'line';
  key: string;
  line: NarrationLine;
}
export interface FeedUnitItem {
  kind: 'unit';
  key: string;
  ord: number;
}
export interface FeedArtifactItem {
  kind: 'artifact';
  key: string;
  artifact: RunArtifact;
}
export type FeedItem = FeedLineItem | FeedUnitItem | FeedArtifactItem;

/** One artifact the run produced/touched (§6). */
export interface RunArtifact {
  /** `file` = a path on the daemon host (FileViewer-openable); `pr` = external link. */
  kind: 'file' | 'pr';
  /** Path for files; URL for PRs. */
  ref: string;
  /** Display name (basename for files). */
  name: string;
  /** The phase that produced it, when known. */
  phase: string | null;
}

/** Inline artifact cards per dataUsed event are capped; the strip holds them all. */
export const INLINE_ARTIFACT_CAP = 6;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== '');
  return parts[parts.length - 1] ?? path;
}

/**
 * Every artifact the run has produced so far, deduped by ref, first-seen order
 * (§6). Files come from `dataUsed` frames; the delivered PR (when the DTO
 * carries one) is appended last — it is the run's final artifact.
 */
export function deriveArtifacts(
  events: readonly CoreEvent[],
  view: SessionView | null,
  ctx: NarratorContext,
): RunArtifact[] {
  const seen = new Set<string>();
  const out: RunArtifact[] = [];
  for (const e of events) {
    if (e.type !== 'dataUsed' || !Array.isArray(e.files)) continue;
    const phase = ctx.phaseOf(num(e.ord));
    for (const f of e.files) {
      if (typeof f !== 'string' || f === '' || seen.has(f)) continue;
      seen.add(f);
      out.push({ kind: 'file', ref: f, name: basename(f), phase });
    }
  }
  const delivery = (view?.session as { delivery?: { kind: string; url: string } } | undefined)?.delivery;
  if (delivery && typeof delivery.url === 'string' && delivery.url !== '' && !seen.has(delivery.url)) {
    out.push({ kind: 'pr', ref: delivery.url, name: 'Pull request', phase: null });
  }
  return out;
}

/** The old timeline filter, verbatim (FINDING-052): units that have run or are running. */
export function feedUnits(units: readonly WorkUnit[], executingUnitOrd: number | null): WorkUnit[] {
  return [...units]
    .sort((a, b) => a.ord - b.ord)
    .filter((u) => u.status === 'done' || u.status === 'rejected' || u.ord === executingUnitOrd);
}

/**
 * The one chronological feed (§5): narration lines in event order, each spoken
 * unit's group block anchored after its LAST line (its story ends with its
 * evidence), unspoken units appended in ord order, artifact cards following the
 * `dataUsed` line that produced them. Pure — the renderer maps over the result.
 */
export function buildFeed(
  events: readonly CoreEvent[],
  units: readonly WorkUnit[],
  executingUnitOrd: number | null,
  ctx: NarratorContext,
): FeedItem[] {
  const sorted = sortFeedEvents(events);
  const items: FeedItem[] = [];
  const seenArtifacts = new Set<string>();
  let lineNo = 0;

  for (const event of sorted) {
    const line = narrate(event, ctx);
    if (line === null) continue;
    lineNo += 1;
    items.push({ kind: 'line', key: `l${lineNo}`, line });
    // Artifact cards ride directly behind the dataUsed line that produced them (§6).
    if (event.type === 'dataUsed' && Array.isArray(event.files)) {
      const phase = ctx.phaseOf(num(event.ord));
      let inlined = 0;
      for (const f of event.files) {
        if (typeof f !== 'string' || f === '' || seenArtifacts.has(f)) continue;
        seenArtifacts.add(f);
        if (inlined >= INLINE_ARTIFACT_CAP) continue; // strip still collects them
        inlined += 1;
        items.push({
          kind: 'artifact',
          key: `a${lineNo}:${f}`,
          artifact: { kind: 'file', ref: f, name: basename(f), phase },
        });
      }
    }
  }

  // Anchor each spoken unit's group after its LAST narration line; append the rest.
  const anchored: FeedItem[] = [];
  const speaks = new Map<number, number>(); // ord -> index of last line item in `items`
  items.forEach((it, i) => {
    if (it.kind === 'line' && it.line.ord !== null) speaks.set(it.line.ord, i);
  });
  const unitsToAnchor = feedUnits(units, executingUnitOrd);
  const byLastLine = new Map<number, WorkUnit[]>();
  const unanchored: WorkUnit[] = [];
  for (const u of unitsToAnchor) {
    const at = speaks.get(u.ord);
    if (at === undefined) unanchored.push(u);
    else byLastLine.set(at, [...(byLastLine.get(at) ?? []), u]);
  }
  items.forEach((it, i) => {
    anchored.push(it);
    for (const u of byLastLine.get(i) ?? []) {
      anchored.push({ kind: 'unit', key: `u${u.ord}`, ord: u.ord });
    }
  });
  for (const u of unanchored) {
    anchored.push({ kind: 'unit', key: `u${u.ord}`, ord: u.ord });
  }
  return anchored;
}

/**
 * The now-bar's "last narration" line (§2): the newest spoken line of the trail,
 * or `null` when nothing has been spoken yet (empty/pruned trail — the caller
 * falls back to a unit-derived status phrase).
 */
export function lastNarration(events: readonly CoreEvent[], ctx: NarratorContext): NarrationLine | null {
  const sorted = sortFeedEvents(events);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const line = narrate(sorted[i]!, ctx);
    if (line !== null) return line;
  }
  return null;
}
