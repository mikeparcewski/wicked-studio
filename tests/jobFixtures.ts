import type { JobProposal } from '../src/board/jobStream.js';

/** A job proposal as crew resolves it (DES-CATALOG-002 §4.6), for the passage's tests. */
export const CHAT = 'chat-j';
export function jobProposal(over: Partial<JobProposal> = {}): JobProposal {
  return {
    pid: `${CHAT}:t1`, chatId: CHAT, turnId: 't1', kind: 'job', seat: 'claude',
    what: { entry: 'migrate', title: 'Get reporting off .NET Framework', label: 'Migrate · Upgrade', outcome: null },
    brief: null, reason: null, sources: [], repos: ['reporting-api'], helpers: null, time: null, stops: null,
    filedIn: { projectId: null, label: 'Not in a project' }, blocked: null,
    shape: { card: 'migrate', option: 'upgrade', depth: null, by: 'detected', source: 'chat' },
    gate: ['qe-acceptance', 'parity'],
    seats: { lead: 'codex', keys: ['codex', 'claude'], label: 'Codex and Claude' },
    sentence: {
      text: 'I’ll port {repo} as {option}, with {seats}, checked by {checks}.',
      tokens: [
        { id: 'repo', kind: 'repo', label: 'reporting-api', swap: { choices: [{ label: 'billing-api', edit: { repoRef: 'billing' } }] } },
        { id: 'option', kind: 'option', label: 'an in-place upgrade', swap: { choices: [{ label: 'a move', edit: { option: 'move' } }] } },
        { id: 'seats', kind: 'seats', label: 'Codex and Claude', swap: null },
        { id: 'checks', kind: 'checks', label: 'QE acceptance and a parity check', swap: null },
      ],
      notes: [],
      ask: 'Start?',
    },
    suggestions: [{ label: 'Make it a move', edit: { option: 'move' } }],
    question: null,
    sketch: { steps: [{ label: 'Plan', asks: false }, { label: 'Port', asks: false }, { label: 'Deliver', asks: true }] },
    revises: null,
    lineage: `${CHAT}:t1`,
    ...over,
  } as JobProposal;
}
