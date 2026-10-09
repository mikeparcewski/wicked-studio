import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { LaunchBodyWithDeliver, RepoEntry, SessionView } from '../../api/types.js';
import { chipText, messageWithAbout, projectChip, type AboutChip } from '../../board/aboutChips.js';
import { composerSendRefusal, NO_REPO_REASON, readyLead, workflowLaunchState } from '../../board/launchModel.js';
import {
  COMPOSER_DEFAULT_GATE_POSTURE,
} from '../composerDefaults.js';
import {
  parseWorkflowCommand, workflowItems, WORKFLOWS_LOADING_LINE, type WorkflowRow,
} from '../../board/workflowCommand.js';
import {
  draftTarget, dropToken, menuToken, slashItems, wordOf, type DraftRunState, type DraftTarget, type SlashItem,
} from '../../board/planDraft.js';
import { gateInstance } from '../../board/proposalCard.js';
import { sessionPath } from '../../board/sessionModel.js';
import { useRoster } from '../../hooks/useRoster.js';
import { loadCatalog, loadPresets, usePlanCatalog } from '../../store/planCatalog.js';
import { usePlanGate } from '../../store/planGates.js';
import { addGateDraftStep, queueMidRunStep } from '../../store/planDrafts.js';
import { useGateStore } from '../../store/gates.js';
import { useProjectsStore } from '../../store/projects.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { useWorkflowDefs } from '../../store/workflowCache.js';
import {
  addAboutChip, backspaceAboutChip, chipsOf, clearAboutChips, removeAboutChip, useComposerChips,
} from '../../store/composerChips.js';
import { humanTitle } from '../runIdentity.js';
import { describeGate } from '../launchTarget.js';
import type { ConfirmMode } from '../ContextPopover.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useLaunchPreview } from '../../hooks/useLaunchPlan.js';
import { takeComposerSeed, useComposerSeed } from '../../store/composerSeed.js';
import { SlashMenu, type AtItem } from './SlashMenu.js';

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
export function Composer({
  composerKey, text, setText, onSend, runs = [], started = false, placeholder, ariaLabel, variant, className = '',
  inputRef, navigate, hint = false, footer = null,
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
  const chatIdOnLaunch = useCapabilities((s) => s.chatIdOnLaunch);
  const deliverGate = useCapabilities((s) => s.deliverGate);
  const own = useRef<HTMLTextAreaElement | null>(null);
  const box = inputRef ?? own;
  const [caret, setCaret] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoEntry[] | null>(getCachedRepos());
  const [repoRef, setRepoRef] = useState<string | null>(null);
  const [deliverOn, setDeliverOn] = useState(true);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(COMPOSER_DEFAULT_GATE_POSTURE.mode);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

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

  // S19a: a workflow chip needs the repository list (a user gesture named the work).
  useEffect(() => {
    if (wfChip === null || repos !== null) return;
    fetchReposCached().then(setRepos, () => setRepos([]));
  }, [wfChip, repos]);
  useEffect(() => {
    if (wfChip === null || repoRef !== null || repos === null) return;
    if (repos.length === 1 && repos[0] !== undefined) setRepoRef(repos[0].id);
  }, [wfChip, repos, repoRef]);

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
  const ats: AtItem[] = useMemo(() => {
    if (token?.trigger !== '@') return [];
    const q = token.query.toLowerCase();
    const p: AtItem[] = projects.map((x) => ({ kind: 'project', id: x.id, label: x.name, line: 'a project · the message goes there' }));
    const h: AtItem[] = (roster ?? []).map((s) => ({ kind: 'helper', id: s.key, label: s.display_name || s.key, line: 'a helper · the message is about it' }));
    return [...p, ...h].filter((x) => x.label.toLowerCase().startsWith(q) || x.id.toLowerCase().startsWith(q)).slice(0, 8);
  }, [token?.trigger, token?.query, projects, roster]);
  const count = token?.trigger === '/' ? wf.length + slash.length : ats.length;
  const active = count === 0 ? 0 : Math.min(cursor, count - 1);

  const refusal = composerSendRefusal(roster, project !== null);
  const launchState = wfChip !== null ? workflowLaunchState(repoRef, roster) : null;
  const wfDef = wfChip !== null ? (defs ?? []).find((d) => d.id === wfChip.workflowId) ?? null : null;
  // A named def that runs no code is not a delivering launch; an unknown name (a preset) may deliver.
  const deliverVisible = wfChip !== null && (wfDef === null ? true : wfDef.phases.some((p) => p.executes_code));
  const canSend = text.trim() !== '' && refusal === null && (launchState === null || launchState.ready) && !launching;

  // S19a: the composer reads the SAME gate rule the launch form does — the `before:N` shift past the
  // PA's scope step included — so a launch from here and one from the form can never disagree.
  const beforeOrd = COMPOSER_DEFAULT_GATE_POSTURE.beforeOrd;
  const autoDeliver = confirmMode === 'none';
  const launchPreview = useLaunchPreview({
    plan: null,
    workflow: wfChip?.workflowId ?? '',
    projectId: project?.projectId ?? null,
    repoRef,
    deliver: deliverVisible ? (deliverOn ? 'pr' : 'none') : null,
    mode: undefined,
    confirm: confirmMode,
    beforeOrd,
  });
  const targetRepo = repoRef ?? (repos !== null && repos.length === 1 ? repos[0]?.id ?? null : null);
  const repoLabel = targetRepo === null ? 'no repository' : ((repos ?? []).find((r) => r.id === targetRepo)?.name ?? targetRepo);
  const deliverShown = deliverVisible && deliverOn;
  const deliverWord = autoDeliver && deliverGate === true
    ? 'auto — no gate before the push'
    : 'after you approve the deliver gate';

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
    setNote(item.kind === 'project'
      ? (started ? `Your next message starts a new session in ${item.label}.` : `This conversation will be in ${item.label}.`)
      : (!started && useCapabilities.getState().askPath ? `${item.label} will answer this conversation.` : null));
  };
  const pickWorkflow = (item: WorkflowRow): void => {
    if (token === null) return;
    const next = dropToken(text, token.start, caret);
    setText(next);
    focusEnd(next);
    setLaunchError(null);
    addAboutChip(composerKey, { kind: 'workflow', key: `wf:${item.workflowId}`, label: `/workflow-${item.workflowId}`, workflowId: item.workflowId });
  };
  const pick = (i: number): void => {
    if (token?.trigger === '/') {
      if (i < wf.length) { const it = wf[i]; if (it !== undefined) pickWorkflow(it); }
      else { const it = slash[i - wf.length]; if (it !== undefined) pickSlash(it); }
    } else { const it = ats[i]; if (it !== undefined) pickAt(it); }
  };

  /** S19a: POST the launch a named workflow runs — the wire the launch form sends, from the composer. */
  const launchWorkflow = async (workflowId: string, intent: string): Promise<void> => {
    setLaunching(true);
    setLaunchError(null);
    // Everything that can fail — the launch preview's gate placement included — sits inside the try,
    // so a refusal is said on screen and the composer never stays "Launching…".
    try {
      const seats = (roster ?? []).filter((s) => s.enabled_for_council);
      const body: LaunchBodyWithDeliver = { problem: intent, workflow: workflowId };
      if (seats.length > 0) body.clisJson = JSON.stringify(seats);
      const targetRepo = repoRef ?? (repos !== null && repos.length === 1 ? repos[0]?.id ?? null : null);
      if (targetRepo !== null) body.repoRef = targetRepo;
      if (project !== null) body.projectId = project.projectId;
      // The gate posture is the form's rule: the `before:N` shift past the PA's scope step is read off
      // the same launch preview (`mode` is undefined here — a composer has no mode pill — so the
      // posture select speaks, exactly as it does on a Balanced form).
      const humanConfirm = await launchPreview.resolveHumanConfirm();
      if (humanConfirm !== undefined) body.humanConfirm = humanConfirm;
      if (deliverVisible) body.deliver = deliverOn ? 'pr' : 'none';
      // F-E2E-030: only the explicitly unattended posture sends the opt-out, and only with a delivery.
      if (body.deliver === 'pr' && autoDeliver && deliverGate === true) body.deliverGate = 'auto';
      // A chat's composer names the chat (only on a daemon that accepts the key), so the run lands in
      // that chat's session; a Desk launch opens a `run:<id>` session instead.
      const chat = chatIdOnLaunch && composerKey !== 'desk' && !composerKey.startsWith('run:') ? composerKey : null;
      if (chat !== null) body.chatId = chat;
      const { runId } = await api.launchRun(body);
      useProvenanceStore.getState().markLaunchedHere(runId);
      clearAboutChips(composerKey);
      setText('');
      setNote(null);
      navigate?.(chat !== null ? sessionPath(chat) : sessionPath(`run:${runId}`));
    } catch (err) {
      // A failed launch keeps the words and the chip, and says the daemon's own words.
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLaunching(false);
    }
  };

  const send = (): void => {
    if (launching) return;
    if (wfChip !== null) {
      if (!canSend) return;
      void launchWorkflow(wfChip.workflowId, text.trim());
      return;
    }
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
      addAboutChip(composerKey, { kind: 'workflow', key: `wf:${known.key}`, label: `/workflow-${known.key}`, workflowId: known.workflowId });
      setText(typed.rest);
      setNote(null);
      return;
    }
    if (!canSend) return;
    const message = messageWithAbout(text, chips);
    // ASK-S1: a helper named with `@` before the first send answers this conversation (its chip still
    // leads the message as a subject, as before).
    const helper = !started && useCapabilities.getState().askPath ? chips.find((c) => c.kind === 'about' && c.key.startsWith('h:')) : undefined;
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
      {wfChip !== null && (
        <div
          data-testid="composer-launch-row"
          data-workflow={wfChip.workflowId}
          role="group"
          aria-label={`Launch ${chipText(wfChip)}`}
          className="wk-composer-launch"
        >
          <span className="wk-composer-launch-wf">{chipText(wfChip)}</span>
          <select
            data-testid="launch-row-repo"
            aria-label="Repository this run works in"
            aria-invalid={launchState?.missing === 'repo'}
            value={repoRef ?? ''}
            onChange={(e) => setRepoRef(e.target.value === '' ? null : e.target.value)}
            className="wk-composer-launch-repo"
          >
            <option value="">pick the repository…</option>
            {(repos ?? []).map((r) => <option key={r.id} value={r.id}>{r.name ?? r.id}</option>)}
          </select>
          <select
            data-testid="launch-row-gate"
            aria-label="Gate posture"
            value={confirmMode}
            onChange={(e) => setConfirmMode(e.target.value as ConfirmMode)}
            className="wk-composer-launch-gate"
          >
            <option value="before">{beforeOrd === 1 ? 'First gate' : `Before unit #${beforeOrd}`}</option>
            <option value="all">Every unit</option>
            <option value="none">{deliverShown && deliverGate === true ? 'No gates · auto-deliver' : 'No gates'}</option>
          </select>
          {deliverVisible && (
            <label data-testid="launch-row-deliver" className="wk-composer-launch-deliver">
              <input type="checkbox" data-testid="launch-row-deliver-toggle" checked={deliverOn} onChange={(e) => setDeliverOn(e.target.checked)} />
              deliver when done
            </label>
          )}
          <span data-testid="composer-launch-line" role="status" className="wk-composer-launch-line">
            {launching ? 'Launching…'
              : launchState?.missing === 'repo' ? NO_REPO_REASON
                : (
                  <>
                    {readyLead(canSend, refusal)}
                    <span data-testid="composer-launch-workflow" style={{ color: 'var(--ink-high)' }}>{chipText(wfChip)}</span>
                    {' on '}
                    <span data-testid="composer-launch-target" style={{ color: targetRepo === null ? 'var(--status-gate)' : 'var(--ink-high)' }}>{repoLabel}</span>
                    {' · gate: '}
                    <span data-testid="composer-launch-gate-word">{describeGate(undefined, confirmMode, beforeOrd)}</span>
                    {deliverShown && (
                      <>
                        {' · deliver: '}
                        <span data-testid="composer-launch-deliver-word">{deliverWord}</span>
                      </>
                    )}
                  </>
                )}
          </span>
          {launchError !== null && <span data-testid="composer-launch-error" role="alert" className="wk-composer-note wk-composer-note--bad">{launchError}</span>}
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
