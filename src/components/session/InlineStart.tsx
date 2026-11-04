import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import type { RepoEntry, RosterSeat } from '../../api/types.js';
import { workflowLaunchBody } from '../../board/launchModel.js';
import { sessionPath } from '../../board/sessionModel.js';
import { seatLabel } from '../../board/seatNames.js';
import { entryOffered, entryWords, needsProject, needsRepo, type CatalogEntry } from '../../board/workflowCatalog.js';
import { notOfferedLine } from '../../board/slashCatalog.js';
import { WORKFLOWS_FAILED_LINE, WORKFLOWS_LOADING_LINE } from '../../board/workflowCommand.js';
import { registerRepoPath } from '../../hooks/ambientProject.js';
import { useLaunchPreview } from '../../hooks/useLaunchPlan.js';
import { useCapabilities } from '../../store/capabilities.js';
import { clearAboutChips } from '../../store/composerChips.js';
import { startAppByChat } from '../../store/inlineStart.js';
import { useProjectsStore } from '../../store/projects.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { useWorkflowDefs } from '../../store/workflowCache.js';
import { useRoster } from '../../hooks/useRoster.js';
import { seatStanding } from '../gateVerdictModel.js';
import { COMPOSER_DEFAULT_GATE_POSTURE } from '../composerDefaults.js';
import { launchChatId } from '../launch/launchChatId.js';
import { ReducedAssuranceOptIn } from './AssuranceReceipt.js';

/** What the composer calls on Enter while a card is on it: true when the work started (the composer then clears). */
export interface InlineStartHandle {
  start: (words: string) => Promise<boolean>;
}

