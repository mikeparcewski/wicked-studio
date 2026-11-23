import { useCallback, useEffect, useState } from 'react';
import { CADENCE_DAYS, REVIEW_WORKFLOW, asksReducedAssurance, cadenceWords, insightsApi, type WorkflowSchedule } from '../../api/insights.js';
import { sessionPath } from '../../board/sessionModel.js';
import { useProjectsStore } from '../../store/projects.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmButton, CalmRow, CalmRows, CalmSection } from '../calm/Calm.js';
import { INSIGHTS_PATH } from './InsightsLine.js';

const WORKFLOW_NAMES: Record<string, string> = { [REVIEW_WORKFLOW]: 'Review recent work' };
const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** The row's one line: cadence, when it runs next, and (for the review) the last review's date and outcome. */
export function scheduleLine(s: WorkflowSchedule): string {
  const parts = [s.enabled ? `${cadenceWords(s.everyHours)}, next ${day(s.nextDueAt)}` : `Off (${cadenceWords(s.everyHours).toLowerCase()} when on)`];
  if (s.lastReview != null) {
    const outcome = s.lastReview.status === 'running' ? 'running now' : s.lastReview.status;
    parts.push(`last review ${day(s.lastReview.launchedAt)}, ${outcome}`);
  } else if (s.workflow === REVIEW_WORKFLOW) {
    parts.push('no review yet');
  }
  if (s.reducedAssurance === true) parts.push('an agent that did the work may review it when no other can');
  if (s.retryWith?.reducedAssurance === true && s.reducedAssurance !== true) parts.push('last start refused: no other agent can review this work independently');
  else if (s.lastOutcome === 'refused' && s.lastNote !== null) parts.push(`last start refused: ${s.lastNote}`);
  else if (s.lastNote !== null && s.lastNote.startsWith('skipped')) parts.push(s.lastNote.replace(/^skipped: /u, 'waiting: '));
  return parts.join(' · ');
}

/**
 * SCHEDULES (Build & settings; crew DES-RUNS-REVIEW-001 §2): each scheduled workflow, with on/off, how often, which
 * projects it covers and "Run it now". The default is "Review recent work" every 2 days.
 */
