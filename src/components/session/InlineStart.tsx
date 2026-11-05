import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { RepoEntry, RosterSeat } from '../../api/types.js';
import { workflowLaunchBody } from '../../board/launchModel.js';
import { sessionPath } from '../../board/sessionModel.js';
import { entryOffered, entryWords, needsProject, needsRepo, type CatalogEntry } from '../../board/workflowCatalog.js';
import { notOfferedLine } from '../../board/slashCatalog.js';
import { WORKFLOWS_FAILED_LINE, WORKFLOWS_LOADING_LINE } from '../../board/workflowCommand.js';
import { registerRepoPath } from '../../hooks/ambientProject.js';
import { useLaunchPreview } from '../../hooks/useLaunchPlan.js';
import { useCapabilities } from '../../store/capabilities.js';
import { chipsOf, removeAboutChip, useComposerChips } from '../../store/composerChips.js';
import { usePlanCatalog } from '../../store/planCatalog.js';
import { startAppByChat } from '../../store/inlineStart.js';
import { useProjectsStore } from '../../store/projects.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { useWorkflowDefs } from '../../store/workflowCache.js';
import { useRoster } from '../../hooks/useRoster.js';
import { COMPOSER_DEFAULT_GATE_POSTURE } from '../composerDefaults.js';
import { launchChatId } from '../launch/launchChatId.js';
import { ReducedAssuranceOptIn } from './AssuranceReceipt.js';

/** What the composer calls on Enter while a card is on it: true when the work started (the composer then clears). */
export interface InlineStartHandle {
  start: (words: string) => Promise<boolean>;
}

/** How many choices a need row offers before "N more" shows the rest. */
const CHOICES_MAX = 6;

/** Starts in flight, by composer: two composers on one chat (the thread's and the full-screen drawer's) share it. */
const inFlight = new Set<string>();

/** The Unfiled mount is "no project" (New job's rule). */
const realProject = (p: string | null | undefined): string | null => (p === undefined || p === null || p === '' || p === 'default' ? null : p);

/**
 * THE START ROW (ux-tonight; DES-CATALOG-002 rev 4 §2.4 "inline needs", the smallest version): shown on a chat's
 * composer while a card is on it. It says what Enter starts and where, asks inline for what the start still needs
 * (a repository, a project) as one-click choices, and on Enter launches into this chat:
 *
 *  - a workflow: `POST /runs` with the chat's id, so its plan, gates, questions and progress are this thread's
 *    (`RunBlock`). Every repository job started here stops at its plan: `humanConfirm` is before its first step
 *    (`before:1`, shifted past the scope step as New job does) and, on a daemon with power mode, `power: false`
 *    (a power run has no plan gate, crew `routes.ts` power-mode rule);
 *  - Apps: a new app by chat, the words its first turn (the Apps page's own path).
 *
 * The choices are client state; the only write is the start itself.
 */
