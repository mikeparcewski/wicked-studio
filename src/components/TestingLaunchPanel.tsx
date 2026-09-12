import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import {
  effectiveRepos,
  isMultiScopeUnsupported,
  isNarrowedProject,
  launchGovernedTest,
  mintGroupLabel,
  MULTI_SCOPE_UNSUPPORTED_COPY,
  NO_GOVERNED_WORKFLOW_COPY,
  testingPath,
  type GovernedLaunchResult,
  type GovernedLaunchRoute,
  type LaunchIntent,
} from '../api/testing.js';
import type { Project, RepoEntry, WorkUnit, WorkflowDef } from '../api/types.js';
import { QE_AUTHOR_TESTS_WORKFLOW_ID } from '../api/wave6-wire.js';
import { useGateStore } from '../store/gates.js';
import { setCachedWorkflows } from '../store/workflowCache.js';
import { runShortId } from './runIdentity.js';
import { SteeringGate } from './SteeringGate.js';

/**
 * The testing LAUNCH panel — "New test" runs the GOVERNED `qe-author-tests` workflow (wave 6:
 * acceptance findings F-075 / F-7R2-003 / -008 / -009 / -010 / -011 / F-076), "Run recon" the
 * free-text survey it always was:
 *
 *  - the WORKFLOW is read off `GET /workflows` on mount, never assumed: a daemon that lists
 *    `qe-author-tests` gets the governed launch (recon → author → verify → review → deliver — the
 *    engine's deliver phase opens the PR, never the worker); a daemon that does not shows the honest
 *    banner "this daemon has no governed test workflow — plain run" BEFORE the launch and launches
 *    today's free-text recon;
 *  - a PROJECT SELECTOR: picking a project shows its `crew.repo` members as chips the operator may
 *    DROP (F-076: "attach the project, drop repos"). A narrowed project launches one run per
 *    remaining repo over the shipping `POST /runs` wire — `repoRef` scopes, `projectId` FILES — so an
 *    explicit single repo keeps its `project_id` (F-7R2-010); an un-narrowed scope rides the pinned
 *    `/testing/*` body (`launchGovernedTest` spells the chain and says which wire it took);
 *  - a MULTI-REPO picker: search over the registered repos, explicit attachments as chips;
 *  - scope honesty: a launch needs a project OR ≥ 1 repo, unless the operator explicitly chooses an
 *    unscoped run (never a silent default);
 *  - after the 201 the panel LINKS every launched run (`testing-launch-fanout-run`, the single run
 *    too — F-7R2-011), names the wire and the workflow it carried, and for a single run keeps the
 *    intake-gate flow: the run's `awaitingHuman` arrives on the app's one /ws fold, the EXISTING
 *    gate card renders here with the PLAN above the prompt — every phase, executor, skill and seat
 *    (F-7R2-008), read once off `GET /runs/:id` when the gate arrives.
 */

// ── The two intents' problem framings (exported so the composition is contract-visible) ──────

/** The recon framing — what "Run recon" sends is this prefix, a blank line, then the brief. */
export const RECON_PROBLEM_PREFIX =
  'Recon: survey the target and propose a test plan — the scenarios, their ' +
  'dependencies, and which are deterministic tool checks vs governed agent runs. Present the ' +
  'proposed plan at the intake gate and launch nothing until it is approved.';

/** The test-kickoff framing — "New test" sends this prefix + blank line + brief. Under the governed
 *  workflow the phases are the def's; the prefix states the operator's intent for them. */
export const TEST_PROBLEM_PREFIX =
  'New test: plan the test for the attached scope — the scenarios, their ' +
  'dependencies, and which are deterministic tool checks vs governed agent runs — and run the ' +
  'approved plan as governed sibling runs under one test. Present the plan at the ' +
  'intake gate and launch nothing until it is approved.';

// The intent vocabulary lives with the route helpers (`testingLaunchPath` / `readLaunchIntent`
// in `../api/testing.ts`); re-exported here so the panel's callers read one name.
export type { LaunchIntent };

