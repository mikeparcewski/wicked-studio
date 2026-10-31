import type { Ask, AskOption } from '../api/ask.js';

/**
 * PAGE CHATS (DES-LEARN §6.2; mockup learn-and-panels states e and f), pure: the pages that carry their own
 * chat, what each tells it, and the guided "What next?" that follows each answer (DES-GUIDED-CHAT: an answer
 * is cited text, then a choice; there are no buttons in bubbles).
 *
 * A page chat is the system chat's engine drawn inside the page (AskDock in its `page` mode): the same crew
 * chat, the same citation check, the same history. Each page keeps its own conversation.
 */

export type PageChatKind = 'understand' | 'report' | 'nerve' | 'evaluate' | 'steering' | 'memory' | 'learn';

export const PAGE_CHAT_KINDS: readonly PageChatKind[] = ['understand', 'report', 'nerve', 'evaluate', 'steering', 'memory', 'learn'];

/** The item a question is about: a number, a chart, a row, a past evaluation. */
export interface PageFocus {
  /** Stable per item, so asking about the same thing twice is the same focus. */
  key: string;
  /** What the chip says ("68% passed first time · Last 7 days"). */
  label: string;
  /** Its data, as lines for the context pack. */
  lines: string[];
}

export interface PageChatSpec {
  /** The chat's header: "Chat · Report". */
  title: string;
  /** "Ask about the Report…". */
  placeholder: string;
  /** The read-only workflow its chat runs (`analyze` on Understand), when crew runs it; else a plain chat. */
  workflow?: string;
  /** What the empty thread says a message does here. */
  hint: string;
}

export const PAGE_CHAT_SPECS: Record<PageChatKind, PageChatSpec> = {
  understand: {
    title: 'Understand', placeholder: 'Ask a follow-up…', workflow: 'analyze',
    hint: 'Ask how your code fits together. The answer reads the code graph and cites the files it rests on; nothing changes.',
  },
  report: {
    title: 'Report', placeholder: 'Ask about the Report…',
    hint: 'Ask about any number or chart on this page. Click one to ask about it; the chat sees the figures behind it.',
  },
  nerve: {
    title: 'Nerve Center', placeholder: 'Ask about system state…',
    hint: 'Ask about the system: host load, the helpers, what is slowing work. The chat sees the snapshot this page shows.',
  },
  evaluate: {
    title: 'Evaluate', placeholder: 'Ask about your evaluations…',
    hint: 'Ask about your evaluations: what slipped through, which rules to add, what to run next.',
  },
  steering: {
    title: 'Steering', placeholder: 'Ask about your rules…',
    hint: 'Ask about the rules on this page. To write rules, use Add with chat: the steering assistant drafts them for you to approve.',
  },
  memory: {
    title: 'Memory', placeholder: 'Tell it what to remember, or ask…',
    hint: 'Tell it what helpers should remember, or ask what they remember. What it would keep is filed for you to approve; nothing is saved directly.',
  },
  learn: {
    title: 'Learn', placeholder: 'Ask about what studio has learned…',
    hint: 'Ask what studio has learned about your style, rules and brand, and what to teach it next.',
  },
};

/** Session storage: each page's chat is its own conversation (the system chat's is `wicked.ask.session`). */
export function pageChatSessionKey(kind: PageChatKind): string {
  return `wicked.pagechat.${kind}.session`;
}

/** The page's own instruction, said in every first pack: answer from the page, change nothing from here. */
export function pageChatRules(kind: PageChatKind): string {
  const base = 'This chat sits inside the page named above: answer from what the page shows and what you can read; change nothing from this chat (a job makes changes).';
  return kind === 'memory'
    ? `${base} When the user tells you something helpers should remember, end your answer with one line per memory, each starting "Remember: ", one fact per line. Studio files those lines as proposals for the user to approve.`
    : base;
}

// ── What next (the guided ask after an answer) ─────────────────────────────────────────────────

/** What a "What next?" option does; the page chat carries it out (navigation stays the page's). */
export type NextMove =
  | 'follow-up' // focus the composer
  | 'none' // close the ask
  | 'jobs' // open Jobs
  | 'new-job' // open New job with the question written in
  | 'recheck' // read the system again
  | 'agents' // open Agents
  | 'draft-rules' // hand an evaluation's gaps to the steering assistant
  | 'rerun' // run the evaluation again
  | 'steer-assist' // open Steering's Add with chat
  | 'remember' // keep some of the answer as memory proposals
  | 'graph'; // open Understand's Explore the graph

export interface NextContext {
  kind: PageChatKind;
  /** The item the last question was about. */
  focus: PageFocus | null;
  /** Memory: the "Remember:" lines the last answer ended with. */
  remember?: readonly string[];
  /** Evaluate: the evaluation the chat is analysing has gaps a rule could close. */
  gaps?: number;
  /** Understand: the repository the question read, for "in acme/payments-api". */
  repo?: string | null;
}

const opt = (id: NextMove, label: string, consequence: string, extra: Partial<AskOption> = {}): AskOption =>
  ({ id, label, token: id, consequence, ...extra });

const FOLLOW = opt('follow-up', 'Ask a follow-up', 'Type it below; the answer lands here, in this conversation.', { sub: 'keeps this thread' });
const NONE = opt('none', 'Nothing for now', 'This choice closes; the conversation stays here.');

