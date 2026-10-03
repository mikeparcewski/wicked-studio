import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import { chipText, messageWithAbout, projectChip, type AboutChip } from '../../board/aboutChips.js';
import { composerSendRefusal } from '../../board/launchModel.js';
import {
  draftTarget, dropToken, menuToken, slashItems, wordOf, type DraftRunState, type DraftTarget, type SlashItem,
} from '../../board/planDraft.js';
import { gateInstance } from '../../board/proposalCard.js';
import { useRoster } from '../../hooks/useRoster.js';
import { loadCatalog, usePlanCatalog } from '../../store/planCatalog.js';
import { usePlanGate } from '../../store/planGates.js';
import { addGateDraftStep, queueMidRunStep } from '../../store/planDrafts.js';
import { useGateStore } from '../../store/gates.js';
import { useProjectsStore } from '../../store/projects.js';
import {
  addAboutChip, backspaceAboutChip, chipsOf, clearAboutChips, removeAboutChip, useComposerChips,
} from '../../store/composerChips.js';
import { humanTitle } from '../runIdentity.js';

/** Where a send goes besides the words: the project an `@project` chip named, and whether it opens a fresh session. */
export interface ComposerSend {
  /** The `@project` chip's project: the chat is scoped to it. */
  projectId?: string;
  /** True when the message must open a NEW session (an `@project` after this session's first send). */
  fresh?: boolean;
}

/** One `@` row: a project (a destination) or a helper (a subject). */
interface AtItem {
  kind: 'project' | 'helper';
  id: string;
  label: string;
  line: string;
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
    planGate: v.session.id === liveId && planGate.isPlanGate && planGate.view !== null ? { seed: planGate.view.editSeed } : null,
    gatePending: v.session.id === liveId && planGate.pending,
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
 *  - studio#315: when the roster says no helper can take the message, Send is refused and says why.
 *
 * Typing never answers a question and never reshapes the chain: only a picked `/` command does.
 */
export function Composer({
  composerKey, text, setText, onSend, runs = [], started = false, placeholder, ariaLabel, variant, className = '',
  inputRef,
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
}): React.ReactElement {
  const chips = useComposerChips((s) => chipsOf(s, composerKey));
  const roster = useRoster();
  const projects = useProjectsStore((s) => s.projects);
  const catalogState = usePlanCatalog((s) => s.catalog);
  const entries = usePlanCatalog((s) => s.entries);
  const catalog = useMemo(() => (catalogState === 'ready' ? entries.map((e) => e.id) : null), [catalogState, entries]);
  const { target, gateKey, title } = useDraftTarget(runs);
  const own = useRef<HTMLTextAreaElement | null>(null);
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
    if (menuOpen && token?.trigger === '@' && useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load();
  }, [menuOpen, token?.trigger]);

  const slash: SlashItem[] = useMemo(
    () => (token?.trigger === '/' ? slashItems(token.query, target, catalog) : []),
    [token?.trigger, token?.query, target, catalog],
  );
  const ats: AtItem[] = useMemo(() => {
    if (token?.trigger !== '@') return [];
    const q = token.query.toLowerCase();
    const p: AtItem[] = projects.map((x) => ({ kind: 'project', id: x.id, label: x.name, line: 'a project · the message goes there' }));
    const h: AtItem[] = (roster ?? []).map((s) => ({ kind: 'helper', id: s.key, label: s.display_name || s.key, line: 'a helper · the message is about it' }));
    return [...p, ...h].filter((x) => x.label.toLowerCase().startsWith(q) || x.id.toLowerCase().startsWith(q)).slice(0, 8);
  }, [token?.trigger, token?.query, projects, roster]);
  const count = token?.trigger === '/' ? slash.length : ats.length;
  const active = count === 0 ? 0 : Math.min(cursor, count - 1);

