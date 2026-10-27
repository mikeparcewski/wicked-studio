import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Minus } from 'lucide-react';
import type { SessionView } from '../../api/types.js';
import {
  agentReportRows, beforeWords, changeOf, customLimits, customProblem, endedIn, firstPassOf, isoDate,
  periodBuckets, periodOf, periodWords, previousOf, recordBetween, recordReads, RECORD_REACH_DAYS, repoRows, shippedRows,
  spendOfDeltas, spendPerBucket, stepOf, sumOf, SYSTEM_WINDOW_DAYS, throughput, timeToPr, DAY_MS,
  type AgentReportRow, type Change, type CustomRange, type Ending, type Period, type PeriodKind, type RepoRow,
} from '../../board/reportModel.js';
import { durationWords, moneyWords } from '../../board/deskPulse.js';
import { jobTitle } from '../../board/deskWords.js';
import { useReportRecord } from '../../hooks/useReportRecord.js';
import { useQualityChecks } from '../../hooks/useQualityChecks.js';
import { useSystemPoll, useSystemStore } from '../../store/systemSnapshot.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { agentColor, StackedBars } from '../charts/Chart.js';
import { Segmented, Skeleton } from '../ui/index.js';
import { ago } from '../AgeStamp.js';

/**
 * THE REPORT (ui-v2; the `report` entry of design/mockups/desk-pages-redesign + the operator's
 * "more detailed, as they usually are … more whitespace, easy to scan"): one centred column, a title
 * and one sentence, the period as the one control, then one section after another: headline numbers
 * with their change, throughput, quality, cost, by repository, by agent, shipped.
 *
 * Every number is read off crew (board/reportModel says which field). A figure crew does not serve
 * says "Not tracked yet" with what it would need ({@link NotTracked}); nothing is ever invented.
 * Every chart has a text alternative and a data table behind it ({@link ChartFigure}).
 */
