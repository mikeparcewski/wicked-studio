/**
 * "SHOW ME THIS JOB", THEN "TELL IT …" (operator 2026-10-31, lane voice-jobs). Pure: what the words name and what they
 * ask for. The controller (`voice/controller.ts`) acts on the result, and nothing it does is sent before an on-screen
 * confirm.
 *
 *  1. WHICH JOB. "this job" / "it" is the job in focus (the one previewed, else the run page voice was opened from),
 *     else the only running one. A name or description ("the webhook retries job") is fuzzy-matched against running
 *     and recent jobs: words of the title, a prefix, or one letter off (a transcription slip). Several close matches →
 *     a choose-one ask.
 *  2. WHAT TO DO. Deterministic first: show / the other one / close / pin; tell it to …; stop (with a reason); raise
 *     rigor; check on it; answer its gate; a constraint or a next step for its working document. Only words that match
 *     none of these, said while a job is in view, go to one cheap classification (the controller's).
 */

import { parseGateAnswer, type GateWords } from './intent.js';

export type Rigor = 'light' | 'standard' | 'high' | 'highest';
export const RIGOR_ORDER: readonly Rigor[] = ['light', 'standard', 'high', 'highest'];

/** A job voice can name: running (the system read) or recent (the runs list). */
export interface JobRef {
  runId: string;
  title: string;
  running: boolean;
}

const norm = (t: string): string => t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Words that name no job by themselves. */
const FILLER = new Set(['the', 'a', 'an', 'job', 'run', 'one', 'that', 'this', 'it', 'its', 'for', 'and', 'of', 'to', 'on', 'in', 'with', 'my', 'me', 'please', 'which', 'is', 'about', 'thing', 'task', 'work']);

/** "this job", "it", "that one", "": the job in focus. */
export function isDeictic(words: string): boolean {
  const t = norm(words).replace(/^(the|that|this)\s+/, '');
  return t === '' || /^(it|this|that|job|run|one|current( job| run)?|this( job| run| one)?|that( job| run| one)?|the job|the run|the current( job| run)?)$/.test(t)
    || /^(job|run|one)$/.test(t);
}

/** Edit distance ≤ 1 (one letter added, dropped or changed): "webhooks" ~ "webhook", "retrys" ~ "retries" is not. */
function oneOff(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** How well one spoken word matches one title word (0..1). */
function wordScore(w: string, h: string): number {
  if (w === h) return 1;
  // A plural or a stem: "retries" ~ "retry", "webhooks" ~ "webhook".
  const stem = (x: string): string => x.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : ''));
  if (stem(w) === stem(h) && stem(w).length >= 3) return 0.95;
  if (w.length >= 3 && h.startsWith(w)) return 0.85;
  if (h.length >= 4 && w.startsWith(h)) return 0.8;
  if (w.length >= 5 && oneOff(w, h)) return 0.7;
  return 0;
}

/** How well the spoken words name a job (0..1): the mean of each word's best match in the title (or the run id). */
export function jobScore(words: string, job: JobRef): number {
  const want = norm(words).split(' ').filter((w) => w.length > 1 && !FILLER.has(w));
  if (want.length === 0) return 0;
  const have = [...norm(job.title).split(' '), ...norm(job.runId).split(/[ -]/)].filter((h) => h !== '');
  let sum = 0;
  for (const w of want) {
    let best = 0;
    for (const h of have) best = Math.max(best, wordScore(w, h));
    sum += best;
  }
  return sum / want.length;
}

export type Resolution =
  | { kind: 'one'; job: JobRef; how: 'focused' | 'only-running' | 'named' }
  | { kind: 'choose'; jobs: JobRef[]; why: string }
  | { kind: 'none'; why: string };

/** The least a name must match to count, and how far ahead the best must be to win outright. */
export const MATCH_MIN = 0.5;
export const MATCH_MARGIN = 0.2;
const CHOOSE_MAX = 4;

