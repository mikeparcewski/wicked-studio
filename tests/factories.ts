import type { AgentSession, SessionView, WorkUnit } from '../src/api/types.js';

export function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'run-1',
    workflow_id: 'wf',
    problem: 'do the thing',
    entity_mode: 'shared',
    collection_scope: null,
    clis: ['claude'],
    status: 'executing',
    human_confirm: 'none',
    unit_ix: 0,
    attempt: 0,
    workdir: null,
    repo_ref: null,
    ...overrides,
  };
}

export function makeUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'run-1:u0',
    session_id: 'run-1',
    ord: 0,
    description: 'a unit of work',
    stage: 'build',
    assigned_cli: null,
    assigned_invocation: null,
    council_task_ref: null,
    routing: null,
    denial_reason: null,
    phase_ref: null,
    conformance_ref: null,
    phase_status: null,
    collection_scope: null,
    status: 'pending',
    ...overrides,
  };
}

export function makeView(session: Partial<AgentSession> = {}, units: WorkUnit[] = []): SessionView {
  return { session: makeSession(session), units };
}
