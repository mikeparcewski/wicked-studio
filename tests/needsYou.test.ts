import { describe, expect, it } from 'vitest';
import type { Campaign, CampaignNodeStatus } from '../src/api/campaigns.js';
import type { RepoEntry } from '../src/api/types.js';
import {
  calmCopy,
  FAILED_WINDOW,
  isFreshInstall,
  needsYouRows,
  newestFailedRun,
  oldestNeedAt,
  retryPrefillOf,
  type NeedsYouInputs,
} from '../src/board/needsYou.js';
import { makeView } from './factories.js';

/**
 * The needs-you queue fold (DES-HOME-COMMAND-CENTER §3): severity order,
 * honest clocks, and — the point — DEDUPE across every attention source, so
 * one underlying trouble is one row, ever. The calm state is the same fold's
 * zero-row branch; the component-level contradiction guard is pinned in
 * HomeBoard.queue.test.tsx.
 */

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 3_600_000;

function repo(id: string, name = id): RepoEntry {
  return { id, name, root_path: `/repos/${id}`, default_branch: 'main', registered_at: NOW - 10 * HOUR };
}

/** An engine campaign (the REAL `GET /campaigns` shape) with one node per status entry;
 *  `runIds` pair up with the entries in order (a node without one is undispatched). */
function campaign(
  id: string,
  over: Partial<Record<'awaitingHuman' | 'failed', number>>,
  runIds: string[] = [],
): Campaign {
  const statuses: CampaignNodeStatus[] = [
    ...Array<CampaignNodeStatus>(over.awaitingHuman ?? 0).fill('awaiting_human'),
    ...Array<CampaignNodeStatus>(over.failed ?? 0).fill('failed'),
  ];
  while (statuses.length < runIds.length) statuses.push('completed');
  const node_status: Record<string, CampaignNodeStatus> = {};
  const node_run_id: Record<string, string> = {};
  const nodes = statuses.map((status, i) => {
    const nid = `n${i}`;
    node_status[nid] = status;
    const runId = runIds[i];
    if (runId !== undefined) node_run_id[nid] = runId;
    return { node_id: nid, run_spec: { problem: `${id} ${nid}` } };
  });
  return {
    id, def_id: id, status: 'running',
    def: { id, name: id, nodes }, node_status, node_run_id,
  };
}

function inputs(over: Partial<NeedsYouInputs>): NeedsYouInputs {
  return {
    runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {},
    chats: [], repos: [], campaigns: [], now: NOW, ...over,
  };
}

describe('needsYouRows — severity order and honest clocks', () => {
  it('orders gate › failed › campaign › repo › stalled chat, newest first within a kind', () => {
    const rows = needsYouRows(inputs({
      runs: [
        makeView({ id: 'r-fail-old', status: 'failed' }),
        makeView({ id: 'r-fail-new', status: 'failed' }),
        makeView({ id: 'r-gate', status: 'awaiting_human', problem: 'ship it' }),
      ],
      gates: { 'r-gate': { prompt: 'approve the plan?', receivedAt: NOW - 5 * MIN, ord: 1 } },
      failedAt: { 'r-fail-old': NOW - 6 * HOUR, 'r-fail-new': NOW - 10 * MIN },
      chats: [{ chatId: 'chat-1', seats: ['claude'], idleSecs: 900 }],
      repos: [repo('repo-never')],
      campaigns: [campaign('camp-1', { awaitingHuman: 2 })],
    }));
    expect(rows.map((r) => r.key)).toEqual([
      'gate:r-gate',
      'fail:r-fail-new',
      'fail:r-fail-old',
      'campaign:camp-1',
      'repo:repo-never',
      'chat:chat-1',
    ]);
    // The gate row speaks the narrator's awaitingHuman template — zero forks.
    expect(rows[0]!.text).toBe('Gate: waiting on you — approve the plan?');
    expect(rows[0]!.tone).toBe('gate');
  });

  it('a clockless failure sorts after clocked ones in its group and reports age null', () => {
    const rows = needsYouRows(inputs({
      runs: [
        makeView({ id: 'r-clockless', status: 'failed' }),
        makeView({ id: 'r-clocked', status: 'failed' }),
      ],
      failedAt: { 'r-clocked': NOW - HOUR },
    }));
    expect(rows.map((r) => r.key)).toEqual(['fail:r-clocked', 'fail:r-clockless']);
    expect(rows[1]!.at).toBeNull();
  });

  it('archived runs never count — gate or failure', () => {
    const rows = needsYouRows(inputs({
      runs: [
        makeView({ id: 'r-arch-gate', status: 'awaiting_human', archived_at: NOW - HOUR }),
        makeView({ id: 'r-arch-fail', status: 'failed', archived_at: NOW - HOUR }),
      ],
    }));
    expect(rows).toEqual([]);
  });

  it('failures live inside the newest-N positional window; gates are NEVER windowed', () => {
    const filler = Array.from({ length: FAILED_WINDOW }, (_, i) =>
      makeView({ id: `r-live-${i}`, status: 'executing' }));
    const rows = needsYouRows(inputs({
      // The old failure and the old gate sit BELOW the window's positional edge.
      runs: [...filler, makeView({ id: 'r-old-fail', status: 'failed' }), makeView({ id: 'r-old-gate', status: 'awaiting_human' })],
    }));
    expect(rows.map((r) => r.key)).toEqual(['gate:r-old-gate']);
  });
});

