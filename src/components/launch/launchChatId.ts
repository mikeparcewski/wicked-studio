/**
 * The chat a launch lands in (`POST /runs` `chatId`, when the daemon advertises
 * `capabilities.chatIdOnLaunch`): the composer key, but only when that key IS a chat id.
 *
 * A composer key can also name a place that is not a chat: the desk (`desk`), a run (`run:<id>`)
 * or a repository (`repo:<id>`, the repository page's "Generate it"). crew refuses a `chatId`
 * outside `^[A-Za-z0-9._-]+$` with a 400 ("Invalid request body: `chatId` — Invalid"), so sending
 * `repo:tiny-math` made Generate it fail every launch. A key with a place prefix is not sent; the
 * run then lands in its own session, as a launch from the desk does.
 */
const CHAT_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function launchChatId(key: string | null, chatIdOnLaunch: boolean | undefined): string | null {
  if (chatIdOnLaunch !== true || key === null || key === 'desk') return null;
  return CHAT_ID.test(key) ? key : null;
}