/** The options after an answer on `kind`'s page, the recommended one first. */
export function nextOptions(ctx: NextContext): AskOption[] {
  switch (ctx.kind) {
    case 'understand':
      return [
        { ...FOLLOW, recommended: true },
        opt('graph', 'Explore the graph', 'Opens Explore the graph on this page: each repository’s code graph, hotspots and blast radius.'),
        opt('new-job', 'Start a job about this', 'Opens New job with your question written in; nothing starts until you start it.', ctx.repo != null ? { sub: `in ${ctx.repo}` } : {}),
        NONE,
      ];
    case 'report':
      return [
        { ...FOLLOW, recommended: true },
        opt('jobs', 'Open the jobs behind it', 'Opens Jobs, where every job in this period is listed with how it ended.'),
        opt('new-job', 'Start a job about it', 'Opens New job with the question written in; nothing starts until you start it.'),
        NONE,
      ];
    case 'nerve':
      return [
        { ...FOLLOW, recommended: true },
        opt('recheck', 'Check again', 'Reads the system again now; this page updates with what it finds.'),
        opt('agents', 'Open Agents', 'Opens the Agents page: each helper’s sign-in, health and record.'),
        NONE,
      ];
    case 'evaluate':
      return (ctx.gaps ?? 0) > 0
        ? [
            opt('draft-rules', 'Draft rules for the gaps', `Opens the steering assistant with the ${ctx.gaps} uncovered ${ctx.gaps === 1 ? 'behaviour' : 'behaviours'} written in; you send it, and nothing is saved until you approve the rules.`, { recommended: true }),
            opt('rerun', 'Run this evaluation again', 'Replays the same behaviours against the rules in force now; the result is added to Past runs.'),
            FOLLOW,
            NONE,
          ]
        : [{ ...FOLLOW, recommended: true }, opt('rerun', 'Run this evaluation again', 'Replays the same behaviours against the rules in force now; the result is added to Past runs.'), NONE];
    case 'steering':
      return [
        { ...FOLLOW, recommended: true },
        opt('steer-assist', 'Draft rules with the assistant', 'Opens Add with chat: the steering assistant drafts rules from what you describe; nothing is saved until you approve them.'),
        NONE,
      ];
    case 'memory':
      return (ctx.remember?.length ?? 0) > 0
        ? [opt('remember', 'Choose what to keep', `Lists the ${ctx.remember!.length} ${ctx.remember!.length === 1 ? 'memory' : 'memories'} it would keep; what you pick is filed for your approval.`, { recommended: true }), FOLLOW, NONE]
        : [{ ...FOLLOW, recommended: true }, NONE];
    case 'learn':
      return [{ ...FOLLOW, recommended: true }, NONE];
  }
}

/** The "What next?" ask after answer number `n` on `kind`'s page. */
export function nextAsk(ctx: NextContext, n: number): Ask {
  return {
    id: `pagechat:${ctx.kind}:next:${n}`,
    host: 'chat',
    from: { kind: 'studio', id: `pagechat:${ctx.kind}`, label: 'Studio' },
    prompt: 'What next?',
    kind: 'choose',
    options: nextOptions(ctx),
    answeredBy: 'person',
    record: 'You chose: {label}',
  };
}

/** Memory's pick-several: the answer's "Remember:" lines, all picked to start with. */
export function rememberAsk(lines: readonly string[], n: number): Ask {
  const options: AskOption[] = lines.map((l, i) => ({ id: `m${i}`, label: l, token: l, sub: 'told by you' }));
  return {
    id: `pagechat:memory:keep:${n}`,
    host: 'chat',
    from: { kind: 'studio', id: 'pagechat:memory', label: 'Studio' },
    prompt: 'Which should helpers remember?',
    detail: 'Each one you pick is filed as a proposal; it is kept once you approve it in Suggested.',
    kind: 'pick',
    options,
    multi: { min: 1, max: options.length },
    default: options.map((o) => o.id),
    answeredBy: 'person',
    record: 'You kept: {labels}',
  };
}

/** The "Remember: …" lines an answer ends with (Memory's chat), trimmed, de-duplicated, at most 12. */
export function rememberLines(answer: string): string[] {
  const out: string[] = [];
  for (const raw of answer.split('\n')) {
    const m = /^\s*(?:[-*•]\s*)?\**remember\**\s*:\s*\**\s*(.+?)\s*$/i.exec(raw);
    if (m === null) continue;
    const line = m[1]!.replace(/\*+$/u, '').trim();
    if (line !== '' && !out.includes(line)) out.push(line);
    if (out.length === 12) break;
  }
  return out;
}

// ── The page's data, for the pack ──────────────────────────────────────────────────────────────

/** How much of a page's visible text rides a pack (the pack is stored with the message). */
export const PAGE_TEXT_CAP = 4000;
/** How much one item's text rides. */
export const ITEM_TEXT_CAP = 1500;

/**
 * Visible text → pack lines: whitespace folded, blank lines dropped, repeated lines dropped, cut at `cap`
 * characters with the cut said. Used for "Ask about this" (an item) and the header Ask (the whole page).
 */
export function textLines(text: string, cap: number): string[] {
  const out: string[] = [];
  let used = 0;
  let cut = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line === '' || out[out.length - 1] === line) continue;
    if (used + line.length > cap) { cut = true; break; }
    out.push(line);
    used += line.length + 1;
  }
  if (cut) out.push(`(cut at ${cap} characters)`);
  return out;
}