describe('needsYouRows — dedupe', () => {
  it('a failed onboarding run collapses into its repo row (re-index beats retry)', () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'r-onboard', status: 'failed', workflow_id: 'onboarding', repo_ref: 'repo-1' })],
      failedAt: { 'r-onboard': NOW - HOUR },
      repos: [repo('repo-1', 'wicked-studio')],
    }));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.key).toBe('repo:repo-1');
    expect(row.kind).toBe('repo-graph');
    expect(row.subject).toBe('wicked-studio');
    // The act is the §4.3 prefill idiom — deposits the recorded onboard run.
    expect(row.action.kind).toBe('reindex-prefill');
    if (row.action.kind === 'reindex-prefill') {
      expect(row.action.prefill.retryOf).toBe('r-onboard');
      expect(row.action.prefill.repoRef).toBe('repo-1');
    }
  });

  it('a never-indexed repo rows at low severity with the repo door', () => {
    const rows = needsYouRows(inputs({ repos: [repo('repo-x')] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('repo-graph');
    expect(rows[0]!.severity).toBe(30);
    expect(rows[0]!.action).toEqual({ kind: 'open', path: '/repo-detail/repo-x', label: 'Open repo ›' });
  });

  it('a repo with a READY graph contributes no row', () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'r-ok', status: 'completed', workflow_id: 'onboarding', repo_ref: 'repo-1' })],
      repos: [repo('repo-1')],
    }));
    expect(rows).toEqual([]);
  });

  it('campaign troubles fully visible as member rows subtract to nothing', () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'r-member', status: 'failed' })],
      campaigns: [campaign('camp-1', { failed: 1 }, ['r-member'])],
    }));
    // The member's own failed row stands; the campaign adds NO second row.
    expect(rows.map((r) => r.key)).toEqual(['fail:r-member']);
  });

  it('campaign counts the live list cannot see produce ONE campaign row', () => {
    const rows = needsYouRows(inputs({
      runs: [makeView({ id: 'r-member', status: 'failed' })],
      // 3 failed on the server; only one member is in the live list.
      campaigns: [campaign('camp-1', { failed: 3 }, ['r-member', 'r-archived-a', 'r-archived-b'])],
    }));
    expect(rows.map((r) => r.key)).toEqual(['fail:r-member', 'campaign:camp-1']);
    expect(rows[1]!.text).toContain('3 runs failed');
    expect(rows[1]!.action).toEqual({
      kind: 'open', path: '/testing/campaigns/camp-1', label: 'Open campaign ›',
    });
  });

  it('stalled chats row only past the idle threshold; unknown idle never counts', () => {
    const rows = needsYouRows(inputs({
      chats: [
        { chatId: 'busy', seats: ['claude'], idleSecs: 30 },
        { chatId: 'stalled', seats: ['claude', 'codex'], idleSecs: 720 },
        { chatId: 'unknown', seats: ['claude'], idleSecs: null },
      ],
    }));
    expect(rows.map((r) => r.key)).toEqual(['chat:stalled']);
    expect(rows[0]!.text).toContain('Idle 12m');
    expect(rows[0]!.text).toContain('2 warm seats');
    expect(rows[0]!.action).toEqual({ kind: 'open', path: '/chat/stalled', label: 'Open chat ›' });
  });
});

