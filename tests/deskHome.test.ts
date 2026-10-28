// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import type { NeedRow } from '../src/board/needsYou.js';
import { approvesInPlace, homeSentence, needCardWords, progressRows, shippedTodayWords, topNeed } from '../src/board/deskHome.js';
import { attentionBadge, attentionRows } from '../src/board/attention.js';

/**
 * The landing's words (home v2, operator-approved mockup 2026-10-26): one plain sentence of state, ONE
 * card for the most important waiting item with at most two moves, at most three jobs in progress,
 * and one closing line. Pure in every input, so each is pinned here.
 */

function run(id: string, status: string, extra: Record<string, unknown> = {}, units: unknown[] = []): SessionView {
  return { session: { id, status, problem: `do ${id}`, title: `Job ${id}`, unit_ix: 0, ...extra }, units } as unknown as SessionView;
}

function need(key: string, kind: NeedRow['kind'] = 'gate', extra: Partial<NeedRow> = {}): NeedRow {
  return {
    key, kind, severity: kind === 'gate' ? 100 : kind === 'failed-run' ? 70 : 40, stakes: 1, subject: key, text: `line ${key}`, tone: 'gate',
    at: 1, subjectPath: `/s/run%3A${key}`, action: { kind: 'open', path: `/s/run%3A${key}#gate`, label: 'Open gate ›' }, ...extra,
  } as NeedRow;
}

const name = (cli: string): string => (cli === 'claude' ? 'Claude Code' : cli);

describe('homeSentence', () => {
  it('says what needs you and what runs, in words', () => {
    expect(homeSentence({ read: 'known', waiting: 2, partial: false, running: 1 })).toBe('Two things need you. One job is running.');
    expect(homeSentence({ read: 'known', waiting: 1, partial: false, running: 0 })).toBe('One thing needs you. Nothing else is running.');
    expect(homeSentence({ read: 'known', waiting: 0, partial: false, running: 3 })).toBe('Nothing needs you. Three jobs are running.');
    expect(homeSentence({ read: 'known', waiting: 0, partial: false, running: 0 })).toBe('Nothing needs you, and nothing is running.');
    expect(homeSentence({ read: 'known', waiting: 19, partial: false, running: 0 })).toBe('19 things need you. Nothing else is running.');
  });

  it('a partial read is a floor, and an unread list is never a verdict', () => {
    expect(homeSentence({ read: 'known', waiting: 2, partial: true, running: 0 })).toBe('At least two things need you.');
    expect(homeSentence({ read: 'known', waiting: 0, partial: true, running: 1 })).toBe('Some of what needs you could not be read. One job is running.');
    expect(homeSentence({ read: 'checking', waiting: null, partial: false, running: 0 })).toBe('Checking what is going on…');
    expect(homeSentence({ read: 'failed', waiting: null, partial: false, running: 0 })).toMatch(/can’t say/);
  });
});

