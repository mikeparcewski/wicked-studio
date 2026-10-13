import { describe, expect, it } from 'vitest';
import { ANALYZE_WORKFLOW, analysisIntent, analysisLaunchBody, evidenceLinks, type AnalyzeKind } from '../src/board/deskAnalyze.js';

const API = 'http://127.0.0.1:7701/api/v1';
const base = { days: 30 as const, api: API, project: null, projectLabel: null };

describe('Desk v2 Analyze: an existing workflow, one unique intent per kind', () => {
  it('launches the learn workflow through the wizard body, no delivery, no seats', () => {
    const body = analysisLaunchBody({ ...base, kind: 'agents', items: [{ id: 'claude', label: 'Claude Code' }] });
    expect(body.workflow).toBe(ANALYZE_WORKFLOW);
    expect(body.workflow).toBe('learn');
    expect('deliver' in body).toBe(false);
    expect('clisJson' in body).toBe(false);
    expect(body.problem).toContain('Claude Code (claude)');
  });
  it('writes a different intent per kind, each naming its questions', () => {
    const kinds: AnalyzeKind[] = ['agents', 'workflows', 'jobs', 'projects'];
    const texts = kinds.map((kind) => analysisIntent({ ...base, kind, items: [{ id: 'x1', label: 'X' }] }));
    expect(new Set(texts).size).toBe(4);
    expect(texts[0]).toMatch(/failure modes/);
    expect(texts[1]).toMatch(/bottleneck/);
    expect(texts[2]).toMatch(/succeed/);
    expect(texts[3]).toMatch(/risks/);
  });
  it('carries the ids, the window and the evidence links', () => {
    const t = analysisIntent({ ...base, kind: 'jobs', items: [{ id: 'r-1', label: 'Fix login' }, { id: 'r-2', label: 'Fix login again' }] });
    expect(t).toContain('Fix login (r-1); Fix login again (r-2)');
    expect(t).toContain('the last 30 days');
    expect(t).toContain(`${API}/runs/r-1/events`);
    expect(t).toContain(`${API}/runs/r-2`);
    expect(t).toMatch(/never estimate a number/);
  });
  it('scopes a project analysis to its project and skips the synthesized one', () => {
    expect(evidenceLinks('projects', [{ id: 'default', label: 'Not in a project' }, { id: 'p1', label: 'P' }], 7, API)[0]).toBe(`${API}/roster/record?days=7&project=p1`);
    const body = analysisLaunchBody({ ...base, kind: 'projects', items: [{ id: 'p1', label: 'P' }], project: 'p1', projectLabel: 'P' });
    expect(body.projectId).toBe('p1');
  });
});

describe('Edit and past analyses', () => {
  it('uses the edited words when given, the drafted intent when blank', () => {
    const input = { ...base, kind: 'agents' as const, items: [{ id: 'pi', label: 'Pi CLI' }] };
    expect(analysisLaunchBody(input, 'Just look at Pi').problem).toBe('Just look at Pi');
    expect(analysisLaunchBody(input, '   ').problem).toBe(analysisIntent(input));
  });
  it('recognises an earlier analysis job by workflow and opening words', async () => {
    const { isAnalysisRun } = await import('../src/board/deskAnalyze.js');
    expect(isAnalysisRun(analysisIntent({ ...base, kind: 'jobs', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }), 'learn')).toBe(true);
    expect(isAnalysisRun('Analyze one agent: x', 'bug')).toBe(false);
    expect(isAnalysisRun('Research rust async', 'learn')).toBe(false);
  });
});
