import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { launchChatId } from './launchChatId.js';
import { api, apiWire } from '../../api/client.js';
import { qeRefusalOf } from '../../board/qeRefusal.js';
import { goToPath, QeRefusalWarning } from '../QeRefusalWarning.js';
import type { RepoEntry } from '../../api/types.js';
import { assuranceNoticeOf, gatePostureWord, launchLead, reducedRelaunchBody, workflowLaunchBody, type LaunchAssuranceNotice } from '../../board/launchModel.js';
import type { LaunchBodyWithDeliver } from '../../api/types.js';
import { postureFieldsOfBody, postureKey, powerToSend } from '../../board/launchPosture.js';
import { usePosturePreview } from '../../hooks/usePosturePreview.js';
import { qeAcceptanceSetting, workflowRequiresQe } from '../../board/assuranceModel.js';
import { QeOffNote } from '../QeOffNote.js';
import { workflowItems } from '../../board/workflowCommand.js';
import { sessionPath } from '../../board/sessionModel.js';
import { seatLabel, userSeats } from '../../board/seatNames.js';
import { NO_WORKER_PICKED, onlyReviewersChosen, REVIEWS_ONLY_WORDS, reviewsOnly, seatCanCarry, seatJoinStanding, WORKS_ONLY_NOTE, WORKS_ONLY_WORDS, worksOnly } from '../gateVerdictModel.js';
import { COMPOSER_DEFAULT_GATE_POSTURE } from '../composerDefaults.js';
import type { ConfirmMode } from '../ContextPopover.js';
import { useModalEscape } from '../Modal.js';
import { QeAcceptanceOptions, ReducedAssuranceOptIn } from '../session/AssuranceReceipt.js';
import { REDUCED_RELAUNCH_WORDS } from '../session/GateRow.js';
import { Switch } from '../ui/Switch.js';
import { TechDetails } from '../ui/TechDetails.js';
import { StandInChoice } from '../StandInChoice.js';
import { helperNamer, saveStandInsEveryJob, standInChoiceOf, standInRelaunchBody, type StandInChoiceId, type StandInChoiceRefusal } from '../../board/standIn.js';
import { AGENTS_PATH } from '../../hooks/useRoute.js';
import { useRoster } from '../../hooks/useRoster.js';
import { useSignInHere } from '../agents/useSignInHere.js';
import { useLaunchPreview } from '../../hooks/useLaunchPlan.js';
import { useCapabilities } from '../../store/capabilities.js';
import { isOptInKey, OPT_IN_NOTE, seatOff, useLaunchSeats } from '../../store/composerSeats.js';
import { loadPresets, usePlanCatalog } from '../../store/planCatalog.js';
import { useProjectsStore } from '../../store/projects.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { useWorkflowDefs } from '../../store/workflowCache.js';
import { workflowLabel } from '../../board/workflowNames.js';
import { DEMO_VIDEO_ID, DRAFT_EPICS_ID, useLaunchWizard, withJobKind, type LaunchDraft } from '../../store/launchWizard.js';
import { openChatFlow } from '../../store/chatFlow.js';
import { startCatalogEntry } from '../../store/startCatalogEntry.js';
import { useComposerPrefsStore } from '../../store/composerPrefs.js';
import { launchDemo } from '../../api/demo.js';
import { DEMO_AUDIENCES, DEMO_AUDIENCE_MAX, DEMO_SHOW_MAX, DEMO_URL_MAX, demoBlocker } from '../../board/demoLaunch.js';
import { UNFILED_MOUNT } from '../../api/interactive.js';
import { composeProduct } from '../../api/product.js';
import { COMPOSE_MAX, RequirementsBrowser, reqKey, type ChosenRequirement } from '../product/RequirementsBrowser.js';
import { aboutMinutes, jobCatalogView, needsLine, needsRepo, startsInline, type CatalogEntry, type CatalogView } from '../../board/workflowCatalog.js';
import { startInNewChat, workflowChipFor } from '../../store/inlineStart.js';
import { addAboutChip, clearAboutChips } from '../../store/composerChips.js';
import { pageComposerKey, seedComposer } from '../../store/composerSeed.js';
import { useWorkflowCatalog } from '../../store/workflowCatalog.js';
import { WorkflowCatalog } from './WorkflowCatalog.js';

type Step = 'workflow' | 'what' | 'where' | 'options' | 'requirements' | 'demo' | 'review';
const STEP_TITLE: Record<Step, string> = {
  workflow: 'Choose a workflow',
  what: 'The work',
  where: 'Where does it work?',
  options: 'How should it run?',
  requirements: 'Choose the requirements',
  demo: 'The video',
  review: 'Check and launch',
};
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
export function LaunchWizard({ navigate, cardsStartInChat = true }: {
  navigate?: (path: string) => void;
  /** ux-tonight: a workflow card picked in the catalog step starts in a chat (the default, what the app mounts). False
   *  hands the pick to the shaping steps below, which named openers walk; their tests pin them that way. */
  cardsStartInChat?: boolean;
}): React.ReactElement | null {
  const open = useLaunchWizard((s) => s.open);
  const draft = useLaunchWizard((s) => s.draft);
  if (!open || draft === null) return null;
  return <WizardDialog draft={draft} navigate={navigate} cardsStartInChat={cardsStartInChat} />;
}

