/**
 * CenterDashboard — Build given a purpose (DES-UXFIX-001 §2.7, slice 5, F7).
 *
 * Pins the slice-5 DOM AC:
 *   - `build-purpose` is present with a non-empty subject even with zero runs;
 *   - no campaigns-panel testid exists, and no Chats panel renders;
 *   - with no runs there is no `—` stat hero (no em-dash anywhere on the surface);
 *   - run rows are labelled by INTENT phrase, never the full prompt string;
 *   - the stat row survives only as a data-gated footer;
 *   - the one primary action is "+ Build something" (V9);
 *   - the gate inbox appears only when a gate is pending (W4).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  BUILD_PURPOSE,
  CenterDashboard,
  intentPhrase,
  runRowModel,
} from '../src/components/CenterDashboard.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit, makeView } from './factories.js';
import type { SessionView } from '../src/api/types.js';

vi.mock('../src/api/client.js', () => ({
  api: {
    confirmGate: vi.fn(async () => ({})),
    injectMessage: vi.fn(async () => ({})),
  },
}));

const LONG_PROMPT =
  'Refactor the ingestion pipeline so that every incoming webhook payload is validated '
  + 'against the registered JSON schema, quarantined on mismatch, and replayed from the '
  + 'dead-letter store once the schema catches up with the producer';

function dash(runs: SessionView[] = []): void {
  render(
    <CenterDashboard
      runs={runs}
      onSelectRun={vi.fn()}
      onApproveGate={vi.fn()}
      onRejectGate={vi.fn()}
      navigate={vi.fn()}
    />,
  );
}

function units(done: number, total: number, sid = 'run-1') {
  return Array.from({ length: total }, (_, i) =>
    makeUnit({ id: `${sid}:u${i}`, ord: i, status: i < done ? 'done' : 'pending' }),
  );
}

beforeEach(() => {
  useGateStore.setState({ gates: {} });
  useRunEventStore.setState({ byRun: {} });
});

describe('the purpose statement (F7)', () => {
  it('is always present with a non-empty subject, even with zero runs', () => {
    dash([]);
    const purpose = screen.getByTestId('build-purpose');
    expect(purpose.textContent).toBe(BUILD_PURPOSE);
    expect(purpose.textContent).toMatch(/Build runs governed code work/);
    expect(purpose.textContent).toMatch(/independent check/);
    expect(purpose.textContent).toMatch(/evidence/);
  });

  it('with no runs, the purpose + one primary action IS the empty state — no em-dash hero, no absence lines', () => {
    dash([]);
    const surface = screen.getByTestId('build-dashboard');
    expect(surface.textContent).not.toContain('—');
    expect(screen.getByTestId('build-something').textContent).toContain('Build something');
    // The runs region is omitted, not filled with a "nothing" line (§2.1.2).
    expect(surface.textContent).not.toMatch(/No work sessions|No runs yet|No chats yet/);
    expect(screen.queryByTestId('build-stats-footer')).toBeNull();
  });
});

describe('the dead shells are folded (V4, §2.7 rule 3)', () => {
  it('no campaigns panel testid or copy exists', () => {
    dash([makeView({ status: 'executing' }, units(1, 4))]);
    expect(screen.queryByTestId('campaign-dag-stub')).toBeNull();
    expect(screen.getByTestId('build-dashboard').textContent).not.toMatch(/Campaign/);
  });

  it('no Chats panel — a chat-classified session never rides the runs list', () => {
    dash([
      makeView({ id: 'chat-1', workflow_id: 'chat', problem: 'just talking', status: 'completed' }),
      makeView({ id: 'work-1', workflow_id: 'wf-x', problem: 'ship the thing', status: 'completed' }),
    ]);
    const rows = screen.getAllByTestId('build-run-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('ship the thing');
    expect(screen.getByTestId('build-dashboard').textContent).not.toMatch(/New Chat|just talking/);
  });
});

describe('run rows are labelled by intent, not raw prompt (F7)', () => {
  it('a long prompt truncates with the intent leading; the full prompt stays on the row title', () => {
    dash([makeView({ id: 'run-long', problem: LONG_PROMPT, status: 'executing' }, units(0, 2, 'run-long'))]);
    const row = screen.getByTestId('build-run-row');
    expect(row.textContent).not.toContain(LONG_PROMPT);
    expect(row.textContent).toContain('Refactor the ingestion pipeline');
    expect(row.textContent).toContain('…');
    expect(row.getAttribute('title')).toBe(LONG_PROMPT);
  });

  it('rows read in user vocabulary: working · phase k/n, gate · needs you, done, failed', () => {
    dash([
      makeView({ id: 'r-work', problem: 'add rate limiting', status: 'executing' }, units(1, 4, 'r-work')),
      makeView({ id: 'r-gate', problem: 'migrate the tables', status: 'awaiting_human' }, units(0, 2, 'r-gate')),
      makeView({ id: 'r-done', problem: 'fix the flaky test', status: 'completed' }),
      makeView({ id: 'r-fail', problem: 'spike the importer', status: 'failed' }, units(0, 3, 'r-fail')),
    ]);
    const texts = screen.getAllByTestId('build-run-row').map((r) => r.textContent ?? '');
    expect(texts.find((t) => t.includes('add rate limiting'))).toMatch(/working · phase 2\/4/);
    expect(texts.find((t) => t.includes('migrate the tables'))).toMatch(/gate · needs you/);
    expect(texts.find((t) => t.includes('fix the flaky test'))).toMatch(/done/);
    expect(texts.find((t) => t.includes('spike the importer'))).toMatch(/failed · at phase 1/);
    // The scheduler words never render (V3).
    for (const t of texts) expect(t).not.toMatch(/executing|distributing|awaiting_human/);
  });

  it('caps the list and defers the rest to "view all →"', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeView({ id: `r-${i}`, problem: `task ${i}`, status: 'completed' }),
    );
    dash(many);
    expect(screen.getAllByTestId('build-run-row')).toHaveLength(9);
    expect(screen.getByText('view all →')).toBeTruthy();
  });
});

describe('the stat row is a data-gated footer (§2.7 rule 2)', () => {
  it('absent with runs but no usage data — never an em-dash placeholder', () => {
    dash([makeView({ id: 'r-1', problem: 'quiet work', status: 'completed' })]);
    expect(screen.queryByTestId('build-stats-footer')).toBeNull();
    expect(screen.getByTestId('build-dashboard').textContent).not.toContain('—');
  });

  it('present with real cost/token data folded from cliUsage events', () => {
    useRunEventStore.setState({
      byRun: {
        'r-1': [
          { type: 'cliUsage', session: 'r-1', inputTokens: 84_000, outputTokens: 14_000, costUsd: 0.42 },
        ],
      },
    });
    dash([makeView({ id: 'r-1', problem: 'billed work', status: 'executing' }, units(0, 2, 'r-1'))]);
    const footer = screen.getByTestId('build-stats-footer');
    expect(footer.textContent).toContain('$0.42');
    expect(footer.textContent).toContain('98.0k tokens');
    expect(footer.textContent).not.toContain('—');
  });
});

describe('the gate inbox (W4, §2.7 rule 5)', () => {
  it('is absent while no gate is pending', () => {
    dash([makeView({ id: 'r-gate', problem: 'migrate the tables', status: 'awaiting_human' })]);
    expect(screen.queryByTestId('gate-inbox')).toBeNull();
  });

  it('appears when a gate is pending, headed by the count', () => {
    useGateStore.setState({
      gates: {
        'r-gate': {
          runId: 'r-gate', ord: 0, prompt: 'Approve the plan?', lifecycle: 'open', receivedAt: 1,
        },
      },
    });
    dash([makeView({ id: 'r-gate', problem: 'migrate the tables', status: 'awaiting_human' })]);
    const inbox = screen.getByTestId('gate-inbox');
    expect(inbox.textContent).toContain('1 gate needs you');
    expect(inbox.textContent).toContain('Approve the plan?');
    // The gate card names the run by intent, not by workflow id.
    expect(inbox.textContent).toContain('migrate the tables');
  });
});

describe('send-to-agents respects the empty-state budget', () => {
  it('is omitted entirely when nothing is running', () => {
    dash([makeView({ id: 'r-done', problem: 'old work', status: 'completed' })]);
    expect(screen.queryByText('Send to agents')).toBeNull();
    expect(screen.queryByText('No active sessions')).toBeNull();
  });

  it('renders while a run is active', () => {
    dash([makeView({ id: 'r-live', problem: 'live work', status: 'executing' })]);
    expect(screen.getByText('Send to agents')).toBeTruthy();
  });
});

describe('intentPhrase / runRowModel (pure)', () => {
  it('takes the first line, collapses whitespace, truncates at a word boundary', () => {
    const v = makeView({ problem: 'first  line\nsecond line' });
    expect(intentPhrase(v)).toBe('first line');
    const long = intentPhrase(makeView({ problem: LONG_PROMPT }));
    expect(long.length).toBeLessThanOrEqual(73); // 72 + ellipsis
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toContain('validated against'); // cut before the tail
  });

  it('falls back to workflow · repo, then the short id, when there is no problem', () => {
    expect(intentPhrase(makeView({ problem: '', workflow_id: 'wf-x', repo_ref: 'acme/api' }))).toBe('wf-x · acme/api');
    expect(intentPhrase(makeView({ problem: '', workflow_id: 'chat', id: 'abcdef123456' }))).toBe('abcdef12');
  });

  it('maps engine statuses to the user words', () => {
    expect(runRowModel(makeView({ status: 'executing' }, units(2, 5)))).toMatchObject({
      status: 'working', detail: 'phase 3/5',
    });
    expect(runRowModel(makeView({ status: 'awaiting_human' }))).toMatchObject({
      status: 'gate', detail: 'needs you',
    });
    expect(runRowModel(makeView({ status: 'failed' }, units(0, 3)), 'boom')).toMatchObject({
      status: 'failed', detail: 'at phase 1: boom',
    });
    expect(runRowModel(makeView({ status: 'completed' }))).toMatchObject({ status: 'done', detail: '' });
    expect(runRowModel(makeView({ status: 'cancelled' }))).toMatchObject({ status: 'cancelled' });
  });
});
