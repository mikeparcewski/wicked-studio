/**
 * What did the person mean? (DES-VOICE §2a, §3.) Spoken words are matched to the few things voice can do; anything
 * else is a question for the system chat. Matching is deliberately narrow: a decision is only ever PROPOSED from
 * words, and the person confirms it on screen (gate answers, steers); an unmatched phrase answers nothing and
 * says so. Pure, so the tests read like the conversation.
 */

const norm = (t: string): string => t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ?:,-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "Do you want to enter voice mode?": yes, no, a question about voice, or nothing usable. */
export type EntryReply = { kind: 'yes' } | { kind: 'no' } | { kind: 'question'; answer: string } | { kind: 'unclear' };

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go|go ahead|let's go|let's do it|do it|enter|please|start|absolutely|of course)\b/;
const NO = /^(no|nope|nah|not now|not today|cancel|never ?mind|close|no thanks|stop)\b/;
const QUESTION = /\?|^(what|how|is|are|does|do|can|will|why|where|who|when|which|tell me)\b/;

/** Answers to questions ABOUT voice mode, asked before entering it (the modal answers, then asks again). */
export function answerVoiceQuestion(text: string): string {
  const t = norm(text);
  if (/record|privacy|private|stor|save|kept|keep|sent|send|cloud|listen|hear|my voice|audio|disk/.test(t)) {
    return 'No. Your speech is turned into text on this computer and the audio is dropped straight away. Nothing is recorded or sent anywhere. I only listen while voice mode is open, and anything you ask a job to do still shows on screen before it happens.';
  }
  if (/space|stream|mode|push|hold|always/.test(t)) {
    return 'You choose how I listen. Streaming keeps the mic on and I answer when you pause. Space bar means I hear you only while you hold Space or the mic button.';
  }
  if (/approve|decision|gate|ship|deliver|confirm/.test(t)) {
    return 'You can answer a decision by voice, but it always stops at a Confirm on screen, then waits the usual 10 seconds so you can undo it.';
  }
  if (/leave|exit|stop|quit|out/.test(t)) {
    return 'Say “leave voice” or “stop listening”, press Esc, or use the Leave voice button.';
  }
  return 'Voice mode lets you talk to the system: ask what is running, steer a job, or answer a decision. The conversation is written out as captions, and the live system is around it.';
}

export function parseEntry(text: string): EntryReply {
  const t = norm(text);
  if (t === '') return { kind: 'unclear' };
  if (QUESTION.test(t)) return { kind: 'question', answer: answerVoiceQuestion(t) };
  if (NO.test(t)) return { kind: 'no' };
  if (YES.test(t)) return { kind: 'yes' };
  return { kind: 'unclear' };
}

/** "How should I listen?" */
export function parseMode(text: string): 'stream' | 'space' | null {
  const t = norm(text);
  if (/\b(space|push|hold|press|button|walkie)\b/.test(t)) return 'space';
  if (/\b(stream|streaming|always|continuous|open mic|hands free|keep listening)\b/.test(t)) return 'stream';
  return null;
}

/** "Stop listening", "leave voice", … */
export function isLeave(text: string): boolean {
  return /^(please )?(stop listening|leave voice( mode)?|exit voice( mode)?|exit|close voice( mode)?|goodbye|bye|that's all|end voice( mode)?)\b/.test(norm(text));
}

/** An on-screen confirm, answered aloud. */
export function parseConfirm(text: string): 'confirm' | 'cancel' | null {
  const t = norm(text);
  if (/^(not that|no|nope|cancel|wrong|stop|never ?mind|don't)\b/.test(t)) return 'cancel';
  if (/^(confirm|confirmed|yes|yeah|yep|correct|that's right|do it|send it|send|go ahead|ok|okay)\b/.test(t)) return 'confirm';
  return null;
}

/** A spoken answer to a decision, matched to the dock's own moves. */
export type GateWords = { action: 'approve' } | { action: 'request_changes'; note: string } | { action: 'reject' };

export function parseGateAnswer(text: string): GateWords | null {
  const t = norm(text);
  if (/\b(don't|do not|never) (approve|ship|deliver)\b/.test(t)) return null;
  const back = /\bsend (it |this )?back\b(?:\s*(?:with|saying|because|and tell (?:them|it)|:|,)\s*(?:a note\s*)?(?:that\s*)?)?(.*)$/.exec(t);
  if (back !== null) return { action: 'request_changes', note: (back[2] ?? '').trim() };
  if (/\b(reject|cancel the (run|job)|stop the (run|job)|kill it|throw it away)\b/.test(t)) return { action: 'reject' };
  if (/\b(approve|approved|ship|deliver|go ahead|accept|lgtm|looks good|merge it)\b/.test(t)) return { action: 'approve' };
  return null;
}

/** A spoken steer: "tell the dark mode job to use CSS variables". `job` = the words naming it ("" = "it"). */
export interface SteerWords { job: string; message: string }

export function parseSteer(text: string): SteerWords | null {
  const t = text.trim();
  const m = /^(?:please\s+)?(?:tell|ask|steer|instruct)\s+(?:the\s+)?(.+?)\s+(?:job\s+|run\s+)?(?:to|that)\s+(.+)$/i.exec(t)
    ?? /^(?:please\s+)?steer\s+(?:the\s+)?(.+?)(?:\s+job|\s+run)?\s*:\s*(.+)$/i.exec(t);
  if (m === null) return null;
  const job = norm(m[1] ?? '').replace(/\b(job|run)$/, '').trim();
  const message = (m[2] ?? '').trim();
  if (message === '') return null;
  return { job: job === 'it' || job === 'this' ? '' : job, message: message.charAt(0).toUpperCase() + message.slice(1) };
}

/** The running job a steer names: the best word overlap with a title; "" (it) = the only running job. */
export function matchJob<T extends { title: string }>(words: string, jobs: readonly T[]): T | null {
  if (jobs.length === 0) return null;
  if (words === '') return jobs.length === 1 ? jobs[0]! : null;
  const want = new Set(norm(words).split(' ').filter((w) => w.length > 2 && !['the', 'and', 'for', 'job', 'run'].includes(w)));
  if (want.size === 0) return null;
  let best: T | null = null;
  let score = 0;
  let tie = false;
  for (const j of jobs) {
    const have = new Set(norm(j.title).split(' '));
    const s = [...want].filter((w) => have.has(w) || [...have].some((h) => h.startsWith(w) || w.startsWith(h) && h.length > 3)).length;
    if (s > score) { best = j; score = s; tie = false; } else if (s === score && s > 0) tie = true;
  }
  return score > 0 && !tie ? best : null;
}
