import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { readErrorKind } from '../../api/errors.js';
import type { RepoEntry } from '../../api/types.js';
import { relTime } from '../../board/relTime.js';
import { OverflowMenu, Segmented, Skeleton, StateBanner, Switch } from '../ui/index.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import {
  EVERY_HOURS,
  EVERY_OPTIONS,
  LEARN_WORKFLOW_ID,
  defaultEvery,
  dueIn,
  everyOf,
  freshness,
  holdsLine,
  joinRows,
  lastRunLine,
  learnApi,
  type Every,
  type LearnSchedule,
  type LearnTopic,
  type TopicRow,
} from './learnModel.js';

/** "Learn something new": the topic source's add flow, the launch wizard on the learn workflow (operator 2026-10-11,
 *  reel chapter 60): what / where / options, then Launch, never a typed command. */
export function startLearnTopic(): void {
  openLaunchWizard({ workflowId: LEARN_WORKFLOW_ID });
}

/**
 * Topics to follow AS SOURCES (program DES-LEARN §3.5; operator 2026-10-31: Topics folds into Style as a source kind).
 * Every repository's learned topics (`.wicked/knowledge/<slug>/`), each a row in Style's source list with its own
 * refresh schedule, freshness and actions. A refresh re-runs the `learn` workflow and proposes only changes in a pull
 * request; nothing lands without a person. A topic is added through the source picker's "Topic to follow"
 * ({@link startLearnTopic}); there is no section of its own.
 */
