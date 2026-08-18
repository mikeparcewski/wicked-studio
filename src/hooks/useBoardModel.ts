import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { listDocs, type DocSummary } from '../api/interactive.js';
import type { Project, ProjectMember, SessionView } from '../api/types.js';

/**
 * The orchestrator board's data model (DES-MERGE-001 §1.4, slice 5).
 *
 * STATIC by design: everything here comes from the REST surface on load — `GET
 * /projects`, `GET /runs` (owned by `useRuns`, passed in), each project's members,
 * and the interactive `listDocs` for projects bound to an interactive root. The
 * board goes live in slice 6; no WS subscription belongs in this file.
 *
 * Runs are joined to projects through MEMBERSHIP (`crew.run` / `crew.chat` refs) —
 * `AgentSession` carries no project id, so this is the only binding that exists.
 */

/** Attention buckets, most-urgent first — §1.4's sort key, spelled once. */
export type Attention = 'gate' | 'failing' | 'running' | 'drafts' | 'quiet';

const ORDER: readonly Attention[] = ['gate', 'failing', 'running', 'drafts', 'quiet'];

/** Statuses that mean the run is moving under its own power. */
const ACTIVE: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);

/** Membership kinds that make a run/thread a member of a project. */
const RUN_KINDS: ReadonlySet<string> = new Set(['crew.run', 'crew.chat']);

export interface BoardProject {
  project: Project;
  /** Display name of the bound repo (`crew.repo` member), or `null` when unbound. */
  repo: string | null;
  runs: SessionView[];
  docs: DocSummary[];
  attention: Attention;
}

/**
 * The nullable per-project setting that maps a project onto a wicked-interactive
 * root (§7.1). It rides `Project`'s forward-additive index signature, so it is read
 * defensively: no root, no `listDocs` call, and a card with no doc tiles.
 */
export function interactiveRootOf(p: Project): string | null {
  const v = p.interactiveRoot ?? p.interactive_root;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** §1.4's sort key. Gate-waiting first; ties break newest-updated, then by name. */
export function deriveAttention(runs: SessionView[], docs: DocSummary[]): Attention {
  if (runs.some((v) => v.session.status === 'awaiting_human')) return 'gate';
  if (runs.some((v) => v.session.status === 'failed')) return 'failing';
  if (runs.some((v) => ACTIVE.has(v.session.status))) return 'running';
  if (docs.length > 0) return 'drafts';
  return 'quiet';
}

export function sortByAttention(items: BoardProject[]): BoardProject[] {
  return [...items].sort(
    (a, b) =>
      ORDER.indexOf(a.attention) - ORDER.indexOf(b.attention) ||
      b.project.updated_at - a.project.updated_at ||
      a.project.name.localeCompare(b.project.name),
  );
}

/** Everything about a project that the run list itself cannot answer. */
interface Bindings {
  runIds: ReadonlySet<string>;
  repo: string | null;
  docs: DocSummary[];
}

const EMPTY: Bindings = { runIds: new Set(), repo: null, docs: [] };

async function loadBindings(p: Project, repoNames: Map<string, string>): Promise<Bindings> {
  const [members, docs] = await Promise.all([
    api.listProjectMembers(p.id).then((r) => r.members).catch((): ProjectMember[] => []),
    // No interactive root ⇒ no bridge to ask. A project WITH one whose bridge cannot be
    // started (§7.12) simply shows no tiles rather than failing the whole board.
    interactiveRootOf(p) ? listDocs(p.id).catch((): DocSummary[] => []) : Promise.resolve([]),
  ]);
  const repoRef = members.find((m) => m.member_kind === 'crew.repo')?.member_ref ?? null;
  return {
    runIds: new Set(members.filter((m) => RUN_KINDS.has(m.member_kind)).map((m) => m.member_ref)),
    repo: repoRef === null ? null : repoNames.get(repoRef) ?? repoRef,
    docs,
  };
}

export interface BoardModel {
  items: BoardProject[];
  loading: boolean;
  error: string | null;
}

export function useBoardModel(runs: SessionView[]): BoardModel {
  const [projects, setProjects] = useState<Project[]>([]);
  const [bindings, setBindings] = useState<Record<string, Bindings>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let active: Project[];
      let repoNames: Map<string, string>;
      try {
        const [{ projects: all }, repos] = await Promise.all([
          api.listProjects(),
          api.listRepos().then((r) => r.repos).catch(() => []),
        ]);
        active = all.filter((p) => p.status === 'active');
        repoNames = new Map(repos.map((r) => [r.id, r.name]));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;
      // Cards render as soon as the projects are known; tiles and chips fill in behind
      // them, so a slow bridge never holds the whole board on a spinner (§3.3).
      setProjects(active);
      setLoading(false);
      const entries = await Promise.all(
        active.map(async (p) => [p.id, await loadBindings(p, repoNames)] as const),
      );
      if (!cancelled) setBindings(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, []);

  const items = useMemo(
    () =>
      sortByAttention(
        projects.map((project) => {
          const b = bindings[project.id] ?? EMPTY;
          const mine = runs.filter((v) => b.runIds.has(v.session.id));
          return { project, repo: b.repo, runs: mine, docs: b.docs, attention: deriveAttention(mine, b.docs) };
        }),
      ),
    [projects, bindings, runs],
  );

  return { items, loading, error };
}