/**
 * The job the words name. `focused` is the job in focus (previewed, or the page voice was opened from), if any.
 * Running jobs come first, then recent ones; a tie between the two is broken toward the running job.
 */
export function resolveJob(words: string, jobs: readonly JobRef[], focused: string | null): Resolution {
  const running = jobs.filter((j) => j.running);
  if (isDeictic(words)) {
    const f = focused !== null ? jobs.find((j) => j.runId === focused) : undefined;
    if (f !== undefined) return { kind: 'one', job: f, how: 'focused' };
    if (running.length === 1) return { kind: 'one', job: running[0]!, how: 'only-running' };
    if (running.length === 0) return { kind: 'none', why: 'No job is running, and none is open, so I don’t know which job you mean. Say its name.' };
    return { kind: 'choose', jobs: running.slice(0, CHOOSE_MAX), why: `${running.length} jobs are running. Which one?` };
  }
  const scored = jobs
    .map((j) => ({ j, s: jobScore(words, j) + (j.running ? 0.05 : 0) }))
    .filter((x) => x.s >= MATCH_MIN)
    .sort((a, b) => b.s - a.s);
  if (scored.length === 0) {
    const names = running.slice(0, 3).map((j) => j.title).join('; ');
    return { kind: 'none', why: `I couldn’t find a job called “${words.trim()}”.${names !== '' ? ` Running now: ${names}.` : ''}` };
  }
  const [top, second] = scored;
  if (second === undefined || top!.s - second.s >= MATCH_MARGIN) return { kind: 'one', job: top!.j, how: 'named' };
  const close = scored.filter((x) => top!.s - x.s < MATCH_MARGIN).slice(0, CHOOSE_MAX).map((x) => x.j);
  return { kind: 'choose', jobs: close, why: `${close.length} jobs match “${words.trim()}”. Which one?` };
}

/** "the other one": the next job after the one shown — the other candidates of the last choice first, then running. */
export function otherJob(current: string | null, lastChoice: readonly string[], jobs: readonly JobRef[]): JobRef | null {
  const pool = [...lastChoice.map((id) => jobs.find((j) => j.runId === id)).filter((j): j is JobRef => j !== undefined), ...jobs.filter((j) => j.running)];
  const seen = new Set<string>();
  const order = pool.filter((j) => (seen.has(j.runId) ? false : (seen.add(j.runId), true)));
  if (order.length === 0) return null;
  const at = order.findIndex((j) => j.runId === current);
  const next = order[(at + 1) % order.length]!;
  return next.runId === current ? null : next;
}

// ── What the words ask for ──────────────────────────────────────────────────────────────────────────

/** What a person can ask of one job by voice. Every one is confirmed on screen before it is sent. */
export type JobAction =
  | { kind: 'steer'; note: string }
  | { kind: 'doc'; section: 'constraints' | 'next'; text: string }
  | { kind: 'stop'; reason: string | null }
  | { kind: 'rigor'; to: Rigor | null }
  | { kind: 'gate'; words: GateWords }
  | { kind: 'check' };

export type Spoken =
  | { kind: 'show'; job: string }
  | { kind: 'other' }
  | { kind: 'close' }
  | { kind: 'pin'; on: boolean }
  /** `job` = the words naming it ("" = it / this job). `explicit`: said with "tell" (the rest is the note as said). */
  | { kind: 'act'; job: string; action: JobAction; explicit: boolean };