export function SchedulesSection({ navigate }: { navigate: Navigate }): React.ReactElement | null {
  const [rows, setRows] = useState<WorkflowSchedule[] | null | undefined>(undefined);
  const [said, setSaid] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // crew#1837: Run it now answered "no other agent can review this independently" (retryWith.reducedAssurance).
  const [offered, setOffered] = useState<Record<string, boolean>>({});
  const projects = useProjectsStore((s) => s.projects);
  const loadProjects = useProjectsStore((s) => s.load);

  const read = useCallback(async () => {
    try {
      setRows(await insightsApi.schedules());
    } catch (e) {
      setRows([]);
      setSaid({ _: `Schedules could not be read: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, []);
  useEffect(() => { void read(); if (projects.length === 0) void loadProjects(); }, [read]); // eslint-disable-line react-hooks/exhaustive-deps -- once

  const save = async (s: WorkflowSchedule, patch: Partial<Pick<WorkflowSchedule, 'enabled' | 'everyHours' | 'projectIds' | 'reducedAssurance'>>): Promise<void> => {
    setBusy(s.id);
    try {
      const next = await insightsApi.saveSchedule(s.id, {
        workflow: s.workflow,
        everyHours: patch.everyHours ?? s.everyHours,
        enabled: patch.enabled ?? s.enabled,
        projectIds: patch.projectIds ?? s.projectIds,
        ...(patch.reducedAssurance !== undefined ? { reducedAssurance: patch.reducedAssurance } : {}),
      });
      setRows((cur) => (cur ?? []).map((r) => (r.id === s.id ? { ...next, ...(r.lastReview !== undefined && next.lastReview === undefined ? { lastReview: r.lastReview } : {}) } : r)));
      setSaid((m) => ({ ...m, [s.id]: 'Saved.' }));
    } catch (e) {
      setSaid((m) => ({ ...m, [s.id]: `Not saved: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (s: WorkflowSchedule, reduced = false): Promise<void> => {
    setBusy(s.id);
    try {
      await (reduced ? insightsApi.runNow(s.id, { reducedAssurance: true }) : insightsApi.runNow(s.id));
      setOffered((m) => ({ ...m, [s.id]: false }));
      setSaid((m) => ({ ...m, [s.id]: 'Started. It shows on Jobs, and the review lands in Insights when it finishes.' }));
      await read();
    } catch (e) {
      if (!reduced && asksReducedAssurance(e)) {
        setOffered((m) => ({ ...m, [s.id]: true }));
        setSaid((m) => ({ ...m, [s.id]: 'Not started: no other agent can review this work independently.' }));
      } else {
        setSaid((m) => ({ ...m, [s.id]: `Not started: ${e instanceof Error ? e.message : String(e)}` }));
      }
    } finally {
      setBusy(null);
    }
  };

  if (rows === undefined) return null;
  return (
    <CalmSection label="Schedules" data-testid="schedules-section">
      {rows === null ? (
        <p className="wk-calm-sentence" data-testid="schedules-unsupported">This version of crew does not run workflows on a schedule yet.</p>
      ) : rows.length === 0 ? (
        <p className="wk-calm-sentence" data-testid="schedules-empty">Nothing is scheduled.</p>
      ) : (
        <div className="wk-schedules">
          {rows.map((s) => {
            const days = s.everyHours / 24;
            const name = WORKFLOW_NAMES[s.workflow] ?? s.workflow;
            const covered = s.projectIds.length === 0 ? 'All projects' : projects.filter((p) => s.projectIds.includes(p.id)).map((p) => p.name).join(', ') || `${s.projectIds.length} projects`;
            const blockedPath = s.blocked ? sessionPath(`run:${s.blocked.target.runId}`) : '';
            const offer = s.reducedAssurance !== true && (offered[s.id] === true || s.retryWith?.reducedAssurance === true);
            return (
              <div key={s.id} className="wk-schedule" data-testid="schedule-row" data-schedule={s.id} data-enabled={String(s.enabled)}>
                <CalmRows label={name}>
                  <CalmRow
                    tone={s.enabled ? 'ok' : 'quiet'}
                    title={name}
                    sub={`${scheduleLine(s)} · ${covered}`}
                    {...(s.workflow === REVIEW_WORKFLOW ? { href: INSIGHTS_PATH, onOpen: () => navigate(INSIGHTS_PATH), openLabel: `${name}: open Insights` } : {})}
                    detailsLabel="Which projects it covers"
                    details={(
                      <fieldset className="wk-schedule-projects" data-testid="schedule-projects">
                        <legend>Projects it covers (none ticked = all)</legend>
                        {projects.map((p) => (
                          <label key={p.id}>
                            <input type="checkbox" checked={s.projectIds.includes(p.id)} disabled={busy === s.id}
                              onChange={(e) => void save(s, { projectIds: e.target.checked ? [...s.projectIds, p.id] : s.projectIds.filter((x) => x !== p.id) })} />
                            {' '}{p.name}
                          </label>
                        ))}
                      </fieldset>
                    )}
                  />
                </CalmRows>
                {s.blocked && (
                  <p className="wk-schedule-blocked" data-testid="schedule-blocked">
                    Blocked since {day(s.blocked.since)}
                    {s.blocked.missedDue > 0 && ` · ${s.blocked.missedDue} missed ${s.blocked.missedDue === 1 ? 'run' : 'runs'}`}
                    {' · '}<a href={blockedPath} onClick={(e) => {
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      navigate(blockedPath);
                    }}>Open run</a>
                  </p>
                )}
                {offer && (
                  <>
                    <p className="wk-schedule-blocked" data-testid="schedule-reduced-offer">
                      Every agent that could review this work did some of it, so none can review it independently. Sign in
                      another agent (Agents), or let one that did the work review it from now on; each review says so.
                    </p>
                    <div className="wk-schedule-controls" style={{ marginBottom: 10 }}>
                      <CalmButton testId="schedule-run-reduced" tone="primary" disabled={busy === s.id} onClick={() => void runNow(s, true)}>
                        Allow it and run now
                      </CalmButton>
                    </div>
                  </>
                )}
                <div className="wk-schedule-controls">
                  <label className="wk-schedule-toggle">
                    <input type="checkbox" data-testid="schedule-enabled" checked={s.enabled} disabled={busy === s.id}
                      onChange={(e) => void save(s, { enabled: e.target.checked })} />
                    <span>On</span>
                  </label>
                  <select aria-label={`How often: ${name}`} data-testid="schedule-cadence" className="wk-field" value={CADENCE_DAYS.includes(days as 1 | 2 | 3) ? String(days) : 'custom'} disabled={busy === s.id}
                    onChange={(e) => { const d = Number(e.target.value); if (Number.isInteger(d)) void save(s, { everyHours: d * 24 }); }}>
                    {CADENCE_DAYS.map((d) => <option key={d} value={String(d)}>{cadenceWords(d * 24)}</option>)}
                    {!CADENCE_DAYS.includes(days as 1 | 2 | 3) && <option value="custom" disabled>{cadenceWords(s.everyHours)}</option>}
                  </select>
                  {s.reducedAssurance === true && (
                    <label className="wk-schedule-toggle">
                      <input type="checkbox" data-testid="schedule-reduced" checked disabled={busy === s.id}
                        onChange={() => void save(s, { reducedAssurance: false })} />
                      <span>Allow a reviewer that did the work</span>
                    </label>
                  )}
                  <CalmButton testId="schedule-run-now" disabled={busy === s.id} onClick={() => void runNow(s)}>Run it now</CalmButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {rows !== null && rows.some((s) => said[s.id] !== undefined) && (
        <p className="wk-insights-said" role="status" data-testid="schedules-said">{rows.map((s) => said[s.id]).filter(Boolean).join(' ')}</p>
      )}
      {said['_'] !== undefined && <p className="wk-insights-said" role="status">{said['_']}</p>}
    </CalmSection>
  );
}
