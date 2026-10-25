import type { RosterSeat } from '../api/types.js';
import { chatAdmissionOf } from './chatOpen.js';
import { isReviewerOnly, seatLabel } from './seatNames.js';
import { seatStandingWord, usageLimitWord } from '../components/HealthRailSection.js';
import { isOptInKey } from '../store/composerSeats.js';
import { agentFixPath } from '../hooks/useRoute.js';

/**
 * THE SYSTEM CHAT'S CLI PICKER (DES-SYSTEM-CHAT §5), pure: exactly ONE answering CLI by default — the
 * user's last pick, else their saved default seat, else the first one that can answer. A signed-out or
 * benched CLI is listed but cannot be picked, and says why (the daemon's own words), with Sign in when
 * signing in is the fix. Asking several CLIs at once is not the picker's job.
 */

export interface CliOption {
  key: string;
  label: string;
  /** Can answer this chat now. */
  ok: boolean;
  /** Why not, in the daemon's words ("benched: quota (429) until 18:00", "signed out"). */
  reason: string | null;
  /** Where Sign in goes, when signing in is the fix. */
  signInPath: string | null;
  /** An opt-in seat (known to stall): pickable, never a default. */
  optIn: boolean;
}

export const CHAT_CLI_KEY = 'wicked.chat.cli';
const DEFAULT_CLIS_KEY = 'wicked_default_clis';

function readJson(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** The CLI the user last picked for the chat, if any. */
export function storedChatCli(): string | null {
  const v = readJson(CHAT_CLI_KEY);
  return typeof v === 'string' && v !== '' ? v : null;
}

export function saveChatCli(key: string): void {
  try { globalThis.localStorage?.setItem(CHAT_CLI_KEY, JSON.stringify(key)); } catch { /* this page only */ }
}

/** The user's saved default seats for new work (Agents › defaults). */
export function storedDefaultClis(): string[] {
  const v = readJson(DEFAULT_CLIS_KEY);
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
}

/** Why a seat cannot answer, or `null` when it can. */
function refusal(seat: RosterSeat, scoped: boolean): { reason: string; signIn: boolean } | null {
  const admission = chatAdmissionOf(seat, scoped);
  const standing = seatStandingWord(seat);
  const health = seat.health;
  const limit = health?.status === 'inactive' && typeof health.message === 'string' ? usageLimitWord(health.message) : null;
  if (limit !== null) return { reason: `benched: ${limit}`, signIn: false };
  // Signed out — by the roster's auth reading or in the daemon's own refusal — is fixed by signing in.
  const signedOut = standing.kind === 'signed-out' || seat.auth === 'signed_out' || seat.signed_in === false
    || (!admission.ok && /signed out|sign(?:ed)? in|not logged in|log in/i.test(admission.reason ?? ''));
  if (signedOut) return { reason: admission.reason ?? 'signed out', signIn: true };
  if (!admission.ok) return { reason: admission.reason ?? 'the service will not seat it in this chat', signIn: false };
  // Left out of COUNCILS is not left out of chat (the chat admission above decides that); only a spent
  // usage limit the daemon names there is a bench for chat too.
  const councilWhy = typeof seat['council_ineligible_reason'] === 'string' ? seat['council_ineligible_reason'] as string : '';
  const councilLimit = standing.kind === 'ineligible' ? usageLimitWord(councilWhy) : null;
  if (councilLimit !== null) return { reason: `benched: ${councilLimit}`, signIn: false };
  if (health?.status === 'inactive') return { reason: `benched${health.message ? `: ${health.message}` : ''}`, signIn: false };
  return null;
}

/** Every CLI the user could answer with, in roster order, each with whether it can now and why not. */
export function cliOptions(roster: readonly RosterSeat[] | null, scoped: boolean): CliOption[] {
  // The seats a chat may open with (never a reviewer-only one, studio#713) — the Ask's own rule, which
  // reads the daemon's chat admission rather than the roster's binary.
  return (roster ?? []).filter((s) => !isReviewerOnly(s)).map((seat) => {
    const no = refusal(seat, scoped);
    return {
      key: seat.key,
      label: seatLabel(seat),
      ok: no === null,
      reason: no?.reason ?? null,
      signInPath: no?.signIn === true ? agentFixPath(seat.key) : null,
      optIn: isOptInKey(seat.key),
    };
  });
}

/**
 * The one CLI a new chat answers with: the user's last pick, else the first of their saved default
 * seats, else the first that can answer (an opt-in seat only when picked). `null` when none can.
 */
export function defaultChatCli(
  options: readonly CliOption[],
  stored: string | null = storedChatCli(),
  defaults: readonly string[] = storedDefaultClis(),
): string | null {
  const usable = (k: string | null): k is string => k !== null && options.some((o) => o.key === k && o.ok);
  if (usable(stored)) return stored;
  const saved = defaults.find((k) => usable(k));
  if (saved !== undefined) return saved;
  return options.find((o) => o.ok && !o.optIn)?.key ?? null;
}