const SHOW = /^(?:(?:can you |could you |please |ok |okay |now )*)(?:show|open|bring up|pull up|display|switch to|go to|let me see|let's see|let me look at|look at)\s+(?:me\s+)?(.+?)\s*(?:please)?$/;
const OTHER = /^(?:(?:show|open|switch to|go to)\s+(?:me\s+)?)?(?:the\s+)?(?:other|next)(?:\s+(?:one|job|run))?$|^(?:swap|switch)(?:\s+(?:it|jobs|them))?$/;
const CLOSE = /^(?:please\s+)?(?:close|hide|dismiss)(?:\s+(?:it|that|this|the preview|the job|the tile|this job|that job))?$/;
const PIN = /^(?:please\s+)?(un)?pin(?:\s+(?:it|that|this|the preview|the job|this job))?(?:\s+(?:there|open))?$/;
const KEEP = /^keep\s+(?:it|this|that)\s+(?:there|open|up|pinned)$/;

const STOP_WORDS = /^(?:stop|halt|cancel|abort|kill|end)\b/;
const REASON = /^\s*,?\s*(?:because|since|as|cause|'cause|the reason is|reason is|reason)\b\s*:?\s*(.+)$/;

function rigorOf(t: string): Rigor | null {
  const m = /\b(?:to|at|up to)\s+(light|standard|high|highest|max(?:imum)?)\b/.exec(t);
  if (m === null) return /\bhighest\b|\bmax(?:imum)?\b/.test(t) ? 'highest' : null;
  return m[1] === 'max' || m[1] === 'maximum' ? 'highest' : (m[1] as Rigor);
}

const cap = (s: string): string => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1));

/**
 * What one action-phrase asks of the job (the words after "tell it to", or a whole command). `null` = not one of the
 * deterministic actions (after "tell it", that is a steer note; on its own, the controller may classify it).
 */
