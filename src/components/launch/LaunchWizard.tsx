import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, apiWire } from '../../api/client.js';
import { qeRefusalOf } from '../../board/qeRefusal.js';
import { goToPath, QeRefusalWarning } from '../QeRefusalWarning.js';
import type { RepoEntry } from '../../api/types.js';
import { gatePostureWord, workflowLaunchBody } from '../../board/launchModel.js';
import { qeAcceptanceSetting, workflowRequiresQe } from '../../board/assuranceModel.js';
import { QeOffNote } from '../QeOffNote.js';
import { workflowItems, WORKFLOWS_LOADING_LINE } from '../../board/workflowCommand.js';
import { sessionPath } from '../../board/sessionModel.js';
import { seatLabel, userSeats } from '../../board/seatNames.js';
import { COMPOSER_DEFAULT_GATE_POSTURE } from '../composerDefaults.js';
import type { ConfirmMode } from '../ContextPopover.js';
import { useModalEscape } from '../Modal.js';
import { QeAcceptanceOptions, ReducedAssuranceOptIn } from '../session/AssuranceReceipt.js';
import { Switch } from '../ui/Switch.js';
import { TechDetails } from '../ui/TechDetails.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useLaunchPreview } from '../../hooks/useLaunchPlan.js';
import { useCapabilities } from '../../store/capabilities.js';
import { isOptInKey, OPT_IN_NOTE, seatOff, useLaunchSeats } from '../../store/composerSeats.js';
import { clearAboutChips } from '../../store/composerChips.js';
import { loadPresets, usePlanCatalog } from '../../store/planCatalog.js';
import { useProjectsStore } from '../../store/projects.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { useWorkflowDefs } from '../../store/workflowCache.js';
import { workflowLabel } from '../../board/workflowNames.js';
import { DEMO_VIDEO_ID, DRAFT_EPICS_ID, START_CHAT_ID, useLaunchWizard, withJobKind, type LaunchDraft } from '../../store/launchWizard.js';
import { openChatFlow } from '../../store/chatFlow.js';
import { useComposerPrefsStore } from '../../store/composerPrefs.js';
import { launchDemo } from '../../api/demo.js';
import { DEMO_AUDIENCES, DEMO_AUDIENCE_MAX, DEMO_SHOW_MAX, DEMO_URL_MAX, DEMO_VIDEO_LINE, demoBlocker } from '../../board/demoLaunch.js';
import { UNFILED_MOUNT } from '../../api/interactive.js';
import { VIBE_SOON } from '../../board/comingSoon.js';
import { composeProduct } from '../../api/product.js';
import { COMPOSE_MAX, RequirementsBrowser, reqKey, type ChosenRequirement } from '../product/RequirementsBrowser.js';
import { workflowPurpose } from '../../board/workflowPurpose.js';
import { hasWorkflowArt, WorkflowArt } from './WorkflowArt.js';

type Step = 'workflow' | 'what' | 'where' | 'options' | 'requirements' | 'demo' | 'review';
const STEP_TITLE: Record<Step, string> = {
  workflow: 'Choose the kind of job',
  what: 'The work',
  where: 'Where does it work?',
  options: 'How should it run?',
  requirements: 'Choose the requirements',
  demo: 'The video',
  review: 'Check and launch',
};
/** "Draft epics" (operator 2026-10-12): a project's requirements become epics, features and stories. */
const DRAFT_EPICS_LINE = 'Turn requirements into epics and stories';
const START_CHAT_LINE = 'Talk it through first, then start a job';
const INSTRUCTIONS_MAX = 500;
/**
 * THE LAUNCH WIZARD (operator 2026-10-11 15:15Z: "someone just starts a new job by selecting a
 * workflow and we do the wizard in a modal"). Mounted once by the app shell; opened through
 * `openLaunchWizard` from every start point. Steps: (the workflow, when none was named) → what you
 * want → where (repository, project) → options (only the ones this workflow uses) → review →
 * Launch. A modal dialog: focus is trapped inside, Escape closes (the draft stays in its store);
 * on a phone it is a full-height sheet. Launch sends `workflowLaunchBody` — the same body the
 * composer's inline strip sent.
 */
export function LaunchWizard({ navigate }: { navigate?: (path: string) => void }): React.ReactElement | null {
  const open = useLaunchWizard((s) => s.open);
  const draft = useLaunchWizard((s) => s.draft);
  if (!open || draft === null) return null;
  return <WizardDialog draft={draft} navigate={navigate} />;
}