const INTENT_COPY: Record<LaunchIntent, { title: string; blurb: string; governedBlurb: string; cta: string; prefix: string }> = {
  recon: {
    title: 'Run recon',
    blurb:
      'Launches a governed recon run: it surveys the attached codebases, drafts a test plan ' +
      '— the scenarios and their dependencies — and stops at its intake gate. ' +
      'Nothing runs until you approve the gate here.',
    governedBlurb: '',
    cta: 'Launch recon',
    prefix: RECON_PROBLEM_PREFIX,
  },
  campaign: {
    title: 'New test',
    blurb:
      'Launches a governed test kickoff over the attached codebases and stops at its intake gate — ' +
      'you approve the plan before anything runs. The test appears below with its first run.',
    governedBlurb:
      'Runs the governed qe-author-tests workflow over the attached codebases: recon reads the repo and its ' +
      'tests, author writes behaviour tests against the repo’s own harness, verify RUNS them with the ' +
      'repository’s checks, review has a distinct judge grade fitness, and deliver — the engine, never ' +
      'the worker — opens the PR. It stops at its intake gate: you approve the plan before anything runs.',
    cta: 'Launch test',
    prefix: TEST_PROBLEM_PREFIX,
  },
};

/** The synthesized unfiled project — never offered as a launch scope. */
const DEFAULT_PROJECT_ID = 'default';

const FIELD_STYLE: React.CSSProperties = {
  background: 'var(--surface-base)',
  border: '1px solid var(--surface-raised)',
  color: 'var(--ink-high)',
};

/** What the panel knows about the daemon's workflows: not yet / the list / the read failed. */
type WorkflowsState = 'loading' | 'unavailable' | WorkflowDef[];

/** The words for the wire a launch rode — stated on the panel, never implied. */
const ROUTE_WORD: Record<GovernedLaunchRoute, string> = {
  'testing-author': 'via POST /testing/author',
  'runs-fan': 'via POST /runs per repository — repoRef scopes, projectId files',
  'testing-recon-plain': 'via POST /testing/recon — a plain free-text run',
};

function Chip({ repo, source, onRemove }: {
  repo: string;
  source: 'project' | 'explicit';
  onRemove?: (() => void) | undefined;
}): React.ReactElement {
  return (
    <span
      data-testid="testing-launch-chip"
      data-repo={repo}
      data-source={source}
      title={
        source === 'project'
          ? 'Comes with the selected project. Drop it to test the others — the launch then sends the remaining repositories explicitly and still files into the project.'
          : 'Explicit attachment — sent as repoRefs'
      }
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono"
      style={{
        border: '1px solid var(--surface-raised)',
        background: source === 'project' ? 'transparent' : 'var(--accent-subtle)',
        color: source === 'project' ? 'var(--ink-muted)' : 'var(--accent)',
      }}
    >
      {repo}
      {source === 'project' && <span style={{ color: 'var(--ink-dim)' }}>· via project</span>}
      {onRemove !== undefined && (
        <button
          type="button"
          data-testid="testing-launch-chip-remove"
          data-repo={repo}
          data-source={source}
          aria-label={source === 'project' ? `Drop ${repo} from this test` : `Detach ${repo}`}
          onClick={onRemove}
          className="ml-0.5"
          style={{ color: 'inherit', cursor: 'pointer' }}
        >
          ×
        </button>
      )}
    </span>
  );
}

/** What one launch actually sent + got back — the fan-out list renders off this, honestly. */
interface Launched {
  ids: string[];
  campaign: string | null;
  campaignRegistered: boolean;
  route: GovernedLaunchRoute;
  workflow: string | null;
  /** R2-1: the daemon's answer did not honour the narrowed scope — said, never hidden. */
  scopeNote: string | null;
}

/** The launched run's snapshot, read ONCE when its intake gate arrives — the plan's units + pool. */
interface RunSnapshot {
  units: WorkUnit[];
  clis: string[];
}

