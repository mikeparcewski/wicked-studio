import type { SessionView } from '../../src/api/types.js';
import { makeUnit, makeView } from '../factories.js';

export const NOW = Date.UTC(2026, 9, 13, 12);
export const DAY = 86_400_000;
export const names = {
  project: (id: string) => id === 'studio' ? 'Studio Desk' : 'Crew Engine',
  agent: (cli: string) => cli === 'claude' ? 'Claude Sonnet' : cli === 'codex' ? 'Codex' : cli,
};
export const title = (v: SessionView): string => v.session.problem;

export function deskRun(id: string, session: Partial<SessionView['session']> = {}): SessionView {
  return makeView({
    id, problem: `Fix ${id}`, status: 'completed', project_id: 'studio',
    created_at: (NOW - DAY) / 1000,
    ...(session.status === 'executing' || session.status === 'awaiting_human' ? {} : { ended_at: (NOW - DAY + 120_000) / 1000 }),
    run_identity: { kind: 'workflow', name: 'fix-bug', user_plan: false, system: false }, ...session,
  }, [
    makeUnit({ id: `${id}:0`, session_id: id, ord: 0, status: 'done', assigned_cli: 'claude' }),
    makeUnit({ id: `${id}:1`, session_id: id, ord: 1, status: 'pending', assigned_cli: 'codex' }),
  ]);
}

export function outcomeRuns(): SessionView[] {
  return [
    deskRun('working', { status: 'executing' }),
    deskRun('finished'),
    deskRun('answered', { status: 'awaiting_human', ask_turn: true }),
    deskRun('failed', { status: 'failed' }),
    deskRun('waiting', { status: 'awaiting_human' }),
    deskRun('stopped', { status: 'cancelled' }),
  ];
}