function WizardDialog({ draft, navigate }: { draft: LaunchDraft; navigate?: ((path: string) => void) | undefined }): React.ReactElement {
  const { close: closeStore, update, finish } = useLaunchWizard.getState();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // codex r1: a launch in flight holds the dialog open (no second POST from a reopened draft).
  const launchingRef = useRef(false);
  const close = (): void => { if (!launchingRef.current) closeStore(); };
  // "Don't show this again" (operator 2026-10-16): the saved choice, shown as it is. Ticking it saves
  // it and goes to the chat flow now (a new chat on its own page) with what was typed; unticking (seen
  // when a named job opened the picker) turns New job back on.
  const startInChat = useComposerPrefsStore((s) => s.prefs.startInChat);
  const setStartInChat = (on: boolean): void => {
    if (launchingRef.current || draft === null) return;
    useComposerPrefsStore.getState().update({ startInChat: on });
    if (!on) return;
    startChat();
  };
  // "Start with chat" (operator 2026-10-16: "No option in new job modal for just starting with chat"):
  // the first card, and the box above — both go to the one chat flow, in the draft's project.
  const startChat = (): void => {
    if (launchingRef.current) return;
    closeStore();
    openChatFlow({ projectId: draft.projectId, seedText: draft.intent });
  };
  useModalEscape(close);
  // codex r1: focus returns to whatever opened the wizard when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (opener !== null && opener.isConnected) opener.focus(); };
  }, []);

  const defs = useWorkflowDefs();
  const presetsState = usePlanCatalog((s) => s.presets[draft.projectId ?? '']);
  const presets = Array.isArray(presetsState) ? presetsState : null;
  // The wizard reads the kinds of job itself: it can open from a page with no composer to warm them (the Desk).
  useEffect(() => { loadPresets(draft.projectId ?? null); }, [draft.projectId]);
  const rows = useMemo(() => workflowItems('', defs, presets), [defs, presets]);
  const roster = useRoster();
  const projects = useProjectsStore((s) => s.projects) ?? [];
  const dropped = useLaunchSeats((s) => s.dropped);
  const picked = useLaunchSeats((s) => s.picked);
  const toggleSeat = useLaunchSeats((s) => s.toggle);
  const deliverGateCap = useCapabilities((s) => s.deliverGate);
  const reducedCap = useCapabilities((s) => s.reducedAssurance);
  const chatIdOnLaunch = useCapabilities((s) => s.chatIdOnLaunch);
  const [repos, setRepos] = useState<RepoEntry[] | null>(getCachedRepos());
  const [qeCap, setQeCap] = useState(false);
  // Settings › System: QE acceptance off on this computer — the service skips it (labelled); nothing to tick here.
  const [qeOff, setQeOff] = useState(false);
  const [force, setForce] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The launch was refused because its workflow requires QE acceptance (crew's `qe_acceptance_required`). */
  const [qeRefused, setQeRefused] = useState<{ key: string; detail: string | null; forced: boolean } | null>(null);
  const forcedRef = useRef(false);
  const attemptRef = useRef(0);
  const drafting = draft.workflowId === DRAFT_EPICS_ID;
  const demoing = draft.workflowId === DEMO_VIDEO_ID;
  const [step, setStep] = useState<Step>(draft.workflowId === null ? 'workflow' : drafting ? 'requirements' : demoing ? 'demo' : 'what');

  useEffect(() => { if (repos === null) fetchReposCached().then(setRepos, () => setRepos([])); }, [repos]);
  useEffect(() => { if ((useProjectsStore.getState().projects ?? []).length === 0) void useProjectsStore.getState().load(); }, []);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.getHealth()).then((h) => {
      const caps = (h as unknown as { capabilities?: Record<string, unknown> }).capabilities ?? {};
      if (live) { setQeCap(caps['qeAcceptanceOverride'] === true); setQeOff(qeAcceptanceSetting(caps) === 'off'); }
    }).catch(() => { /* no override offered */ });
    return () => { live = false; };
  }, []);

  const row = rows.find((r) => r.workflowId === draft.workflowId) ?? null;
  const def = (defs ?? []).find((d) => d.id === draft.workflowId) ?? null;
  // A named def that runs no code is not a delivering launch; an unknown one (a preset) may deliver.
  // A demo video never delivers (crew launches it with `deliver: 'none'`) and its gates are the preset's own.
  const deliverVisible = draft.workflowId !== null && !demoing && (def === null ? true : def.phases.some((p) => p.executes_code));
  const offerQe = qeCap && !demoing && workflowRequiresQe(def);

  // Where: the user's pick, else the repository the opening context names, else a sole repository.
  const defaultRepo = useMemo(() => {
    const list = repos ?? [];
    const ctx = draft.contextRepo === null ? undefined : list.find((r) => r.id === draft.contextRepo || r.name === draft.contextRepo);
    if (ctx !== undefined) return ctx.id;
    return list.length === 1 ? list[0]?.id ?? null : null;
  }, [repos, draft.contextRepo]);
  const repoRef = draft.repoRef !== null ? (draft.repoRef === '' ? null : draft.repoRef) : defaultRepo;
  const repoName = repoRef === null ? null : ((repos ?? []).find((r) => r.id === repoRef)?.name ?? repoRef);
  // The unfiled mount (`default`) is "not in a project" wherever the wizard shows the choice.
  const filedProject = draft.projectId === UNFILED_MOUNT ? null : draft.projectId;
  const projectName = filedProject === null ? null : (projects.find((p) => p.id === filedProject)?.name ?? null);

  // Options: the helpers a workflow launch convenes (council-enabled, addressable), minus the dropped.
  const eligible = useMemo(() => userSeats(roster).filter((s) => s.enabled_for_council), [roster]);
  const seats = eligible.filter((s) => !seatOff(s.key, dropped, picked));
  const offerReduced = reducedCap && seats.length === 1;
  const beforeOrd = COMPOSER_DEFAULT_GATE_POSTURE.beforeOrd;
  const autoDeliver = draft.confirmMode === 'none';
  const deliver: 'pr' | 'none' | null = deliverVisible ? (draft.deliverOn ? 'pr' : 'none') : null;
  const preview = useLaunchPreview({
    plan: null, workflow: drafting || demoing ? '' : draft.workflowId ?? '', projectId: draft.projectId, repoRef, deliver, mode: undefined,
    confirm: draft.confirmMode, beforeOrd,
  });

  const chosen = useMemo(() => new Map(draft.requirements.map((r) => [reqKey(r.repoId, r.key), r] as const)), [draft.requirements]);
  const toggleReq = (r: ChosenRequirement): void => {
    const k = reqKey(r.repoId, r.key);
    const next = chosen.has(k) ? draft.requirements.filter((x) => reqKey(x.repoId, x.key) !== k)
      : draft.requirements.length >= COMPOSE_MAX ? draft.requirements : [...draft.requirements, r];
    update({ requirements: next });
  };
  const draftBlocker: string | null = draft.projectId === null || draft.projectId === 'default' ? 'Choose the project to draft from.'
    : draft.requirements.length === 0 ? 'Choose at least one requirement to draft from.'
      // What the review shows is what is sent (codex on S5): words carried in from another job may be longer.
      : draft.intent.trim().length > INSTRUCTIONS_MAX ? `Shorten the instructions to ${INSTRUCTIONS_MAX} characters.` : null;
  // What each step needs before Next: words; a repository; a helper and, for a skip, its reason.
  const demoProblem = demoing ? demoBlocker(draft) : null;
  const blocker: string | null =
    step === 'requirements' ? draftBlocker
    : step === 'demo' ? demoProblem
    : step === 'workflow' ? (draft.workflowId === null ? 'Choose the kind of job.' : null)
      : step === 'what' ? (draft.intent.trim() === '' ? 'Say what you want done.' : null)
        : step === 'where' ? (repoRef === null ? 'Choose the repository this works in.' : null)
          : step === 'options' ? (eligible.length > 0 && seats.length === 0 ? 'Turn on at least one helper.'
            : offerQe && !qeOff && draft.skipQe && draft.skipQeReason.trim() === '' ? 'Say why QE acceptance is skipped.' : null)
            : null;
  // Review re-checks every rule (codex r1: another tab may have dropped the last helper meanwhile).
  const launchBlocker: string | null =
    drafting ? draftBlocker
    : demoing ? (demoProblem ?? (eligible.length > 0 && seats.length === 0 ? 'Turn on at least one helper.' : null))
    : draft.workflowId === null ? 'Choose the kind of job.'
      : draft.intent.trim() === '' ? 'Say what you want done.'
        : repoRef === null ? 'Choose the repository this works in.'
          : eligible.length > 0 && seats.length === 0 ? 'Turn on at least one helper.'
            : offerQe && !qeOff && draft.skipQe && draft.skipQeReason.trim() === '' ? 'Say why QE acceptance is skipped.' : null;
  const order: Step[] = drafting ? ['workflow', 'requirements', 'review']
    : demoing ? ['workflow', 'demo', 'options', 'review']
      : ['workflow', 'what', 'where', 'options', 'review'];
  const goNext = (): void => {
    if (blocker !== null) return;
    const i = order.indexOf(step);
    setStep(order[Math.min(i + 1, order.length - 1)]!);
  };
  const goBack = (): void => {
    const i = order.indexOf(step);
    setStep(order[Math.max(i - 1, 1)]!);
  };

  // Focus: the step's first control on every step; Tab stays inside the dialog.
  const autoFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus="true"]')
      ?? dialogRef.current?.querySelector<HTMLElement>('button, select, textarea, input');
    el?.focus();
    autoFocused.current = el ?? null;
  }, [step]);
  // The catalog may arrive after the first card (Draft epics) took focus: focus then moves to the
  // card the step names (the first, or the job already picked) — only while focus is still where the
  // wizard put it (codex r1: a card the user has moved to keeps its focus when presets arrive).
  const cardCount = step === 'workflow' ? rows.length : -1;
  useEffect(() => {
    if (cardCount < 0) return;
    const active = document.activeElement;
    if (active !== autoFocused.current && active !== document.body && active !== dialogRef.current) return;
    const el = dialogRef.current?.querySelector<HTMLElement>('[data-testid="launch-wizard-cards"] [data-autofocus="true"]') ?? null;
    el?.focus();
    autoFocused.current = el;
  }, [cardCount]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select, textarea, input, a[href], summary') ?? [])];
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  // The kinds of job, in the catalog's order, then Draft epics (studio's own): one card each.
  const cards = [
    ...rows.map((r) => ({ key: r.cmd, id: r.workflowId, artKey: r.key, name: workflowLabel(r.key), line: workflowPurpose(r.key, r.line) })),
    { key: DEMO_VIDEO_ID, id: DEMO_VIDEO_ID, artKey: DEMO_VIDEO_ID, name: 'Demo video', line: DEMO_VIDEO_LINE },
    { key: DRAFT_EPICS_ID, id: DRAFT_EPICS_ID, artKey: DRAFT_EPICS_ID, name: 'Draft epics', line: DRAFT_EPICS_LINE },
  ];
  const pickCard = (id: string): void => {
    // codex r1: another kind of job starts its own options; studio#767: and its own words.
    if (id !== draft.workflowId) update(withJobKind(draft, id));
    setStep(id === DRAFT_EPICS_ID ? 'requirements' : id === DEMO_VIDEO_ID ? 'demo' : 'what');
  };
  // Arrow keys move across the grid (as many across as the layout shows), Home/End to the ends;
  // Enter and Space pick (the cards are buttons).
  const onCardKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const grid = e.currentTarget;
    const btns = [...grid.querySelectorAll<HTMLButtonElement>('button')];
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const top = btns[0]?.offsetTop ?? 0;
    const across = Math.max(1, btns.filter((b) => b.offsetTop === top).length);
    const last = btns.length - 1;
    // Up from the top row and Down from the bottom row stay put (codex r1: never a sideways move);
    // Down into a shorter last row lands on its last card.
    const down = Math.floor(at / across) < Math.floor(last / across) ? Math.min(at + across, last) : at;
    const to = e.key === 'ArrowRight' ? Math.min(at + 1, last) : e.key === 'ArrowLeft' ? Math.max(at - 1, 0)
      : e.key === 'ArrowDown' ? down : e.key === 'ArrowUp' ? (at - across >= 0 ? at - across : at)
        : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    const next = btns[to];
    next?.focus();
    next?.scrollIntoView?.({ block: 'nearest' });
  };

  const launch = async (): Promise<void> => {
    if (draft.workflowId === null || launching || launchBlocker !== null) return;
    if (demoing) {
      launchingRef.current = true;
      setLaunching(true);
      setError(null);
      setQeRefused(null);
      try {
        // Unfiled is the `default` mount: crew launches the run unfiled (recording.ts, UNFILED_PROJECT).
        const out = await launchDemo(draft.projectId ?? UNFILED_MOUNT, {
          url: draft.demoUrl.trim(),
          audience: draft.demoAudience.trim(),
          show: draft.intent.trim(),
          ...(seats.length > 0 ? { clisJson: JSON.stringify(seats) } : {}),
          ...(offerReduced && draft.reduced ? { reducedAssurance: true } : {}),
        });
        useProvenanceStore.getState().markLaunchedHere(out.runId);
        finish();
        navigate?.(sessionPath(`run:${out.runId}`));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        launchingRef.current = false;
        setLaunching(false);
      }
      return;
    }
    if (drafting) {
      launchingRef.current = true;
      setLaunching(true);
      setError(null);
      setQeRefused(null);
      try {
        const steer = draft.intent.trim();
        const out = await composeProduct(draft.projectId!, {
          requirements: draft.requirements.map(({ repoId, key }) => ({ repoId, key })),
          ...(steer !== '' ? { instructions: steer.slice(0, INSTRUCTIONS_MAX) } : {}),
        });
        useProvenanceStore.getState().markLaunchedHere(out.runId);
        finish();
        navigate?.(sessionPath(`run:${out.runId}`));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        launchingRef.current = false;
        setLaunching(false);
      }
      return;
    }
    launchingRef.current = true;
    setLaunching(true);
    setError(null);
    try {
      const key = draft.composerKey;
      const chatId = chatIdOnLaunch && key !== null && key !== 'desk' && !key.startsWith('run:') ? key : null;
      const body = workflowLaunchBody({
        workflowId: draft.workflowId,
        intent: draft.intent,
        seats,
        repoRef,
        projectId: draft.projectId,
        humanConfirm: await preview.resolveHumanConfirm(),
        deliver,
        autoDeliverGate: autoDeliver && deliverGateCap === true,
        reducedAssurance: offerReduced && draft.reduced,
        skipQeReason: offerQe && !qeOff && draft.skipQe ? draft.skipQeReason : null,
        chatId,
      });
      if (offerQe && force && (qeOff || !draft.skipQe)) body.forceQeAcceptance = true;
      forcedRef.current = body.forceQeAcceptance === true;
      const { runId } = await api.launchRun(body);
      useProvenanceStore.getState().markLaunchedHere(runId);
      if (key !== null) clearAboutChips(key);
      finish();
      navigate?.(chatId !== null ? sessionPath(chatId) : sessionPath(`run:${runId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      attemptRef.current += 1;
      setQeRefused(qeRefusalOf(err) === 'launch' ? { key: `launch:${attemptRef.current}`, detail: apiWire(err), forced: forcedRef.current } : null);
    } finally {
      launchingRef.current = false;
      setLaunching(false);
    }
  };

  const title = drafting ? 'New job: Draft epics' : demoing ? 'New job: Demo video' : draft.workflowId !== null ? `New job: ${workflowLabel(row?.key ?? draft.workflowId)}` : 'New job';
  return (
    <div className="wk-launch-wizard-scrim" data-testid="launch-wizard-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="launch-wizard"
        className={`wk-launch-wizard${step === 'workflow' ? ' wk-launch-wizard--cards' : ''}`}
        onKeyDown={onKeyDown}
      >
        <header className="wk-launch-wizard-head">
          <div>
            <h2 id={titleId} className="wk-launch-wizard-title">{title}</h2>
            <p className="wk-launch-wizard-progress" data-testid="launch-wizard-progress">
              Step {order.indexOf(step) + (draft.workflowId === null || step === 'workflow' ? 1 : 0)} of {draft.workflowId === null || step === 'workflow' ? order.length : order.length - 1}: {STEP_TITLE[step]}
            </p>
          </div>
          <button type="button" className="wk-btn wk-btn--icon wk-btn--quiet" aria-label="Close (your choices are kept)" title="Close (your choices are kept)" data-testid="launch-wizard-close" disabled={launching} onClick={close}>×</button>
        </header>

        <div className="wk-launch-wizard-body" data-testid="launch-wizard-step" data-step={step}>
          {step === 'workflow' && (
            <fieldset className="wk-launch-wizard-fieldset">
              <legend className="wk-field-label">The kind of job</legend>
              {defs === null && <p className="wk-field-note">{WORKFLOWS_LOADING_LINE}</p>}
              {/* The card grid (operator 2026-10-12): 4 across, 3 rows in view, the rest scroll inside. The
                  frame is a size container, so a row is a third of the room the modal leaves it. */}
              <div className="wk-launch-wizard-cards-frame">
                <div className="wk-launch-wizard-cards" data-testid="launch-wizard-cards" onKeyDown={onCardKey}>
                  {/* Chat first (operator 2026-10-16): not a workflow — a conversation on its own page, where
                      a job can still be started from what is said. Focus starts here unless a job is picked. */}
                  <button
                    type="button"
                    data-testid="launch-wizard-start-chat"
                    data-autofocus={draft.workflowId !== null && cards.some((x) => x.id === draft.workflowId) ? undefined : 'true'}
                    data-art={START_CHAT_ID}
                    aria-pressed={false}
                    className="wk-launch-wizard-choice wk-launch-wizard-card wk-launch-wizard-card--chat"
                    onClick={startChat}
                  >
                    <span className="wk-launch-wizard-card-art"><WorkflowArt workflowKey={START_CHAT_ID} /></span>
                    <span className="wk-launch-wizard-choice-name">Start with chat</span>
                    <span className="wk-launch-wizard-choice-line" title={START_CHAT_LINE}>{START_CHAT_LINE}</span>
                  </button>
                  {cards.map((c) => {
                    const on = c.id === DRAFT_EPICS_ID ? drafting : draft.workflowId === c.id;
                    const autofocus = on && draft.workflowId !== null;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        data-testid={`launch-wizard-workflow-${c.id}`}
                        data-autofocus={autofocus ? 'true' : undefined}
                        data-art={hasWorkflowArt(c.artKey) ? c.artKey : 'fallback'}
                        aria-pressed={on}
                        className={`wk-launch-wizard-choice wk-launch-wizard-card${on ? ' wk-launch-wizard-choice--on' : ''}`}
                        onClick={() => pickCard(c.id)}
                      >
                        <span className="wk-launch-wizard-card-art"><WorkflowArt workflowKey={c.artKey} /></span>
                        <span className="wk-launch-wizard-choice-name">{c.name}</span>
                        <span className="wk-launch-wizard-choice-line" title={c.line}>{c.line}</span>
                      </button>
                    );
                  })}
                  {/* The app builder (operator 2026-10-12): shown, not offered — a card that is not a button. */}
                  <div data-testid="launch-wizard-soon" data-job="vibe" aria-disabled="true" role="group" aria-label={`${VIBE_SOON.name}, coming soon`} className="wk-launch-wizard-choice wk-launch-wizard-card wk-launch-wizard-card--soon">
                    <span className="wk-launch-wizard-card-art"><WorkflowArt workflowKey="vibe" /></span>
                    <span className="wk-tag">Coming soon</span>
                    <span className="wk-launch-wizard-choice-name">{VIBE_SOON.name}</span>
                    <span className="wk-launch-wizard-choice-line" title={VIBE_SOON.line}>{VIBE_SOON.line}</span>
                  </div>
                </div>
              </div>
            </fieldset>
          )}

          {step === 'what' && (
            <label className="wk-launch-wizard-field">
              <span className="wk-field-label">What do you want done?</span>
              <textarea
                data-testid="launch-wizard-intent"
                data-autofocus="true"
                className="wk-field wk-launch-wizard-intent"
                rows={5}
                value={draft.intent}
                placeholder="Describe the outcome, the way you would to a teammate"
                onChange={(e) => update({ intent: e.target.value })}
              />
              <span className="wk-field-note">{row?.line !== undefined && row.line !== '' ? `This job: ${row.line}` : 'The helpers plan the steps from this; you approve the plan before work starts.'}</span>
            </label>
          )}

          {step === 'where' && (
            <>
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">Repository</span>
                <select
                  data-testid="launch-wizard-repo"
                  data-autofocus="true"
                  className="wk-field"
                  value={repoRef ?? ''}
                  onChange={(e) => update({ repoRef: e.target.value })}
                >
                  <option value="">Choose a repository…</option>
                  {(repos ?? []).map((r) => <option key={r.id} value={r.id}>{r.name ?? r.id}</option>)}
                </select>
                <span className="wk-field-note">The code this job reads and changes{draft.contextRepo !== null && repoRef === defaultRepo && repoRef !== null ? ' (the one this session already works in)' : ''}.</span>
              </label>
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">Project</span>
                <select
                  data-testid="launch-wizard-project"
                  className="wk-field"
                  value={draft.projectId ?? ''}
                  onChange={(e) => update({ projectId: e.target.value === '' ? null : e.target.value })}
                >
                  <option value="">Not in a project</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <span className="wk-field-note">Optional. Files the job with a project so it shows up there.</span>
              </label>
            </>
          )}

          {step === 'options' && (
            <>
              {eligible.length > 0 && (
                <fieldset className="wk-launch-wizard-fieldset" data-testid="launch-wizard-helpers">
                  <legend className="wk-field-label">Helpers</legend>
                  <div className="wk-launch-wizard-seats">
                    {eligible.map((s, i) => {
                      const on = !seatOff(s.key, dropped, picked);
                      return (
                        <button
                          key={s.key}
                          type="button"
                          data-testid="launch-wizard-seat"
                          data-key={s.key}
                          data-autofocus={i === 0 ? 'true' : undefined}
                          aria-pressed={on}
                          aria-describedby={isOptInKey(s.key) ? 'launch-wizard-optin-note' : undefined}
                          className={`wk-composer-chip wk-composer-seat${on ? '' : ' wk-composer-seat--off'}`}
                          onClick={() => toggleSeat(s.key)}
                        >
                          {seatLabel(s)}
                        </button>
                      );
                    })}
                  </div>
                  <span className="wk-field-note">Who plans, builds and checks the work. Different helpers check each other’s work.</span>
                  {eligible.some((s) => isOptInKey(s.key)) && (
                    <span id="launch-wizard-optin-note" className="wk-field-note" data-testid="launch-wizard-optin-note">
                      {eligible.filter((s) => isOptInKey(s.key)).map(seatLabel).join(', ')}: {OPT_IN_NOTE}
                    </span>
                  )}
                </fieldset>
              )}
              {demoing ? (
                <p className="wk-field-note" data-testid="launch-wizard-demo-gates">It stops for your yes twice: after the plan (the script and chapters, before anything records) and after the review.</p>
              ) : (
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">Ask me</span>
                <select
                  data-testid="launch-wizard-gate"
                  className="wk-field"
                  value={draft.confirmMode}
                  onChange={(e) => update({ confirmMode: e.target.value as ConfirmMode })}
                >
                  <option value="before">{gatePostureWord('before', beforeOrd)}</option>
                  <option value="all">{gatePostureWord('all', beforeOrd)}</option>
                  <option value="none">{gatePostureWord('none', beforeOrd, deliver === 'pr' && deliverGateCap === true)}</option>
                </select>
                <span className="wk-field-note">When the job stops for your yes before it goes on.</span>
              </label>
              )}
              {deliverVisible && (
                <div className="wk-launch-wizard-field" data-testid="launch-wizard-deliver">
                  <Switch label="Deliver as a pull request when done" checked={draft.deliverOn} onChange={(v) => update({ deliverOn: v })} data-testid="launch-wizard-deliver-toggle" />
                  <span className="wk-field-note">{draft.deliverOn ? (autoDeliver && deliverGateCap === true ? 'It pushes and opens the pull request without asking.' : 'It asks you once more before it pushes.') : 'The work stays on its branch; you can deliver it later from the session.'}</span>
                </div>
              )}
              {offerReduced && <ReducedAssuranceOptIn checked={draft.reduced} onChange={(v) => update({ reduced: v })} testId="launch-wizard-reduced" />}
              {offerQe && qeOff && <QeOffNote force={force} onForce={setForce} testId="launch-wizard-qe-off" />}
              {offerQe && !qeOff && (
                <QeAcceptanceOptions
                  skip={draft.skipQe} reason={draft.skipQeReason} force={force}
                  onSkip={(v) => update({ skipQe: v })} onReason={(v) => update({ skipQeReason: v })} onForce={setForce}
                  testId="launch-wizard-qe"
                />
              )}
            </>
          )}

          {step === 'demo' && (
            <div className="wk-launch-wizard-reqs" data-testid="launch-wizard-demo">
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">The running app</span>
                <input
                  type="url"
                  inputMode="url"
                  data-testid="launch-wizard-demo-url"
                  data-autofocus="true"
                  className="wk-field"
                  value={draft.demoUrl}
                  maxLength={DEMO_URL_MAX}
                  placeholder="http://localhost:5173/"
                  onChange={(e) => update({ demoUrl: e.target.value })}
                />
                <span className="wk-field-note">The recorder opens this address and only reads it; it never changes the app.</span>
              </label>
              <div className="wk-launch-wizard-field">
                <label className="wk-field-label" htmlFor={`${titleId}-audience`}>Who it is for</label>
                <div className="wk-launch-wizard-seats" role="group" aria-label="Common audiences">
                  {DEMO_AUDIENCES.map((a) => (
                    <button key={a} type="button" data-testid="launch-wizard-demo-audience-pick" data-audience={a}
                      aria-pressed={draft.demoAudience.trim() === a} className="wk-chip"
                      onClick={() => update({ demoAudience: a })}>{a}</button>
                  ))}
                </div>
                <input
                  id={`${titleId}-audience`}
                  data-testid="launch-wizard-demo-audience"
                  className="wk-field"
                  value={draft.demoAudience}
                  maxLength={DEMO_AUDIENCE_MAX}
                  placeholder="Or say who, in your words"
                  onChange={(e) => update({ demoAudience: e.target.value })}
                />
              </div>
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">What it should show</span>
                <textarea
                  data-testid="launch-wizard-demo-show"
                  className="wk-field"
                  rows={3}
                  maxLength={DEMO_SHOW_MAX}
                  value={draft.intent}
                  placeholder="The story, step by step: where it starts, what someone does, where it ends"
                  onChange={(e) => update({ intent: e.target.value })}
                />
              </label>
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">Project</span>
                <select
                  data-testid="launch-wizard-demo-project"
                  className="wk-field"
                  value={filedProject ?? ''}
                  onChange={(e) => update({ projectId: e.target.value === '' ? null : e.target.value })}
                >
                  <option value="">Not in a project</option>
                  {projects.filter((p) => p.id !== UNFILED_MOUNT && p.status !== 'archived').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  {filedProject !== null && !projects.some((p) => p.id === filedProject && p.status !== 'archived') && <option value={filedProject}>This project</option>}
                </select>
                <span className="wk-field-note">Optional. The video is listed with the project’s other work.</span>
              </label>
            </div>
          )}

          {step === 'requirements' && (
            <div className="wk-launch-wizard-reqs" data-testid="launch-wizard-requirements">
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">Project</span>
                <select
                  data-testid="launch-wizard-draft-project"
                  data-autofocus={draft.projectId === null ? 'true' : undefined}
                  className="wk-field"
                  value={draft.projectId ?? ''}
                  onChange={(e) => update({ projectId: e.target.value === '' ? null : e.target.value, requirements: [] })}
                >
                  <option value="">Choose a project…</option>
                  {projects.filter((p) => p.id !== 'default' && p.status !== 'archived').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  {/* Opened from a project the list has not read yet (or no longer lists): it stays the choice, never silently blank. */}
                  {draft.projectId !== null && !projects.some((p) => p.id === draft.projectId && p.id !== 'default' && p.status !== 'archived') && <option value={draft.projectId}>This project</option>}
                </select>
                <span className="wk-field-note">The requirements come from this project’s repositories.</span>
              </label>
              {/* What is chosen sits above the list (codex on S5), not under a long one. */}
              <p data-testid="launch-wizard-chosen" className="wk-field-note" aria-live="polite">
                {draft.requirements.length === 0 ? `Choose the requirements to draft from (at most ${COMPOSE_MAX}).`
                  : `${draft.requirements.length} ${draft.requirements.length === 1 ? 'requirement' : 'requirements'} chosen${draft.requirements.length >= COMPOSE_MAX ? ', the most one draft takes' : ''}.`}
                {draft.requirements.length > 0 && <> <button type="button" data-testid="launch-wizard-clear" onClick={() => update({ requirements: [] })} className="wk-btn wk-btn--quiet wk-btn--sm">Clear</button></>}
              </p>
              {draft.projectId !== null && draft.projectId !== 'default' && (
                <RequirementsBrowser projectId={draft.projectId} navigate={(p) => { closeStore(); navigate?.(p); }}
                  selection={{ chosen, onToggle: toggleReq, max: COMPOSE_MAX }} data-testid="launch-wizard-requirements-browser" />
              )}
              <label className="wk-launch-wizard-field">
                <span className="wk-field-label">Instructions for the draft</span>
                <textarea data-testid="launch-wizard-draft-instructions" className="wk-field" rows={2} maxLength={INSTRUCTIONS_MAX}
                  value={draft.intent} onChange={(e) => update({ intent: e.target.value })} placeholder="Optional: how to group the requirements" />
                <span className="wk-field-note">The draft opens in a session for review and approval. Nothing is published.</span>
              </label>
            </div>
          )}

          {step === 'review' && drafting && (
            <dl className="wk-launch-wizard-review" data-testid="launch-wizard-review">
              <div><dt>Job</dt><dd>Draft epics</dd></div>
              <div><dt>Project</dt><dd>{projectName ?? 'No project'}</dd></div>
              <div><dt>Requirements</dt><dd>{draft.requirements.map((r) => r.title).join(' · ')}</dd></div>
              {draft.intent.trim() !== '' && <div><dt>Instructions</dt><dd className="wk-launch-wizard-review-intent">{draft.intent.trim()}</dd></div>}
            </dl>
          )}

          {step === 'review' && demoing && (
            <dl className="wk-launch-wizard-review" data-testid="launch-wizard-review">
              <div><dt>Job</dt><dd>Demo video</dd></div>
              <div><dt>App</dt><dd className="wk-launch-wizard-review-intent">{draft.demoUrl.trim()}</dd></div>
              <div><dt>For</dt><dd className="wk-launch-wizard-review-intent">{draft.demoAudience.trim()}</dd></div>
              <div><dt>Shows</dt><dd className="wk-launch-wizard-review-intent">{draft.intent.trim()}</dd></div>
              <div><dt>Project</dt><dd>{projectName ?? 'Not in a project'}</dd></div>
              {seats.length > 0 && <div><dt>Helpers</dt><dd>{seats.map(seatLabel).join(', ')}</dd></div>}
              <div><dt>Ask me</dt><dd>After the plan and after the review</dd></div>
              {offerReduced && draft.reduced && <div><dt>Checks</dt><dd>Reduced assurance (one helper records and reviews)</dd></div>}
            </dl>
          )}

          {step === 'review' && !drafting && !demoing && (
            <dl className="wk-launch-wizard-review" data-testid="launch-wizard-review">
              <div><dt>Job</dt><dd>{workflowLabel(row?.key ?? draft.workflowId ?? '')}</dd></div>
              <div><dt>What</dt><dd className="wk-launch-wizard-review-intent">{draft.intent.trim()}</dd></div>
              <div><dt>Where</dt><dd>{repoName ?? 'No repository'}{projectName !== null ? ` · in ${projectName}` : ''}</dd></div>
              {seats.length > 0 && <div><dt>Helpers</dt><dd>{seats.map(seatLabel).join(', ')}</dd></div>}
              <div><dt>Ask me</dt><dd>{gatePostureWord(draft.confirmMode, beforeOrd, deliver === 'pr' && deliverGateCap === true)}</dd></div>
              {deliverVisible && <div><dt>Delivery</dt><dd>{draft.deliverOn ? 'A pull request when done' : 'Stays on its branch'}</dd></div>}
              {offerReduced && draft.reduced && <div><dt>Checks</dt><dd>Reduced assurance (one helper builds and reviews)</dd></div>}
              {offerQe && !qeOff && draft.skipQe && <div><dt>QE acceptance</dt><dd>Skipped: {draft.skipQeReason.trim()}</dd></div>}
              {offerQe && qeOff && <div data-testid="launch-wizard-review-qe-off"><dt>QE acceptance</dt><dd>{force ? 'Required for this job' : 'Off on this computer (the job says it was skipped)'}</dd></div>}
            </dl>
          )}

          {/* A launch refused because QE acceptance is required: why, and the way to the setting (the
              wizard closes on the way, keeping the draft). */}
          {error !== null && qeRefused !== null && (
            <QeRefusalWarning kind="launch" refusalKey={qeRefused.key} detail={qeRefused.detail} forced={qeRefused.forced} testId="launch-wizard-qe-refused"
              navigate={(p) => { closeStore(); (navigate ?? goToPath)(p); }} />
          )}
          {error !== null && qeRefused === null && (
            <div role="alert" data-testid="launch-wizard-error" className="wk-composer-note wk-composer-note--bad">
              Couldn’t launch this. Your choices are kept, so you can try again.
              <TechDetails text={error} data-testid="launch-wizard-error-detail" />
            </div>
          )}
        </div>

        <footer className="wk-launch-wizard-foot">
          {step === 'workflow' && <p className="wk-field-note wk-launch-wizard-keys" data-testid="launch-wizard-keys">Arrow keys move between the jobs; Enter picks one.</p>}
          {step === 'workflow' && (
            <div className="wk-launch-wizard-skip" data-testid="launch-wizard-skip">
              <label className="wk-launch-wizard-skip-label">
                <input type="checkbox" data-testid="launch-wizard-skip-toggle" aria-describedby="launch-wizard-skip-note" checked={startInChat}
                  onChange={(e) => setStartInChat(e.target.checked)} />
                Don’t show this again — start in chat
              </label>
              <p id="launch-wizard-skip-note" className="wk-field-note">You can turn New job back on in Settings → View.</p>
            </div>
          )}
          {(step === 'review' ? launchBlocker : blocker) !== null && step !== 'workflow' && <p className="wk-field-note" data-testid="launch-wizard-blocker" role="status">{step === 'review' ? launchBlocker : blocker}</p>}
          <div className="wk-launch-wizard-actions">
            {step !== 'workflow' && step !== 'what' && step !== 'requirements' && step !== 'demo' && (
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="launch-wizard-back" onClick={goBack}>Back</button>
            )}
            {(step === 'what' || step === 'requirements' || step === 'demo') && (
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="launch-wizard-change" onClick={() => setStep('workflow')}>Change job</button>
            )}
            {step === 'review' ? (
              <button type="button" className="wk-btn wk-btn--primary" data-testid="launch-wizard-launch" disabled={launching || launchBlocker !== null} onClick={() => { void launch(); }}>
                {launching ? 'Launching…' : error !== null ? 'Try again' : 'Launch'}
              </button>
            ) : step !== 'workflow' && (
              <button type="button" className="wk-btn wk-btn--primary" data-testid="launch-wizard-next" disabled={blocker !== null} onClick={goNext}>Next</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