export function actionOf(raw: string): JobAction | null {
  const said = raw.trim().replace(/[.!]+$/, '');
  const t = norm(said);
  if (t === '') return null;
  // stop / cancel (with an optional reason): "stop", "stop it because the tests are wrong", "cancel the job"
  if (STOP_WORDS.test(t) && !/^stop\s+(?:listening|talking)\b/.test(t)) {
    const rest = t.replace(STOP_WORDS, '').replace(/^\s*(?:it|this|that|the job|the run|this job|working|now|right now)\b/, '').trim();
    const r = REASON.exec(rest);
    const reason = r !== null ? r[1]!.trim() : null;
    // Anything else after "stop" ("stop using lodash") is an instruction, not a stop.
    if (r === null && rest !== '') return null;
    return { kind: 'stop', reason: reason === null || reason === '' ? null : cap(reason) };
  }
  // raise rigor: "raise the rigor", "raise rigor to high", "be more careful", "bump rigor"
  if (/\b(?:raise|increase|bump|up|turn up|boost)\s+(?:the\s+|its\s+)?rigor\b|^(?:be\s+)?more\s+(?:careful|rigorous|thorough)$|^rigor\s+(?:up|to\s+\w+)$/.test(t)) {
    return { kind: 'rigor', to: rigorOf(t) };
  }
  // check on it: the in-flight analyzer
  if (/^(?:check on (?:it|this|that|the job|the run|how it's going|its progress)|check in(?: on it)?|is it (?:stuck|looping|okay|ok|going well|wasting tokens)\??|how is it (?:doing|going)\??|how's it (?:doing|going)\??|analy[sz]e it)$/.test(t)) {
    return { kind: 'check' };
  }
  // the working document: "add a constraint: keep /v1 working", "constraint: …", "next: add GBP tests", "do X next"
  // (matched on the words as said, so a path or a symbol in them is kept)
  const c = /^(?:add\s+(?:a\s+|the\s+|this\s+)?constraint|new constraint|constraint)\s*(?:that\b|:|,|-)?\s*(.+)$/i.exec(said);
  if (c !== null) return { kind: 'doc', section: 'constraints', text: cap(c[1]!.trim()) };
  const n = /^(?:(?:add\s+)?(?:as\s+)?(?:the\s+)?next(?:\s+step)?|after that)\s*(?:that\b|:|,|-)?\s*(.+)$/i.exec(said);
  if (n !== null && !/^(?:one|job|run)$/i.test(n[1]!.trim())) return { kind: 'doc', section: 'next', text: cap(n[1]!.trim()) };
  const n2 = /^((?:do|add|write|fix|then)\b.+?)\s+next$/i.exec(said);
  if (n2 !== null) return { kind: 'doc', section: 'next', text: cap(n2[1]!.trim()) };
  // its open decision: "approve it", "send it back with a note …", "reject it"
  const g = parseGateAnswer(t);
  if (g !== null) {
    if (g.action !== 'request_changes' || g.note === '') return { kind: 'gate', words: g };
    // The note as said (case and symbols kept): what follows "send it back (with a note)".
    const m = /\bsend (?:it |this )?back\b(?:\s*(?:with|saying|because|and tell (?:them|it)|:|,)\s*(?:a note\s*)?(?:that\s*)?)?(.*)$/i.exec(said);
    return { kind: 'gate', words: { ...g, note: cap((m?.[1] ?? g.note).trim()) } };
  }
  return null;
}

/** "tell it to …", "tell the webhook retries job to …", "ask it to …", "steer it: …". */
const TELL = /^(?:please\s+)?(?:tell|ask|steer|instruct|get)\s+(.+?)\s+(?:to|that)\s+(.+)$/i;
const TELL_COLON = /^(?:please\s+)?(?:tell|steer)\s+(.+?)\s*:\s*(.+)$/i;
/** "stop the webhook job because …" / "raise rigor on the webhook job" — a command naming its job. */
const NAMED = /^(stop|cancel|halt|abort|kill|check on|raise (?:the )?rigor (?:on|for)|approve|reject)\s+(?:the\s+)?(.+?)(?:\s+job|\s+run)?(\s+(?:because|since|to)\b.*)?$/;

/** Split "the webhook retries job" from a tell phrase: the words naming the job, without "the" and "job". */
function jobWords(raw: string): string {
  const t = norm(raw).replace(/^(?:the|that|this)\s+/, '').replace(/\s+(?:job|run)$/, '').trim();
  return isDeictic(t) ? '' : t;
}

/** One utterance, as far as the job preview and "tell it" go; `null` = none of these (a question, a gate answer…). */
export function parseJobWords(raw: string): Spoken | null {
  const said = raw.trim().replace(/[.!?]+$/, '').trim();
  const t = norm(said);
  if (t === '' || /^(?:please\s+)?stop\s+(?:listening|talking)\b/.test(t)) return null;
  if (OTHER.test(t)) return { kind: 'other' };
  if (CLOSE.test(t)) return { kind: 'close' };
  const p = PIN.exec(t);
  if (p !== null) return { kind: 'pin', on: p[1] === undefined };
  if (KEEP.test(t)) return { kind: 'pin', on: true };
  const s = SHOW.exec(t);
  if (s !== null && !/^(?:me\s+)?(?:what|how|why|whether)\b/.test(s[1]!)) {
    const w = s[1]!.replace(/^(?:me\s+)?/, '').replace(/\s+(?:please|now)$/, '').trim();
    return { kind: 'show', job: jobWords(w) };
  }
  const tell = TELL.exec(said) ?? TELL_COLON.exec(said);
  if (tell !== null) {
    const job = jobWords(tell[1]!);
    const rest = tell[2]!.trim();
    const action = actionOf(rest);
    return { kind: 'act', job, action: action ?? { kind: 'steer', note: cap(rest) }, explicit: true };
  }
  // A command naming its job: "stop the webhook job because it's the wrong repo", "check on the dark mode job".
  const named = NAMED.exec(t);
  if (named !== null && !isDeictic(named[2]!) && !/^(?:it|this|that)\b/.test(named[2]!)) {
    const verb = named[1]!;
    const tail = named[3] ?? '';
    const action = actionOf(`${verb.startsWith('raise') ? 'raise rigor' : verb}${verb === 'check on' ? ' it' : ''}${tail}`);
    if (action !== null) return { kind: 'act', job: jobWords(named[2]!), action, explicit: false };
  }
  const action = actionOf(said);
  if (action !== null) {
    // "it" only: a bare command is about the job in focus. "rigor … on the X job" names one.
    const on = /\b(?:on|for)\s+(?:the\s+)?(.+?)(?:\s+job|\s+run)?$/.exec(t);
    return { kind: 'act', job: action.kind === 'rigor' && on !== null && !/rigor/.test(on[1]!) ? jobWords(on[1]!) : '', action, explicit: false };
  }
  return null;
}

/** The words a confirm card says for an action ("Send to “Webhook retries”: “Keep the old URL working”?"). */
export function actionWords(a: JobAction, title: string, now: { rigor: Rigor | null } = { rigor: null }): { prompt: string; confirm: string; record: string; detail: string } {
  switch (a.kind) {
    case 'steer':
      return { prompt: `Send to “${title}”: “${a.note}”?`, confirm: 'Send', record: `Sent to ${title} · by voice`, detail: 'It goes to the job’s worker as your note, like a typed one, and lands at its next turn.' };
    case 'doc':
      return a.section === 'constraints'
        ? { prompt: `Add to “${title}”’s Constraints: “${a.text}”?`, confirm: 'Add the constraint', record: `Constraint added to ${title} · by voice`, detail: 'Constraints are standing: the job follows them in every later step until you change them.' }
        : { prompt: `Add to “${title}”’s Next: “${a.text}”?`, confirm: 'Add to Next', record: `Added to ${title}’s Next · by voice`, detail: 'It rides the job’s next step once.' };
    case 'stop':
      return { prompt: `Stop “${title}”${a.reason !== null && a.reason.trim() !== '' ? ` because “${a.reason}”` : ''}?`, confirm: 'Stop it', record: `Stopped ${title} · by voice, confirmed`, detail: 'It stops where it is and its work so far is kept. You have 10 s to undo.' };
    case 'rigor': {
      const to = a.to ?? nextRigor(now.rigor);
      return { prompt: `Raise “${title}”’s rigor${now.rigor !== null ? ` from ${now.rigor}` : ''} to ${to ?? 'the next level'}?`, confirm: 'Raise rigor', record: `Rigor raised on ${title}${to !== null ? ` to ${to}` : ''} · by voice`, detail: 'More review from here on. Rigor can be raised, never lowered.' };
    }
    case 'check':
      return { prompt: `Check on “${title}”?`, confirm: 'Check on it', record: `Checking on ${title}…`, detail: 'Another agent reads what its current step has done so far, read-only, and says whether it is progressing, looping, stuck or wasting tokens. A check costs a little (at most about $0.25).' };
    case 'gate':
      return { prompt: `Answer “${title}”’s decision?`, confirm: 'Confirm', record: '', detail: '' };
  }
}

/** One level up, or null when it is already at the top (or unknown). */
export function nextRigor(r: Rigor | null): Rigor | null {
  if (r === null) return 'high';
  const i = RIGOR_ORDER.indexOf(r);
  return i >= 0 && i < RIGOR_ORDER.length - 1 ? RIGOR_ORDER[i + 1]! : null;
}

/** The one cheap classification's question and how its answer is read (only for words that matched nothing). */
export const CLASSIFY_PROMPT = (words: string, title: string): string =>
  `Classify what the person wants done with the running job "${title}". They said: "${words}". Answer with exactly one word: steer (an instruction for the job), stop, rigor (be more careful), check (how is it doing), or question (they are asking you something). One word only.`;

export function readClass(reply: string): 'steer' | 'stop' | 'rigor' | 'check' | 'question' | null {
  const m = /\b(steer|stop|rigor|check|question)\b/i.exec(reply);
  return m === null ? null : (m[1]!.toLowerCase() as 'steer' | 'stop' | 'rigor' | 'check' | 'question');
}