export function InlineStart({
  composerKey, entry, catalogState, sessionRepo, projectId: projectIn, seatKeys, words, navigate, handle, onBlocker,
}: {
  composerKey: string;
  /** The card on the composer, or null while the catalog is read (or the card is gone). */
  entry: CatalogEntry | null;
  catalogState: 'loading' | 'error' | 'ready';
  /** The repository this conversation's work names (the default choice). */
  sessionRepo: string | null;
  /** The project the composer's `@project` chip or its chat names. */
  projectId: string | null;
  /** The helpers the composer's row has on (New job's rule: one that cannot take work joins only when picked). */
  seatKeys: readonly string[];
  words: string;
  navigate: (path: string) => void;
  handle: React.MutableRefObject<InlineStartHandle | null>;
  /** Why Enter cannot start yet (shown by the composer), or null. */
  onBlocker: (blocker: string | null) => void;
}): React.ReactElement {
  const defs = useWorkflowDefs();
  const projects = useProjectsStore((s) => s.projects) ?? [];
  const chatIdOnLaunch = useCapabilities((s) => s.chatIdOnLaunch);
  const reducedCap = useCapabilities((s) => s.reducedAssurance);
  const [reduced, setReduced] = useState(false);
  const [repos, setRepos] = useState<RepoEntry[] | null>(getCachedRepos());
  const [pickedRepo, setPickedRepo] = useState<string | null>(null);
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allChoices, setAllChoices] = useState(false);
  /** The repository picker is open over a default (the session's, a sole one): codex r1, a default must be changeable. */
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entryId = entry?.id ?? null;
  // Another card, or another chat's composer (the page is reused across chats), starts its own choices and consent.
  useEffect(() => { setPickedRepo(null); setPickedProject(null); setError(null); setReduced(false); setChoosing(false); setAllChoices(false); }, [entryId, composerKey]);

  const wantsRepo = entry !== null && entry.launchKind === 'run' && needsRepo(entry);
  const wantsProject = entry !== null && needsProject(entry);
  // Read the repositories afresh when the row opens (one may have been added since the cache was warmed: codex r1).
  useEffect(() => {
    if (!wantsRepo) return undefined;
    let live = true;
    api.listRepos().then((r) => { if (live) setRepos(r.repos); }, () => { if (live) fetchReposCached().then(setRepos, () => setRepos([])); });
    return () => { live = false; };
  }, [wantsRepo]);
  useEffect(() => { if (wantsProject && projects.length === 0) void useProjectsStore.getState().load(); }, [wantsProject, projects.length]);

  // The repository: the one picked here, else the one this conversation's work names, else a sole registered one.
  const registered = repos ?? [];
  const contextRepo = sessionRepo === null ? undefined : registered.find((r) => r.id === sessionRepo || r.name === sessionRepo);
  const repoRef = !wantsRepo || (choosing && pickedRepo === null) ? null
    : pickedRepo ?? contextRepo?.id ?? (registered.length === 1 ? registered[0]!.id : null);
  const repoName = repoRef === null ? null : registered.find((r) => r.id === repoRef)?.name ?? repoRef;
  // The project: the composer's (its chip, its chat), else the one picked here, else a sole project.
  const filed = projects.filter((p) => p.id !== 'default');
  const projectId = realProject(projectIn);
  const project = projectId ?? pickedProject ?? (wantsProject && filed.length === 1 ? filed[0]!.id : null);
  const projectName = project === null ? null : filed.find((p) => p.id === project)?.name ?? project;

  const def = entry !== null && entry.launchKind === 'run' ? (defs ?? []).find((d) => d.id === entry.launchId) ?? null : null;
  // New job's rule: a job with a repository whose workflow may change code delivers a pull request, behind its gate.
  const deliver: 'pr' | null = entry !== null && entry.launchKind === 'run' && repoRef !== null
    && (def === null || def.phases.some((p) => p.executes_code)) ? 'pr' : null;
  // The gate is placed off the launch preview, which needs this project's presets read first (codex r1 P1): until then
  // a scoped preset's "before step 1" would land on its scope step and the first work step would run unconfirmed.
  // (An older daemon's or a failed read's `unsupported` has no presets to shift by, as in New job: codex r2.)
  const presetsState = usePlanCatalog((s) => s.presets[project ?? '']);
  const presetsRead = presetsState !== undefined && presetsState !== 'loading';
  const preview = useLaunchPreview({
    plan: null, workflow: entry !== null && entry.launchKind === 'run' ? entry.launchId : '', projectId: project, repoRef, deliver,
    mode: undefined, confirm: COMPOSER_DEFAULT_GATE_POSTURE.mode, beforeOrd: COMPOSER_DEFAULT_GATE_POSTURE.beforeOrd,
  });

  // The helpers: exactly the row's (the composer applies New job's J4 rule to it).
  const roster = useRoster();
  const seats: RosterSeat[] = seatKeys.flatMap((key) => (roster ?? []).filter((x) => x.key === key));

  const offerReduced = reducedCap && entry !== null && entry.launchKind === 'run' && seats.length === 1;
  const { label: wordsLabel, optional: wordsOptional } = entry === null ? { label: 'What do you want done?', optional: false } : entryWords(entry);
  const blocker: string | null = entry === null
    ? (catalogState === 'loading' ? WORKFLOWS_LOADING_LINE : catalogState === 'error' ? WORKFLOWS_FAILED_LINE : 'This workflow is not listed now. Remove it and pick another.')
    : !entryOffered(entry) ? notOfferedLine(entry)
      : words.trim() === '' && !wordsOptional ? `${wordsLabel} Say it in the box.`
        : wantsRepo && repoRef === null ? 'Which repository? Pick one below.'
          : wantsProject && project === null ? 'Which project? Pick one below.'
            // What the daemon can do (power mode, the chat link) and this project's presets are read before a start.
            : entry.launchKind === 'run' && !presetsRead ? 'Checking this workflow…'
              : entry.launchKind === 'run' && seats.length === 0 ? 'Turn on at least one helper.'
                : null;
  useEffect(() => { onBlocker(blocker); }, [blocker, onBlocker]);
  // The request as checked: a launch whose request changed while its gate was placed stops for a fresh look (New
  // job's rule, codex r1), and one whose card was removed meanwhile sends nothing.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const requestNow = useRef('');
  requestNow.current = JSON.stringify([entry?.id ?? null, entry?.launchId ?? null, repoRef, project, words.trim(), seats, deliver, offerReduced && reduced]);
  const blockerNow = useRef<string | null>(null);
  blockerNow.current = blocker;

  handle.current = {
    start: async (typed: string): Promise<boolean> => {
      if (busy || inFlight.has(composerKey)) return false;
      if (blocker !== null || entry === null) { setError(blocker); return false; }
      const asked = requestNow.current;
      const chip = chipsOf(useComposerChips.getState(), composerKey).find((c) => c.kind === 'workflow');
      inFlight.add(composerKey);
      setBusy(true);
      setError(null);
      // On success only THIS card leaves the composer (never a chip someone added meanwhile).
      const spend = (): void => { if (chip !== undefined) removeAboutChip(composerKey, chip.key); };
      try {
        if (entry.launchKind === 'app') {
          const r = await startAppByChat(typed.trim(), project!);
          if ('error' in r) { setError(r.error); return false; }
          spend();
          navigate(r.path);
          return true;
        }
        // What the daemon can do, read NOW (codex r2 P1): a failed or missing read must never let a power run (which has
        // no plan gate) start because `power: false` was left out. No answer, no start.
        let caps: Record<string, unknown>;
        try {
          caps = ((await api.getHealth()) as unknown as { capabilities?: Record<string, unknown> }).capabilities ?? {};
        } catch (e) {
          throw new Error(`the daemon did not say what it can do (${e instanceof Error ? e.message : String(e)}); try again`);
        }
        const chatId = launchChatId(composerKey, caps['chatIdOnLaunch'] === true);
        const humanConfirm = await preview.resolveHumanConfirm();
        if (!mounted.current) return false;
        if (blockerNow.current !== null) throw new Error(blockerNow.current);
        if (requestNow.current !== asked) throw new Error('This job changed while it was being checked. Look it over and press Enter again.');
        const stillOn = chipsOf(useComposerChips.getState(), composerKey).some((c) => c.kind === 'workflow' && c.key === chip?.key && c.workflowId === entry.launchId);
        if (!stillOn) return false;
        const body = workflowLaunchBody({
          workflowId: entry.launchId,
          // Crew needs a problem: a start with no words (an optional form) sends the card's own summary.
          intent: typed.trim() !== '' ? typed : (entry.summary.split('. ')[0] || entry.title),
          seats,
          repoRef,
          projectId: project,
          humanConfirm,
          deliver,
          autoDeliverGate: false,
          // New job's rule: with one helper the creator's seat would review its own work, so the person opts in (said).
          reducedAssurance: offerReduced && reduced,
          skipQeReason: null,
          chatId,
          primary: null,
          // The plan gate holds: a power run has none.
          power: caps['powerMode'] === true ? false : null,
        });
        const { runId } = await api.launchRun(body);
        useProvenanceStore.getState().markLaunchedHere(runId);
        spend();
        navigate(chatId !== null ? sessionPath(chatId) : sessionPath(`run:${runId}`));
        return true;
      } catch (e) {
        setError(`Not started: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        inFlight.delete(composerKey);
        setBusy(false);
      }
    },
  };

  const where = [repoName !== null ? `in ${repoName}` : null, projectName !== null ? `in project ${projectName}` : null].filter((x) => x !== null).join(', ');
  const line = entry === null ? null
    : entry.launchKind === 'app'
      ? `Enter makes the app${projectName !== null ? ` in project ${projectName}` : ''}: your words are its first message, and its page opens on that turn.`
      : `Enter starts ${entry.title}${where !== '' ? ` ${where}` : ''}${launchChatId(composerKey, chatIdOnLaunch) !== null ? ' in this chat' : ' as its own job'}. It asks you to approve the plan before any step runs.`;
  const repoChoices = allChoices ? registered : registered.slice(0, CHOICES_MAX);
  const projectChoices = allChoices ? filed : filed.slice(0, CHOICES_MAX);
  return (
    <div data-testid="composer-start" data-entry={entry?.id ?? ''} role="group" aria-label="What this start needs" className="wk-composer-chips wk-composer-start">
      {line !== null && <span data-testid="composer-start-line" className="wk-composer-note">{busy ? 'Starting…' : line}</span>}
      {wantsRepo && repoRef === null && repos !== null && (
        <span data-testid="composer-start-repos" role="group" aria-label="Which repository?" className="wk-composer-start-need">
          <span className="wk-composer-note">Which repository?</span>
          {repoChoices.map((r) => (
            <button key={r.id} type="button" data-testid="composer-start-repo" data-repo={r.id} disabled={busy}
              onClick={() => setPickedRepo(r.id)} className="wk-composer-chip wk-composer-suggestion">{r.name}</button>
          ))}
          {!allChoices && registered.length > CHOICES_MAX && (
            <button type="button" data-testid="composer-start-more" className="wk-btn wk-btn--link wk-btn--sm" onClick={() => setAllChoices(true)}>
              {registered.length - CHOICES_MAX} more
            </button>
          )}
          <a href={registerRepoPath(project)} data-testid="composer-start-add-repo" className="wk-link wk-composer-note"
            onClick={(e) => { e.preventDefault(); navigate(registerRepoPath(project)); }}>Add a repository</a>
        </span>
      )}
      {wantsRepo && repoRef !== null && (
        <button type="button" data-testid="composer-start-repo-change" className="wk-btn wk-btn--link wk-btn--sm"
          onClick={() => { setPickedRepo(null); setChoosing(true); }}>Another repository</button>
      )}
      {wantsProject && project === null && (
        <span data-testid="composer-start-projects" role="group" aria-label="Which project?" className="wk-composer-start-need">
          <span className="wk-composer-note">{filed.length === 0 ? 'Make a project first: this belongs to a project.' : 'Which project?'}</span>
          {projectChoices.map((p) => (
            <button key={p.id} type="button" data-testid="composer-start-project" data-project={p.id} disabled={busy}
              onClick={() => setPickedProject(p.id)} className="wk-composer-chip wk-composer-suggestion">{p.name}</button>
          ))}
          {!allChoices && filed.length > CHOICES_MAX && (
            <button type="button" data-testid="composer-start-more" className="wk-btn wk-btn--link wk-btn--sm" onClick={() => setAllChoices(true)}>
              {filed.length - CHOICES_MAX} more
            </button>
          )}
        </span>
      )}
      {offerReduced && <ReducedAssuranceOptIn checked={reduced} onChange={setReduced} testId="composer-start-reduced" />}
      {error !== null && <span data-testid="composer-start-error" role="alert" className="wk-composer-note wk-composer-note--bad">{error}</span>}
    </div>
  );
}
