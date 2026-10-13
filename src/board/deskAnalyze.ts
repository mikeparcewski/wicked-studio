import { workflowLaunchBody } from './launchModel.js';

type LaunchBody = ReturnType<typeof workflowLaunchBody>;
import type { RangeDays } from './deskInsights.js';

/**
 * "ANALYZE" ON THE DESK'S UNDERSTAND TAB (DES-desk-v2 §0.4): a governed run that studies the
 * selection. NO NEW WORKFLOW: it launches the existing `learn` workflow (scope → research → write a
 * sourced walkthrough, every claim tied to the source it came from) through the same
 * `POST /runs` body the New job wizard builds (`workflowLaunchBody`). The only new thing is the
 * intent: one well-formed, unique sentence set per analysis kind, naming the selected ids, the
 * refine window and the records it must read. Pure; the component confirms, then launches.
 */

export type AnalyzeKind = 'agents' | 'workflows' | 'jobs' | 'projects';

/** The existing workflow every analysis runs (see the DES for why `learn`). */
export const ANALYZE_WORKFLOW = 'learn';

export interface AnalyzeItem { id: string; label: string }

export interface AnalyzeInput {
  kind: AnalyzeKind;
  items: readonly AnalyzeItem[];
  days: RangeDays;
  /** The studio service's API base the run reads its evidence from (`apiBase()`, e.g. http://127.0.0.1:7701/api/v1). */
  api: string;
  /** The refine bar's other filters, said in the intent (null = all). */
  project: string | null;
  projectLabel: string | null;
}

const ASKS: Record<AnalyzeKind, { title: (n: number) => string; questions: readonly string[] }> = {
  agents: {
    title: (n) => `Analyze ${n === 1 ? 'one agent' : `${n} agents`}: performance, reliability, cost and fit`,
    questions: [
      'How does each agent perform: steps taken, checks passed first time, rework?',
      'How reliable is each one: times it sat out and why (signed out, quota, timeouts), failed steps, governance fallbacks?',
      'What does each cost, in total and per step?',
      'What are its typical failure modes, quoted from the failed steps?',
      'Where does each fit best (which workflows and step kinds), and where should it not be used?',
    ],
  },
  workflows: {
    title: (n) => `Analyze ${n === 1 ? 'one workflow' : `${n} workflows`}: outcomes, bottlenecks, gates and QE`,
    questions: [
      'What are the outcomes of each workflow: finished, failed, stopped, delivered?',
      'Which step is the bottleneck: where does the time go, and where do jobs stop?',
      'How do its gates go: approved, sent back, refused, and why?',
      'What did QE acceptance say on the jobs that required it?',
      'What one change would most improve each workflow’s outcomes?',
    ],
  },
  jobs: {
    title: (n) => `Analyze ${n === 1 ? 'one job' : `${n} jobs`}: what differed and why`,
    questions: [
      'What differed between these jobs: workflow, agents, steps, gates, time and cost?',
      'Where did their paths part, step by step?',
      'Why did the one that succeeded succeed, and why did the others not?',
      'What would have made the failing ones succeed?',
    ],
  },
  projects: {
    title: (n) => `Analyze ${n === 1 ? 'one project' : `${n} projects`}: health, spend and risk`,
    questions: [
      'How healthy is each project: jobs started, finished, failed, waiting on a person?',
      'Where is its spend going, by agent and by workflow?',
      'What are its risks: open failures, jobs that ran without governance checks, stale or missing code graphs?',
      'What should be fixed first in each, and why?',
    ],
  },
};

/** The records the run must read for each selected item (absolute URLs on the studio service). */
export function evidenceLinks(kind: AnalyzeKind, items: readonly AnalyzeItem[], days: RangeDays, api: string, project: string | null = null): string[] {
  const base = api.replace(/\/+$/, '');
  // On a project's page the agent record is the project's own (`?project=`); the unfiled shelf has none.
  const scoped = project !== null && project !== 'default' ? `&project=${encodeURIComponent(project)}` : '';
  const rec = `${base}/roster/record?days=${days}${scoped}`;
  if (kind === 'agents') return [rec, `${base}/roster`, `${base}/diagnostics`, `${base}/runs`];
  if (kind === 'workflows') return [`${base}/runs`, rec, `${base}/decisions`];
  if (kind === 'jobs') return items.flatMap((i) => [`${base}/runs/${encodeURIComponent(i.id)}`, `${base}/runs/${encodeURIComponent(i.id)}/events`]);
  return [...items.filter((i) => i.id !== 'default').map((i) => `${base}/roster/record?days=${days}&project=${encodeURIComponent(i.id)}`), `${base}/runs`, `${base}/projects`];
}

/** The run's intent: unique per kind, naming the ids, the window and the evidence. */
export function analysisIntent(input: AnalyzeInput): string {
  const a = ASKS[input.kind];
  const ids = input.items.map((i) => `${i.label} (${i.id})`).join('; ');
  const links = evidenceLinks(input.kind, input.items, input.days, input.api);
  return [
    `${a.title(input.items.length)}.`,
    `Selected ${input.kind}: ${ids}.`,
    `Window: the last ${input.days} days${input.project !== null ? `, project ${input.projectLabel ?? input.project}` : ''}.`,
    'Answer these questions, one section each:',
    ...a.questions.map((q, i) => `${i + 1}. ${q}`),
    'Sources: read these records from the studio service with curl -sL (they are the primary sources; cite each claim to the record and job it came from):',
    ...links.map((l) => `- ${l}`),
    'Use only what these records say. When a record cannot be read or does not hold the answer, say so; never estimate a number. Change no code and no settings.',
  ].join('\n');
}

/** The launch body: the New job wizard's own builder, the `learn` workflow, no delivery. */
export function analysisLaunchBody(input: AnalyzeInput, edited?: string): LaunchBody {
  // "Edit" on the confirm card: the operator's own words replace the drafted intent (never empty).
  const intent = edited !== undefined && edited.trim() !== '' ? edited : analysisIntent(input);
  return workflowLaunchBody({
    workflowId: ANALYZE_WORKFLOW,
    intent,
    seats: [],
    repoRef: null,
    projectId: input.project !== null && input.project !== 'default' ? input.project : null,
    humanConfirm: undefined,
    deliver: null,
    autoDeliverGate: false,
    reducedAssurance: false,
    skipQeReason: null,
    chatId: null,
  });
}

/** An earlier analysis job: a run of the analysis workflow whose words start the way ours do. */
export function isAnalysisRun(problem: string | null | undefined, workflow: string | null): boolean {
  return workflow === ANALYZE_WORKFLOW && /^Analyze (one|\d+) (agent|workflow|job|project)s?\b/.test((problem ?? '').trim());
}
