import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import {
  isMultiScopeUnsupported,
  launchTestingRun,
  launchedRunIds,
  MULTI_SCOPE_UNSUPPORTED_COPY,
  testingPath,
  type TestingLaunchBody,
  type TestingLaunchResult,
} from '../api/testing.js';
import type { Project, RepoEntry } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { SteeringGate } from './SteeringGate.js';

/**
 * The testing LAUNCH panel (the testing-UX wave) — the Harness's creation flow, folded into
 * the Campaigns landing's header verbs and grown the multi-codebase scope the pinned wire
 * carries (see `../api/testing.ts` — the PINNED `{projectId?, repoRefs?}` fields):
 *
 *  - a PROJECT SELECTOR: picking a project shows its `crew.repo` members as locked
 *    "via project" chips — the server resolves them from `projectId` (union semantics mean a
 *    project-carried repo cannot be subtracted client-side, so the chips say so instead of
 *    pretending), and the selection is fully editable by switching or clearing the project;
 *  - a MULTI-REPO picker: search over the registered repos, explicit attachments as
 *    removable chips → `repoRefs`;
 *  - scope honesty: a launch needs a project OR ≥ 1 repo, unless the operator explicitly
 *    chooses the unscoped run today's wire already supports (never a silent default);
 *  - the presence-gate: ONE explicit repo and no project sends today's `repoRef` spelling —
 *    the flow an older crew keeps serving; the pinned fields go on the wire only when the
 *    scope actually needs them, and an old daemon's strict-zod refusal renders the honest
 *    named gap, never a crash;
 *  - fan-out honesty: `runIds` (length ≥ 1) is the source of truth — a multi-repo launch
 *    renders "N runs launched" with a real link per run; a single run keeps the intake-gate
 *    flow (the run's awaitingHuman frame arrives on the app's one /ws fold and renders the
 *    EXISTING SteeringGate card — no second gate UI, no polling).
 */

// ── The two intents' problem framings (exported so the composition is contract-visible) ──────

/** The recon framing — what "Run recon" sends is this prefix, a blank line, then the brief. */
export const RECON_PROBLEM_PREFIX =
  'Campaign recon: survey the target and propose a test campaign — the scenarios, their ' +
  'dependencies, and which are deterministic tool checks vs governed agent runs. Present the ' +
  'proposed campaign at the intake gate and launch nothing until it is approved.';

/** The campaign-kickoff framing — "New campaign" sends this prefix + blank line + brief. */
export const CAMPAIGN_PROBLEM_PREFIX =
  'New test campaign: plan the campaign for the attached scope — the scenarios, their ' +
  'dependencies, and which are deterministic tool checks vs governed agent runs — and run the ' +
  'approved plan as governed sibling runs under one campaign label. Present the plan at the ' +
  'intake gate and launch nothing until it is approved.';

export type LaunchIntent = 'recon' | 'campaign';

const INTENT_COPY: Record<LaunchIntent, { title: string; blurb: string; cta: string; prefix: string }> = {
  recon: {
    title: 'Run a campaign recon',
    blurb:
      'Launches a governed recon run: it surveys the attached codebases, drafts a test ' +
      'campaign — the scenarios and their dependencies — and stops at its intake gate. ' +
      'Nothing runs until you approve the gate here.',
    cta: 'Launch recon',
    prefix: RECON_PROBLEM_PREFIX,
  },
  campaign: {
    title: 'New campaign',
    blurb:
      'Launches a governed campaign kickoff: it plans the campaign over the attached ' +
      'codebases and stops at its intake gate — you approve the plan before anything runs. ' +
      'The campaign appears below with its first run.',
    cta: 'Launch campaign',
    prefix: CAMPAIGN_PROBLEM_PREFIX,
  },
};

/** The synthesized unfiled project — never offered as a launch scope. */
const DEFAULT_PROJECT_ID = 'default';

