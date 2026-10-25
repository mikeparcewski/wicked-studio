import type { Project, RepoEntry, RosterSeat, SessionView } from '../api/types.js';
import { sessionProjectId } from '../hooks/ambientProject.js';
import { jobTitle } from './deskWords.js';
import { newestFailedRun, type NeedRow } from './needsYou.js';
import { pageNameFor } from './pageNames.js';
import { seatLabel, userSeats } from './seatNames.js';
import type { CliOption } from './chatCli.js';

/**
 * THE PAGE-AWARE SYSTEM CHAT (DES-SYSTEM-CHAT §7), pure: which page the chat is "seeing", what it is
 * called, the project and repo it implies (the scope chips' defaults), and the suggested prompts —
 * built from the page's LIVE data (the held gate, the benched CLI, the failed run). A prompt whose
 * referent the app does not hold is omitted, never filler.
 */

export type PageKind = 'run' | 'nerve' | 'steering' | 'repo' | 'project' | 'workflows' | 'home' | 'other';

export interface PageContext {
  kind: PageKind;
  /** The page in words: "the Desk", "Nerve Center", a run's title, a repo's name. */
  label: string;
  /** The project the page is in, when it is in one (the Project chip's default). */
  project: { id: string; name: string } | null;
  /** The repository the page is about, when it is about one (the Repo chip's default). */
  repo: { id: string; name: string } | null;
  /** On a run/session page: the run on screen. */
  run: SessionView | null;
}

export interface PageInputs {
  pathname: string;
  search?: string;
  runs: readonly SessionView[];
  projects: readonly Pick<Project, 'id' | 'name'>[];
  repos: readonly Pick<RepoEntry, 'id' | 'name'>[];
}

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** The newest run of a session id (`/s/:id` — a chat id, or `run:<id>`). */
function runOfSession(id: string, runs: readonly SessionView[]): SessionView | null {
  const runId = id.startsWith('run:') ? id.slice(4) : null;
  const hits = runs.filter((v) => v.session.id === id || (runId !== null && v.session.id === runId)
    || (v.session as { chat_id?: string | null }).chat_id === id);
  if (hits.length === 0) return null;
  return [...hits].sort((a, b) => Number((b.session as { created_at?: number }).created_at ?? 0) - Number((a.session as { created_at?: number }).created_at ?? 0))[0] ?? null;
}

function projectNamed(id: string | null | undefined, projects: PageInputs['projects']): { id: string; name: string } | null {
  if (id === null || id === undefined || id === '' || id === 'default') return null;
  return { id, name: projects.find((p) => p.id === id)?.name ?? id };
}

function repoNamed(ref: string | null | undefined, repos: PageInputs['repos']): { id: string; name: string } | null {
  if (ref === null || ref === undefined || ref === '') return null;
  const hit = repos.find((r) => r.id === ref || r.name === ref);
  return hit !== undefined ? { id: hit.id, name: hit.name } : { id: ref, name: ref };
}

/** What page the chat is seeing. */
export function pageContext({ pathname, search = '', runs, projects, repos }: PageInputs): PageContext {
  const path = pathname.split('?')[0] ?? pathname;
  const [, first = '', second = ''] = path.split('/');
  const query = search !== '' ? search : pathname.includes('?') ? pathname.slice(pathname.indexOf('?')) : '';
  const queryProject = new URLSearchParams(query).get('project');
  const base = { project: projectNamed(queryProject, projects), repo: null, run: null };
  if (first === '') return { ...base, kind: 'home', label: 'the Desk' };
  // Nerve Center (DES-SYSTEM-VIEW) lands on /watch, and /health folds into it.
  if (first === 'watch' || first === 'health') return { ...base, kind: 'nerve', label: 'Nerve Center' };
  if (first === 'steering' || first === 'rules') return { ...base, kind: 'steering', label: 'Steering' };
  if (first === 'workflows') return { ...base, kind: 'workflows', label: 'Workflows' };
  if (first === 'repo-detail' && second !== '') {
    const repo = repoNamed(decode(second), repos);
    return { ...base, kind: 'repo', label: repo?.name ?? 'this repository', repo };
  }
  if ((first === 'projects' || first === 'p') && second !== '') {
    const project = projectNamed(decode(second), projects);
    // The Unfiled bucket (`default`) is not a project: its page gets the Desk's prompts.
    if (project === null) return { ...base, kind: 'other', label: 'work not in a project' };
    return { ...base, kind: 'project', label: project.name, project };
  }
  if (first === 's' && second !== '') {
    const run = runOfSession(decode(second), runs);
    if (run === null) return { ...base, kind: 'run', label: 'this chat', run: null };
    return {
      kind: 'run',
      label: jobTitle(run.session),
      run,
      project: projectNamed(sessionProjectId(run.session) ?? null, projects),
      repo: repoNamed(run.session.repo_ref, repos),
    };
  }
  return { ...base, kind: 'other', label: pageNameFor(path) ?? 'this page' };
}

