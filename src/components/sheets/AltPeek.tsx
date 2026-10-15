import { useEffect, useState } from 'react';
import { executingOrd } from '../../api/run-state.js';
import type { SessionView } from '../../api/types.js';
import { objectAttr, type ObjectRef } from '../../board/objectActions.js';
import { parseSessionId, runChatIdOf } from '../../board/sessionModel.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useSheets } from '../../store/sheets.js';
import { isTypingContext } from '../../hooks/useGlobalShortcuts.js';
import { seatStandingWord } from '../HealthRailSection.js';
import { humanTitle } from '../runIdentity.js';
import { deskLiveCounts } from '../../board/statusWords.js';
import { isAskTurnRun } from '../../board/askTurn.js';

const RUN_WORD: Record<string, string> = {
  executing: 'being worked on', distributing: 'being handed out', planning: 'being planned', awaiting_human: 'waiting on you',
  completed: 'finished', failed: 'stopped', cancelled: 'cancelled', pending: 'not started',
};

/** The one telling fact a peek shows for an object (DESIGN-interaction rule 9). */
export function peekFact(ref: ObjectRef, ctx: { runs: readonly SessionView[]; needCount: number; runChatId: boolean; standing: (cli: string) => string | null; held?: ReadonlySet<string> }): string {
  if (ref.kind === 'desk') {
    // The calm line's count (deskLiveCounts): an idle chat is open, not running.
    // `held`: the runs a Needs-you row is about, which the Running now card leaves out too.
    const { working, chatsOpen } = deskLiveCounts(ctx.runs, ctx.held);
    const chats = chatsOpen > 0 ? ` · ${chatsOpen} ${chatsOpen === 1 ? 'chat' : 'chats'} open` : '';
    return `${ctx.needCount === 0 ? 'Nothing needs you' : `${ctx.needCount} ${ctx.needCount === 1 ? 'thing needs' : 'things need'} you`} · ${working} running${chats}`;
  }
  if (ref.kind === 'session') {
    const s = parseSessionId(ref.sessionId);
    const mine = s.kind === 'run' ? ctx.runs.filter((v) => v.session.id === s.runId) : ctx.runs.filter((v) => ctx.runChatId && runChatIdOf(v) === s.chatId);
    const v = mine[mine.length - 1];
    if (v === undefined) return 'Nothing in this session is on this daemon';
    // An answered chat waits for its next message, not on you (statusWord's "Answered").
    const word = v.session.status === 'awaiting_human' && isAskTurnRun(v.session) ? 'open, waiting for your next message' : (RUN_WORD[v.session.status] ?? v.session.status);
    return `${humanTitle(v.session.problem || v.session.id)} · ${word}${mine.length > 1 ? ` · ${mine.length} runs` : ''}`;
  }
  const v = ctx.runs.find((x) => x.session.id === ref.runId);
  if (v === undefined) return 'Not on this daemon';
  if (ref.kind === 'helper') {
    const working = v.units.some((u) => u.ord === executingOrd(v.session, v.units) && u.assigned_cli === ref.cli);
    return `${ref.cli} · ${working ? 'working now' : 'not working right now'}${ctx.standing(ref.cli) !== null ? ` · ${ctx.standing(ref.cli)}` : ''}`;
  }
  const u = v.units.find((x) => x.ord === ref.ord);
  if (u === undefined) return 'Not started';
  const live = executingOrd(v.session, v.units) === u.ord;
  return `${live ? 'Working' : u.status === 'done' ? 'Done' : u.status === 'rejected' ? 'Stopped' : 'Not started'}${u.assigned_cli ? ` · ${u.assigned_cli}` : ''}`;
}

/**
 * ⌥ PEEK (DESIGN-interaction rule 9, scene 05 desk-peek, slice S11): hold ⌥ over any object — a step,
 * a helper, a session, the Desk — and one telling fact appears beside it. Letting go, or any other key,
 * hides it. A click opens the full sheet; ⌘K lists its actions.
 */
export function AltPeek({ runs, needCount, heldRuns }: { runs: SessionView[]; needCount: number; heldRuns?: ReadonlySet<string> }): React.ReactElement | null {
  const pointed = useSheets((s) => s.pointed);
  const runChatId = useCapabilities((s) => s.runChatId);
  const roster = useRoster();
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      // ⌥ inside a text field is typing (or a chord there), never a peek (codex on S11).
      if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !isTypingContext(e)) setHeld(true);
      else setHeld(false);
    };
    const up = (e: KeyboardEvent): void => { if (e.key === 'Alt') setHeld(false); };
    const off = (): void => setHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', off);
    };
  }, []);
  if (!held || pointed === null) return null;
  const el = document.querySelector(`[data-object="${CSS.escape(objectAttr(pointed))}"]`);
  const rect = el?.getBoundingClientRect();
  const standing = (cli: string): string | null => {
    const seat = roster?.find((s) => s.key === cli);
    return seat === undefined ? null : seatStandingWord(seat).detail;
  };
  const top = rect !== undefined ? Math.min(window.innerHeight - 60, rect.top + Math.min(rect.height, 28) + 6) : 80;
  const left = rect !== undefined ? Math.max(8, Math.min(window.innerWidth - 340, rect.left)) : 80;
  return (
    <div data-testid="alt-peek" data-object={objectAttr(pointed)} role="status" className="wk-alt-peek" style={{ top, left }}>
      {peekFact(pointed, { runs, needCount, runChatId, standing, ...(heldRuns !== undefined ? { held: heldRuns } : {}) })}
    </div>
  );
}
