import type { RetryPrefill } from '../store/retryPrefill.js';

/**
 * S16a-4e: "Continue in Build" on a chat's own session (a chat off the ask path) — the GroupChat
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
  // PR-safe headline: the first question, ≤72 chars, absolute paths redacted.
  const headline = firstAsk.replace(/\/(?:Users|home|root|tmp)\S*/g, '<path>').slice(0, 72).trimEnd();
  const transcript = messages
    .filter((m) => (m.kind === 'user' || m.kind === 'seat') && typeof m.text === 'string')
    .map((m) => (m.kind === 'user' ? `operator: ${m.text}` : `${m.cliKey ?? 'helper'}: ${m.text}`))
    .join('\n');
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