/** The input's placeholder: "Ask about the Desk…". */
export function pagePlaceholder(ctx: PageContext): string {
  return `Ask about ${ctx.label}…`;
}

export interface PagePromptInputs {
  ctx: PageContext;
  runs: readonly SessionView[];
  /** The Desk's needs-you rows (the one queue fold). */
  needRows: readonly NeedRow[];
  /** Open gates by run id (the gate store). */
  gates: Readonly<Record<string, { prompt: string }>>;
  /** The CLI picker's options: a benched or signed-out one is Nerve Center's news. */
  clis: readonly CliOption[];
  roster: readonly RosterSeat[] | null;
  projects: readonly Pick<Project, 'id' | 'name' | 'updated_at'>[];
  repos: readonly Pick<RepoEntry, 'id' | 'name'>[];
}

export interface PagePrompt { label: string; text: string }

const quote = (s: string): string => `“${s}”`;

function runPrompts(ctx: PageContext, gates: PagePromptInputs['gates']): PagePrompt[] {
  const run = ctx.run;
  if (run === null) return [{ label: 'What has this chat found so far?', text: 'Sum up what this chat has found so far, and what is still open.' }];
  const s = run.session;
  const title = jobTitle(s);
  const gate = gates[s.id];
  const out: PagePrompt[] = [];
  if (s.status === 'awaiting_human' || gate !== undefined) {
    out.push({
      label: 'Why is this run held, and what should I do?',
      text: `Why is the run ${quote(title)} (${s.id}) held${gate !== undefined && gate.prompt.trim() !== '' ? ` at ${quote(gate.prompt.trim())}` : ''}, and what should I do?`,
    });
  } else if (s.status === 'failed') {
    out.push({ label: `Why did ${quote(title)} fail?`, text: `Why did the run ${quote(title)} (${s.id}) fail? Walk its record and its evidence.` });
  } else if (s.status === 'cancelled') {
    out.push({ label: 'Why was this run stopped?', text: `Why was the run ${quote(title)} (${s.id}) stopped, and is anything left half done?` });
  } else if (s.status === 'completed') {
    out.push({ label: 'What did this run change?', text: `What did the run ${quote(title)} (${s.id}) change, and what evidence backs it?` });
  } else {
    out.push({ label: 'What is this run doing right now?', text: `What is the run ${quote(title)} (${s.id}) doing right now, and how far along is it?` });
  }
  if (s.status !== 'completed') out.push({ label: 'What has it changed so far?', text: `What has the run ${quote(title)} (${s.id}) changed so far?` });
  return out;
}

function nervePrompts({ clis, needRows }: PagePromptInputs): PagePrompt[] {
  const out: PagePrompt[] = [{ label: 'What’s stopping work right now?', text: 'What’s stopping work right now? Name each blocker, why, and the one thing to do about it.' }];
  const benched = clis.find((c) => !c.ok);
  if (benched !== undefined) {
    out.push({
      label: `Why is ${benched.label} out?`,
      text: `Why can’t ${benched.label} answer right now (${benched.reason ?? 'unavailable'}), what does it block, and what should I do?`,
    });
  }
  const waiting = needRows.length;
  if (waiting > 0) out.push({ label: `Which of the ${waiting} waiting items comes first?`, text: `${waiting} item${waiting === 1 ? ' is' : 's are'} waiting on me. Which comes first, and why?` });
  return out;
}

function repoPrompts(ctx: PageContext, runs: readonly SessionView[]): PagePrompt[] {
  const repo = ctx.repo;
  if (repo === null) return [];
  const out: PagePrompt[] = [
    { label: `What changed in ${repo.name} recently?`, text: `What changed in the repository ${quote(repo.name)} recently? Use its code and its job history.` },
    { label: `Where is ${repo.name} riskiest to change?`, text: `Where is the repository ${quote(repo.name)} riskiest to change? Use its code graph: hotspots and blast radius.` },
  ];
  const mine = runs.filter((v) => v.session.repo_ref === repo.id || v.session.repo_ref === repo.name);
  const failed = mine.find((v) => v.session.status === 'failed');
  if (failed !== undefined) {
    const t = jobTitle(failed.session);
    out.unshift({ label: `Why did ${quote(t)} fail?`, text: `Why did the run ${quote(t)} (${failed.session.id}) on ${repo.name} fail? Walk its record and its evidence.` });
  }
  return out;
}

