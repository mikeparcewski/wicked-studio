import type { SessionView } from '../api/types.js';
import { agentsOf, durationMin, outcomeOf, projectOf, workflowOf, type AgentRow, type WorkflowRow } from './deskInsights.js';

/**
 * UNDERSTAND'S SIDE-BY-SIDE (DES-desk-v2 §0.4, the approved concept): one card per selected item, the
 * same metric rows on every card, a "best" mark on the row's winner (only when two or more items are
 * compared and one strictly wins), and a few "where they differ" sentences said in plain words. Pure.
 * Small-sample honesty: a rate under 20 is a count ("1 of 1"), and the summary carries a caveat.
 */

export type CellTone = 'ok' | 'warn' | null;
export interface CompareCell { text: string; best: boolean; tone: CellTone; tag?: boolean; title?: string }
export interface CompareCard { id: string; label: string; color: string | null; cells: CompareCell[] }
export interface CompareView { rows: string[]; cards: CompareCard[]; differ: string[]; small: boolean }

type Better = 'high' | 'low' | null;
interface Metric { label: string; better: Better; value: (i: number) => number | null; text: (i: number) => string; tone?: (i: number) => CellTone; tag?: boolean; title?: string }

const SMALL = 20;
const money = (v: number | null): string => (v === null ? '—' : v === 0 ? '$0' : v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`);
const mins = (m: number | null): string => (m === null ? '—' : m < 1 ? '<1 min' : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);
const rate = (k: number, n: number): string => (n === 0 ? '—' : n < SMALL ? `${k} of ${n}` : `${Math.round((k / n) * 100)}%`);

function build(ids: readonly { id: string; label: string; color: string | null }[], metrics: readonly Metric[]): CompareCard[] {
  const best = metrics.map((m) => {
    if (m.better === null || ids.length < 2) return -1;
    const vals = ids.map((_, i) => m.value(i));
    const known = vals.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null);
    if (known.length < 2) return -1;
    const top = m.better === 'high' ? Math.max(...known.map((x) => x.v)) : Math.min(...known.map((x) => x.v));
    const winners = known.filter((x) => x.v === top);
    return winners.length === 1 ? winners[0]!.i : -1;
  });
  return ids.map((it, i) => ({
    ...it,
    cells: metrics.map((m, r) => ({ text: m.text(i), best: best[r] === i, tone: m.tone?.(i) ?? null, ...(m.tag === true ? { tag: true } : {}), ...(m.title !== undefined ? { title: m.title } : {}) })),
  }));
}

export interface GovernanceOf { (cli: string): { word: string; tone: CellTone; unchecked: number } }

export function compareAgents(rows: readonly AgentRow[], governance: GovernanceOf, color: (cli: string) => string): CompareView {
  const g = rows.map((r) => governance(r.cli));
  const metrics: Metric[] = [
    { label: 'Steps run', better: null, value: (i) => rows[i]!.steps, text: (i) => String(rows[i]!.steps) },
    { label: 'Passed checks first time', better: 'high', value: (i) => rows[i]!.firstPassRate, text: (i) => rate(Math.round((rows[i]!.firstPassRate ?? 0) * rows[i]!.gated), rows[i]!.gated) },
    { label: 'Reworked', better: 'low', value: (i) => (rows[i]!.steps > 0 ? rows[i]!.rework : null), text: (i) => String(rows[i]!.rework) },
    { label: 'Sat out', better: 'low', value: (i) => rows[i]!.benched, text: (i) => String(rows[i]!.benched) },
    { label: 'Cost per priced use', title: 'Cost divided by priced usage records.', better: 'low', value: (i) => rows[i]!.costPerPricedUse, text: (i) => money(rows[i]!.costPerPricedUse) },
    { label: 'Governance', better: null, value: () => null, text: (i) => g[i]!.word, tone: (i) => g[i]!.tone, tag: true },
  ];
  const cards = build(rows.map((r) => ({ id: r.cli, label: r.label, color: color(r.cli) })), metrics);
  const differ: string[] = [];
  if (rows.length >= 2) {
    const most = [...rows].sort((a, b) => b.steps - a.steps)[0]!;
    if (most.steps > 0) differ.push(`${most.label} does most of the work (${most.steps} steps)${most.benched === 0 ? ' and never sat out' : ''}${most.gated > 0 && most.rework / Math.max(1, most.steps) >= 0.3 ? `, but needed rework on ${most.rework} of ${most.steps} steps` : ''}.`);
    const priced = rows.filter((r) => r.costPerPricedUse !== null);
    if (priced.length >= 2) { const c = [...priced].sort((a, b) => a.costPerPricedUse! - b.costPerPricedUse!)[0]!; differ.push(`${c.label} is the cheapest per priced use (${money(c.costPerPricedUse)}).`); }
    for (const [i, r] of rows.entries()) {
      if (r.benched > 0) {
        const top = Object.entries(r.benchReasons).sort((a, b) => b[1] - a[1])[0];
        differ.push(`${r.label} sat out ${r.benched} ${r.benched === 1 ? 'time' : 'times'}${top !== undefined ? ` (mostly ${top[0].replace(/_/g, ' ')})` : ''}${g[i]!.unchecked > 0 ? ` and ran without its governance checks ${g[i]!.unchecked === 1 ? 'once' : `${g[i]!.unchecked} times`} across all recorded runs (studio-wide)` : ''}.`);
      } else if (g[i]!.unchecked > 0) differ.push(`${r.label} ran without its governance checks ${g[i]!.unchecked === 1 ? 'once' : `${g[i]!.unchecked} times`} across all recorded runs (studio-wide).`);
    }
  }
  return { rows: metrics.map((m) => m.label), cards, differ: differ.slice(0, 5), small: rows.reduce((a, r) => a + r.steps, 0) < SMALL };
}

export function compareWorkflows(rows: readonly WorkflowRow[]): CompareView {
  const ended = (r: WorkflowRow): number => r.finished + r.failed + r.stopped;
  const metrics: Metric[] = [
    { label: 'Jobs', better: null, value: (i) => rows[i]!.jobs, text: (i) => String(rows[i]!.jobs) },
    { label: 'Finished', better: 'high', value: (i) => rows[i]!.successRate, text: (i) => rate(rows[i]!.finished, ended(rows[i]!)) },
    { label: 'Failed', better: 'low', value: (i) => rows[i]!.failed, text: (i) => String(rows[i]!.failed) },
    { label: 'Typical time', better: 'low', value: (i) => rows[i]!.medianMin, text: (i) => mins(rows[i]!.medianMin) },
    { label: 'Steps per job', better: null, value: (i) => rows[i]!.avgSteps, text: (i) => (rows[i]!.avgSteps === null ? '—' : rows[i]!.avgSteps!.toFixed(1)) },
    { label: 'Delivered', better: 'high', value: (i) => rows[i]!.delivered, text: (i) => String(rows[i]!.delivered) },
  ];
  const cards = build(rows.map((r) => ({ id: r.key, label: r.label, color: null })), metrics);
  const differ: string[] = [];
  if (rows.length >= 2) {
    const busiest = [...rows].sort((a, b) => b.jobs - a.jobs)[0]!;
    differ.push(`${busiest.label} runs most often (${busiest.jobs} ${busiest.jobs === 1 ? 'job' : 'jobs'}).`);
    for (const r of rows) if (r.failed > 0) differ.push(`${r.label}: ${r.failed} of ${ended(r)} ended jobs failed.`);
    const timed = rows.filter((r) => r.medianMin !== null);
    if (timed.length >= 2) { const f = [...timed].sort((a, b) => a.medianMin! - b.medianMin!)[0]!; differ.push(`${f.label} finishes fastest (typically ${mins(f.medianMin)}).`); }
  }
  return { rows: metrics.map((m) => m.label), cards, differ: differ.slice(0, 5), small: rows.reduce((a, r) => a + r.jobs, 0) < SMALL };
}

export function compareJobs(runs: readonly SessionView[], title: (v: SessionView) => string, agentName: (cli: string) => string, cost: (id: string) => number | null | undefined): CompareView {
  const metrics: Metric[] = [
    { label: 'Workflow', better: null, value: () => null, text: (i) => workflowOf(runs[i]!).label },
    { label: 'Outcome', better: null, value: () => null, text: (i) => outcomeOf(runs[i]!) ?? 'Unknown', tone: (i) => (outcomeOf(runs[i]!) === 'Failed' ? 'warn' : outcomeOf(runs[i]!) === 'Finished' ? 'ok' : null), tag: true },
    { label: 'Time', better: 'low', value: (i) => durationMin(runs[i]!), text: (i) => mins(durationMin(runs[i]!)) },
    { label: 'Steps done', better: 'high', value: (i) => (runs[i]!.units ?? []).filter((u) => u.status === 'done').length, text: (i) => `${(runs[i]!.units ?? []).filter((u) => u.status === 'done').length} of ${(runs[i]!.units ?? []).length}` },
    { label: 'Steps refused', better: 'low', value: (i) => (runs[i]!.units ?? []).filter((u) => u.status === 'rejected').length, text: (i) => String((runs[i]!.units ?? []).filter((u) => u.status === 'rejected').length) },
    { label: 'Agents', better: null, value: () => null, text: (i) => agentsOf(runs[i]!).map(agentName).join(', ') || '—' },
    { label: 'Spend', better: 'low', value: (i) => cost(runs[i]!.session.id) ?? null, text: (i) => { const c = cost(runs[i]!.session.id); return c === undefined ? 'Reading…' : money(c); } },
  ];
  const cards = build(runs.map((v) => ({ id: v.session.id, label: title(v), color: null })), metrics);
  const differ: string[] = [];
  if (runs.length >= 2) {
    const wfs = new Set(runs.map((v) => workflowOf(v).key));
    if (wfs.size > 1) differ.push('They ran different workflows, so their steps are not like for like.');
    const ok = runs.filter((v) => outcomeOf(v) === 'Finished');
    const bad = runs.filter((v) => outcomeOf(v) === 'Failed');
    if (ok.length > 0 && bad.length > 0) {
      const b = bad[0]!;
      const at = (b.units ?? []).find((u) => u.status === 'rejected' || u.status === 'pending');
      differ.push(`${title(ok[0]!)} finished; ${title(b)} failed${at !== undefined ? ` at step ${at.ord}${typeof at.assigned_cli === 'string' ? ` (${agentName(at.assigned_cli)})` : ''}` : ''}.`);
    }
    const ag = runs.map((v) => agentsOf(v).join(','));
    if (new Set(ag).size > 1) differ.push('Different agents worked on them.');
  }
  return { rows: metrics.map((m) => m.label), cards, differ, small: true };
}

export function compareProjects(ids: readonly string[], kept: readonly SessionView[], name: (id: string) => string): CompareView {
  const data = ids.map((id) => {
    const vs = kept.filter((v) => projectOf(v) === id);
    const o = vs.map(outcomeOf);
    const fin = o.filter((x) => x === 'Finished' || x === 'Answered').length;
    const ended = o.filter((x) => x !== null && x !== 'Working' && x !== 'Waiting on you').length;
    const m = vs.map(durationMin).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return { id, jobs: vs.length, fin, ended, failed: o.filter((x) => x === 'Failed').length, waiting: o.filter((x) => x === 'Waiting on you').length, med: m.length === 0 ? null : m[Math.floor((m.length - 1) / 2)]!, flows: new Set(vs.map((v) => workflowOf(v).key)).size };
  });
  const metrics: Metric[] = [
    { label: 'Jobs', better: null, value: (i) => data[i]!.jobs, text: (i) => String(data[i]!.jobs) },
    { label: 'Finished', better: 'high', value: (i) => (data[i]!.ended === 0 ? null : data[i]!.fin / data[i]!.ended), text: (i) => rate(data[i]!.fin, data[i]!.ended) },
    { label: 'Failed', better: 'low', value: (i) => data[i]!.failed, text: (i) => String(data[i]!.failed) },
    { label: 'Waiting on you', better: 'low', value: (i) => data[i]!.waiting, text: (i) => String(data[i]!.waiting) },
    { label: 'Typical time', better: 'low', value: (i) => data[i]!.med, text: (i) => mins(data[i]!.med) },
    { label: 'Workflows used', better: null, value: (i) => data[i]!.flows, text: (i) => String(data[i]!.flows) },
  ];
  const cards = build(ids.map((id) => ({ id, label: name(id), color: null })), metrics);
  const differ: string[] = [];
  if (ids.length >= 2) {
    const busiest = [...data].sort((a, b) => b.jobs - a.jobs)[0]!;
    differ.push(`${name(busiest.id)} has the most work (${busiest.jobs} jobs).`);
    for (const d of data) if (d.failed > 0) differ.push(`${name(d.id)} has ${d.failed} failed ${d.failed === 1 ? 'job' : 'jobs'}.`);
  }
  return { rows: metrics.map((m) => m.label), cards, differ: differ.slice(0, 5), small: data.reduce((a, d) => a + d.jobs, 0) < SMALL };
}

/**
 * The message "Generate insights" sends through Ask: the numbers on screen as a table, the evidence
 * links, and what to say. Unique per selection (the cache key is the selection).
 */
export function insightPrompt(kind: string, view: CompareView, days: number, links: readonly string[], scope: string | null = null): string {
  const head = `| | ${view.cards.map((c) => c.label).join(' | ')} |`;
  const rule = `|---|${view.cards.map(() => '---').join('|')}|`;
  const body = view.rows.map((r, k) => `| ${r} | ${view.cards.map((c) => c.cells[k]!.text).join(' | ')} |`);
  return [
    `Compare these ${kind} from my studio over the last ${days} days and tell me where they REALLY differ.`,
    ...(scope !== null ? [`The numbers below are for ${scope} only; read the evidence for that scope, not for all of studio.`] : []),
    '',
    head, rule, ...body,
    '',
    'Evidence you can read with curl -sL (the studio service API):',
    ...links.map((l) => `- ${l}`),
    '',
    'Answer in four short sections, plain words, no preamble:',
    '1. **Real differences**: the two to four differences that matter, each tied to the numbers above.',
    '2. **Likely causes**: why, from the records (quote the record or job when you can).',
    '3. **What to do**: two or three concrete recommendations.',
    `4. **How sure**: these are small numbers${view.small ? ' (under 20 jobs or steps)' : ''}; say what would change the conclusion.`,
    'Governance capability is not a verdict. ACP diagnostics counts are studio-wide across all recorded runs, not scoped to this window or project.',
    'Do not invent numbers that are not above or in the records. Change nothing.',
  ].join('\n');
}