function WizardDialog({ draft, navigate, cardsStartInChat }: { draft: LaunchDraft; navigate?: ((path: string) => void) | undefined; cardsStartInChat: boolean }): React.ReactElement {
  const { close: closeStore, update, finish } = useLaunchWizard.getState();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // codex r1: a launch in flight holds the dialog open (no second POST from a reopened draft).
  const launchingRef = useRef(false);
  /** studio#1239: a launch crew answered with an `assuranceNotice` — the job started; the dialog says what crew said and
   *  offers the explicit relaunch in reduced assurance before it goes to the job. */
  const [launched, setLaunched] = useState<{ notice: LaunchAssuranceNotice; body: LaunchBodyWithDeliver; dest: string } | null>(null);
  const [confirmReduced, setConfirmReduced] = useState(false);
  // The draft the dialog shows (codex r2): another job opened over it starts without this one's notice, and a launch
  // answered after its draft was replaced shows nothing here.
  const draftSig = JSON.stringify([draft.workflowId, draft.composerKey, draft.catalogEntryId, draft.projectId]);
  const draftSigNow = useRef(draftSig);
  draftSigNow.current = draftSig;
  useEffect(() => { setLaunched(null); setConfirmReduced(false); }, [draftSig]);
  // A launched job's draft is done: closing ends it (never a second launch from a kept draft).
  const close = (): void => { if (launchingRef.current) return; if (launched !== null) finish(); else closeStore(); };
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
  const rows = useMemo(() => workflowItems('', defs, presets, Number.POSITIVE_INFINITY), [defs, presets]);
  // The catalog (crew's, or today's list on an older daemon), with studio's own kinds added.
  const catalogLoad = useWorkflowCatalog(draft.projectId === null || draft.projectId === '' || draft.projectId === UNFILED_MOUNT ? null : draft.projectId);
  // Loading, or a failed read on a daemon that serves a catalog: no stand-in (today's list is not its catalog).
  // The same view every box's `/` menu reads (slash-catalog), so both list the same kinds of job.
  const read: CatalogView | null = useMemo(() => jobCatalogView(catalogLoad, defs, presets), [catalogLoad, defs, presets]);
  // A project change mid-shaping re-reads the catalog (its usage and presets): the last one read stays
  // shown meanwhile, so the picked workflow's rules (repository, words) never flip while it loads.
  // Nor does a failed read for the new project swap crew's catalog for today's list (xreview r2): once
  // this daemon has answered with its catalog, the list never replaces it in this open of the modal.
  const catalogKey = draft.projectId === null || draft.projectId === '' || draft.projectId === UNFILED_MOUNT ? '' : draft.projectId;
  // (Only this project's own answer replaces what is shown: crew's catalog, or a confirmed older daemon.)
  const lastRead = useRef<{ view: CatalogView; key: string } | null>(null);
  if (read !== null) lastRead.current = { view: read, key: catalogKey };
  const catalog = lastRead.current?.view ?? read;
  // What is shown may be the previous project's catalog; it does not say what THIS project offers, so a
  // card picked from it waits for this project's read before it launches (codex r3).
  // (Only crew's catalog says what a project offers; today's list on an older daemon authorizes nothing.)
  // A draft waits until THIS project's answer is the one shown (crew's catalog, or a confirmed older
  // daemon): while the first read is out, after a project change, after a failed read, across a close
  // and reopen, for every draft (xreview r4-r6).
  // (And while this project's read is out again after a failure, or failed: what is shown is not its answer, codex r7.)
  const scopePending = lastRead.current === null || lastRead.current.key !== catalogKey
    || catalogLoad.state === 'loading' || catalogLoad.state === 'error';
  const thisCatalog = !scopePending && lastRead.current!.view.source === 'catalog';
  const holdLine = catalogLoad.state === 'error'
    ? 'Couldn’t check this workflow for the chosen project. Close New job and open it again to retry.'
    : lastRead.current === null ? 'Reading the workflows…' : 'Checking this workflow for the chosen project…';
  const [now] = useState(() => Date.now());
  const roster = useRoster();
  // A greyed helper's Sign in opens its sign-in modal over the wizard; closing it re-reads the roster,
  // and the helpers below re-derive from it (a helper that signed in is picked by default again).
  const signIn = useSignInHere();
  const projects = useProjectsStore((s) => s.projects) ?? [];
  const dropped = useLaunchSeats((s) => s.dropped);
  const picked = useLaunchSeats((s) => s.picked);
  const toggleSeat = useLaunchSeats((s) => s.toggle);
  const deliverGateCap = useCapabilities((s) => s.deliverGate);
  const reducedCap = useCapabilities((s) => s.reducedAssurance);
  const leadCap = useCapabilities((s) => s.launchPrimary);
  const powerCap = useCapabilities((s) => s.powerMode);
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
  /** DES-STANDIN-001 S0: crew asked how to check this job (too few helpers signed in); nothing started. */
  // A choice launches the job as the form shows it THEN, through `launch` itself (codex r1+delta on #1361): nothing is
  // replayed from the refused attempt, so an edit made after the refusal (or during the settings save) is what is sent.
  const [standIn, setStandIn] = useState<StandInChoiceRefusal | null>(null);
  const [standInBusy, setStandInBusy] = useState<StandInChoiceId | null>(null);
  const [standInError, setStandInError] = useState<string | null>(null);
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
  // The card picked from the catalog is THE card: if it is gone or now launches something else, the
  // draft is blocked, never matched to another card (xreview r2). A draft opened by a workflow id
  // (a composer's /workflow-<key>, Learn, Settings) takes the card for that workflow, an offered one first.
  const pickedCard = draft.catalogEntryId === null || catalog === null ? null : (catalog.entries.find((e) => e.id === draft.catalogEntryId) ?? null);
  const byWorkflow = draft.workflowId === null || catalog === null ? [] : catalog.entries.filter((e) => e.launchId === draft.workflowId || e.id === draft.workflowId);
  const entry = draft.workflowId === null ? null
    : draft.catalogEntryId !== null && catalog !== null ? pickedCard
      : (byWorkflow.find((e) => e.status === 'ready' && e.launchId === draft.workflowId) ?? byWorkflow[0] ?? null);
  const offered = (e: CatalogEntry): boolean =>
    e.status === 'ready' && e.launchId === draft.workflowId && (['run', 'demo', 'compose'] as const).includes(e.launchKind as 'run');
  // The catalog may have changed since the pick (a resumed draft, a re-read): what is no longer offered
  // is never launched (codex r1).
  // With crew's catalog for this project in, every draft (picked or opened by id) needs an offered card.
  const entryBlocker = draft.workflowId !== null && catalog !== null
    // And a card picked from a list (crew's or today's) that is gone blocks under any list (agy r7).
    && (((thisCatalog || draft.catalogEntryId !== null) && entry === null) || (entry !== null && !offered(entry)))
    ? 'This workflow is not available now. Change job to pick another.' : null;
  // A workflow the catalog says works without a repository does not ask for one; any other keeps
  // today's rule (an unknown workflow, a preset, an older daemon's list: a repository is required).
  const repoRequired = entry === null ? true : needsRepo(entry);
  // A workflow whose card says it works within a project (crew: `needs` has `project`) asks for one.
  const projectRequired = entry !== null && entry.launchKind === 'run' && entry.needs.includes('project');
  const jobName = entry?.title ?? workflowLabel(row?.key ?? draft.workflowId ?? '');
  // The catalog's form: its first text input names the words box; any other text input is listed under it.
  const textInputs = (entry?.inputs ?? []).filter((i) => i.kind === 'text');
  // Words are required unless the catalog says otherwise: a workflow whose form has no text input,
  // or whose first one is optional. Crew still needs a problem (`problem` min 1), so a launch with no
  // words sends the workflow's own summary.
  const wordsOptional = entry !== null && entry.launchKind === 'run' && entry.form && textInputs.every((i) => !i.required);
  const wordsLabel = textInputs[0]?.label ?? (wordsOptional ? 'Anything to focus on?' : 'What do you want done?');
  const moreWords = textInputs.slice(1);
  const problemText = draft.intent.trim() !== '' || entry === null ? draft.intent : (entry.summary.split('. ')[0] || entry.title);
  const def = (defs ?? []).find((d) => d.id === draft.workflowId) ?? null;
  const offerQe = qeCap && !demoing && workflowRequiresQe(def);

  // Where: the user's pick, else the repository the opening context names, else a sole repository.
  const defaultRepo = useMemo(() => {
    const list = repos ?? [];
    const ctx = draft.contextRepo === null ? undefined : list.find((r) => r.id === draft.contextRepo || r.name === draft.contextRepo);
    if (ctx !== undefined) return ctx.id;
    return list.length === 1 ? list[0]?.id ?? null : null;
  }, [repos, draft.contextRepo]);
  // A workflow that works without a repository starts with none (it is offered, not assumed).
  const repoRef = draft.repoRef !== null ? (draft.repoRef === '' ? null : draft.repoRef) : repoRequired ? defaultRepo : null;
  // A named def that runs no code is not a delivering launch; an unknown one (a preset) may deliver.
  // A demo video never delivers (crew launches it with `deliver: 'none'`) and its gates are the preset's own.
  // A job with no repository has nothing to deliver a pull request to.
  const deliverVisible = draft.workflowId !== null && !demoing && repoRef !== null && (def === null ? true : def.phases.some((p) => p.executes_code));
  const repoName = repoRef === null ? null : ((repos ?? []).find((r) => r.id === repoRef)?.name ?? repoRef);
  // The unfiled mount (`default`) is "not in a project" wherever the wizard shows the choice.
  const filedProject = draft.projectId === UNFILED_MOUNT ? null : draft.projectId;
  const projectName = filedProject === null ? null : (projects.find((p) => p.id === filedProject)?.name ?? null);

  // Options: the helpers a workflow launch convenes (council-enabled, addressable), minus the dropped.
  // studio#1311: a work-only helper (council off, seated for work) is listed too, off until the person turns it on.
  const eligible = useMemo(() => userSeats(roster).filter((s) => s.enabled_for_council || worksOnly(s)), [roster]);
  const workOnly = useMemo(() => new Set(eligible.filter((s) => worksOnly(s)).map((s) => s.key)), [eligible]);
  // (PRODUCT-WORKS J4) Only a helper that can take work now is picked by default: one that is signed
  // out, benched (out of quota until its lift time) or refused work by this computer is shown greyed
  // out with why, and joins the job only when the operator turns it on. A reviewer-only seat joins: it votes (the
  // agent judge is a work role), and is never the lead (studio#856).
  const unusable = useMemo(() => new Map(eligible.flatMap((s) => {
    const st = seatJoinStanding(s);
    return st.state === 'ready' || st.state === 'unknown' ? [] : [[s.key, st.state === 'signed-out' ? 'signed out' : st.note] as const];
  })), [eligible]);
  const offUnlessPicked = (key: string): boolean => unusable.has(key) || workOnly.has(key);
  const isOff = (key: string): boolean => (offUnlessPicked(key) ? !picked.includes(key) : seatOff(key, dropped, picked));
  const seats = eligible.filter((s) => !isOff(s.key));
  const offerReduced = reducedCap && seats.length === 1;
  // The Lead agent (DES-TEAMING-002 §8.1): offered when the daemon takes it and there is a choice to
  // make; a pick whose helper was turned off reads as Random again (never a stale seat sent).
  // Only a seat that can take work may lead: crew refuses a signed-out, benched or not-work-eligible lead by name.
  const leadable = seats.filter((s) => s.signed_in !== false && seatCanCarry(s));
  const offerLead = leadCap && leadable.length > 1;
  // Power mode is a build posture: asked of crew for a workflow launch on a daemon that runs it (not Draft epics, not a demo).
  const offerPower = powerCap && !drafting && !demoing;
  const lead = launchLead(offerLead ? draft.lead : null, leadable, leadCap);
  const beforeOrd = COMPOSER_DEFAULT_GATE_POSTURE.beforeOrd;
  const autoDeliver = draft.confirmMode === 'none';
  const deliver: 'pr' | 'none' | null = deliverVisible ? (draft.deliverOn ? 'pr' : 'none') : null;
  // studio#1305: whether this job runs in power mode is crew's decision for the body Launch sends (`POST /runs/preview`,
  // `board/launchPosture.ts`), read as the composer reads it: the fields are the launch body's own (the one builder), the
  // switch reads crew's answer, and Launch sends `power` only as crew answered for exactly those fields. Crew runs a
  // registered (non-preset) workflow or a launch with no repository phased, and says why (`powerNotice`). The person's
  // switch is the `power` asked about (unset: crew applies Settings' "Power mode for new jobs").
  const powerChoice: boolean | undefined = draft.power ?? undefined;
  const postureFields = postureFieldsOfBody(workflowLaunchBody({
    workflowId: draft.workflowId ?? '', intent: '', seats: [], repoRef, projectId: draft.projectId, humanConfirm: undefined,
    deliver, autoDeliverGate: autoDeliver && deliverGateCap === true, reducedAssurance: false, skipQeReason: null, chatId: null,
  }));
  const posture = usePosturePreview(postureFields, powerChoice, offerPower && draft.workflowId !== null);
  const crewPosture = posture.answer.status === 'ready' ? posture.answer.posture : null;
  const powerOn = offerPower && crewPosture?.power === true;
  // While crew is asked about a change, the switch keeps the person's choice and says it is being checked (nothing
  // about the run is promised until crew answers); the launch waits for crew's word (below). No answer (a failed
  // preview, an older daemon): Off, as Launch then runs it (codex r1, r2).
  const powerPending = offerPower && posture.answer.status === 'loading';
  const switchOn = crewPosture !== null ? powerOn : powerPending && powerChoice === true;
  /** A power run asks once, at hand-off, only when it delivers with a person (crew's `deliver` and `autoDeliver`). */
  const powerAsksAtHandOff = crewPosture !== null && crewPosture.deliver === 'pr' && !crewPosture.autoDeliver;
  const powerUnchecked: 'failed' | 'unsupported' | null = !offerPower ? null : posture.answer.status === 'failed' ? 'failed'
    : powerChoice !== false && posture.answer.status === 'none' ? 'unsupported' : null;
  const powerNotice = offerPower && crewPosture !== null && !crewPosture.power ? (crewPosture.powerNotice ?? null) : null;
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
    step !== 'workflow' && entryBlocker !== null ? entryBlocker
    // Nothing to shape this draft by (the chosen project's catalog is not in yet, and none was shown in
    // this open): every step says why it waits, rather than a rule guessed without the catalog.
    : step !== 'workflow' && scopePending && catalog === null ? holdLine
    : step === 'requirements' ? draftBlocker
    : step === 'demo' ? demoProblem
    : step === 'workflow' ? (draft.workflowId === null ? 'Choose the kind of job.' : null)
      : step === 'what' ? (draft.intent.trim() === '' && !wordsOptional ? 'Say what you want done.' : null)
        : step === 'where' ? (repoRequired && repoRef === null ? 'Choose the repository this works in.'
          : projectRequired && filedProject === null ? 'Choose the project this works in.' : null)
          : step === 'options' ? (eligible.length > 0 && seats.length === 0 ? 'Turn on at least one helper.'
            : onlyReviewersChosen(seats) ? NO_WORKER_PICKED
            : offerQe && !qeOff && draft.skipQe && draft.skipQeReason.trim() === '' ? 'Say why QE acceptance is skipped.' : null)
            : null;
  // Review re-checks every rule (codex r1: another tab may have dropped the last helper meanwhile).
  const launchBlocker: string | null =
    entryBlocker !== null ? entryBlocker
    : scopePending ? holdLine
    : projectRequired && filedProject === null ? 'Choose the project this works in.'
    : drafting ? draftBlocker
    : demoing ? (demoProblem ?? (eligible.length > 0 && seats.length === 0 ? 'Turn on at least one helper.' : onlyReviewersChosen(seats) ? NO_WORKER_PICKED : null))
    : draft.workflowId === null ? 'Choose the kind of job.'
      : draft.intent.trim() === '' && !wordsOptional ? 'Say what you want done.'
        : repoRequired && repoRef === null ? 'Choose the repository this works in.'
          : eligible.length > 0 && seats.length === 0 ? 'Turn on at least one helper.'
            : onlyReviewersChosen(seats) ? NO_WORKER_PICKED
            : offerQe && !qeOff && draft.skipQe && draft.skipQeReason.trim() === '' ? 'Say why QE acceptance is skipped.'
              // studio#1305: Launch sends `power` as crew answered; while it is asked, nothing is sent on a guess.
              : offerPower && posture.answer.status === 'loading' ? 'Checking how this job will run…' : null;
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
    el?.scrollIntoView?.({ block: 'nearest' });
    autoFocused.current = el ?? null;
  }, [step]);
  // The catalog may arrive after focus went to the search box: focus then moves to what the step
  // names (the job already picked) — only while focus is still where the wizard put it (codex r1:
  // a card the user has moved to keeps its focus when the catalog arrives).
  const catalogCount = step === 'workflow' ? (catalog?.entries.length ?? -1) : -2;
  useEffect(() => {
    if (catalogCount < 0) return;
    const active = document.activeElement;
    if (active !== autoFocused.current && active !== document.body && active !== dialogRef.current) return;
    // Someone already typing in the search box keeps it.
    if (active instanceof HTMLInputElement && active.dataset.testid === 'launch-catalog-search' && active.value !== '') return;
    const el = dialogRef.current?.querySelector<HTMLElement>('[data-testid="launch-catalog"] [data-autofocus="true"]') ?? null;
    if (el === null || el === active) return;
    el.focus();
    el.scrollIntoView?.({ block: 'nearest' });
    autoFocused.current = el;
  }, [catalogCount]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return;
    const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select, textarea, input, a[href], summary') ?? [])];
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  // How each entry starts (wf-catalog WIRE `launch.kind`), the one handler a box's `/` pick uses too:
  // a run, studio's Demo video or Draft epics walk the wizard; a document opens New document on its
  // list (the words as its brief); chat is the chat flow.
  const pickEntry = (e: CatalogEntry): void => {
    // codex r1: a launch in flight holds the dialog (nothing leaves it for another surface).
    if (launchingRef.current) return;
    startCatalogEntry(e, {
      projectId: filedProject, intent: draft.intent, navigate: navigate ?? goToPath, leave: closeStore,
      // ux-tonight (operator 2026-11-04: "clicking on a workflow opens a modal rather than starting an inline chat,
      // needs to be removed and chat done inline"): a workflow or a new app starts in a chat. The chat New job was
      // opened from (its composer on screen), else a new chat on its own page; the card goes on its composer with
      // the words typed so far, and the composer asks for the rest. Demo video and Draft epics keep their steps here.
      shape: (x) => {
        if (!cardsStartInChat || !startsInline(x)) { pickCard(x.launchId, x.id); return; }
        const key = draft.composerKey;
        // Only a composer that IS a chat (never the desk, a run's page or a repository's) takes it (codex r1).
        const here = key !== null && launchChatId(key, true) !== null && pageComposerKey() === key ? key : null;
        // Each kind keeps its own words (studio#767's rule, `withJobKind`): a Demo video's brief is not a bug's.
        const words = withJobKind(draft, x.launchId).intent;
        finish();
        if (here !== null) {
          addAboutChip(here, workflowChipFor(x));
          // A draft the chat already holds stays unless New job brings words of its own (codex r2).
          if (words.trim() !== '') seedComposer(here, words);
        } else {
          startInNewChat(x, { projectId: filedProject, intent: words });
        }
      },
    });
  };
  const pickCard = (id: string, entryId: string | null = null): void => {
    // codex r1: another kind of job starts its own options; studio#767: and its own words.
    if (id !== draft.workflowId) update({ ...withJobKind(draft, id), catalogEntryId: entryId });
    // Another card for the same workflow: its own options and repository choice (the words are the workflow's).
    else if (entryId !== draft.catalogEntryId) update({ catalogEntryId: entryId, reduced: false, skipQe: false, skipQeReason: '', repoRef: null });
    setStep(id === DRAFT_EPICS_ID ? 'requirements' : id === DEMO_VIDEO_ID ? 'demo' : 'what');
  };

  // The newest render's blocker, for a launch that awaited something: the catalog may have stopped
  // offering the workflow meanwhile (codex r2), and the launch must not post what is no longer offered.
  const blockerNow = useRef<string | null>(null);
  blockerNow.current = launchBlocker;
  // And what is sent is what was checked (codex r4): if the request itself changed while the preview
  // was awaited (a catalog refresh re-derived the repository, say), the launch stops for a fresh look.
  const requestNow = useRef('');
  requestNow.current = JSON.stringify([draft.workflowId, draft.catalogEntryId, repoRef, draft.projectId, problemText.trim(),
    // Whole seats, as `clisJson` sends them (codex r5: a roster refresh can change a seat under one key).
    deliver, seats, lead, offerPower ? powerOn : null, offerReduced && draft.reduced, draft.skipQe, draft.skipQeReason]);
  const resolveConfirmStill = async (): Promise<Awaited<ReturnType<typeof preview.resolveHumanConfirm>>> => {
    const asked = requestNow.current;
    const confirm = await preview.resolveHumanConfirm();
    if (blockerNow.current !== null) throw new Error(blockerNow.current);
    if (requestNow.current !== asked) throw new Error('This job changed while it was being checked. Look it over and launch again.');
    return confirm;
  };

  /** `standInChoice`: the person answered the stand-in card ("this job" adds crew's `retryWith`; "every job" saved the
   *  setting first and sends the request unflagged, DES §4 consentFor). */
  const launch = async (standInChoice?: { refusal: StandInChoiceRefusal; scope: 'job' | 'always' }): Promise<void> => {
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
    // What the form shows as Launch is pressed (studio#1305): crew's answer for these fields, captured now.
    const sigAtLaunch = draftSigNow.current;
    const postureKeyAtLaunch = posture.key;
    const postureAtLaunch = posture.answer;
    launchingRef.current = true;
    setLaunching(true);
    setError(null);
    // A QE refusal speaks for the attempt that drew it; this one is new (codex r1).
    setQeRefused(null);
    // The card stays up while its own choice is carried out; any other launch replaces it.
    if (standInChoice === undefined) { setStandIn(null); setStandInError(null); }
    try {
      const key = draft.composerKey;
      const chatId = launchChatId(key, chatIdOnLaunch);
      const body = workflowLaunchBody({
        workflowId: draft.workflowId,
        intent: problemText,
        seats,
        repoRef,
        projectId: draft.projectId,
        humanConfirm: await resolveConfirmStill(),
        deliver,
        autoDeliverGate: autoDeliver && deliverGateCap === true,
        reducedAssurance: offerReduced && draft.reduced,
        skipQeReason: offerQe && !qeOff && draft.skipQe ? draft.skipQeReason : null,
        chatId,
        primary: lead,
        power: null,
      });
      // `power` as crew previewed it for exactly the fields this body carries; no answer for them runs phased.
      if (offerPower) {
        const shown = postureKey(postureFieldsOfBody(body), powerChoice) === postureKeyAtLaunch && postureAtLaunch.status === 'ready' ? postureAtLaunch.posture : null;
        (body as typeof body & { power?: boolean }).power = powerToSend(true, shown) === true;
      }
      if (offerQe && force && (qeOff || !draft.skipQe)) body.forceQeAcceptance = true;
      forcedRef.current = body.forceQeAcceptance === true;
      if (standInChoice?.scope === 'job') Object.assign(body, standInRelaunchBody(body, standInChoice.refusal));
      const out = await api.launchRun(body);
      const { runId } = out;
      useProvenanceStore.getState().markLaunchedHere(runId);
      if (key !== null) clearAboutChips(key);
      const dest = chatId !== null ? sessionPath(chatId) : sessionPath(`run:${runId}`);
      const notice = assuranceNoticeOf(out);
      if (notice !== null) {
        if (draftSigNow.current === sigAtLaunch) { setConfirmReduced(false); setLaunched({ notice, body, dest }); }
        return;
      }
      finish();
      navigate?.(dest);
    } catch (err) {
      // Too few helpers to check it: the choice, not an error (nothing was created; DES §4).
      const choice = standInChoiceOf(err);
      if (choice !== null) { setStandIn(choice); return; }
      setStandIn(null);
      setError(err instanceof Error ? err.message : String(err));
      attemptRef.current += 1;
      setQeRefused(qeRefusalOf(err) === 'launch' ? { key: `launch:${attemptRef.current}`, detail: apiWire(err), forced: forcedRef.current } : null);
    } finally {
      launchingRef.current = false;
      setLaunching(false);
    }
  };

  // studio#1239: the notice's relaunch, confirmed: the same job in a run of its own, in reduced assurance (`retryWith`).
  const relaunchReduced = async (): Promise<void> => {
    if (launched === null || launchingRef.current) return;
    launchingRef.current = true;
    setLaunching(true);
    setError(null);
    setQeRefused(null);
    try {
      const { runId } = await api.launchRun(reducedRelaunchBody(launched.body, launched.notice));
      useProvenanceStore.getState().markLaunchedHere(runId);
      finish();
      navigate?.(sessionPath(`run:${runId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      launchingRef.current = false;
      setLaunching(false);
    }
  };
  // The launch as THIS render builds it: a choice awaiting the settings save calls the one current when it lands, so an
  // edit made meanwhile is what is sent (codex delta on #1361).
  const launchNow = useRef(launch);
  launchNow.current = launch;
  // DES-STANDIN-001 §2.1 step 3: what each choice does.
  const chooseStandIn = async (id: StandInChoiceId): Promise<void> => {
    if (standIn === null || launchingRef.current || standInBusy !== null) return;
    if (id === 'cancel') { setStandIn(null); setStandInError(null); return; }
    if (id === 'sign_in') { closeStore(); (navigate ?? goToPath)(AGENTS_PATH); return; }
    setStandInBusy(id);
    setStandInError(null);
    try {
      if (id === 'always') {
        // A setting not saved launches nothing and keeps the choices (another one, "this job", still works).
        try { await saveStandInsEveryJob(); } catch (err) { setStandInError(err instanceof Error ? err.message : String(err)); return; }
      }
      await launchNow.current({ refusal: standIn, scope: id });
    } finally {
      setStandInBusy(null);
    }
  };
  const openLaunched = (): void => { if (launched === null || launchingRef.current) return; finish(); navigate?.(launched.dest); };

  const title = drafting ? 'New job: Draft epics' : demoing ? 'New job: Demo video' : draft.workflowId !== null ? `New job: ${jobName}` : 'New job';
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
              {/* first-run C6: a pick here usually continues in a chat (or a form), so the first screen promises no
                  step count it can't keep; the steps a workflow does walk here are counted from its own first one. */}
              {launched !== null ? 'Started'
                : step === 'workflow' && cardsStartInChat
                ? 'Pick what to do. Most jobs continue in a chat, where you say what you want and approve the plan before anything runs.'
                : <>Step {order.indexOf(step) + (draft.workflowId === null || step === 'workflow' ? 1 : 0)} of {draft.workflowId === null || step === 'workflow' ? order.length : order.length - 1}: {STEP_TITLE[step]}</>}
            </p>
          </div>
          <button type="button" className="wk-btn wk-btn--icon wk-btn--quiet" aria-label="Close (your choices are kept)" title="Close (your choices are kept)" data-testid="launch-wizard-close" disabled={launching} onClick={close}>×</button>
        </header>

        <div className="wk-launch-wizard-body" data-testid="launch-wizard-step" data-step={launched !== null ? 'launched' : step}>
          {launched !== null && (
            <div role="status" data-testid="launch-wizard-assurance" data-code={launched.notice.code} className="wk-launch-wizard-field">
              <p className="wk-field-label">The job started, and it will wait for a second helper</p>
              <p className="wk-field-note" data-testid="launch-wizard-assurance-message">{launched.notice.message}</p>
              {reducedCap && (confirmReduced ? (
                <div role="group" aria-label="Start it again with reduced assurance?" data-testid="launch-wizard-assurance-confirm">
                  <p className="wk-field-note">{REDUCED_RELAUNCH_WORDS}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                    <button type="button" className="wk-btn wk-btn--secondary" data-testid="launch-wizard-assurance-cancel" disabled={launching} onClick={() => setConfirmReduced(false)}>Keep only this job</button>
                    <button type="button" className="wk-btn wk-btn--primary" data-testid="launch-wizard-assurance-relaunch" disabled={launching} onClick={() => { void relaunchReduced(); }}>
                      {launching ? 'Starting…' : 'Start it again with reduced assurance'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="launch-wizard-assurance-reduced" onClick={() => setConfirmReduced(true)}>Start it again with reduced assurance…</button>
              ))}
            </div>
          )}
          {launched === null && <>
          {step === 'workflow' && (
            <WorkflowCatalog
              view={catalog}
              contextRepoName={(repos ?? []).find((r) => r.id === draft.contextRepo || r.name === draft.contextRepo)?.name}
              failed={catalogLoad.state === 'error' && catalog === null}
              pickedId={draft.workflowId}
              pickedEntryId={draft.catalogEntryId}
              intent={draft.intent}
              now={now}
              onPick={pickEntry}
              onChat={startChat}
            />
          )}

          {step === 'what' && (
            <label className="wk-launch-wizard-field">
              <span className="wk-field-label">{wordsLabel}{wordsOptional ? ' (optional)' : ''}</span>
              <textarea
                data-testid="launch-wizard-intent"
                data-autofocus="true"
                className="wk-field wk-launch-wizard-intent"
                rows={5}
                value={draft.intent}
                placeholder="Describe the outcome, the way you would to a teammate"
                onChange={(e) => update({ intent: e.target.value })}
              />
              <span className="wk-field-note">The helpers plan the steps from this; you approve the plan before work starts.</span>
            </label>
          )}
          {step === 'what' && entry !== null && (
            <div className="wk-launch-shape" data-testid="launch-wizard-shape">
              <p className="wk-launch-shape-line"><span className="wk-launch-shape-key">You get</span> {entry.gets}</p>
              <p className="wk-launch-shape-line" data-testid="launch-wizard-shape-needs"><span className="wk-launch-shape-key">It needs</span> {needsLine(entry).replace(/^Needs /, '')}{entry.needs.length === 0 ? '' : '. The next steps ask for it.'}</p>
              {(entry.time !== null || entry.cost !== null || entry.medianMinutes !== null) && (
                <p className="wk-launch-shape-line"><span className="wk-launch-shape-key">Usually</span> {[entry.time, entry.cost, entry.medianMinutes !== null ? `your runs took about ${aboutMinutes(entry.medianMinutes)}` : null].filter(Boolean).join(' · ')}</p>
              )}
              {moreWords.length > 0 && (
                <div className="wk-launch-shape-inputs" data-testid="launch-wizard-shape-inputs">
                  <span className="wk-launch-shape-key">Say in your words</span>
                  <ul aria-label="Say these in your words">
                    {moreWords.map((i) => <li key={i.key}>{i.label}{i.required ? '' : ', if it matters'}</li>)}
                  </ul>
                </div>
              )}
            </div>
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
                  <option value="">{repoRequired ? 'Choose a repository…' : 'No repository'}</option>
                  {(repos ?? []).map((r) => <option key={r.id} value={r.id}>{r.name ?? r.id}</option>)}
                </select>
                <span className="wk-field-note" data-testid="launch-wizard-repo-note">{repoRequired
                  ? <>The code this job reads and changes{draft.contextRepo !== null && repoRef === defaultRepo && repoRef !== null ? ' (the one you started from)' : ''}.</>
                  : 'Optional. This workflow works without a repository; pick one if it should read your code.'}</span>
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
                <span className="wk-field-note" data-testid="launch-wizard-project-note">{projectRequired
                  ? 'Required by this workflow: it works within a project.'
                  : 'Optional. Files the job with a project so it shows up there.'}</span>
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
                      const on = !isOff(s.key);
                      const why = unusable.get(s.key);
                      return (
                        <button
                          key={s.key}
                          type="button"
                          data-testid="launch-wizard-seat"
                          data-key={s.key}
                          data-unusable={why !== undefined ? 'true' : undefined}
                          data-autofocus={i === 0 ? 'true' : undefined}
                          aria-pressed={on}
                          aria-describedby={why !== undefined ? 'launch-wizard-unusable-note' : isOptInKey(s.key) ? 'launch-wizard-optin-note' : undefined}
                          title={why !== undefined ? `${seatLabel(s)} cannot take work now: ${why}` : undefined}
                          className={`wk-composer-chip wk-composer-seat${on ? '' : ' wk-composer-seat--off'}${why !== undefined ? ' wk-composer-seat--unusable' : ''}`}
                          onClick={() => toggleSeat(s.key, offUnlessPicked(s.key))}
                        >
                          <span className="wk-composer-seat-name">{seatLabel(s)}</span>
                          {reviewsOnly(s) && <span className="wk-composer-seat-role" data-testid="launch-wizard-seat-role"> · {REVIEWS_ONLY_WORDS}</span>}
                          {workOnly.has(s.key) && <span className="wk-composer-seat-role" data-testid="launch-wizard-seat-role"> · {WORKS_ONLY_WORDS}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {unusable.size > 0 && (
                    <span id="launch-wizard-unusable-note" className="wk-field-note" data-testid="launch-wizard-unusable-note">
                      Not picked, because they cannot take work now: {eligible.filter((s) => unusable.has(s.key)).map((s) => `${seatLabel(s)} (${unusable.get(s.key) || 'unavailable'})`).join(', ')}.{' '}
                      {eligible.filter((s) => unusable.has(s.key)).map((s, _i, all) => (
                        <button key={s.key} type="button" className="wk-btn wk-btn--secondary" data-testid="launch-wizard-signin" data-key={s.key}
                          aria-label={`Sign in to ${seatLabel(s)}`} onClick={() => signIn.open(s.key)}>
                          {all.length === 1 ? 'Sign in ›' : `Sign in to ${seatLabel(s)} ›`}
                        </button>
                      ))}
                      {signIn.modal}
                    </span>
                  )}
                  <span className="wk-field-note">Who plans, builds and checks the work. Different helpers check each other’s work.</span>
                  {workOnly.size > 0 && (
                    <span className="wk-field-note" data-testid="launch-wizard-workonly-note">
                      {eligible.filter((s) => workOnly.has(s.key)).map(seatLabel).join(', ')}: {WORKS_ONLY_NOTE}.
                    </span>
                  )}
                  {eligible.some((s) => isOptInKey(s.key)) && (
                    <span id="launch-wizard-optin-note" className="wk-field-note" data-testid="launch-wizard-optin-note">
                      {eligible.filter((s) => isOptInKey(s.key)).map(seatLabel).join(', ')}: {OPT_IN_NOTE}
                    </span>
                  )}
                </fieldset>
              )}
              {offerLead && !demoing && (
                <label className="wk-launch-wizard-field">
                  <span className="wk-field-label">Lead helper</span>
                  <select
                    data-testid="launch-wizard-lead"
                    className="wk-field"
                    value={lead ?? ''}
                    onChange={(e) => update({ lead: e.target.value === '' ? null : e.target.value })}
                  >
                    <option value="">Random</option>
                    {leadable.map((s) => <option key={s.key} value={s.key}>{seatLabel(s)}</option>)}
                  </select>
                  <span className="wk-field-note">Who leads the job and does every step not handed to another helper. The other helpers watch and check its work.</span>
                </label>
              )}
              {offerPower && (
                <div className="wk-launch-wizard-field pm-launch-power" data-testid="launch-wizard-power" aria-busy={posture.answer.status === 'loading'}>
                  <Switch label={`Power mode: ${powerPending ? 'checking…' : switchOn ? 'On' : 'Off'}`} checked={switchOn} onChange={(v) => update({ power: v })} data-testid="launch-wizard-power-toggle" />
                  <span className="wk-field-note" data-testid="launch-wizard-power-note">{powerPending
                    ? 'Checking with Studio’s service how this job will run…'
                    : powerOn
                    ? `One orchestrator builds it with you in this conversation, re-checked at every commit. Rigor is sized at intake${powerAsksAtHandOff ? ' and applied once, at hand-off' : ''}.`
                    : 'Phased: one helper per step, with a gate after each step the plan declares.'}{draft.power === null && crewPosture !== null && powerNotice === null ? ' Preset from Settings.' : ''}</span>
                </div>
              )}
              {powerNotice !== null && (
                <p className="wk-field-note" role="status" data-testid="launch-wizard-power-notice">Studio’s service says: {powerNotice}.</p>
              )}
              {powerUnchecked !== null && (
                <p className="wk-field-note" role="status" data-testid="launch-wizard-power-unchecked" data-reason={powerUnchecked}>
                  {powerUnchecked === 'failed'
                    ? 'Couldn’t check how this will launch, so it runs phased, with the gate chosen here.'
                    : 'Studio’s service can’t say whether it would use power mode, so it runs phased, with the gate chosen here.'}
                  {powerUnchecked === 'failed' && <>{' '}<button type="button" data-testid="launch-wizard-power-retry" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={posture.retry}>Retry</button></>}
                </p>
              )}
              {demoing ? (
                <p className="wk-field-note" data-testid="launch-wizard-demo-gates">It stops for your yes twice: after the plan (the script and chapters, before anything records) and after the review.</p>
              ) : powerOn ? (
                <p className="wk-field-note" data-testid="launch-wizard-power-gates">{powerAsksAtHandOff
                  ? 'Power mode asks you once, at hand-off, plus anything policy or the QE plan requires.'
                  : 'Power mode has no step gates: it stops only where policy or the QE plan requires.'}</p>
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
              <div><dt>Job</dt><dd>{jobName}</dd></div>
              <div><dt>What</dt><dd className="wk-launch-wizard-review-intent">{problemText.trim()}</dd></div>
              <div><dt>Where</dt><dd>{repoName ?? 'No repository'}{projectName !== null ? ` · in ${projectName}` : ''}</dd></div>
              {seats.length > 0 && <div><dt>Helpers</dt><dd>{seats.map(seatLabel).join(', ')}</dd></div>}
              {offerLead && <div data-testid="launch-wizard-review-lead"><dt>Lead helper</dt><dd>{lead === null ? 'Random (picked when it starts)' : seatLabel(leadable.find((s) => s.key === lead)!)}</dd></div>}
              {offerPower && <div data-testid="launch-wizard-review-power"><dt>Power mode</dt><dd>{powerOn ? `On: one orchestrator${powerAsksAtHandOff ? ', rigor at hand-off' : ''}` : powerNotice !== null ? `Off: phased (${powerNotice})` : 'Off: phased'}</dd></div>}
              <div><dt>Ask me</dt><dd>{powerOn ? (powerAsksAtHandOff ? 'At hand-off' : 'Only where policy requires') : gatePostureWord(draft.confirmMode, beforeOrd, deliver === 'pr' && deliverGateCap === true)}</dd></div>
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
          </>}
          {standIn !== null && launched === null && step === 'review' && (
            <StandInChoice refusal={standIn} name={helperNamer(roster)} busy={standInBusy} error={standInError} testId="launch-wizard-standin"
              onChoose={(id) => { void chooseStandIn(id); }} />
          )}
          {error !== null && qeRefused === null && (
            <div role="alert" data-testid="launch-wizard-error" className="wk-composer-note wk-composer-note--bad">
              {launched !== null ? 'Couldn’t start it again. The first job is still running.' : 'Couldn’t launch this. Your choices are kept, so you can try again.'}
              <TechDetails text={error} data-testid="launch-wizard-error-detail" />
            </div>
          )}
        </div>

        <footer className="wk-launch-wizard-foot">
          {step === 'workflow' && <p className="wk-field-note wk-launch-wizard-keys" data-testid="launch-wizard-keys">Type to search. Arrow keys move between workflows, Enter picks one and Esc closes.</p>}
          {step === 'workflow' && (
            <div className="wk-launch-wizard-skip" data-testid="launch-wizard-skip">
              <label className="wk-launch-wizard-skip-label" title="You can turn New job back on in Settings → View.">
                <input type="checkbox" data-testid="launch-wizard-skip-toggle" aria-describedby="launch-wizard-skip-note" checked={startInChat}
                  onChange={(e) => setStartInChat(e.target.checked)} />
                Don’t show this again — start in chat
              </label>
              <p id="launch-wizard-skip-note" className="wk-field-note">You can turn New job back on in Settings → View.</p>
            </div>
          )}
          {launched === null && (step === 'review' ? launchBlocker : blocker) !== null && step !== 'workflow' && <p className="wk-field-note" data-testid="launch-wizard-blocker" role="status">{step === 'review' ? launchBlocker : blocker}</p>}
          {launched !== null ? (
          <div className="wk-launch-wizard-actions">
            <button type="button" className="wk-btn wk-btn--primary" data-testid="launch-wizard-assurance-open" disabled={launching} onClick={openLaunched}>Open the job</button>
          </div>
          ) : (
          <div className="wk-launch-wizard-actions">
            {step !== 'workflow' && step !== 'what' && step !== 'requirements' && step !== 'demo' && (
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="launch-wizard-back" disabled={launching} onClick={goBack}>Back</button>
            )}
            {(step === 'what' || step === 'requirements' || step === 'demo') && (
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="launch-wizard-change" disabled={launching} onClick={() => setStep('workflow')}>Change job</button>
            )}
            {step === 'review' ? (
              <button type="button" className="wk-btn wk-btn--primary" data-testid="launch-wizard-launch" disabled={launching || launchBlocker !== null} onClick={() => { void launch(); }}>
                {launching ? 'Launching…' : error !== null ? 'Try again' : 'Launch'}
              </button>
            ) : step !== 'workflow' && (
              <button type="button" className="wk-btn wk-btn--primary" data-testid="launch-wizard-next" disabled={blocker !== null} onClick={goNext}>Next</button>
            )}
          </div>
          )}
        </footer>
      </div>
    </div>
  );
}