function projectPrompts(ctx: PageContext, needRows: readonly NeedRow[], runs: readonly SessionView[]): PagePrompt[] {
  const project = ctx.project;
  if (project === null) return [];
  const runsIn = runs.filter((v) => sessionProjectId(v.session) === project.id);
  const ids = new Set(runsIn.map((v) => v.session.id));
  const waiting = needRows.filter((r) => ids.has(r.key.replace(/^[a-z-]+:/u, ''))).length;
  const out: PagePrompt[] = [
    { label: `How healthy is ${project.name}?`, text: `What’s in the project ${quote(project.name)}: its jobs, documents and repositories, and how healthy is it?` },
  ];
  if (waiting > 0) out.push({ label: `What’s waiting on me in ${project.name}?`, text: `${waiting} item${waiting === 1 ? '' : 's'} in ${quote(project.name)} ${waiting === 1 ? 'is' : 'are'} waiting on me. What should I answer first?` });
  if (runsIn.length > 0) out.push({ label: `What did ${project.name} ship lately?`, text: `What did the ${runsIn.length} job${runsIn.length === 1 ? '' : 's'} in ${quote(project.name)} change lately?` });
  return out;
}

/** The suggested prompts for the page on screen, newest-relevant first; at most four. */
export function pagePrompts(input: PagePromptInputs): PagePrompt[] {
  const { ctx, runs, needRows, gates, projects, repos } = input;
  let out: PagePrompt[];
  switch (ctx.kind) {
    case 'run': out = runPrompts(ctx, gates); break;
    case 'nerve': out = nervePrompts(input); break;
    case 'repo': out = repoPrompts(ctx, runs); break;
    case 'project': out = projectPrompts(ctx, needRows, runs); break;
    case 'steering':
      out = [
        { label: 'Which rules would block my next change?', text: 'Which steering rules would block or warn on a typical change here, and why?' },
        ...(ctx.project !== null ? [{ label: `Which rules apply to ${ctx.project.name}?`, text: `Which steering rules apply to the project ${quote(ctx.project.name)}, most severe first?` }] : []),
        { label: 'Where do the rules have gaps?', text: 'Where do the steering rules have gaps: behaviours no rule covers?' },
      ];
      break;
    case 'workflows':
      out = [
        { label: 'Which workflow fits a bug fix?', text: 'Which workflow should I use for a bug fix, and what do its gates check?' },
        { label: 'How do these workflows differ?', text: 'How do the workflows here differ in phases, gates and who reviews?' },
      ];
      break;
    default: {
      // The Desk (and any other page): the newest failure, the newest project and repo, and studio itself.
      out = [];
      const failed = newestFailedRun(needRows, runs as SessionView[]);
      if (failed !== undefined) {
        const t = jobTitle(failed.session);
        out.push({ label: `Why did ${quote(t)} fail?`, text: `Why did the job ${quote(t)} (${failed.session.id}) fail? Walk its record and its evidence.` });
      }
      if (needRows.length > 0) out.push({ label: `What needs me first?`, text: `${needRows.length} item${needRows.length === 1 ? ' is' : 's are'} waiting on me. Which comes first, and why?` });
      const project = [...projects].filter((p) => p.id !== 'default').sort((a, b) => b.updated_at - a.updated_at)[0];
      if (project !== undefined) out.push({ label: `What’s in ${project.name}?`, text: `What’s in the project ${quote(project.name)}: its jobs, documents and repositories, and how healthy is it?` });
      const repo = repos[0];
      if (repo !== undefined) out.push({ label: `What changed in ${repo.name}?`, text: `What changed in the repository ${quote(repo.name)} recently? Use its code and its job history.` });
      out.push({ label: 'Is studio healthy?', text: 'Is this studio healthy: the app, its service and what they depend on? Flag anything that is not.' });
    }
  }
  return out.slice(0, 4);
}

/** The roster's CLIs by name — for "Answered by". */
export function cliName(key: string, roster: readonly RosterSeat[] | null): string {
  const seat = userSeats(roster).find((s) => s.key === key) ?? (roster ?? []).find((s) => s.key === key);
  return seat !== undefined ? seatLabel(seat) : seatLabel({ key });
}
