import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import { chipText, messageWithAbout, projectChip, type AboutChip } from '../../board/aboutChips.js';
import { composerSendRefusal } from '../../board/launchModel.js';
import {
  parseWorkflowCommand, workflowItems, WORKFLOWS_LOADING_LINE, type WorkflowRow,
} from '../../board/workflowCommand.js';
import {
  draftTarget, dropToken, menuToken, slashItems, wordOf, type DraftRunState, type DraftTarget, type SlashItem,
} from '../../board/planDraft.js';
import { gateInstance } from '../../board/proposalCard.js';
import { useRoster } from '../../hooks/useRoster.js';
import { seatLabel, userSeats } from '../../board/seatNames.js';
import { defaultSelection } from '../../board/chatOpen.js';
import { chosenSeats, NO_SEAT_PICKED, useComposerSeats } from '../../store/composerSeats.js';
import { loadCatalog, loadPresets, usePlanCatalog } from '../../store/planCatalog.js';
import { usePlanGate } from '../../store/planGates.js';
import { addGateDraftStep, queueMidRunStep } from '../../store/planDrafts.js';
import { useGateStore } from '../../store/gates.js';
import { useProjectsStore } from '../../store/projects.js';
import { useWorkflowDefs } from '../../store/workflowCache.js';
import {
  addAboutChip, backspaceAboutChip, chipsOf, clearAboutChips, removeAboutChip, useComposerChips,
} from '../../store/composerChips.js';
import { humanTitle } from '../runIdentity.js';
import { useCapabilities } from '../../store/capabilities.js';
import { takeComposerSeed, useComposerSeed } from '../../store/composerSeed.js';
import { SlashMenu, type AtItem } from './SlashMenu.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { usePhone } from '../../hooks/usePhone.js';