const FIELD_STYLE: React.CSSProperties = {
  background: 'var(--surface-base)',
  border: '1px solid var(--surface-raised)',
  color: 'var(--ink-high)',
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
          ? 'Comes with the selected project — the daemon resolves it from projectId. Clear the project to drop it.'
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
      {source === 'project' ? (
        <span style={{ color: 'var(--ink-dim)' }}>· via project</span>
      ) : (
        <button
          type="button"
          data-testid="testing-launch-chip-remove"
          data-repo={repo}
          aria-label={`Detach ${repo}`}
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
}

export function TestingLaunchPanel({ intent, navigate, onClose, onLaunched }: {
  intent: LaunchIntent;
  navigate: (path: string) => void;
  onClose: () => void;
  /** Fired once per successful launch with the honest run-id list (fan-out included). */
  onLaunched?: ((ids: string[]) => void) | undefined;
}): React.ReactElement {
  const copy = INTENT_COPY[intent];
  const [instructions, setInstructions] = useState('');

  // ── Scope state ────────────────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  /** The selected project's `crew.repo` member refs — the locked "via project" chips. */
  const [projectRepos, setProjectRepos] = useState<string[] | 'loading'>([]);
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

  // The single-run intake gate arrives as a normal awaitingHuman frame on the app's one /ws
  // fold — this panel just watches for it and renders the EXISTING gate card. A fan-out
  // (ids.length > 1) never watches: each sibling's gate shows everywhere gates do.
  const gateRunId = launched !== null && launched.ids.length === 1 ? launched.ids[0]! : null;
  const gate = useGateStore((s) => (gateRunId !== null ? s.gates[gateRunId] : undefined));

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

  // Project selection resolves that project's repos for DISPLAY (the daemon re-resolves from
  // projectId at launch — these chips show what the union will contain, they are not the wire).
  useEffect(() => {
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
  // Explicit chips that the project already carries are redundant on the wire (union dedupes)
  // but stay visible as explicit — the operator attached them; dropping the project keeps them.
  const attachedVisible = attached.filter((r) => !viaProject.includes(r));

  const matches = useMemo(() => {
    const q = repoQuery.trim().toLowerCase();
    if (q === '') return [];
    return repos
      .filter((r) => (r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)))
      .filter((r) => !attached.includes(r.id) && !viaProject.includes(r.id))
      .slice(0, 8);
  }, [repoQuery, repos, attached, viaProject]);

  const scoped = projectId !== '' || attached.length > 0;
  const canLaunch = instructions.trim() !== '' && (scoped || unscoped) && !busy;

  /**
   * The wire body — the pinned composition:
   *  - one explicit repo, no project ⇒ today's `repoRef` (the presence-gated legacy flow);
   *  - a project and/or several repos ⇒ the PINNED `{projectId?, repoRefs?}` (both = union);
   *  - neither (explicit unscoped) ⇒ today's body unchanged.
   */
  const composeBody = (): TestingLaunchBody => {
    const body: TestingLaunchBody = { problem: `${copy.prefix}\n\n${instructions.trim()}` };
    const explicit = [...new Set(attached)];
    if (projectId !== '') body.projectId = projectId;
    if (explicit.length === 1 && projectId === '') body.repoRef = explicit[0]!;
    else if (explicit.length >= 1) body.repoRefs = explicit;
    return body;
  };

  const launch = async (): Promise<void> => {
    if (!canLaunch) return;
    setBusy(true);
    setError(null);
    try {
      const result: TestingLaunchResult = await launchTestingRun(composeBody());
      const ids = launchedRunIds(result);
      if (ids.length === 0) {
        setError('The daemon accepted the launch but answered without a run id — nothing to link.');
        return;
      }
      setLaunched({ ids, campaign: typeof result.campaign === 'string' ? result.campaign : null });
      onLaunched?.(ids);
    } catch (e) {
      setError(isMultiScopeUnsupported(e) ? MULTI_SCOPE_UNSUPPORTED_COPY : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="testing-launch-panel"
      data-intent={intent}
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
          {copy.title}
        </span>
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

      {launched === null ? (
        <>
          <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{copy.blurb}</p>
          <textarea
            data-testid="testing-launch-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should this campaign cover? Name the surfaces, risks, or behaviors to test."
            className="min-h-[4rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
            style={FIELD_STYLE}
          />

          {/* ── The scope: project + explicit codebases (the pinned union) ── */}
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

          {(viaProject.length > 0 || attachedVisible.length > 0 || projectRepos === 'loading') && (
            <div data-testid="testing-launch-chips" className="flex flex-wrap items-center gap-1">
              {projectRepos === 'loading' && (
                <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>resolving project repos…</span>
              )}
              {viaProject.map((r) => <Chip key={`p-${r}`} repo={r} source="project" />)}
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
          <div>
            <button
              data-testid="testing-launch-submit"
              type="button"
              disabled={!canLaunch}
              onClick={() => void launch()}
              className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {busy ? 'Launching…' : copy.cta}
            </button>
          </div>
        </>
      ) : launched.ids.length > 1 ? (
        // ── The fan-out, honestly: one run per attached codebase, each a real link. ──
        <div data-testid="testing-launch-fanout" className="flex flex-col gap-1">
          <p className="text-[11px]" style={{ color: 'var(--ink-high)' }}>
            {launched.ids.length} runs launched
            {launched.campaign !== null ? (
              <> under <span className="font-mono" data-testid="testing-launch-fanout-label">{launched.campaign}</span></>
            ) : (
              <> — one per attached codebase, under one campaign label</>
            )}
            .
          </p>
          <div className="flex flex-wrap gap-2">
            {launched.ids.map((id) => (
              <button
                key={id}
                type="button"
                data-testid="testing-launch-fanout-run"
                data-run-id={id}
                onClick={() => navigate(`/runs/${encodeURIComponent(id)}`)}
                className="font-mono text-[10px] underline"
                style={{ color: 'var(--accent)' }}
              >
                {id.slice(0, 8)}
              </button>
            ))}
          </div>
          <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            Each sibling stops at its own intake gate — gates surface everywhere gates do, and
            the campaign&rsquo;s progress lands on this page.
          </p>
        </div>
      ) : resolved ? (
        <p data-testid="testing-launch-resolved" className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Intake gate answered — the campaign&rsquo;s progress lands on{' '}
          <button
            type="button"
            data-testid="testing-launch-to-campaigns"
            onClick={() => navigate(testingPath('campaigns'))}
            className="underline"
            style={{ color: 'var(--accent)' }}
          >
            Campaigns
          </button>
          , and the run itself is at{' '}
          <button
            type="button"
            onClick={() => navigate(`/runs/${encodeURIComponent(gateRunId!)}`)}
            className="font-mono underline"
            style={{ color: 'var(--accent)' }}
          >
            {gateRunId!.slice(0, 8)}
          </button>
          .
        </p>
      ) : gate === undefined ? (
        <p data-testid="testing-launch-waiting" className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Run <span className="font-mono">{gateRunId!.slice(0, 8)}</span> launched — its intake
          gate will appear here the moment the run asks. It also shows up everywhere gates do.
        </p>
      ) : (
        // The intake gate — the EXISTING gate card, reused verbatim. Approving (optionally
        // with steer text) is what launches the proposed campaign; rejecting launches nothing.
        <SteeringGate
          runId={gateRunId!}
          ord={gate.ord}
          prompt={gate.prompt}
          onResolved={() => setResolved(true)}
        />
      )}
    </div>
  );
}