  const project = projectChip(chips);
  const refusal = composerSendRefusal(roster, project !== null);
  const canSend = text.trim() !== '' && refusal === null;

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
    setNote(item.kind === 'project'
      ? (started ? `Your next message starts a new session in ${item.label}.` : `This conversation will be in ${item.label}.`)
      : null);
  };
  const pick = (i: number): void => {
    if (token?.trigger === '/') { const it = slash[i]; if (it !== undefined) pickSlash(it); }
    else { const it = ats[i]; if (it !== undefined) pickAt(it); }
  };

  const send = (): void => {
    if (!canSend) return;
    const message = messageWithAbout(text, chips);
    onSend(message, project === null ? {} : { projectId: project.projectId, fresh: started });
    clearAboutChips(composerKey);
    setText('');
    setNote(null);
  };

  return (
    <div className={`wk-composer ${className}`} data-testid="composer" data-composer={composerKey}>
      {menuOpen && token !== null && (
        <div data-testid="composer-menu" data-trigger={token.trigger} role="listbox" aria-label={token.trigger === '/' ? 'Add a step' : 'Name a project or a helper'} className="wk-composer-menu">
          <p className="wk-composer-menu-head">{token.trigger === '/' ? 'Add a step to this session' : 'Name a project or a helper'} · ↑↓ Enter</p>
          {count === 0 && <p className="wk-composer-menu-empty">Nothing matches.</p>}
          {token.trigger === '/' && slash.map((it, i) => (
            <button
              key={it.command.cmd}
              type="button"
              role="option"
              aria-selected={i === active}
              aria-disabled={it.refused !== null}
              data-testid="composer-menu-item"
              data-cmd={it.command.cmd}
              data-refused={it.refused !== null ? 'true' : 'false'}
              title={it.refused ?? it.command.line}
              onMouseDown={(e) => { e.preventDefault(); pickSlash(it); }}
              className={`wk-composer-menu-item${i === active ? ' wk-composer-menu-item--on' : ''}${it.refused !== null ? ' wk-composer-menu-item--off' : ''}`}
            >
              <code className="wk-composer-cmd">/{it.command.cmd}</code>
              <span><b>{it.command.word}</b> <small>{it.refused ?? it.command.line}</small></span>
            </button>
          ))}
          {token.trigger === '@' && ats.map((it, i) => (
            <button
              key={`${it.kind}:${it.id}`}
              type="button"
              role="option"
              aria-selected={i === active}
              data-testid="composer-menu-item"
              data-kind={it.kind}
              data-id={it.id}
              onMouseDown={(e) => { e.preventDefault(); pickAt(it); }}
              className={`wk-composer-menu-item${i === active ? ' wk-composer-menu-item--on' : ''}`}
            >
              <code className="wk-composer-cmd">@</code>
              <span><b>{it.label}</b> <small>{it.line}</small></span>
            </button>
          ))}
        </div>
      )}
      {(chips.length > 0 || note !== null || refusal !== null) && (
        <div className="wk-composer-chips">
          {chips.map((c) => (
            <span key={c.key} data-testid="composer-chip" data-kind={c.kind} data-key={c.key} className="wk-composer-chip" title={c.kind === 'project' ? 'Where your next message goes' : 'Your next message is about this'}>
              {chipText(c)}
              <button type="button" data-testid="composer-chip-remove" aria-label={`Remove ${chipText(c)}`} onClick={() => { removeAboutChip(composerKey, c.key); box.current?.focus(); }} className="wk-composer-chip-x">×</button>
            </span>
          ))}
          {refusal !== null && <span data-testid="composer-refused" role="status" className="wk-composer-note wk-composer-note--bad">{refusal}</span>}
          {refusal === null && note !== null && <span data-testid="composer-note" role="status" className="wk-composer-note">{note}</span>}
        </div>
      )}
      <form className="wk-desk-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={box}
          data-testid={variant === 'desk' ? 'desk-composer-input' : 'session-composer-input'}
          data-type-target="page"
          aria-label={ariaLabel}
          rows={1}
          value={text}
          onChange={(e) => { setText(e.target.value); syncCaret(e.target); setCursor(0); if (note !== null && e.target.value !== '') setNote(null); }}
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
          placeholder={placeholder}
          className="wk-desk-input"
        />
        <button type="submit" data-testid={variant === 'desk' ? 'desk-composer-send' : 'session-composer-send'} aria-label="Send" disabled={!canSend} className="wk-desk-send">↑</button>
      </form>
    </div>
  );
}
