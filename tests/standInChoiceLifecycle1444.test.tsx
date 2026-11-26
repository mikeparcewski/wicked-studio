/**
 * studio#1444 round 1 (codex): a stand-in choice belongs to the page that holds it.
 * - Leaving the page retires a choice in flight: a start that answers later is not recorded and opens nothing.
 * - Retiring a choice frees the launcher's Start at once, so a stalled request of the old choice never holds it.
 * The refusal is crew's own 409 body (tests/fixtures/stand-in-choice.learn-one-helper.crew.json, its route writer).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { standInChoiceOf } from '../src/board/standIn.js';
import { useStandInChoice } from '../src/hooks/useStandInChoice.js';

const CHOICE = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/stand-in-choice.learn-one-helper.crew.json'), 'utf8')) as { status: number; body: Record<string, unknown> };
const refusal = standInChoiceOf(new ApiError(CHOICE.status, String(CHOICE.body['error'] ?? ''), CHOICE.body))!;
const BODY = { workflowId: 'capture-learnings', problem: 'p', repoRef: 'svc' } as unknown as LaunchBodyWithDeliver;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Ask = (r: typeof refusal | null, retries: Array<{ body: LaunchBodyWithDeliver; meta: number }>) => void;

function Probe({ launch, started, exposeAsk }: {
  launch: (body: LaunchBodyWithDeliver) => Promise<string>;
  started: (done: ReadonlyArray<{ result: string; meta: number }>) => void;
  exposeAsk: (ask: Ask) => void;
}): React.ReactElement {
  const s = useStandInChoice<number, string>(launch, started, () => {});
  exposeAsk(s.ask);
  return <div><span data-testid="busy">{String(s.busy)}</span>{s.card('probe')}</div>;
}

describe('studio#1444 r1: a stand-in choice ends with its page, and a retired one never holds Start', () => {
  it('leaving the page while "this job" is starting: the late answer records nothing', async () => {
    let answer!: (id: string) => void;
    const launch = vi.fn(() => new Promise<string>((res) => { answer = res; }));
    const started = vi.fn();
    let ask!: Ask;
    const view = render(<Probe launch={launch} started={started} exposeAsk={(a) => { ask = a; }} />);
    act(() => ask(refusal, [{ body: BODY, meta: 1 }]));
    fireEvent.click(screen.getByTestId('probe-job'));
    expect(launch).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { answer('run-late'); await Promise.resolve(); });
    expect(started).not.toHaveBeenCalled();
  });

  it('a retired choice whose start never answers frees Start at once', async () => {
    const launch = vi.fn(() => new Promise<string>(() => {}));
    let ask!: Ask;
    render(<Probe launch={launch} started={vi.fn()} exposeAsk={(a) => { ask = a; }} />);
    act(() => ask(refusal, [{ body: BODY, meta: 1 }]));
    fireEvent.click(screen.getByTestId('probe-job'));
    expect(screen.getByTestId('busy').textContent).toBe('true');
    act(() => ask(null, []));
    expect(screen.getByTestId('busy').textContent).toBe('false');
    expect(screen.queryByTestId('probe')).toBeNull();
  });
});
