import type { RetryPrefill } from '../store/retryPrefill.js';

/** Any POSIX absolute path of two or more segments (`/var/folders/x`, `/opt/app/bin`), or a Windows
 *  drive path (`C:\\work\\x`, `D:/repo`) — the shapes a PR title must never carry (studio#311 R1).
 *  A path starts after anything but a word/path character (so `[/srv/x]` and `a,/srv/x` match, while
 *  `src/a/b` and a URL's `//host/x` do not) and stops at whitespace, quotes and brackets. */
const ABS_PATH = /(?<![\w.~/\\-])(?:\/[^\s/'"`()[\]{}<>,;]+){2,}\/?|(?<!\w)[A-Za-z]:[\\/][^\s'"`()[\]{}<>,;]*/g;
/** Sentence punctuation a path match swallowed — it belongs to the sentence, not the path. */
const TRAILING_PUNCT = /[.:?!]+$/;

/**
 * The PR-safe headline: the first question with whitespace collapsed (a multi-line ask reads as one
 * line, studio#311 R2), absolute paths redacted to `<path>` (R1), at most 72 chars.
 */
export function promoteHeadline(firstAsk: string): string {
  return firstAsk
    .replace(/\s+/g, ' ')
    .trim()
    .replace(ABS_PATH, (m) => `<path>${TRAILING_PUNCT.exec(m)?.[0] ?? ''}`)
    .slice(0, 72)
    .trimEnd();
}

/**
 * S16a-4e: "Continue in Build" on a chat's own session (a chat off the ask path) — the retired chat page's
 * promote, said on the session: the WHOLE conversation rides into the Build composer as context
 * (studio#238), the run is filed under this chat (`chatId`, studio#446), the seats that replied are
 * the launch's seats; nothing launches until the operator sends.
 */
export function chatPromotePrefill(
  chatId: string,
  messages: ReadonlyArray<{ kind: string; text?: string; cliKey?: string; ok?: boolean }>,
  projectId: string | null,
): RetryPrefill {
  const firstAsk = messages.find((m) => m.kind === 'user')?.text ?? '';
  const headline = promoteHeadline(firstAsk);
  const transcript = messages
    .filter((m) => (m.kind === 'user' || m.kind === 'seat') && typeof m.text === 'string')
    .map((m) => (m.kind === 'user' ? `operator: ${m.text}` : `${m.cliKey ?? 'helper'}: ${m.text}`))
    .join('\n');
  // "The seats that replied" = every seat that answered ANY turn of this chat (studio#311 R3): the
  // transcript is the whole conversation, so a seat that answered an earlier question but is still
  // working on the latest one rides along — it is part of the context being carried into Build.
  const answered = [...new Set(messages.filter((m) => m.kind === 'seat' && m.ok !== false && typeof m.cliKey === 'string').map((m) => m.cliKey as string))];
  return {
    retryOf: null,
    chatId,
    problem: `${headline}\n\n---\n${transcript}`,
    clis: answered,
    workflowId: null,
    repoRef: null,
    entityMode: 'shared',
    humanConfirm: { before: 1 },
    projectId,
  };
}