export function TestingLaunchPanel({ intent, navigate, onClose, onLaunched, initialProjectId }: {
  intent: LaunchIntent;
  navigate: (path: string) => void;
  onClose: () => void;
  /** Fired once per successful launch with the honest run-id list (fan-out included). */
  onLaunched?: ((ids: string[]) => void) | undefined;
  /** Pre-select this project (the test is launched FROM a project shell) — so a project-scoped
   *  "New test" auto-scopes to that project instead of opening unscoped. */
  initialProjectId?: string | undefined;
}): React.ReactElement {
  const copy = INTENT_COPY[intent];
  const [instructions, setInstructions] = useState('');

  // ── The governed workflow: read off the daemon, never assumed ─────────────
  const [workflows, setWorkflows] = useState<WorkflowsState>('loading');
  useEffect(() => {
    let disposed = false;
    // `Promise.resolve().then` turns a daemon without the route (or a host without the method) into
    // the same honest `unavailable` as a rejected read — never a thrown render.
    Promise.resolve()
      .then(() => api.listWorkflows())
      .then(({ workflows: defs }) => {
        if (disposed) return;
        setWorkflows(defs);
        setCachedWorkflows(defs);
      })
      .catch(() => { if (!disposed) setWorkflows('unavailable'); });
    return () => { disposed = true; };
  }, []);
  /** The def "New test" runs — `null` while reading, when the daemon lists none, or on Run recon. */
  const qeWorkflow: WorkflowDef | null = useMemo(
    () => (intent === 'campaign' && Array.isArray(workflows)
      ? workflows.find((w) => w.id === QE_AUTHOR_TESTS_WORKFLOW_ID) ?? null
      : null),
    [intent, workflows],
  );
  const governed = qeWorkflow !== null;
  /** The honest pre-launch banner: this New test will be a PLAIN run (the daemon lists no QE workflow). */
  const plainBanner = intent === 'campaign' && workflows !== 'loading' && !governed;

  // ── Scope state ────────────────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  /** The selected project's `crew.repo` member refs — the "via project" chips. */
  const [projectRepos, setProjectRepos] = useState<string[] | 'loading'>([]);
  /** Project members the operator DROPPED (F-076) — reset when the project changes. */
  const [excluded, setExcluded] = useState<string[]>([]);
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [repoQuery, setRepoQuery] = useState('');
  /** Explicit attachments, insertion-ordered, deduped at attach time. */
  const [attached, setAttached] = useState<string[]>([]);
  const [unscoped, setUnscoped] = useState(false);

  // ── Launch state ───────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<Launched | null>(null);
  const [resolved, setResolved] = useState(false);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);

  // The single-run intake gate arrives as a normal awaitingHuman frame on the app's one /ws
  // fold — this panel just watches for it and renders the EXISTING gate card. A fan-out
  // (ids.length > 1) never watches: each sibling's gate shows everywhere gates do.
  const gateRunId = launched !== null && launched.ids.length === 1 ? launched.ids[0]! : null;
  const gate = useGateStore((s) => (gateRunId !== null ? s.gates[gateRunId] : undefined));

  // F-7R2-008: the gate card shows the PLAN — read the run ONCE when its intake gate arrives (the
  // units are planned by then; before it there is nothing to show). A failed read shows the card
  // without the plan, never a fabricated one.
  useEffect(() => {
    if (gateRunId === null || gate === undefined || snapshot !== null) return;
    let disposed = false;
    // `Promise.resolve().then` so a host without the read (an older client shell, a test double)
    // degrades to "no plan block" instead of a thrown effect.
    Promise.resolve()
      .then(() => api.getRun(gateRunId))
      .then(({ run }) => {
        if (disposed) return;
        setSnapshot({ units: run.units, clis: Array.isArray(run.session.clis) ? run.session.clis : [] });
      })
      .catch(() => { /* no plan block — the prompt and the answers still render */ });
    return () => { disposed = true; };
  }, [gateRunId, gate, snapshot]);

  useEffect(() => {
    let disposed = false;
    api.listRepos()
      .then(({ repos: rs }) => { if (!disposed) setRepos(rs); })
      .catch(() => { /* the picker stays empty — an unscoped launch still works */ });
    api.listProjects()
      .then(({ projects: ps }) => {
        if (!disposed) setProjects(ps.filter((p) => p.status === 'active' && p.id !== DEFAULT_PROJECT_ID));
      })
      .catch(() => { /* no project selector — repos and unscoped still work */ });
    return () => { disposed = true; };
  }, []);

  // Project selection resolves that project's repos — the chips the operator may drop; the daemon
  // re-resolves from projectId at launch for an UN-narrowed scope, and the narrowed fan sends the
  // remaining members explicitly (F-076).
  useEffect(() => {
    setExcluded([]);
    if (projectId === '') { setProjectRepos([]); return; }
    let disposed = false;
    setProjectRepos('loading');
    api.listProjectMembers(projectId)
      .then(({ members }) => {
        if (disposed) return;
        setProjectRepos(members.filter((m) => m.member_kind === 'crew.repo').map((m) => m.member_ref));
      })
      .catch(() => { if (!disposed) setProjectRepos([]); });
    return () => { disposed = true; };
  }, [projectId]);

  const viaProject = useMemo(
    () => (projectRepos === 'loading' ? [] : projectRepos),
    [projectRepos],
  );
  const kept = viaProject.filter((r) => !excluded.includes(r));
  const dropped = viaProject.filter((r) => excluded.includes(r));
  // Explicit chips that the project already carries are redundant on the wire (union dedupes)
  // but stay visible as explicit — the operator attached them; dropping the project keeps them.
  const attachedVisible = attached.filter((r) => !viaProject.includes(r));

  const matches = useMemo(() => {
    const q = repoQuery.trim().toLowerCase();
    if (q === '') return [];
    return repos
      .filter((r) => (r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)))
      .filter((r) => !attached.includes(r.id) && !kept.includes(r.id))
      .slice(0, 8);
  }, [repoQuery, repos, attached, kept]);

  const scopeInput = {
    projectId: projectId === '' ? null : projectId,
    projectRepos: viaProject,
    excluded,
    explicit: [...new Set(attached)],
  };
  const narrowed = isNarrowedProject(scopeInput);
  const willCover = effectiveRepos(scopeInput);
  const scoped = projectId !== '' || attached.length > 0;
  // A project whose every member was dropped and nothing attached covers nothing — refused before
  // the wire, on the button.
  const emptyNarrowed = narrowed && willCover.length === 0;
  // F-3 (independent review of #263): while `GET /workflows` is still pending, "New test" does not
  // know whether it is governed — a click then would launch a plain free-text run with no banner
  // ever shown (exactly the F-7R2-003 run). The button waits for the read to land or fail; a failed
  // read shows the banner first and the plain run is then an explicit choice.
  const workflowsPending = intent === 'campaign' && workflows === 'loading';
  const canLaunch = instructions.trim() !== '' && (scoped || unscoped) && !busy && !emptyNarrowed && projectRepos !== 'loading' && !workflowsPending;

  const launch = async (): Promise<void> => {
    if (!canLaunch) return;
    setBusy(true);
    setError(null);
    try {
      const result: GovernedLaunchResult = await launchGovernedTest({
        problem: `${copy.prefix}\n\n${instructions.trim()}`,
        ...scopeInput,
        workflow: governed ? QE_AUTHOR_TESTS_WORKFLOW_ID : null,
        groupLabel: mintGroupLabel(),
      });
      const ids = result.runIds ?? [];
      if (ids.length === 0) {
        setError('The daemon accepted the launch but answered without a run id — nothing to link.');
        return;
      }
      setLaunched({
        ids,
        campaign: typeof result.campaign === 'string' && result.campaign !== '' ? result.campaign : null,
        campaignRegistered: result.campaignRegistered,
        route: result.route,
        workflow: result.workflow,
        scopeNote: result.scopeNote,
      });
      onLaunched?.(ids);
    } catch (e) {
      setError(isMultiScopeUnsupported(e) ? MULTI_SCOPE_UNSUPPORTED_COPY : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runLink = (id: string): React.ReactElement => (
    <button
      key={id}
      type="button"
      data-testid="testing-launch-fanout-run"
      data-run-id={id}
      onClick={() => navigate(`/runs/${encodeURIComponent(id)}`)}
      className="font-mono text-[10px] underline"
      style={{ color: 'var(--accent)' }}
    >
      {runShortId(id)}
    </button>
  );

  return (
    <div
      data-testid="testing-launch-panel"
      data-intent={intent}
      data-governed={intent === 'campaign' ? (workflows === 'loading' ? 'unknown' : governed ? 'true' : 'false') : 'n/a'}
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
          {copy.title}
        </span>
        {governed && (
          <span
            data-testid="testing-launch-workflow"
            data-workflow={QE_AUTHOR_TESTS_WORKFLOW_ID}
            className="rounded-full px-2 py-0.5 text-[10px] font-mono"
            title={`Governed workflow — ${qeWorkflow.phases.length} phases: ${qeWorkflow.phases.map((p) => p.id).join(' → ')}`}
            style={{ border: '1px solid var(--surface-raised)', color: 'var(--accent)' }}
          >
            {QE_AUTHOR_TESTS_WORKFLOW_ID} · {qeWorkflow.phases.map((p) => p.id).join(' → ')}
          </span>
        )}
        <button
          data-testid="testing-launch-close"
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Close
        </button>
      </div>

      {/* F-075: the honest banner — this New test will be a PLAIN run, said BEFORE the launch. */}
      {plainBanner && (
        <p
          data-testid="testing-launch-plain-banner"
          data-reason={workflows === 'unavailable' ? 'workflows-unreadable' : 'workflow-absent'}
          className="rounded px-2 py-1 text-[10px]"
          style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}
        >
          {NO_GOVERNED_WORKFLOW_COPY}
          {workflows === 'unavailable'
            ? ' (GET /workflows could not be read)'
            : ` (GET /workflows lists no ${QE_AUTHOR_TESTS_WORKFLOW_ID}; upgrade wicked-crew / wicked-core for the governed flow)`}
          . The launch will be free-text planned: no verify phase runs what it writes, no deliver phase.
        </p>
      )}

      {launched === null ? (
        <>
          <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            {governed ? copy.governedBlurb : copy.blurb}
          </p>
          <textarea
            data-testid="testing-launch-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should this test cover? Name the surfaces, risks, or behaviors to test."
            className="min-h-[4rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
            style={FIELD_STYLE}
          />

          {/* ── The scope: project + explicit codebases (the pinned union, narrowable) ── */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
              project
              <select
                data-testid="testing-launch-project"
                value={projectId}
                onChange={(e) => { setProjectId(e.target.value); setUnscoped(false); }}
                className="rounded px-1 py-0.5 text-[10px] font-mono"
                style={FIELD_STYLE}
              >
                <option value="">no project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
              attach codebases
              <input
                data-testid="testing-launch-repo-search"
                value={repoQuery}
                onChange={(e) => setRepoQuery(e.target.value)}
                placeholder="search registered repos…"
                className="w-48 rounded px-2 py-0.5 text-[10px] font-mono"
                style={FIELD_STYLE}
              />
            </label>
          </div>

          {matches.length > 0 && (
            <div data-testid="testing-launch-repo-matches" className="flex flex-wrap gap-1">
              {matches.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  data-testid="testing-launch-repo-option"
                  data-repo={r.id}
                  onClick={() => {
                    setAttached((cur) => (cur.includes(r.id) ? cur : [...cur, r.id]));
                    // Re-attaching a dropped project member restores it as explicit.
                    setExcluded((cur) => cur.filter((x) => x !== r.id));
                    setRepoQuery('');
                    setUnscoped(false);
                  }}
                  className="rounded-full px-2 py-0.5 text-[10px] font-mono"
                  style={{ border: '1px dashed var(--surface-raised)', color: 'var(--ink-muted)', cursor: 'pointer' }}
                >
                  + {r.name}
                </button>
              ))}
            </div>
          )}

          {(kept.length > 0 || attachedVisible.length > 0 || projectRepos === 'loading') && (
            <div data-testid="testing-launch-chips" className="flex flex-wrap items-center gap-1">
              {projectRepos === 'loading' && (
                <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>resolving project repos…</span>
              )}
              {kept.map((r) => (
                <Chip
                  key={`p-${r}`}
                  repo={r}
                  source="project"
                  onRemove={() => setExcluded((cur) => (cur.includes(r) ? cur : [...cur, r]))}
                />
              ))}
              {attachedVisible.map((r) => (
                <Chip
                  key={`e-${r}`}
                  repo={r}
                  source="explicit"
                  onRemove={() => setAttached((cur) => cur.filter((x) => x !== r))}
                />
              ))}
            </div>
          )}

          {/* F-076: what was dropped, and the way back — said as a scope fact, with the wire it
              changes (the narrowed fan files into the project through `projectId` on POST /runs). */}
          {dropped.length > 0 && (
            <p data-testid="testing-launch-dropped" data-count={dropped.length} className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
              {dropped.length} of {viaProject.length} project repositor{dropped.length === 1 ? 'y' : 'ies'} dropped ({dropped.join(', ')}) —
              {' '}{willCover.length === 0
                ? 'nothing left to test: keep one, attach a codebase, or clear the project'
                : `${willCover.length} run${willCover.length === 1 ? '' : 's'}, filed into the project`}
              .{' '}
              <button
                type="button"
                data-testid="testing-launch-restore"
                onClick={() => setExcluded([])}
                className="underline"
                style={{ color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
              >
                restore all
              </button>
            </p>
          )}

          {/* The pin's zero-repo 400 applies to projectId ALONE — explicit attachments are
              the named fix, so the warning stands only while none are attached. */}
          {projectId !== '' && projectRepos !== 'loading' && projectRepos.length === 0 && attached.length === 0 && (
            <p data-testid="testing-launch-project-empty" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
              This project holds no repositories — the daemon will refuse the launch (400) until
              one is attached to the project, or attach codebases here explicitly.
            </p>
          )}

          {/* Scoped work needs a project or a repo; unscoped stays an EXPLICIT choice the
              shipping wire already supports — never a silent default. */}
          {!scoped && (
            <label className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
              <input
                data-testid="testing-launch-unscoped"
                type="checkbox"
                checked={unscoped}
                onChange={(e) => setUnscoped(e.target.checked)}
              />
              run unscoped — survey all registered repositories
            </label>
          )}

          {error !== null && (
            <p data-testid="testing-launch-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              data-testid="testing-launch-submit"
              type="button"
              disabled={!canLaunch}
              onClick={() => void launch()}
              className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              title={emptyNarrowed
                ? 'every project repository was dropped — keep one, attach a codebase, or clear the project'
                : workflowsPending
                  ? 'waiting for GET /workflows — the launch must know whether this daemon has the governed test workflow'
                  : undefined}
              {...(workflowsPending ? { 'data-pending': 'workflows' } : {})}
            >
              {busy ? 'Launching…' : workflowsPending ? 'resolving workflows…' : copy.cta}
            </button>
            {scoped && willCover.length > 1 && (
              <span data-testid="testing-launch-fan-note" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                {willCover.length} repositories → {willCover.length} governed runs — each pauses at its own intake gate; approve them one at a time
              </span>
            )}
          </div>
        </>
      ) : (
        <div data-testid="testing-launch-launched" data-route={launched.route} className="flex flex-col gap-2">
          {/* ── What launched, honestly: the runs (each a link), the workflow, the wire, the grouping. ── */}
          <div data-testid={launched.ids.length > 1 ? 'testing-launch-fanout' : 'testing-launch-single'} className="flex flex-col gap-1">
            <p className="text-[11px]" style={{ color: 'var(--ink-high)' }}>
              {launched.ids.length === 1 ? (
                <>Run {runLink(launched.ids[0]!)} launched</>
              ) : (
                <>
                  {launched.ids.length} runs launched
                  {launched.campaign !== null ? (
                    <> under <span className="font-mono" data-testid="testing-launch-fanout-label">{launched.campaign}</span></>
                  ) : (
                    <> — one per attached codebase, under one test</>
                  )}
                </>
              )}
              .
            </p>
            {launched.ids.length > 1 && (
              <div className="flex flex-wrap gap-2">{launched.ids.map(runLink)}</div>
            )}
            {launched.scopeNote !== null && (
              <p data-testid="testing-launch-scope-note" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}>
                ⚠ {launched.scopeNote}
              </p>
            )}
            <p data-testid="testing-launch-route" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
              {launched.workflow !== null ? (
                <>workflow <span className="font-mono" data-testid="testing-launch-launched-workflow" style={{ color: 'var(--accent)' }}>{launched.workflow}</span> · </>
              ) : (
                <><span data-testid="testing-launch-launched-plain" style={{ color: 'var(--status-gate)' }}>plain free-text run — no governed test workflow on this daemon</span> · </>
              )}
              {ROUTE_WORD[launched.route]}
              {launched.ids.length === 1 && launched.campaign !== null && (
                <> · {launched.campaignRegistered ? 'test' : 'label'} <span className="font-mono" data-testid="testing-launch-fanout-label">{launched.campaign}</span></>
              )}
              {launched.campaignRegistered
                ? ' · registered on the Test landing'
                : launched.campaign !== null
                  ? ' · grouped under one label on the Test landing'
                  : ' · appears on the Test landing when the run registers its test set'}
            </p>
          </div>

          {launched.ids.length > 1 ? (
            <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
              Each sibling stops at its own intake gate — gates surface everywhere gates do, and
              the test&rsquo;s progress lands on this page.
            </p>
          ) : resolved ? (
            <p data-testid="testing-launch-resolved" className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Intake gate answered — the test&rsquo;s progress lands on{' '}
              <button
                type="button"
                data-testid="testing-launch-to-campaigns"
                onClick={() => navigate(testingPath('campaigns'))}
                className="underline"
                style={{ color: 'var(--accent)' }}
              >
                Tests
              </button>
              , and the run itself is at{' '}
              <button
                type="button"
                onClick={() => navigate(`/runs/${encodeURIComponent(gateRunId!)}`)}
                className="font-mono underline"
                style={{ color: 'var(--accent)' }}
              >
                {runShortId(gateRunId!)}
              </button>
              .
            </p>
          ) : gate === undefined ? (
            <p data-testid="testing-launch-waiting" className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Run <span className="font-mono">{gateRunId!.slice(0, 8)}</span> launched — its intake
              gate will appear here the moment the run asks{governed ? `, with the plan (${qeWorkflow.phases.map((p) => p.id).join(' → ')}) above the prompt` : ''}. It also shows up everywhere gates do.
            </p>
          ) : (
            // The intake gate — the EXISTING gate card, reused verbatim, with the PLAN above the
            // prompt (F-7R2-008). Approving (optionally with steer text) is what launches the
            // proposed test; rejecting launches nothing.
            <SteeringGate
              runId={gateRunId!}
              ord={gate.ord}
              prompt={gate.prompt}
              {...(snapshot !== null ? { units: snapshot.units, clis: snapshot.clis } : {})}
              workflow={qeWorkflow}
              onResolved={() => setResolved(true)}
            />
          )}
        </div>
      )}
    </div>
  );
}