describe('newestFailedRun — the Ask quick-prompt seed (E1)', () => {
  it('answers the fold’s FIRST failed-run row — the queue’s newest clock, never list order', () => {
    // List order puts the STALE failure first (the E1 defect: the chip seeded a
    // 17-day-old run because it read list order instead of the queue's clocks).
    const stale = makeView({ id: 'r-fail-stale', status: 'failed', problem: 'old breakage' });
    const fresh = makeView({ id: 'r-fail-fresh', status: 'failed', problem: 'new breakage' });
    const runs = [stale, fresh];
    const rows = needsYouRows(inputs({
      runs,
      failedAt: { 'r-fail-stale': NOW - 17 * 24 * HOUR, 'r-fail-fresh': NOW - 10 * MIN },
    }));
    expect(newestFailedRun(rows, runs)).toBe(fresh);
  });

  it('answers undefined when the fold has no failed-run row — nothing is fabricated', () => {
    const runs = [makeView({ id: 'r-live', status: 'executing' })];
    expect(newestFailedRun(needsYouRows(inputs({ runs })), runs)).toBeUndefined();
  });

  it('respects the fold’s own dedupe: a suppressed onboard failure yields the NEXT failed run', () => {
    // The onboard failure is newest, but the queue shows it as a repo row —
    // the seed follows the queue, so the plain failure is the answer.
    const onboard = makeView({ id: 'r-onboard', status: 'failed', workflow_id: 'onboarding', repo_ref: 'repo-1' });
    const plain = makeView({ id: 'r-plain-fail', status: 'failed' });
    const runs = [onboard, plain];
    const rows = needsYouRows(inputs({
      runs,
      failedAt: { 'r-onboard': NOW - MIN, 'r-plain-fail': NOW - HOUR },
      repos: [repo('repo-1')],
    }));
    expect(newestFailedRun(rows, runs)).toBe(plain);
  });
});

describe('needsYouRows — gate act-in-place', () => {
  it('deep-links to the run approval dock when the project is known, /runs/:id otherwise', () => {
    const rows = needsYouRows(inputs({
      runs: [
        makeView({ id: 'r-filed', status: 'awaiting_human' }),
        makeView({ id: 'r-unfiled', status: 'awaiting_human' }),
      ],
      projectIds: { 'r-filed': 'proj-1' },
    }));
    const paths = new Map(rows.map((r) => [r.key, r.action.kind === 'open' ? r.action.path : '']));
    expect(paths.get('gate:r-filed')).toBe('/p/proj-1/build/r-filed#gate');
    expect(paths.get('gate:r-unfiled')).toBe('/runs/r-unfiled');
  });
});

describe('the calm branch and its inputs', () => {
  it('calmCopy carries the LIVE working count', () => {
    expect(calmCopy([
      makeView({ id: 'a', status: 'executing' }),
      makeView({ id: 'b', status: 'planning' }),
      makeView({ id: 'c', status: 'completed' }),
    ])).toBe('Nothing needs you — 2 runs working.');
    expect(calmCopy([])).toBe('Nothing needs you — nothing running right now.');
  });

  it('oldestNeedAt picks the oldest honest clock, ignoring clockless rows', () => {
    const rows = needsYouRows(inputs({
      runs: [
        makeView({ id: 'r-1', status: 'failed' }),
        makeView({ id: 'r-2', status: 'failed' }),
        makeView({ id: 'r-3', status: 'failed' }),
      ],
      failedAt: { 'r-1': NOW - 2 * HOUR, 'r-2': NOW - 5 * HOUR },
    }));
    expect(oldestNeedAt(rows)).toBe(NOW - 5 * HOUR);
  });

  it('isFreshInstall: only a portfolio that has never seen anything', () => {
    expect(isFreshInstall(0, [], [])).toBe(true);
    expect(isFreshInstall(1, [], [])).toBe(false);
    expect(isFreshInstall(0, [makeView()], [])).toBe(false);
    expect(isFreshInstall(0, [], [repo('r')])).toBe(false);
  });
});

describe('retryPrefillOf', () => {
  it('maps the failed run onto the §4.3 prefill shape — lineage included', () => {
    const v = makeView({
      id: 'r-f', problem: 'fix the tests', clis: ['claude', 'codex'],
      workflow_id: 'dev', repo_ref: 'repo-1', project_id: 'proj-9',
    });
    expect(retryPrefillOf(v)).toEqual({
      retryOf: 'r-f',
      problem: 'fix the tests',
      clis: ['claude', 'codex'],
      workflowId: 'dev',
      repoRef: 'repo-1',
      entityMode: 'shared',
      humanConfirm: 'none',
      projectId: 'proj-9',
    });
  });
});
