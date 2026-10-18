import { useMemo } from 'react';
import type { RosterSeat } from '../../api/types.js';
import { seatLabel } from '../../board/seatNames.js';
import { teamRosterOf, type TeamRoster } from '../../board/teamRoster.js';
import { useTeamFold } from '../../hooks/useTeamFold.js';

/**
 * The run's team in the run panel's Agents and spend section (DES-TEAMING-002 §0): who leads (chosen or
 * picked at random), who watches and why that many ("score 30 → 1 monitor"), each watcher's state — a
 * watcher that could not open says so with the reason — and the steps another helper did or checked.
 * Draws nothing for a run with no team rows (an older daemon, or a run that is not a team run).
 */
export function TeamRosterLines({ runId, roster }: { runId: string; roster: readonly RosterSeat[] | null | undefined }): React.ReactElement | null {
  const { fold } = useTeamFold(runId);
  const team = useMemo(() => teamRosterOf(fold?.rows ?? []), [fold]);
  return <TeamRosterView team={team} roster={roster} />;
}

/**
 * The watcher line counts like with like (wicked-studio#850): the plan's monitor count is PER STEP,
 * the members are the distinct seats that watched across the run — never "2 of 1 monitor".
 */
export function watchLine(monitors: number, watched: number): string {
  if (monitors === 0) return 'no monitor';
  const perStep = `${monitors} ${monitors === 1 ? 'monitor' : 'monitors'} per step`;
  const seats = watched === 0 ? 'no seat watched yet' : `${watched} ${watched === 1 ? 'seat' : 'seats'} watched`;
  return `${perStep} · ${seats}`;
}

export function TeamRosterView({ team, roster }: { team: TeamRoster; roster: readonly RosterSeat[] | null | undefined }): React.ReactElement | null {
  const name = (key: string): string => {
    const seat = roster?.find((s) => s.key === key);
    return seat === undefined ? key : seatLabel(seat);
  };
  if (team.lead === null && team.watch === null && team.members.length === 0) return null;
  const work = team.steps.filter((s) => s.kind === 'work');
  const checks = team.steps.filter((s) => s.kind === 'check');
  const watching = team.members.filter((m) => m.status === 'watching').length;
  return (
    <div data-testid="run-tab-team" className="wk-run-tab-team">
      {team.lead !== null && (
        <p data-testid="run-tab-team-lead" data-seat={team.lead.seat} className="wk-run-tab-line">
          <strong>Leading:</strong> {name(team.lead.seat)}{' '}
          <span className="wk-run-tab-muted">
            {team.lead.selection === 'chosen' ? '(you chose it)' : team.lead.selection === 'random' ? '(picked at random)' : ''}
            {team.lead.from !== null && ` · took over from ${name(team.lead.from)}${team.lead.repickReason !== null ? ` (${team.lead.repickReason})` : ''}`}
          </span>
        </p>
      )}
      {team.watch !== null && (
        <p data-testid="run-tab-team-watch" data-monitors={team.watch.monitors} className="wk-run-tab-line">
          <strong>Watching:</strong>{' '}
          {watchLine(team.watch.monitors, watching)}{' '}
          <span className="wk-run-tab-muted">({team.watch.why})</span>
        </p>
      )}
      {team.members.length > 0 && (
        <ul className="wk-run-tab-list" data-testid="run-tab-team-members">
          {team.members.map((m) => (
            <li key={m.seat ?? '—'} data-testid="run-tab-team-member" data-seat={m.seat ?? ''} data-status={m.status}
              className={m.status === 'failed' ? 'wk-run-tab-member wk-run-tab-member--failed' : 'wk-run-tab-member'}>
              {m.seat === null ? 'No monitor' : name(m.seat)}{' '}
              <span className="wk-run-tab-muted">{m.status === 'watching' ? 'watching' : 'could not watch'}</span>
              {m.error !== null && <span data-testid="run-tab-team-member-error" className="wk-run-tab-member-error">{m.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {work.length > 0 && (
        <p data-testid="run-tab-team-work" className="wk-run-tab-line">
          <strong>Done by other helpers:</strong> {work.map((s) => `${s.step} (${name(s.seat)})`).join(', ')}
        </p>
      )}
      {checks.length > 0 && (
        <p data-testid="run-tab-team-checks" className="wk-run-tab-line">
          <strong>Checked by:</strong> {checks.map((s) => `${s.step} (${name(s.seat)})`).join(', ')}
        </p>
      )}
    </div>
  );
}