export function LearnTopics({ navigate }: { navigate: (p: string) => void; embedded?: boolean }): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[] | null>(null);
  const [byRepo, setByRepo] = useState<Record<string, LearnTopic[]> | null>(null);
  const [schedules, setSchedules] = useState<LearnSchedule[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  // One read generation at a time: only the newest may commit.
  const generation = useRef(0);
  const load = useCallback(async () => {
    const gen = ++generation.current;
    setError(null);
    try {
      const [r, s] = await Promise.all([api.listRepos(), learnApi.schedules()]);
      // Every repository's topics, each read on its own: one that fails to read leaves the others listed.
      const reads = await Promise.allSettled(r.repos.map((x) => learnApi.topics(x.id)));
      if (gen !== generation.current) return;
      const map: Record<string, LearnTopic[]> = {};
      r.repos.forEach((x, i) => { const v = reads[i]!; map[x.id] = v.status === 'fulfilled' ? v.value.topics : []; });
      if (r.repos.length > 0 && reads.every((x) => x.status === 'rejected')) throw (reads[0] as PromiseRejectedResult).reason;
      setRepos(r.repos);
      setSchedules(s.schedules);
      setByRepo(map);
    } catch (e) {
      if (gen === generation.current) setError(e);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const retry = async (): Promise<void> => {
    setRetrying(true);
    await load();
    setRetrying(false);
  };

  const rows = useMemo(() => {
    if (repos === null || byRepo === null || schedules === null) return null;
    return repos.flatMap((r) => joinRows(r.id, byRepo[r.id] ?? [], schedules).map((row) => ({ row, repoRef: r.id, repoName: r.name })));
  }, [repos, byRepo, schedules]);

  // One write at a time, page-wide (codex r1): a second control used mid-save would send a body
  // built from the pre-save snapshot and could undo the first.
  const write = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    if (busy !== null) return;
    setBusy(key);
    setWriteError(null);
    try {
      await fn();
      setSchedules((await learnApi.schedules()).schedules);
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="learn-page" className="wk-learn-topics-body">
      {error !== null && (
        <StateBanner
          kind={readErrorKind(error)}
          what="learned topics"
          error={error instanceof Error ? error.message : String(error)}
          onRetry={() => void retry()}
          retrying={retrying}
          data-testid="learn-error"
        />
      )}
      {writeError !== null && (
        <p className="wk-field-note wk-field-note--bad" role="alert" data-testid="learn-write-error">
          {"That change didn't save. Try again."}
        </p>
      )}
      {error === null && rows === null && <Skeleton rows={2} data-testid="learn-loading" />}
      {error === null && repos !== null && repos.length === 0 && (
        <p className="wk-learn-quiet" data-testid="learn-no-repos">
          Topics are saved in a repository.{' '}
          <a className="wk-link" href="/repos/new" onClick={(e) => { e.preventDefault(); navigate('/repos/new'); }}>Add a repository</a> first.
        </p>
      )}
      {error === null && rows !== null && rows.length === 0 && repos !== null && repos.length > 0 && (
        <p className="wk-learn-quiet" data-testid="learn-no-topics">No topics followed yet. Pick “Topic to follow” above: a helper researches it and refreshes it on a schedule.</p>
      )}
      {error === null && rows !== null && rows.length > 0 && (
        <ul className="wk-learn-sources wk-learn-sources--topics" aria-label="Topics to follow" data-testid="learn-topics">
          {rows.map(({ row, repoRef, repoName }) => (
            <TopicItem key={`${repoRef}:${row.topic.slug}`} row={row} repoRef={repoRef} repoName={repoName} busy={busy} write={write} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TopicItem({ row, repoRef, repoName, busy, write }: {
  row: TopicRow;
  repoRef: string;
  repoName: string;
  busy: string | null;
  write: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}): React.ReactElement {
  const { topic, schedule } = row;
  const fresh = freshness(topic);
  const every: Every = schedule !== null ? everyOf(schedule.everyHours) : defaultEvery(topic.kind);
  const on = schedule?.enabled ?? false;
  const key = topic.slug;
  const save = (next: { every?: Every; enabled?: boolean }): Promise<void> =>
    write(key, () =>
      learnApi.save({
        repoRef,
        slug: topic.slug,
        topic: topic.title,
        // Keep a schedule's own interval unless the user picked a new one (codex r1: an interval set
        // elsewhere, e.g. 24 h, must survive an on/off toggle).
        everyHours: next.every !== undefined ? EVERY_HOURS[next.every] : (schedule?.everyHours ?? EVERY_HOURS[every]),
        enabled: next.enabled ?? on,
      }),
    );
  const last = schedule !== null ? lastRunLine(schedule) : null;
  const now = Date.now();
  const meta = [
    topic.kind === 'event' ? 'Event to follow' : 'Topic to follow',
    repoName,
    holdsLine(topic),
    topic.refreshedAt !== null ? `refreshed ${relTime(Date.parse(topic.refreshedAt), now)}` : null,
  ].filter((x): x is string => x !== null);
  return (
    <li className="wk-learn-src wk-learn-src--topic" data-kind="topic" data-testid={`learn-topic-${topic.slug}`}>
      <div className="wk-learn-item-head">
        <div className="wk-learn-item-text">
          <div className="wk-list-row-title">{topic.title}</div>
          <div className="wk-list-row-meta">{meta.join(' · ')}</div>
        </div>
        <span className={fresh.tone === 'quiet' ? 'wk-tag' : `wk-tag wk-tag--${fresh.tone}`} data-testid={`learn-fresh-${topic.slug}`}>
          {fresh.word}
        </span>
        <OverflowMenu
          label={`More actions for ${topic.title}`}
          data-testid={`learn-menu-${topic.slug}`}
          items={[
            {
              id: 'run-now',
              label: 'Refresh now',
              disabled: schedule === null || !on ? 'Turn on automatic refresh first.' : schedule.lastOutcome === 'launched' ? 'A refresh is already running.' : null,
              onSelect: () => {
                if (schedule !== null) void write(key, () => learnApi.runNow(schedule.id));
              },
            },
            {
              id: 'remove',
              label: 'Stop refreshing this topic',
              danger: true,
              disabled: schedule === null ? 'It has no refresh schedule.' : null,
              onSelect: () => {
                if (schedule !== null) void write(key, () => learnApi.remove(schedule.id));
              },
            },
          ]}
        />
      </div>
      {topic.problem !== null && <p className="wk-field-note">{"Part of this topic's files couldn't be read, so some counts may be missing."}</p>}
      <div className="wk-learn-controls">
        <Switch
          label="Refresh automatically"
          checked={on}
          onChange={(v) => void save({ enabled: v })}
          disabled={busy !== null ? 'Saving…' : null}
          data-testid={`learn-auto-${topic.slug}`}
        />
        <Segmented
          label="How often"
          value={every}
          options={EVERY_OPTIONS}
          onChange={(v) => void save({ every: v })}
          data-testid={`learn-every-${topic.slug}`}
        />
      </div>
      {schedule !== null && !Object.values(EVERY_HOURS).includes(schedule.everyHours) && (
        <p className="wk-learn-next" data-testid={`learn-custom-${topic.slug}`}>
          {`Set elsewhere to ${Math.round(schedule.everyHours / 24) === 1 ? 'every day' : `every ${Math.round(schedule.everyHours / 24)} days`}; picking an option replaces it.`}
        </p>
      )}
      <p className="wk-learn-next" data-testid={`learn-next-${topic.slug}`}>
        {on && schedule !== null
          ? `Next refresh ${dueIn(Date.parse(schedule.nextDueAt), now)}${last !== null ? ` · ${last}` : ''}`
          : 'Not on a schedule. Turn on automatic refresh to keep it current.'}
      </p>
    </li>
  );
}