/** How many choices a need row offers before it says to narrow (the rest are one link away). */
const CHOICES_MAX = 6;

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
  composerKey, entry, catalogState, sessionRepo, projectId, seatKeys, picked, words, navigate, handle, onBlocker,
}: {
  composerKey: string;
  /** The card on the composer, or null while the catalog is read (or the card is gone). */
  entry: CatalogEntry | null;
  catalogState: 'loading' | 'error' | 'ready';
  /** The repository this conversation's work names (the default choice). */
  sessionRepo: string | null;
  /** The project the composer's `@project` chip or its chat names. */
  projectId: string | null;
  /** The helpers the composer's row has on. */
  seatKeys: readonly string[];
  /** The helpers turned on by hand (a signed-out or benched one joins only then, as in New job). */
  picked: readonly string[];
  words: string;
  navigate: (path: string) => void;
  handle: React.MutableRefObject<InlineStartHandle | null>;
  /** Why Enter cannot start yet (shown by the composer), or null. */
  onBlocker: (blocker: string | null) => void;
}): React.ReactElement {
  const defs = useWorkflowDefs();
  const projects = useProjectsStore((s) => s.projects) ?? [];
  const chatIdOnLaunch = useCapabilities((s) => s.chatIdOnLaunch);
  const powerCap = useCapabilities((s) => s.powerMode);
  const reducedCap = useCapabilities((s) => s.reducedAssurance);
  const [reduced, setReduced] = useState(false);
  const [repos, setRepos] = useState<RepoEntry[] | null>(getCachedRepos());
  const [pickedRepo, setPickedRepo] = useState<string | null>(null);
  const [pickedProject, setPickedProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allChoices, setAllChoices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entryId = entry?.id ?? null;
  // Another card starts its own choices.
  useEffect(() => { setPickedRepo(null); setPickedProject(null); setError(null); setReduced(false); }, [entryId]);

  const wantsRepo = entry !== null && entry.launchKind === 'run' && needsRepo(entry);
  const wantsProject = entry !== null && needsProject(entry);
  useEffect(() => { if (wantsRepo && repos === null) fetchReposCached().then(setRepos, () => setRepos([])); }, [wantsRepo, repos]);
  useEffect(() => { if (wantsProject && projects.length === 0) void useProjectsStore.getState().load(); }, [wantsProject, projects.length]);

  // The repository: the one picked here, else the one this conversation's work names, else a sole registered one.
  const registered = repos ?? [];
  const contextRepo = sessionRepo === null ? undefined : registered.find((r) => r.id === sessionRepo || r.name === sessionRepo);
  const repoRef = !wantsRepo ? null
    : pickedRepo ?? contextRepo?.id ?? (registered.length === 1 ? registered[0]!.id : null);
  const repoName = repoRef === null ? null : registered.find((r) => r.id === repoRef)?.name ?? repoRef;
  // The project: the composer's (its chip, its chat), else the one picked here, else a sole project.
  const filed = projects.filter((p) => p.id !== 'default');
  const project = projectId ?? pickedProject ?? (wantsProject && filed.length === 1 ? filed[0]!.id : null);
  const projectName = project === null ? null : filed.find((p) => p.id === project)?.name ?? project;

  const def = entry !== null && entry.launchKind === 'run' ? (defs ?? []).find((d) => d.id === entry.launchId) ?? null : null;
  // New job's rule: a job with a repository whose workflow may change code delivers a pull request, behind its gate.
  const deliver: 'pr' | null = entry !== null && entry.launchKind === 'run' && repoRef !== null
    && (def === null || def.phases.some((p) => p.executes_code)) ? 'pr' : null;
  const preview = useLaunchPreview({
    plan: null, workflow: entry !== null && entry.launchKind === 'run' ? entry.launchId : '', projectId: project, repoRef, deliver,
    mode: undefined, confirm: COMPOSER_DEFAULT_GATE_POSTURE.mode, beforeOrd: COMPOSER_DEFAULT_GATE_POSTURE.beforeOrd,
  });

  // The helpers: the row's, minus one that cannot take work now unless it was turned on by hand (New job's J4 rule).
  const roster = useRoster();
  const seatsFrom = (all: readonly RosterSeat[]): { seats: RosterSeat[]; left: string[] } => {
    const seats: RosterSeat[] = [];
    const left: string[] = [];
    for (const key of seatKeys) {
      const s = all.find((x) => x.key === key);
      if (s === undefined) continue;
      const st = seatStanding(s);
      if (st.state !== 'ready' && st.state !== 'unknown' && !picked.includes(key)) left.push(seatLabel(s));
      else seats.push(s);
    }
    return { seats, left };
  };

  const offerReduced = reducedCap && entry !== null && entry.launchKind === 'run' && seatsFrom(roster ?? []).seats.length === 1;
  const { label: wordsLabel, optional: wordsOptional } = entry === null ? { label: 'What do you want done?', optional: false } : entryWords(entry);
  const blocker: string | null = entry === null
    ? (catalogState === 'loading' ? WORKFLOWS_LOADING_LINE : catalogState === 'error' ? WORKFLOWS_FAILED_LINE : 'This workflow is not listed now. Remove it and pick another.')
    : !entryOffered(entry) ? notOfferedLine(entry)
      : words.trim() === '' && !wordsOptional ? `${wordsLabel} Say it in the box.`
        : wantsRepo && repoRef === null ? 'Which repository? Pick one below.'
          : wantsProject && project === null ? 'Which project? Pick one below.'
            : null;
  useEffect(() => { onBlocker(blocker); }, [blocker, onBlocker]);

  handle.current = {
    start: async (typed: string): Promise<boolean> => {
      if (busy) return false;
      if (blocker !== null || entry === null) { setError(blocker); return false; }
      setBusy(true);
      setError(null);
      try {
        if (entry.launchKind === 'app') {
          const r = await startAppByChat(typed.trim(), project!);
          if ('error' in r) { setError(r.error); return false; }
          clearAboutChips(composerKey);
          navigate(r.path);
          return true;
        }
        const chatId = launchChatId(composerKey, chatIdOnLaunch);
        const { seats } = seatsFrom(roster ?? []);
        const body = workflowLaunchBody({
          workflowId: entry.launchId,
          // Crew needs a problem: a start with no words (an optional form) sends the card's own summary.
          intent: typed.trim() !== '' ? typed : (entry.summary.split('. ')[0] || entry.title),
          seats,
          repoRef,
          projectId: project,
          humanConfirm: await preview.resolveHumanConfirm(),
          deliver,
          autoDeliverGate: false,
          // New job's rule: with one helper the creator's seat would review its own work, so the person opts in (said).
          reducedAssurance: offerReduced && reduced,
          skipQeReason: null,
          chatId,
          primary: null,
          // The plan gate holds: a power run has none.
          power: powerCap ? false : null,
        });
        const { runId } = await api.launchRun(body);
        useProvenanceStore.getState().markLaunchedHere(runId);
        clearAboutChips(composerKey);
        navigate(chatId !== null ? sessionPath(chatId) : sessionPath(`run:${runId}`));
        return true;
      } catch (e) {
        setError(`Not started: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
  };

  const leftOut = seatsFrom(roster ?? []).left;
  const where = [repoName !== null ? `in ${repoName}` : null, projectName !== null ? `in project ${projectName}` : null].filter((x) => x !== null).join(', ');
  const line = entry === null ? null
    : entry.launchKind === 'app'
      ? `Enter makes the app${projectName !== null ? ` in project ${projectName}` : ''}: your words are its first message, and its page opens on that turn.`
      : `Enter starts ${entry.title}${where !== '' ? ` ${where}` : ''} in this chat. It asks you to approve the plan before any step runs.`
        + (leftOut.length > 0 ? ` Left out until you turn them on: ${leftOut.join(', ')}.` : '');
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
      {wantsRepo && repoRef !== null && pickedRepo !== null && (
        <button type="button" data-testid="composer-start-repo-change" className="wk-btn wk-btn--link wk-btn--sm" onClick={() => setPickedRepo(null)}>Another repository</button>
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
