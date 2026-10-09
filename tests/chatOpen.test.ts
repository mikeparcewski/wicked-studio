/**
 * S16a-4i: the chat-open helpers kept code uses (board/chatOpen.ts) — moved unchanged from the retired
 * chat page with their unit cases (from GroupChat.chips and GroupChat.scope).
 */
import { describe, expect, it } from 'vitest';
import type { RosterSeat } from '../src/api/types.js';
import { chatAdmissionOf, defaultSelection, describeChatOpenRefusal } from '../src/board/chatOpen.js';
import { CHAT_OPEN_REFUSALS } from './fixtures/wave2.js';

const REFUSED_NO_ACP = {
  ok: false,
  reason: 'it has no ACP adapter registered, and a scoped chat holds only ACP-governed seats',
  source: 'scope',
};
const ADMITTED = { unscoped: { ok: true }, scoped: { ok: true } };
const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp', transport: 'stdio' }, chat_admission: ADMITTED },
  { key: 'codex', enabled_for_council: true, chat_admission: { unscoped: REFUSED_NO_ACP, scoped: REFUSED_NO_ACP } },
  { key: 'agy', enabled_for_council: false, acp: null, chat_admission: { unscoped: REFUSED_NO_ACP, scoped: REFUSED_NO_ACP } },
  { key: 'pi', enabled_for_council: false, acp: { binary: 'pi-acp', transport: 'stdio' }, chat_admission: ADMITTED },
] as unknown as RosterSeat[];

/** crew ≥ 0.7.36: the daemon's own admission verdict rides every roster seat (F-W1-005). */
const VERDICT_ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp', transport: 'stdio', acp_input_governance: true },
    chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } },
  { key: 'pi', enabled_for_council: false, acp: { binary: 'pi-acp', transport: 'stdio' },
    chat_admission: { unscoped: { ok: true }, scoped: { ok: false, reason: 'its ACP adapter asks no permissions and its record arms no OS sandbox, so a scoped chat could not hold the repositories read-only for it (open the chat unscoped to include it)', source: 'scope' } } },
  { key: 'codex', enabled_for_council: true,
    chat_admission: { unscoped: { ok: false, reason: 'signed out — it cannot take a turn until it is signed in from the System page', source: 'auth' }, scoped: { ok: false, reason: 'signed out — it cannot take a turn until it is signed in from the System page; it has no ACP adapter registered, and a scoped chat holds only ACP-governed seats', source: 'auth' } } },
] as unknown as RosterSeat[];

describe('defaultSelection — the seats the DAEMON would seat (no client-side capability rule)', () => {
  it('selects by the daemon verdict for the mode; a roster with no verdict offers everything', () => {
    expect(defaultSelection(VERDICT_ROSTER, true)).toEqual(['claude']);
    expect(defaultSelection(VERDICT_ROSTER, false)).toEqual(['claude', 'pi']);
    // No verdict on the wire ⇒ studio second-guesses nothing: every seat is offered and the
    // daemon's own answer at open is the truth (review MED-1).
    expect(defaultSelection(ROSTER.map((r) => ({ key: r.key })) as unknown as RosterSeat[], true))
      .toEqual(ROSTER.map((r) => r.key));
    expect(chatAdmissionOf({ key: 'x' } as unknown as RosterSeat, true)).toEqual({ ok: true });
  });

  it('chatAdmissionOf / defaultSelection: the verdict for the scope mode wins', () => {
    expect(chatAdmissionOf(VERDICT_ROSTER[1]!, true)).toEqual(expect.objectContaining({ ok: false, source: 'scope' }));
    expect(chatAdmissionOf(VERDICT_ROSTER[1]!, false)).toEqual({ ok: true });
    expect(defaultSelection(VERDICT_ROSTER, true)).toEqual(['claude']);
    expect(defaultSelection(VERDICT_ROSTER, false)).toEqual(['claude', 'pi']);
    expect(defaultSelection(ROSTER, true)).toEqual(['claude', 'pi']);
  });
});

describe('describeChatOpenRefusal — the operator sentence for a refused POST /chats', () => {
  it('describes crew#502 refusals by status and leaves anything else as the translated message', () => {
    expect(describeChatOpenRefusal(404, CHAT_OPEN_REFUSALS.missing.body.error, 'x')).toMatch(/^Scope refused — Repo 'ghost', 'phantom' not found\./);
    expect(describeChatOpenRefusal(400, CHAT_OPEN_REFUSALS.ambiguous.body.error, 'x')).toMatch(/^Scope refused — repoRef 'api' is ambiguous/);
    expect(describeChatOpenRefusal(409, CHAT_OPEN_REFUSALS.overlap.body.error, 'x')).toMatch(/^The daemon refused to open this chat — repo 'scratchpad'/);
    expect(describeChatOpenRefusal(501, CHAT_OPEN_REFUSALS.engine.body.error, 'x')).toMatch(/^This daemon cannot open a SCOPED chat — the installed wicked-core-ts predates chat scope/);
    // A 404 that is not a repo 404 (the route also answers `Project <id> not found`) reads plain.
    expect(describeChatOpenRefusal(404, 'Project proj_9 not found', 'x')).toBe('Project proj_9 not found');
    expect(describeChatOpenRefusal(400, 'Invalid request body', 'the daemon refused this — Invalid request body')).toBe('the daemon refused this — Invalid request body');
    expect(describeChatOpenRefusal(null, null, 'boom')).toBe('boom');
  });
});