describe('the card', () => {
  it('shows the top decision before a failure, and counts what the rail badge counts', () => {
    const rows = [need('f', 'failed-run', { action: { kind: 'retry-prefill', prefill: {} as never, label: 'Retry ›' } }), need('g'), need('p', 'proposal')];
    expect(topNeed(attentionRows(rows), 10)?.key).toBe('g');
    expect(attentionRows(rows).length).toBe(attentionBadge(rows));
    expect(attentionRows(rows).map((r) => r.key)).not.toContain('p');
  });

  it('a gate opens its decision; the generic verb reads as what it is for', () => {
    const v = run('g', 'awaiting_human', { repo_ref: 'wicked-garden' }, [{ status: 'done', assigned_cli: 'claude' }, { status: 'pending', assigned_cli: 'claude' }]);
    const w = needCardWords(need('g', 'gate', { question: 'Approve the plan?' }), v, { agentName: name, ago: '12 minutes ago' });
    expect(w.context).toBe('wicked-garden · Claude Code · 12 minutes ago');
    expect(w.title).toBe('Approve the plan?');
    expect(w.body).toBe('“Job g” is paused at step 2 of 2 until you answer.');
    expect(w.primary).toMatchObject({ kind: 'act', label: 'Review and decide' });
    // The job's page IS where the decision is: no second button to the same place.
    expect(w.secondary).toBeNull();
  });

  it('only a simple, low-impact plan gate is approved in place; everything else opens its evidence', () => {
    const v = run('g', 'awaiting_human');
    const plan = need('g', 'gate', { groupKey: 'approval', action: { kind: 'open', path: '/s/run%3Ag#gate', label: 'Approve plan… ›' } });
    expect(approvesInPlace(plan, v)).toBe(true);
    const w = needCardWords(plan, v, { agentName: name, ago: null });
    expect(w.primary).toEqual({ kind: 'approve', label: 'Approve plan', runId: 'g' });
    expect(w.secondary).toMatchObject({ kind: 'act', label: 'See the plan' });
    expect(approvesInPlace({ ...plan, action: { kind: 'open', path: '/x', label: 'Review diff… ›' } }, v)).toBe(false);
    expect(approvesInPlace({ ...plan, action: { kind: 'open', path: '/x', label: 'Send back… ›' } }, v)).toBe(false);
    expect(approvesInPlace({ ...plan, action: { kind: 'open', path: '/x', label: 'Open gate ›' } }, v)).toBe(false);
    // A gate with free text or more than two answers carries no `approval` group key.
    expect(approvesInPlace(need('g', 'gate', { action: plan.action }), v)).toBe(false);
    expect(approvesInPlace(plan, null)).toBe(false);
  });

  it('a failure offers Retry and See why', () => {
    const v = run('f', 'failed', {}, [{ status: 'done' }, { status: 'failed' }, { status: 'pending' }]);
    const w = needCardWords(need('f', 'failed-run', { action: { kind: 'retry-prefill', prefill: {} as never, label: 'Retry ›' } }), v, { agentName: name, ago: null });
    expect(w.primary).toMatchObject({ kind: 'act', label: 'Retry' });
    expect(w.secondary).toEqual({ kind: 'link', label: 'See why', path: '/s/run%3Af' });
    expect(w.body).toMatch(/^“Job f” stopped at step 2 of 3\./);
  });
});

describe('progressRows', () => {
  it('working first, then waiting; at most max; step x of y with one muted line', () => {
    const runs = [
      run('a', 'awaiting_human', { created_at: 300 }, [{ status: 'done' }, { status: 'pending' }]),
      run('b', 'executing', { created_at: 100 }, [{ status: 'done' }, { status: 'running', assigned_cli: 'claude', stage: 'build' }, { status: 'pending' }]),
      run('c', 'executing', { created_at: 200 }, []),
      run('d', 'completed', { created_at: 400 }),
      run('e', 'executing', { created_at: 500, archived_at: 9 }),
    ];
    const { rows, total } = progressRows(runs, { max: 2, agentName: name });
    expect(total).toBe(3);
    expect(rows.map((r) => r.runId)).toEqual(['c', 'b']);
    expect(rows[0]).toMatchObject({ word: 'Working', tone: 'run', line: 'Planning' });
    expect(rows[1]).toMatchObject({ done: 1, total: 3, line: 'Step 2 of 3 · Building · Claude Code' });
    const all = progressRows(runs, { max: 3, agentName: name }).rows;
    expect(all[2]).toMatchObject({ runId: 'a', word: 'Waiting on you', tone: 'gate', line: 'Step 2 of 2 · waiting for your answer' });
  });
});

describe('shippedTodayWords', () => {
  const now = new Date(2026, 9, 26, 15, 0).getTime();
  const today = Math.floor(new Date(2026, 9, 26, 9, 0).getTime() / 1000);
  const yesterday = Math.floor(new Date(2026, 9, 25, 22, 0).getTime() / 1000);
  it('counts pull requests delivered since midnight', () => {
    const pr = (id: string, ended: number) => run(id, 'completed', { ended_at: ended, delivery: 'delivered', deliverUrl: `https://github.com/o/r/pull/${id.length}` });
    expect(shippedTodayWords([pr('a', today), pr('bb', today), pr('ccc', yesterday)], now)).toBe('2 pull requests shipped today');
    expect(shippedTodayWords([pr('a', today)], now)).toBe('1 pull request shipped today');
    expect(shippedTodayWords([run('p', 'completed', { ended_at: today, delivery: 'pushed' })], now)).toBe('1 job delivered today');
    expect(shippedTodayWords([pr('ccc', yesterday)], now)).toBe('Nothing shipped yet today');
  });
});