export function ReportPage({ runs, runsShown, now, navigate, projectId, agentName, pathOfRun, work }: {
  runs: readonly SessionView[];
  runsShown: boolean;
  now: number;
  navigate: Navigate;
  /** A project's page: the record is read for that project (`default` = no project: no spend of its own). */
  projectId?: string;
  agentName: (cli: string) => string;
  pathOfRun: (runId: string) => string;
  /** A fingerprint of finished work: when it moves, the record is read again. */
  work: string;
}): React.ReactElement {
  const [kind, setKind] = useState<PeriodKind>('7');
  const [custom, setCustom] = useState<CustomRange>(() => ({ from: isoDate(now - 13 * DAY_MS), to: isoDate(now) }));
  const customError = kind === 'custom' ? customProblem(custom, now) : null;
  // A custom range that can't be shown keeps the last good period on screen (with the reason said).
  const lastGood = useRef<Period>({ kind: '7', fromDays: 7, toDays: 0 });
  const picked = periodOf(kind, kind === 'custom' ? custom : null, now);
  const pk = picked ?? lastGood.current;
  useEffect(() => { if (picked !== null) lastGood.current = picked; });
  const period = useMemo<Period>(() => ({ kind: pk.kind, fromDays: pk.fromDays, toDays: pk.toDays }), [pk.kind, pk.fromDays, pk.toDays]);
  const prev = useMemo(() => previousOf(period), [period]);
  const before = beforeWords(period);
  const isLast7 = period.fromDays === SYSTEM_WINDOW_DAYS && period.toDays === 0;

  // ── Jobs (the run list) ──
  const { jobs, undated } = useMemo(() => endedIn(runs, period, now), [runs, period, now]);
  const prevJobs = useMemo(() => endedIn(runs, prev, now).jobs, [runs, prev, now]);
  const buckets = useMemo(() => periodBuckets(period, now), [period, now]);
  const per = stepOf(period) === 7 ? 'week' : 'day';
  const flow = useMemo(() => throughput(jobs, buckets), [jobs, buckets]);
  const ttp = timeToPr(jobs);
  const ttpPrev = timeToPr(prevJobs);
  const repos = useMemo(() => repoRows(jobs), [jobs]);
  const shipped = useMemo(() => shippedRows(jobs, (v) => jobTitle(v.session)), [jobs]);
  const delivered = shipped.length;

  // ── The agent record ──
  const noSpend = projectId === 'default';
  const record = useReportRecord(recordReads(period), projectId ?? null, work, !noSpend);
  const recordRead = record.phase === 'done';
  const now7 = recordRead && !noSpend ? recordBetween(record.reads, period.fromDays, period.toDays) : null;
  const prev7 = recordRead && !noSpend && prev.fromDays <= RECORD_REACH_DAYS ? recordBetween(record.reads, prev.fromDays, prev.toDays) : null;
  const spend = now7 === null ? null : spendOfDeltas(now7);
  const spendPrev = prev7 === null ? null : spendOfDeltas(prev7);
  const fp = now7 === null ? null : firstPassOf(now7);
  const fpPrev = prev7 === null ? null : firstPassOf(prev7);
  const spendDaily = useMemo(() => (recordRead && !noSpend ? spendPerBucket(record.reads, period, agentName) : null), [recordRead, noSpend, record.reads, period, agentName]);

  // ── /system: per-agent median and 429s, floors, gates (crew counts these for 7 days only) ──
  useSystemPoll();
  const snapshot = useSystemStore((s) => s.snapshot);
  const systemMode = useSystemStore((s) => s.mode);
  const sysClis = snapshot?.clis.map((c) => ({ key: c.key, name: c.name, medianMs: c.statsDays === SYSTEM_WINDOW_DAYS ? c.medianMs : null, rateLimited: c.statsDays === SYSTEM_WINDOW_DAYS ? c.rateLimited : null })) ?? null;
  const agents = now7 === null ? [] : agentReportRows(now7, sysClis, isLast7 && projectId === undefined, agentName);
  const gov = (key: string): { counts: Record<string, number> | null } | null => snapshot?.governance.find((g) => g.key === key) ?? null;

  // ── QE acceptance: one verdict read per finished job (newest first, capped) ──
  const qeIds = useMemo(() => [...jobs].sort((a, b) => (b.session.ended_at ?? 0) - (a.session.ended_at ?? 0)).map((v) => v.session.id), [jobs]);
  const qe = useQualityChecks(qeIds, work);

  // ── Headline ──
  const finishedChange = changeOf(jobs.length, prevJobs.length, 'good', (d) => String(d), before, ['more', 'fewer'], true);
  const fpChange = fp?.rate == null || fpPrev?.rate == null ? null
    : changeOf(Math.round(fp.rate * 100), Math.round(fpPrev.rate * 100), 'good', (d) => `${d} pts`, before, ['higher', 'lower']);
  const ttpChange = changeOf(ttp.minutes, ttpPrev.minutes, 'bad', (d) => durationWords(d), before, ['slower', 'faster']);
  const spendChange = spend === null || spendPrev === null || spend.partial || spendPrev.partial ? null
    : changeOf(spend.usd, spendPrev.usd, 'bad', (d) => moneyWords(d), before, ['more', 'less'], true);

  const lede = !runsShown ? 'Reading your jobs…'
    : `${periodWords(period, now)}: ${count(jobs.length, 'job')} finished, ${delivered} delivered${spend !== null && !noSpend ? `, ${spend.partial ? 'at least ' : ''}${moneyWords(spend.usd)} spent` : ''}.`;

  const goLast7 = (): void => setKind('7');
  const limits = customLimits(now);

  return (
    <div className="wk-rep" data-testid="report-page">
      <div className="wk-rep-col">
        <header className="wk-rep-head">
          <div className="wk-rep-hello">
            <h1 className="wk-rep-title">Report</h1>
            <p className="wk-rep-lede" data-testid="report-lede">{lede}</p>
          </div>
          <div className="wk-rep-period">
            <Segmented label="Period" data-testid="report-period" value={kind}
              options={[{ value: '7', label: '7 days', testId: 'report-period-7' }, { value: '30', label: '30 days', testId: 'report-period-30' }, { value: 'custom', label: 'Custom', testId: 'report-period-custom' }]}
              onChange={setKind} />
          </div>
        </header>
        {kind === 'custom' && (
          <div className="wk-rep-custom" role="group" aria-label="Custom period" data-testid="report-custom">
            <label className="wk-rep-date"><span>From</span>
              <input type="date" className="wk-field" data-testid="report-custom-from" value={custom.from} min={limits.min} max={limits.max}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label className="wk-rep-date"><span>To</span>
              <input type="date" className="wk-field" data-testid="report-custom-to" value={custom.to} min={limits.min} max={limits.max}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
            <p className="wk-rep-custom-note" data-testid="report-custom-note" {...(customError !== null ? { role: 'alert', 'data-tone': 'fail' } : {})}>
              {customError ?? `Both dates included. A day is the 24 hours up to this time of day on that date, the way crew’s record counts it. The record reaches back ${RECORD_REACH_DAYS} days.`}
            </p>
          </div>
        )}

        {/* 1. Headline numbers */}
        <section className="wk-rep-sec" aria-labelledby="report-h-headline">
          <h2 id="report-h-headline" className="wk-rep-label">{periodWords(period, now)}</h2>
          <ul className="wk-rep-tiles" data-testid="report-headline">
            <Tile testId="report-tile-finished" label="jobs finished" loading={!runsShown} value={String(jobs.length)} change={finishedChange}
              note={undated > 0 ? `${undated} ended with no end time and ${undated === 1 ? 'is' : 'are'} left out` : null} />
            <Tile testId="report-tile-firstpass" label="passed first time" loading={!noSpend && !recordRead}
              value={fp === null ? null : fp.rate === null ? '—' : fp.gated < 20 ? `${fp.passed} of ${fp.gated}` : `${Math.round(fp.rate * 100)}%`}
              change={fp !== null && fp.gated < 20 ? null : fpChange}
              note={noSpend ? 'counted per project: work in no project has no record of its own' : fp === null ? 'Couldn’t read the agent record for this period'
                : fp.rate === null ? 'no checked steps in this period' : fp.gated < 20 ? 'checked steps that passed first try (too few to compare)' : `of ${fp.gated} checked steps`}
/>
            <Tile testId="report-tile-ttp" label="median time to PR" loading={!runsShown} value={ttp.minutes === null ? '—' : durationWords(ttp.minutes)} change={ttpChange}
              note={ttp.n === 0 ? 'no pull request opened in this period' : `start to PR, over ${count(ttp.n, 'delivered job')}`} />
            <Tile testId="report-tile-spend" label="spend" loading={!noSpend && !recordRead}
              value={spend === null ? null : `${spend.partial ? '≥ ' : ''}${moneyWords(spend.usd)}`} change={spendChange}
              note={noSpend ? 'spend is counted per project' : now7 === null ? 'Couldn’t read spend for this period' : spend === null ? 'usage recorded, no price reported' : spend.partial ? 'priced usage only: some agents report no price' : null}
/>
          </ul>
        </section>

        {/* 2. Throughput */}
        <section className="wk-rep-sec" aria-labelledby="report-h-flow" data-testid="report-throughput">
          <SecHead id="report-h-flow" label="Throughput" meta={`jobs finished per ${per}, by how they ended`} />
          {!runsShown ? <Skeleton rows={3} variant="line" /> : jobs.length === 0 ? <p className="wk-rep-quiet">No job finished in this period.</p> : (
            <ChartFigure summary={`${count(jobs.length, 'job')} finished: ${flow.filter((s) => sumOf(s.values) > 0).map((s) => `${sumOf(s.values)} ${ENDING_WORDS[s.key]}`).join(', ')}.`}
              table={{ caption: `Jobs finished per ${per}`, cols: buckets.map((b) => b.title), rows: flow.map((s) => ({ label: s.label, values: s.values.map(String) })) }} testId="report-throughput-chart">
              <StackedBars buckets={buckets} series={flow.map((s) => ({ ...s, color: ENDING_COLOR[s.key] }))} format={(v) => String(Math.round(v))}
                label={`Jobs finished per ${per}, ${periodWords(period, now).toLowerCase()}, by how they ended`} height={180} ownTable />
            </ChartFigure>
          )}
          <p className="wk-rep-note">Delivered: a pull request opened or the branch pushed. Done, nothing to ship: an answer, an onboarding, a job with no change to deliver. Stopped: cancelled before it ended.</p>
        </section>

        {/* 3. Quality */}
        <section className="wk-rep-sec" aria-labelledby="report-h-quality" data-testid="report-quality">
          <SecHead id="report-h-quality" label="Quality" />
          <div className="wk-rep-trio">
            <div className="wk-rep-block" data-testid="report-qe">
              <h3 className="wk-rep-block-title">QE acceptance</h3>
              {!runsShown || qe.tally === null ? <Skeleton rows={2} variant="line" /> : qe.tally.recorded === 0 ? (
                <p className="wk-rep-quiet">{jobs.length === 0 ? 'No job finished in this period.' : qe.failed > 0 && qe.tally.read === 0 ? 'Couldn’t read the verdicts.' : 'No QE verdict recorded for these jobs.'}</p>
              ) : (
                <>
                  <p className="wk-rep-big">{qe.tally.recorded < 20 ? `${qe.tally.passed} of ${qe.tally.recorded}` : `${Math.round((qe.tally.passed / qe.tally.recorded) * 100)}%`}</p>
                  <Meter parts={[{ key: 'passed', label: 'Passed', value: qe.tally.passed, color: 'var(--status-ok)' }, { key: 'failed', label: 'Not passed', value: qe.tally.recorded - qe.tally.passed, color: 'var(--status-fail)' }]} label="QE acceptance verdicts" />
                  <p className="wk-rep-note">passed acceptance, of the finished jobs with a verdict{qe.capped ? ` (the newest ${qe.tally.read} jobs read)` : ''}{qe.failed > 0 ? `; ${qe.failed} couldn’t be read` : ''}</p>
                </>
              )}
            </div>
            <div className="wk-rep-block" data-testid="report-floors">
              <h3 className="wk-rep-block-title">Floor outcomes</h3>
              <SevenDay isLast7={isLast7} mode={systemMode} snapshotRead={snapshot !== null} onLast7={goLast7} what="floor outcomes">
                {(() => {
                  const c = gov('floor_outcomes')?.counts ?? null;
                  if (c === null) return <NotTracked feed="floor-outcomes" why="Crew served no floor counts." />;
                  const parts = [
                    { key: 'passed', label: 'Passed', value: c['passed'] ?? 0, color: 'var(--status-ok)' },
                    { key: 'failed', label: 'Failed', value: c['failed'] ?? 0, color: 'var(--status-fail)' },
                    { key: 'timed_out', label: 'Timed out', value: c['timed_out'] ?? 0, color: 'var(--status-warn)' },
                    { key: 'not_run', label: 'Not run', value: c['not_run'] ?? 0, color: 'var(--status-done)' },
                  ];
                  const total = sumOf(parts.map((p) => p.value));
                  return (
                    <>
                      <p className="wk-rep-big">{total === 0 ? '—' : `${parts[0]!.value} of ${total}`}</p>
                      <Meter parts={parts} label="Floor outcomes" />
                      <dl className="wk-rep-dl">
                        {parts.map((p) => <div key={p.key}><dt><i className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: p.color }} aria-hidden />{p.label}</dt><dd>{p.value}</dd></div>)}
                        <div><dt>Overridden</dt><dd><NotTracked feed="floor-overridden" why="Crew's floor counts have no overridden outcome yet." /></dd></div>
                      </dl>
                    </>
                  );
                })()}
              </SevenDay>
            </div>
            <div className="wk-rep-block" data-testid="report-gates">
              <h3 className="wk-rep-block-title">Gates answered</h3>
              <SevenDay isLast7={isLast7} mode={systemMode} snapshotRead={snapshot !== null} onLast7={goLast7} what="gates answered">
                {(() => {
                  const c = gov('gates_answered')?.counts ?? null;
                  if (c === null) return <NotTracked feed="gates-answered" why="Crew served no gate counts." />;
                  const you = c['byYou'] ?? 0;
                  const judges = c['byJudges'] ?? 0;
                  const parts = [{ key: 'you', label: 'By you', value: you, color: 'var(--accent)' }, { key: 'judges', label: 'By judges', value: judges, color: 'var(--status-gate)' }];
                  return (
                    <>
                      <p className="wk-rep-big">{you + judges}</p>
                      <Meter parts={parts} label="Gates answered by you and by judges" />
                      <dl className="wk-rep-dl">
                        {parts.map((p) => <div key={p.key}><dt><i className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: p.color }} aria-hidden />{p.label}</dt><dd>{p.value}</dd></div>)}
                      </dl>
                    </>
                  );
                })()}
              </SevenDay>
            </div>
          </div>
        </section>

        {/* 4. Cost */}
        <section id="desk-focus-spend" className="wk-rep-sec" aria-labelledby="report-h-cost" data-testid="report-cost">
          <SecHead id="report-h-cost" label="Cost" meta={`spend per ${per}, by agent`} />
          {noSpend ? <p className="wk-rep-quiet">Spend is counted per project, so work in no project has none of its own.</p>
            : !recordRead ? <Skeleton rows={3} variant="line" />
            : spendDaily === null ? <p className="wk-rep-quiet" data-tone="fail">Couldn’t read spend for every {per} of this period (a read failed or the record left out older runs), so no {per} is drawn.</p>
            : spend === null ? <p className="wk-rep-quiet" data-testid="report-spend-unknown">Spend unknown: usage recorded, no price reported.</p>
            : spendDaily.length === 0 ? <p className="wk-rep-quiet">No priced usage in this period.</p> : (
              <ChartFigure summary={`Spend per ${per}: ${spendDaily.map((s) => `${s.label} ${moneyWords(sumOf(s.values))}`).join(', ')}.`}
                table={{ caption: `Spend per ${per} by agent`, cols: buckets.map((b) => b.title), rows: spendDaily.map((s) => ({ label: s.label, values: s.values.map(moneyWords) })) }} testId="report-spend-chart">
                <StackedBars buckets={buckets} series={spendDaily.map((s) => ({ ...s, color: agentColor(s.key) }))} format={money} label={`Spend per ${per} by agent, ${periodWords(period, now).toLowerCase()}`} height={160} ownTable />
              </ChartFigure>
            )}
          <div className="wk-rep-pair">
            <div className="wk-rep-sub" data-testid="report-spend-agents">
              <h3 className="wk-rep-block-title">Per agent</h3>
              {noSpend || !recordRead || now7 === null ? <p className="wk-rep-quiet">{noSpend ? '—' : !recordRead ? 'Reading…' : 'Couldn’t read the agent record.'}</p> : (
                <SpendTable rows={agents} />
              )}
            </div>
            <div className="wk-rep-sub" data-testid="report-spend-repos">
              <h3 className="wk-rep-block-title">Per repository</h3>
              <NotTracked feed="spend-per-repo" block why="Crew records cost per agent and per project, not per repository or per job." />
            </div>
          </div>
        </section>

        {/* 5. By repository */}
        <section className="wk-rep-sec" aria-labelledby="report-h-repos" data-testid="report-repos">
          <SecHead id="report-h-repos" label="By repository" meta="jobs that finished in this period" />
          {!runsShown ? <Skeleton rows={3} variant="line" /> : repos.length === 0 ? <p className="wk-rep-quiet">No job finished in this period.</p> : (
            <SortTable<RepoRow> caption="Jobs finished by repository" testId="report-repos-table" rows={repos} rowKey={(r) => r.key} initial="jobs"
              cols={[
                { key: 'repo', label: 'Repository', sort: (r) => r.label, cell: (r) => r.label, head: true },
                { key: 'jobs', label: 'Jobs', num: true, sort: (r) => r.jobs, cell: (r) => <>{r.jobs}{r.delivered > 0 && <span className="wk-rep-dim"> · {r.delivered} delivered</span>}</> },
                { key: 'pass', label: 'Pass rate', num: true, sort: (r) => r.passRate ?? -1, cell: (r) => rateText(r.ok, r.jobs) },
                { key: 'median', label: 'Median time', num: true, sort: (r) => r.medianMin ?? -1, cell: (r) => (r.medianMin === null ? '—' : durationWords(r.medianMin)) },
                { key: 'spend', label: 'Spend', num: true, cell: () => <NotTracked feed="spend-per-repo" short why="Crew records no spend per repository yet." /> },
              ]} />
          )}
          <p className="wk-rep-note">Pass rate: jobs that ended well (delivered, or done with nothing to ship) of the jobs that ended, stopped ones included. Median time: start to end.</p>
        </section>

        {/* 6. By agent */}
        <section className="wk-rep-sec" aria-labelledby="report-h-agents" data-testid="report-agents">
          <SecHead id="report-h-agents" label="By agent" meta="steps each agent took in this period" />
          {noSpend ? <p className="wk-rep-quiet">The agent record is counted per project, so work in no project has none of its own.</p>
            : !recordRead ? <Skeleton rows={3} variant="line" />
            : now7 === null ? <p className="wk-rep-quiet" data-tone="fail">Couldn’t read the agent record for this period.</p>
            : agents.length === 0 ? <p className="wk-rep-quiet">No agent took a step in this period.</p> : (
              <SortTable<AgentReportRow> caption="Steps by agent" testId="report-agents-table" rows={agents} rowKey={(r) => r.cli} initial="units"
                cols={[
                  { key: 'agent', label: 'Agent', sort: (r) => r.label, head: true, cell: (r) => <span className="wk-rep-agent"><i className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: agentColor(r.cli) }} aria-hidden />{r.label}</span> },
                  { key: 'units', label: 'Steps', num: true, sort: (r) => r.units, cell: (r) => r.units },
                  { key: 'pass', label: 'Pass rate', num: true, sort: (r) => r.passRate ?? -1, cell: (r) => rateText(r.firstPass, r.gated) },
                  { key: 'median', label: 'Median step', num: true, sort: (r) => r.medianMs ?? -1, cell: (r) => (r.medianMs !== null ? durationWords(r.medianMs / 60_000) : <SevenDayCell isLast7={isLast7 && projectId === undefined} />) },
                  { key: '429', label: '429s', num: true, sort: (r) => r.rateLimited ?? -1, cell: (r) => (r.rateLimited !== null ? <span data-hot={r.rateLimited > 0 ? 'true' : undefined}>{r.rateLimited}</span> : <SevenDayCell isLast7={isLast7 && projectId === undefined} />) },
                  { key: 'cost', label: 'Cost', num: true, sort: (r) => r.costUsd ?? -1, cell: (r) => (r.costUsd === null ? <span className="wk-rep-dim" title="This agent reports no price">no price</span> : moneyWords(r.costUsd)) },
                ]} />
            )}
          <p className="wk-rep-note">
            Pass rate: checked steps that passed on the first try. {isLast7 && projectId === undefined
              ? 'Median step time and 429s (rate-limit answers) are crew’s 7-day counts.'
              : <>Median step time and 429s: crew counts them for the last 7 days{projectId !== undefined ? ' across every project' : ''} only. {projectId === undefined && <button type="button" className="wk-rep-link" onClick={goLast7}>Show the last 7 days</button>}</>}
          </p>
        </section>

        {/* 7. Shipped */}
        <section className="wk-rep-sec wk-rep-sec--rows" aria-labelledby="report-h-shipped" data-testid="report-shipped">
          <SecHead id="report-h-shipped" label="Shipped" meta={shipped.length > 0 ? count(shipped.length, 'delivery', 'deliveries') : undefined} />
          {!runsShown ? <Skeleton rows={3} variant="line" /> : shipped.length === 0 ? <p className="wk-rep-quiet">Nothing was delivered in this period.</p> : (
            <ul className="wk-rep-rows">
              {shipped.map((s) => (
                <li key={s.runId} className="wk-rep-row" data-testid="report-shipped-row" data-kind={s.kind}>
                  <span className="wk-rep-dot" data-kind={s.kind} aria-hidden />
                  <span className="wk-rep-row-body">
                    <a className="wk-rep-row-title" href={pathOfRun(s.runId)} onClick={(e) => { e.preventDefault(); navigate(pathOfRun(s.runId)); }}>{s.title}</a>
                    <span className="wk-rep-row-sub">
                      {[s.repo, s.kind === 'pr' ? 'pull request opened' : s.kind === 'pushed' ? `branch pushed${s.branch !== null ? ` (${s.branch})` : ''}` : 'delivered, no link recorded'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="wk-rep-row-meta">
                    {s.url !== null && <a className="wk-rep-pr" href={s.url} target="_blank" rel="noreferrer" data-testid="report-shipped-pr">{s.number !== null ? `PR #${s.number}` : 'Pull request'}<ExternalLink size={13} aria-hidden /><span className="wk-sr-only"> (opens GitHub)</span></a>}
                    {s.endedAt !== null && <span className="wk-rep-dim">{ago(s.endedAt, now)} ago</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {shipped.some((s) => s.kind === 'pr') && (
            <p className="wk-rep-note">Merged or closed: <NotTracked feed="pr-state" why="Crew records that a pull request was opened, not whether it was merged or closed since." /></p>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────────────────────

const ENDING_COLOR: Record<Ending, string> = {
  delivered: 'var(--status-ok)',
  finished: 'color-mix(in oklab, var(--status-ok) 40%, var(--surface-card))',
  failed: 'var(--status-fail)',
  stopped: 'color-mix(in oklab, var(--status-done) 55%, var(--surface-card))',
};

/** How a job ended, in the summary sentence ("4 delivered, 7 done with nothing to ship"). */
const ENDING_WORDS: Record<Ending, string> = { delivered: 'delivered', finished: 'done with nothing to ship', failed: 'failed', stopped: 'stopped' };

function money(v: number): string { return v === 0 ? '$0' : v < 1 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`; }

function count(n: number, one: string, many = `${one}s`): string { return `${n} ${n === 1 ? one : many}`; }

/** A rate said as a count under 20 (small-sample honesty), else a percentage. */
function rateText(ok: number, of: number): string {
  if (of === 0) return '—';
  return of < 20 ? `${ok} of ${of}` : `${Math.round((ok / of) * 100)}%`;
}

function SecHead({ id, label, meta }: { id: string; label: string; meta?: string | undefined }): React.ReactElement {
  return (
    <div className="wk-rep-sec-head">
      <h2 id={id} className="wk-rep-label">{label}</h2>
      {meta !== undefined && <span className="wk-rep-meta">{meta}</span>}
    </div>
  );
}

function Tile({ label, value, change, note, loading, testId }: {
  label: string; value: string | null; change: Change | null; note: string | null; loading: boolean; testId: string;
}): React.ReactElement {
  const Arrow = change?.dir === 'up' ? ArrowUp : change?.dir === 'down' ? ArrowDown : Minus;
  return (
    <li className="wk-rep-tile" data-testid={testId}>
      <span className="wk-rep-tile-value" aria-busy={loading ? 'true' : undefined}>{loading ? '…' : value ?? '—'}</span>
      <span className="wk-rep-tile-label">{label}</span>
      {!loading && change !== null && (
        <span className="wk-rep-change" data-tone={change.tone} data-dir={change.dir} data-testid={`${testId}-change`}>
          <Arrow size={14} aria-hidden />
          <span>{change.text}</span>
          {change.tone !== 'neutral' && <span className="wk-sr-only">{change.tone === 'good' ? ' (better)' : ' (worse)'}</span>}
        </span>
      )}
      {!loading && note !== null && <span className="wk-rep-tile-note">{note}</span>}
    </li>
  );
}

/** A figure crew does not serve yet: said as such, never as 0. `feed` names what crew would add. */
export function NotTracked({ feed, why, block = false, short = false }: { feed: string; why: string; block?: boolean; short?: boolean }): React.ReactElement {
  if (block) {
    return (
      <p className="wk-rep-nt wk-rep-nt--block" data-testid="report-not-tracked" data-feed={feed}>
        <span className="wk-rep-nt-tag">Not tracked yet</span> <span>{why}</span>
      </p>
    );
  }
  return <span className="wk-rep-nt" data-testid="report-not-tracked" data-feed={feed} title={why}>{short ? 'not tracked' : 'Not tracked yet'}<span className="wk-sr-only">: {why}</span></span>;
}

/** A /system figure: crew counts it for the last 7 days only, so another period says so. */
function SevenDay({ isLast7, mode, snapshotRead, onLast7, what, children }: {
  isLast7: boolean; mode: 'unknown' | 'system' | 'fallback'; snapshotRead: boolean; onLast7: () => void; what: string; children: React.ReactNode;
}): React.ReactElement {
  if (!isLast7) {
    return (
      <div className="wk-rep-nt wk-rep-nt--block" data-testid="report-not-tracked" data-feed={`${what.replace(/\s+/g, '-')}-period`}>
        <span className="wk-rep-nt-tag">Not tracked for this period</span>
        <span>Crew counts {what} for the last 7 days only.</span>
        <button type="button" className="wk-rep-link" onClick={onLast7}>Show the last 7 days</button>
      </div>
    );
  }
  if (mode === 'fallback') return <NotTracked block feed="system" why="This crew serves no system snapshot, so it doesn’t count these." />;
  if (!snapshotRead) return <Skeleton rows={2} variant="line" />;
  return <>{children}</>;
}

function SevenDayCell({ isLast7 }: { isLast7: boolean }): React.ReactElement {
  return isLast7 ? <span className="wk-rep-dim">—</span> : <NotTracked feed="agent-7day-period" short why="Crew counts this for the last 7 days only." />;
}

/** One stacked bar of parts (a share meter); the numbers sit beside it in text. */
function Meter({ parts, label }: { parts: readonly { key: string; label: string; value: number; color: string }[]; label: string }): React.ReactElement {
  const total = sumOf(parts.map((p) => p.value));
  return (
    <span className="wk-rep-meter" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
      {total > 0 && parts.filter((p) => p.value > 0).map((p) => <i key={p.key} style={{ flexGrow: p.value, background: p.color }} />)}
    </span>
  );
}

/** A chart with its text alternative (one sentence) and its numbers as a table you can open. */
function ChartFigure({ summary, table, children, testId }: {
  summary: string; table: { caption: string; cols: readonly string[]; rows: readonly { label: string; values: readonly string[] }[] }; children: React.ReactNode; testId: string;
}): React.ReactElement {
  const id = useId();
  return (
    <figure className="wk-rep-figure" data-testid={testId} aria-describedby={id}>
      {children}
      <figcaption id={id} className="wk-rep-figcap">{summary}</figcaption>
      <details className="wk-rep-data">
        <summary data-testid={`${testId}-table-toggle`}>Show the numbers</summary>
        <div className="wk-rep-scroll" tabIndex={0} role="region" aria-label={table.caption}>
          <table className="wk-table wk-rep-table">
            <caption className="wk-sr-only">{table.caption}</caption>
            <thead><tr><th scope="col">{''}</th>{table.cols.map((c, i) => <th key={i} scope="col" className="num">{c}</th>)}<th scope="col" className="num">Total</th></tr></thead>
            <tbody>{table.rows.map((r) => (
              <tr key={r.label}><th scope="row">{r.label}</th>{r.values.map((v, i) => <td key={i} className="num">{v}</td>)}<td className="num"><b>{totalOf(r.values)}</b></td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function totalOf(values: readonly string[]): string {
  const money = values.some((v) => v.startsWith('$'));
  const n = sumOf(values.map((v) => Number(v.replace(/[$,]/g, '')) || 0));
  return money ? moneyWords(n) : String(n);
}

function SpendTable({ rows }: { rows: readonly AgentReportRow[] }): React.ReactElement {
  const priced = rows.filter((r) => r.costUsd !== null && r.costUsd > 0);
  const total = sumOf(priced.map((r) => r.costUsd!));
  const unpriced = rows.filter((r) => r.costUsd === null && r.units > 0);
  if (priced.length === 0 && unpriced.length === 0) return <p className="wk-rep-quiet">No spend in this period.</p>;
  return (
    <table className="wk-table wk-rep-table">
      <caption className="wk-sr-only">Spend per agent</caption>
      <thead><tr><th scope="col">Agent</th><th scope="col" className="num">Spend</th><th scope="col" className="num">Share</th></tr></thead>
      <tbody>
        {[...priced].sort((a, b) => b.costUsd! - a.costUsd!).map((r) => (
          <tr key={r.cli}><th scope="row"><span className="wk-rep-agent"><i className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: agentColor(r.cli) }} aria-hidden />{r.label}</span></th>
            <td className="num">{moneyWords(r.costUsd!)}</td><td className="num">{total > 0 ? `${Math.round((r.costUsd! / total) * 100)}%` : '—'}</td></tr>
        ))}
        {unpriced.map((r) => (
          <tr key={r.cli}><th scope="row"><span className="wk-rep-agent"><i className="wk-chart-swatch wk-chart-swatch--dot" style={{ background: agentColor(r.cli) }} aria-hidden />{r.label}</span></th>
            <td className="num"><span className="wk-rep-dim">no price</span></td><td className="num">—</td></tr>
        ))}
      </tbody>
    </table>
  );
}

interface Col<R> { key: string; label: string; num?: boolean; head?: boolean; sort?: (r: R) => number | string; cell: (r: R) => React.ReactNode }

/** A table whose column headers sort it (click again to reverse); the sorted column says so (`aria-sort`). */
function SortTable<R>({ rows, cols, rowKey, initial, caption, testId }: {
  rows: readonly R[]; cols: readonly Col<R>[]; rowKey: (r: R) => string; initial: string; caption: string; testId: string;
}): React.ReactElement {
  const [by, setBy] = useState<{ key: string; desc: boolean }>({ key: initial, desc: true });
  const col = cols.find((c) => c.key === by.key);
  const sorted = useMemo(() => {
    if (col?.sort === undefined) return rows;
    const f = col.sort;
    return [...rows].sort((a, b) => {
      const x = f(a); const y = f(b);
      const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
      return by.desc ? -c : c;
    });
  }, [rows, col, by.desc]);
  return (
    <div className="wk-rep-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className="wk-table wk-rep-table wk-rep-table--sort" data-testid={testId}>
        <caption className="wk-sr-only">{caption}, sortable: press a column heading to sort by it</caption>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} scope="col" className={c.num === true ? 'num' : undefined}
                aria-sort={c.key === by.key && c.sort !== undefined ? (by.desc ? 'descending' : 'ascending') : undefined}>
                {c.sort === undefined ? c.label : (
                  <button type="button" className="wk-rep-sort" data-testid={`${testId}-sort-${c.key}`} data-on={c.key === by.key ? 'true' : undefined}
                    onClick={() => setBy((s) => (s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: typeof c.sort!(rows[0]!) !== 'string' }))}>
                    {c.label}
                    {c.key === by.key && (by.desc ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />)}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}>
              {cols.map((c) => (c.head === true
                ? <th key={c.key} scope="row">{c.cell(r)}</th>
                : <td key={c.key} className={c.num === true ? 'num' : undefined}>{c.cell(r)}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
