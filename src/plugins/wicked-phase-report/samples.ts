import type { CoreEvent } from '../../api/types.js';

/**
 * The Phase report's SAMPLE events (program DES-LEARN §2: a plugin card's live preview is the plugin's own frame, fed
 * only its package's sample events — never a real run's). A power build at its third turn: intake scored High, two
 * checkpoints, the checks at the newest one 2 short of passing. Times are relative to `now`.
 */
export const SAMPLE_RUN = 'sample-run';
export const SAMPLE_SCOPE = { phase: 'build', label: 'Build', ords: [2] } as const;
export const SAMPLE_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi' };

export function sampleEvents(now: number): CoreEvent[] {
  let seq = 0;
  const at = (minAgo: number): number => now - Math.round(minAgo * 60_000);
  const ev = (type: string, minAgo: number, extra: Record<string, unknown> = {}): CoreEvent =>
    ({ type, session: SAMPLE_RUN, ts: at(minAgo), seq: ++seq, ...extra }) as unknown as CoreEvent;
  const checks = (failing: number): Array<Record<string, unknown>> => [
    { name: 'typecheck', exitCode: 0, durationMs: 3_100 },
    { name: 'lint', exitCode: 0, durationMs: 2_400 },
    { name: 'test_targeted', exitCode: failing > 0 ? 1 : 0, durationMs: 48_000 },
  ];
  return [
    ev('sessionStarted', 19),
    ev('unitPlanned', 19, { ord: 1, description: 'intake', role: 'creator' }),
    ev('unitPlanned', 19, { ord: 2, description: 'fix', role: 'creator' }),
    ev('unitPlanned', 19, { ord: 3, description: 'review', role: 'evaluator' }),
    ev('unitPlanned', 19, { ord: 4, description: 'qe', role: 'evaluator' }),
    ev('unitDistributed', 19, { ord: 1, cli: 'pi' }),
    ev('unitExecuting', 19, { ord: 1 }),
    ev('powerIntakePlanned', 18, { ord: 1, plan: { rigor: 'high', score: 46, band: '40-69', highRisk: false, estimateMinutes: 25, mandatoryPhases: [], at: at(18) } }),
    ev('rigorRescored', 18, { change: { seq: 1, trigger: 'intake', from: 'high', to: 'high', direction: 'same', planned: 46, actual: 46, checkpoint: null, turn: null, paused: false, by: 'engine', at: at(18) } }),
    ev('unitDone', 17.5, { ord: 1 }),
    ev('unitDistributed', 17.4, { ord: 2, cli: 'claude' }),
    ev('unitExecuting', 17.3, { ord: 2 }),
    ev('powerTurnStarted', 17.2, { ord: 2, turn: 1, attempt: 0, cli: 'claude' }),
    ev('powerTurnCompleted', 12, { ord: 2, turn: 1, attempt: 0, cli: 'claude', outcome: 'checkpoint' }),
    ev('powerCheckpointReached', 12, { ord: 2, checkpoint: 1, turn: 1, trigger: 'commit', rigor: 'high', picked: 0, paused: false }),
    ev('repoChecksEvaluated', 11, { ord: 2, attempt: 0, floor: 'checkpoint', outcome: 'passed', passed: true, checks: checks(0) }),
    ev('powerTurnStarted', 11, { ord: 2, turn: 2, attempt: 0, cli: 'claude' }),
    ev('powerTurnCompleted', 5, { ord: 2, turn: 2, attempt: 0, cli: 'claude', outcome: 'checkpoint' }),
    ev('powerCheckpointReached', 5, { ord: 2, checkpoint: 2, turn: 2, trigger: 'commit', rigor: 'high', picked: 1, paused: false }),
    ev('repoChecksEvaluated', 4, { ord: 2, attempt: 0, floor: 'checkpoint', outcome: 'failed', passed: false, checks: checks(2) }),
    ev('powerTurnStarted', 3.5, { ord: 2, turn: 3, attempt: 0, cli: 'claude' }),
    ev('cliUsage', 3, { ord: 2, attempt: 0, costUsd: 1.84, inputTokens: 412_000, outputTokens: 38_000 }),
  ];
}