/** Where a send goes besides the words: the project an `@project` chip named, and whether it opens a fresh session. */
export interface ComposerSend {
  /** The `@project` chip's project: the chat is scoped to it. */
  projectId?: string;
  /** True when the message must open a NEW session (an `@project` after this session's first send). */
  fresh?: boolean;
  /** ASK-S1: the helper an `@helper` chip named before the session's first send — under
   *  `capabilities.askPath` it is the one who answers (the path's `primary`). */
  primary?: string;
  /** S16a-4e: the live chat this composer stands in (a chat's own session page) — the send is a
   *  reply INTO that chat, never into the Ask dock's own stored chat. */
  chatId?: string;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function plannedRun(v: SessionView): boolean {
  const id = (v.session as unknown as { run_identity?: { kind?: unknown } }).run_identity;
  return typeof id === 'object' && id !== null && (id.kind === 'preset' || id.kind === 'user_plan');
}

/**
 * Where a `/` command lands for these runs (the session's, oldest first): the newest live run, read
 * with its open gate's kind. One `usePlanGate` read, for that run only.
 */
function useDraftTarget(runs: readonly SessionView[]): { target: DraftTarget; gateKey: string | null; title: string } {
  const live = [...runs].reverse().find((v) => !TERMINAL.has(v.session.status)) ?? null;
  const liveId = live?.session.id ?? null;
  const waiting = live?.session.status === 'awaiting_human';
  const planGate = usePlanGate(liveId, waiting);
  const gate = useGateStore((s) => (liveId === null ? undefined : s.gates[liveId]));
  const states: DraftRunState[] = runs.map((v) => ({
    runId: v.session.id,
    status: v.session.status,
    planned: plannedRun(v),
    // S10 codex r2: seeded only from a view read for THIS gate instance; until it lands, reading.
    planGate: v.session.id === liveId && planGate.isPlanGate && planGate.view !== null && planGate.fresh ? { seed: planGate.view.editSeed } : null,
    gatePending: v.session.id === liveId && (planGate.pending || planGate.reading),
  }));
  return {
    target: draftTarget(states),
    gateKey: gateInstance(gate),
    title: live === null ? '' : humanTitle(live.session.problem || live.session.id),
  };
}

/**
 * THE COMPOSER (DES-STUDIO-REBUILD-001 §5.5, slice S7) — the Desk's and a session's one place to ask
 * (DESIGN-interaction rule 2):
 *
 *  - about-chips: what the next message is about ("about: “the Pay button”"), from a selection in
 *    the thread, `@helper`, and (S8) an element on a page. × removes one; Backspace in an empty box
 *    removes the last. The chips lead the message the helpers get.
 *  - `@`: a project (where the message goes: before this composer's first send it scopes the chat,
 *    after it the message starts a new session there) or a helper (a subject).
 *  - `/`: adds a step to the session's chain — a plan draft (§5.7): on the plan gate's card while
 *    one is open (nothing is sent here), else queued 10 s with Undo and then one plan POST.
 *    A command the engine cannot take is refused in the menu with the reason.
 *  - `/workflow-<key>` as the FIRST token (S19a): names a workflow from the daemon's own catalog and
 *    Enter LAUNCHES it — the rest of the line is the intent. The row under the chip picks the
 *    repository (and the delivery); with none chosen the composer refuses and sends nothing.
 *  - studio#315: when the roster says no helper can take the message, Send is refused and says why.
 *
 * Typing never answers a question and never reshapes the chain: only a picked `/` command does.
 */
/** A phone's one-row placeholder: the first clause (before a comma or dash), at most ~18 characters
 *  on a word boundary, with an ellipsis when anything was cut. */
export function shortPlaceholder(text: string, max = 18): string {
  const whole = text.trim();
  let first = whole.split(/,|\s—\s|\s-\s/)[0]?.trim() ?? whole;
  if (first.length > max) {
    const words = first.split(/\s+/);
    first = '';
    for (const w of words) {
      if ((first === '' ? w : `${first} ${w}`).length > max) break;
      first = first === '' ? w : `${first} ${w}`;
    }
  }
  return first.length < whole.length ? `${first}…` : whole;
}

export function Composer({
  composerKey, text, setText, onSend, runs = [], started = false, placeholder, ariaLabel, variant, className = '',
  inputRef, hint = false, footer = null,
}: {
  /** `desk`, or the session id. */
  composerKey: string;
  text: string;
  setText: (t: string) => void;
  onSend: (message: string, opts: ComposerSend) => void;
  /** The session's runs, oldest first (a `/` command acts on the newest live one). */
  runs?: readonly SessionView[];
  /** This composer's conversation already had its first send (a session with turns or runs). */
  started?: boolean;
  placeholder: string;
  ariaLabel: string;
  /** Which composer: the input and send keep their ids (`desk-composer-*`, `session-composer-*`). */
  variant: 'desk' | 'session';
  className?: string;
  inputRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  /** App-level route navigation (App.tsx's useRoute().navigate): a launched run opens its session. */
  navigate?: (path: string) => void;
  /** S19b: the quiet "Type / for workflows" line under the box (the Desk's) — hidden while the menu
   *  is open or a chip is present. */
  hint?: boolean;
  /** S19b: what sits beside the hint under the box (the Desk's Capture). */
  footer?: React.ReactNode;
}): React.ReactElement {
  const chips = useComposerChips((s) => chipsOf(s, composerKey));
  const roster = useRoster();
  const projects = useProjectsStore((s) => s.projects);
  const catalogState = usePlanCatalog((s) => s.catalog);
  const entries = usePlanCatalog((s) => s.entries);
  const catalog = useMemo(() => (catalogState === 'ready' ? entries.map((e) => e.id) : null), [catalogState, entries]);
  const { target, gateKey, title } = useDraftTarget(runs);
  const defs = useWorkflowDefs();
  const project = projectChip(chips);
  const presetsState = usePlanCatalog((s) => s.presets[project?.projectId ?? '']);
  const presets = Array.isArray(presetsState) ? presetsState : null;
  const wfChip = (chips.find((c) => c.kind === 'workflow') as Extract<AboutChip, { kind: 'workflow' }> | undefined) ?? null;
  const askPathOn = useCapabilities((s) => s.askPath);
  const own = useRef<HTMLTextAreaElement | null>(null);
  // A one-row box on a phone shows only the placeholder's first clause, ended by an ellipsis —
  // never a sentence cut mid-word with no mark (UX audit row 32, the 390 px gate).
  const phone = usePhone();
  const box = inputRef ?? own;
  const [caret, setCaret] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const token = menuToken(text, caret);
  const menuOpen = token !== null && closedAt !== `${token.trigger}${token.start}`;
  useEffect(() => {
    if (menuOpen && token?.trigger === '/') loadCatalog();
  }, [menuOpen, token?.trigger]);
  useEffect(() => {
    if (menuOpen && token?.trigger === '/') loadPresets(project?.projectId ?? null);
  }, [menuOpen, token?.trigger, project?.projectId]);
  useEffect(() => {
    if (menuOpen && token?.trigger === '@' && useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load();
  }, [menuOpen, token?.trigger]);

  // UX audit row 24: a job started from a session defaults to the repository its work names.
  const sessionRepo = useMemo(
    () => [...runs].reverse().map((v) => v.session.repo_ref).find((r): r is string => typeof r === 'string' && r !== '') ?? null,
    [runs],
  );

  // `/workflow-<key>` rows lead the `/` menu only as a FIRST token (a named work), and only while no
  // workflow is already named (a second pick replaces the chip).
  const startCommands = token?.trigger === '/' && token.start === 0 && wfChip === null;
  const wf = useMemo(
    () => (startCommands && token !== null ? workflowItems(token.query, defs, presets) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startCommands, token?.query, defs, presets],
  );
  const anyWorkflows = useMemo(() => workflowItems('', defs, presets).length > 0, [defs, presets]);

  const slash: SlashItem[] = useMemo(
    () => (token?.trigger === '/' ? slashItems(token.query, target, catalog) : []),
    [token?.trigger, token?.query, target, catalog],
  );
  const refusal = composerSendRefusal(roster, project !== null);
  // studio#631: which seats THIS send uses — the launch form's rule (every eligible seat, minus the
  // ones you turned off), shown and editable here. A workflow launch convenes the council seats; an
  // Ask's first send opens a chat with the seats the daemon would admit to it. A reply into a started
  // chat keeps that chat's seats, so the row is not offered there.
  const dropped = useComposerSeats((s) => s.dropped);
  const toggleSeat = useComposerSeats((s) => s.toggle);
  const eligibleSeats = useMemo(() => {
    if (roster === null) return [];
    // A handed-over Ask always opens SCOPED (the dock remounts per handoff, and its default scope is
    // the route's project or everything — only a manual `system` pick is unscoped), so the row reads
    // the scoped admission AskDock sends with (codex r1 on #631).
    // studio#686 (UX audit row 12): only seats a user may address — never the judge seat or a
    // non-CLI helper — so the helpers row and the `@` menu offer the same list under one name each.
    const addressable = new Set(userSeats(roster).map((s) => s.key));
    const keys = wfChip !== null ? roster.filter((s) => s.enabled_for_council).map((s) => s.key) : defaultSelection(roster, true);
    return keys.filter((k) => addressable.has(k));
  }, [roster, wfChip]);
  const ats: AtItem[] = useMemo(() => {
    if (token?.trigger !== '@') return [];
    const q = token.query.toLowerCase();
    // A project row carries its own description (when it has one); the group header says what a pick does.
    const p: AtItem[] = (projects ?? []).map((x) => ({ kind: 'project', id: x.id, label: x.name, line: (x.description ?? '').trim() }));
    // The helpers this send can use (the helpers row's list, in roster order), named by `seatLabel`.
    const h: AtItem[] = eligibleSeats.flatMap((key) => {
      const seat = (roster ?? []).find((s) => s.key === key);
      return seat === undefined ? [] : [{ kind: 'helper' as const, id: seat.key, label: seatLabel(seat), line: '' }];
    });
    return [...p, ...h].filter((x) => x.label.toLowerCase().startsWith(q) || x.id.toLowerCase().startsWith(q)).slice(0, 8);
  }, [token?.trigger, token?.query, projects, roster, eligibleSeats]);
  const count = token?.trigger === '/' ? wf.length + slash.length : ats.length;
  const active = count === 0 ? 0 : Math.min(cursor, count - 1);
  // Shown while a send is being composed (words typed, or a workflow named) — an idle Desk keeps its
  // fold (the desk_home fit), and the row is there whenever there is something to send.
  // A send opens a chat before the first send, and after it whenever an `@project` chip starts a
  // fresh session there (`fresh: started` below) — both take the row's seats (codex r2 on #631).
  const opensChat = !started || project !== null;
  // While the `@` menu is open it already lists these helpers: the row steps aside, so one list shows
  // and the menu sits on the box (S3 UX gate, codex r2).
  const atMenuOpen = menuOpen && token?.trigger === '@';
  // Whether the seat rules apply to this send — independent of whether the row is on screen, so an
  // open `@` menu never lets a send past the refusals below (codex r2 on S3).
  const seatsApply = eligibleSeats.length > 0 && (wfChip !== null || (opensChat && text.trim() !== ''));
  const showSeats = seatsApply && !atMenuOpen;
  const sendSeats = chosenSeats(eligibleSeats, dropped);
  // An `@helper` named to answer (ASK-S1) but turned off in the row would be silently dropped as the
  // chat's primary — refused instead, by name (codex r1 on #631).
  const namedHelper = wfChip === null && opensChat && askPathOn
    ? chips.find((c) => c.kind === 'about' && c.key.startsWith('h:'))
    : undefined;
  const namedDropped = namedHelper !== undefined && dropped.includes(namedHelper.key.slice(2));
  const seatRefusal = !seatsApply ? null
    : sendSeats.length === 0 ? NO_SEAT_PICKED
      : namedDropped ? `${namedHelper?.label ?? 'The helper you named'} is named to answer but is left out of the helpers row — turn it on, or remove the chip.`
        : null;
  const canSend = text.trim() !== '' && refusal === null && seatRefusal === null;

  const syncCaret = (el: HTMLTextAreaElement): void => setCaret(el.selectionStart ?? el.value.length);
  const focusEnd = (value: string): void => {
    requestAnimationFrame(() => {
      const el = box.current;
      if (el === null) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
      setCaret(value.length);
    });
  };

  // S19b: a seed a command left for THIS composer (⌘K "New Build" → `/workflow-`) is taken once —
  // the words land, the box is focused with the caret at the end, so a `/` seed opens the menu.
  const seeded = useComposerSeed((s) => s.seed !== null && s.seed.composerKey === composerKey);
  useEffect(() => {
    if (!seeded) return;
    const words = takeComposerSeed(composerKey);
    if (words === null) return;
    setText(words);
    setClosedAt(null);
    setCursor(0);
    setNote(null);
    focusEnd(words);
    // focusEnd/setText are this render's closures; the seed is read at its edge only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded, composerKey]);

  const pickSlash = (item: SlashItem): void => {
    if (token === null) return;
    if (item.refused !== null) { setNote(item.refused); return; }
    const next = dropToken(text, token.start, caret);
    setText(next);
    focusEnd(next);
    const catalogId = item.command.catalog;
    if (catalogId === null) return;
    const word = wordOf(catalogId);
    if (target.kind === 'gate-amend' && gateKey !== null) {
      addGateDraftStep(target.runId, gateKey, target.seed, catalogId);
      setNote(`${word} is on the plan’s card: approve it there to send it. Nothing has been sent.`);
    } else if (target.kind === 'mid-run') {
      queueMidRunStep(target.runId, catalogId, title);
      setNote(`Adding ${word} — Undo within 10 s. After that it stays: a running plan only grows.`);
    }
  };
  const pickAt = (item: AtItem): void => {
    if (token === null) return;
    const next = dropToken(text, token.start, caret);
    setText(next);
    focusEnd(next);
    const chip: AboutChip = item.kind === 'project'
      ? { kind: 'project', key: `p:${item.id}`, label: item.label, projectId: item.id }
      : { kind: 'about', key: `h:${item.id}`, label: item.label };
    addAboutChip(composerKey, chip);
    // UX audit row 72: the chip already says where the message goes ("in: <project>"), so the note
    // speaks only when it adds something — a fresh session, or who answers.
    setNote(item.kind === 'project'
      ? (started ? `Your next message starts a new session in ${item.label}.` : null)
      : (!started && useCapabilities.getState().askPath ? `${item.label} will answer this conversation.` : null));
  };
  // The launch wizard (operator 2026-10-11): naming a workflow opens the one modal, prefilled with
  // what this composer knows — the words so far, its project chip, the session's repository — and
  // the words move into the wizard's draft. Nothing is sent from here.
  const startJob = (workflowId: string, words: string): void => {
    openLaunchWizard({ workflowId, intent: words.trim(), projectId: project?.projectId ?? null, composerKey, contextRepo: sessionRepo });
    setText('');
    setNote(null);
  };
  const pickWorkflow = (item: WorkflowRow): void => {
    if (token === null) return;
    startJob(item.workflowId, dropToken(text, token.start, caret));
  };
  const pick = (i: number): void => {
    if (token?.trigger === '/') {
      if (i < wf.length) { const it = wf[i]; if (it !== undefined) pickWorkflow(it); }
      else { const it = slash[i - wf.length]; if (it !== undefined) pickSlash(it); }
    } else { const it = ats[i]; if (it !== undefined) pickAt(it); }
  };


  const send = (): void => {
    // A `/workflow-<key>` line typed whole (menu closed, a paste): Enter NAMES it — the options row
    // then asks for the repository. Nothing is sent until the next Enter.
    const typed = parseWorkflowCommand(text);
    if (typed !== null && refusal === null) {
      // Only a key the daemon lists becomes a chip — studio keeps no list and never invents a name.
      const known = workflowItems(typed.key, defs, presets).find((r) => r.key === typed.key);
      if (known === undefined) {
        setNote(defs === null ? WORKFLOWS_LOADING_LINE : `This daemon lists no workflow named ${typed.key} — nothing was sent.`);
        return;
      }
      startJob(known.workflowId, typed.rest);
      return;
    }
    if (!canSend) return;
    // ASK-S1: a helper named with `@` before the first send answers this conversation. studio#631: the
    // chip picks WHO answers — it no longer prefixes the question with "About <helper>:", which
    // re-framed it as a question about the helper (and titled the session that way).
    const helper = opensChat && askPathOn ? chips.find((c) => c.kind === 'about' && c.key.startsWith('h:')) : undefined;
    const message = messageWithAbout(text, helper === undefined ? chips : chips.filter((c) => c !== helper));
    onSend(message, {
      ...(project === null ? {} : { projectId: project.projectId, fresh: started }),
      ...(helper !== undefined ? { primary: helper.key.slice(2) } : {}),
    });
    clearAboutChips(composerKey);
    setText('');
    setNote(null);
  };

  return (
    <div className={`wk-composer ${className}`} data-testid="composer" data-composer={composerKey}>
      {menuOpen && token !== null && (
        <SlashMenu
          menuKey={composerKey}
          trigger={token.trigger}
          startCommands={startCommands}
          defsLoading={defs === null}
          anyWorkflows={anyWorkflows}
          wf={wf}
          slash={slash}
          ats={ats}
          {...(!started && askPathOn ? { helpersHead: 'Helpers · the one you pick answers' } : {})}
          atLoading={token.trigger === '@' && roster === null && (projects ?? []).length === 0}
          active={active}
          onPickWorkflow={pickWorkflow}
          onPickSlash={pickSlash}
          onPickAt={pickAt}
        />
      )}
      {(chips.length > 0 || note !== null || refusal !== null) && (
        <div className="wk-composer-chips">
          {chips.map((c) => (
            <span key={c.key} data-testid="composer-chip" data-kind={c.kind} data-key={c.key} className="wk-composer-chip" title={c.kind === 'project' ? 'Where your next message goes' : c.kind === 'workflow' ? 'The workflow this starts' : 'Your next message is about this'}>
              {chipText(c)}
              <button type="button" data-testid="composer-chip-remove" aria-label={`Remove ${chipText(c)}`} onClick={() => { removeAboutChip(composerKey, c.key); box.current?.focus(); }} className="wk-composer-chip-x">×</button>
            </span>
          ))}
          {refusal !== null && <span data-testid="composer-refused" role="status" className="wk-composer-note wk-composer-note--bad">{refusal}</span>}
          {refusal === null && note !== null && <span data-testid="composer-note" role="status" className="wk-composer-note">{note}</span>}
        </div>
      )}
      {showSeats && (
        <div data-testid="composer-seats" role="group" aria-label="Helpers this send uses" className="wk-composer-chips">
          <span className="wk-composer-note">Helpers</span>
          {eligibleSeats.map((key) => {
            const on = !dropped.includes(key);
            const seat = (roster ?? []).find((s) => s.key === key);
            const name = seat === undefined ? seatLabel({ key }) : seatLabel(seat);
            return (
              <button
                key={key}
                type="button"
                data-testid="composer-seat"
                data-key={key}
                aria-pressed={on}
                title={on ? `${name} takes part — click to leave it out` : `${name} is left out — click to include it`}
                onClick={() => toggleSeat(key)}
                className={`wk-composer-chip wk-composer-seat${on ? '' : ' wk-composer-seat--off'}`}
              >
                {name}
              </button>
            );
          })}
          {seatRefusal !== null && <span data-testid="composer-seats-refused" role="status" className="wk-composer-note wk-composer-note--bad">{seatRefusal}</span>}
        </div>
      )}
      <form className="wk-desk-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={box}
          data-testid={variant === 'desk' ? 'desk-composer-input' : 'session-composer-input'}
          data-type-target="page"
          aria-label={ariaLabel}
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? `composer-menu-list-${composerKey}` : undefined}
          aria-activedescendant={menuOpen && count > 0 ? `composer-menu-option-${composerKey}-${active}` : undefined}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value); syncCaret(e.target); setCursor(0); if (note !== null && e.target.value !== '') setNote(null);
            // studio#623 (#620's launch-form rule): an Escape closes THIS token's menu; once that token
            // is gone (or the caret is in another one), a new `/` or `@` opens the menu again.
            const tok = menuToken(e.target.value, e.target.selectionStart ?? e.target.value.length);
            if (tok === null || `${tok.trigger}${tok.start}` !== closedAt) setClosedAt(null);
          }}
          onSelect={(e) => syncCaret(e.currentTarget)}
          onKeyDown={(e) => {
            // An IME confirming its composition with Enter picks nothing and sends nothing (codex on S7).
            if (e.nativeEvent.isComposing) return;
            if (menuOpen && count > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((active + 1) % count); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((active - 1 + count) % count); return; }
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pick(active); return; }
            }
            if (menuOpen && e.key === 'Escape' && token !== null) { e.preventDefault(); e.stopPropagation(); setClosedAt(`${token.trigger}${token.start}`); return; }
            if (e.key === 'Backspace' && text === '' && backspaceAboutChip(composerKey, text)) { e.preventDefault(); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={wfChip !== null ? 'Describe the work to launch' : phone ? shortPlaceholder(placeholder) : placeholder}
          className="wk-desk-input"
        />
        <button type="submit" data-testid={variant === 'desk' ? 'desk-composer-send' : 'session-composer-send'} aria-label={wfChip !== null ? 'Launch' : 'Send'} disabled={!canSend} className="wk-desk-send">↑</button>
      </form>
      {(hint || footer !== null) && (
        <div className="wk-composer-foot">
          {hint && !menuOpen && chips.length === 0 && (
            <p data-testid="composer-hint" className="wk-composer-hint">Type <kbd>/</kbd> for workflows</p>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
