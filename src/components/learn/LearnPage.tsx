import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { readErrorKind } from '../../api/errors.js';
import type { RepoEntry } from '../../api/types.js';
import { relTime } from '../../board/relTime.js';
import { seedComposer } from '../../store/composerSeed.js';
import { EmptyState, OverflowMenu, PageFrame, Segmented, Skeleton, StateBanner, Switch } from '../ui/index.js';
import {
  EVERY_HOURS,
  EVERY_OPTIONS,
  LEARN_COMMAND,
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

/**
 * The learn page (`/learn`, DES-learn-workflow §5-§6): what a repository has learned from outside
 * sources (`.wicked/knowledge/<slug>/`), how fresh it is, and when it refreshes. A refresh re-runs
 * the `learn` workflow and proposes only changes in a pull request; nothing lands without a person.
 */
export function LearnPage({ navigate }: { navigate: (p: string) => void }): React.ReactElement {
  const [repos, setRepos] = useState<RepoEntry[] | null>(null);
  const [repoRef, setRepoRef] = useState<string | null>(null);
  const [topics, setTopics] = useState<LearnTopic[] | null>(null);
  const [schedules, setSchedules] = useState<LearnSchedule[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  // Each load is one generation; only the newest may commit (codex r1: a slow read of repo A must
  // never land A's topics under repo B).
  const generation = useRef(0);
  const load = useCallback(async (ref: string | null) => {
    const gen = ++generation.current;
    setError(null);
    try {
      const [r, s] = await Promise.all([repos === null ? api.listRepos() : Promise.resolve({ repos }), learnApi.schedules()]);
      const pick = ref ?? r.repos[0]?.id ?? null;
      const t = pick === null ? [] : (await learnApi.topics(pick)).topics;
      if (gen !== generation.current) return;
      setRepos(r.repos);
      setSchedules(s.schedules);
      setRepoRef(pick);
      setTopics(t);
    } catch (e) {
      if (gen === generation.current) setError(e);
    }
  }, [repos]);

  useEffect(() => {
    void load(null);
    // first read only; later reads go through load(repoRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async (): Promise<void> => {
    setRetrying(true);
    await load(repoRef);
    setRetrying(false);
  };

  const pickRepo = (id: string): void => {
    setTopics(null);
    void load(id);
  };

  const rows = useMemo(
    () => (repoRef === null || topics === null || schedules === null ? null : joinRows(repoRef, topics, schedules)),
    [repoRef, topics, schedules],
  );

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

  const startNew = (): void => {
    seedComposer('desk', LEARN_COMMAND);
    navigate('/');
  };

  const repoName = repos?.find((r) => r.id === repoRef)?.name ?? null;

  return (
    <div className="flex-1 overflow-auto" data-testid="learn-page">
      <PageFrame
        title="Learn"
        intro="What your helpers learned from outside sources and saved in each repository, with the source of every claim. Refreshes look for what changed and propose it for review."
        actions={
          <button type="button" className="wk-btn wk-btn--primary" data-testid="learn-new" onClick={startNew}>
            Learn something new
          </button>
        }
      >
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
        {repos !== null && repos.length > 0 && (
          <div className="wk-learn-repo">
            <label className="wk-field-label" htmlFor="learn-repo">
              Repository
            </label>
            <select
              id="learn-repo"
              className="wk-field"
              data-testid="learn-repo"
              value={repoRef ?? ''}
              onChange={(e) => pickRepo(e.target.value)}
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {writeError !== null && (
          <p className="wk-field-note wk-field-note--bad" role="alert" data-testid="learn-write-error">
            {"That change didn't save. Try again."}
          </p>
        )}
        {error === null && rows === null && repos?.length !== 0 && <Skeleton rows={3} data-testid="learn-loading" />}
        {error === null && repos !== null && repos.length === 0 && (
          <EmptyState
            title="No repositories yet."
            body="Add a repository first; what you learn is saved in it."
            action={
              <a className="wk-link" href="/repos/new" onClick={(e) => { e.preventDefault(); navigate('/repos/new'); }}>
                Add a repository
              </a>
            }
          />
        )}
        {error === null && rows !== null && rows.length === 0 && (
          <EmptyState
            title={`Nothing learned in ${repoName ?? 'this repository'} yet.`}
            body="Pick a topic or an event; a helper researches it, walks you through it, and saves what it learned here for review."
            action={
              <button type="button" className="wk-btn wk-btn--secondary" onClick={startNew}>
                Learn something new
              </button>
            }
          />
        )}
        {error === null && rows !== null && rows.length > 0 && (
          <ul className="wk-learn-list" data-testid="learn-topics">
            {rows.map((row) => (
              <TopicItem key={row.topic.slug} row={row} repoRef={repoRef!} busy={busy} write={write} />
            ))}
          </ul>
        )}
      </PageFrame>
    </div>
  );
}

function TopicItem({ row, repoRef, busy, write }: {
  row: TopicRow;
  repoRef: string;
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
    topic.kind === 'event' ? 'Event' : 'Topic',
    holdsLine(topic),
    topic.refreshedAt !== null ? `refreshed ${relTime(Date.parse(topic.refreshedAt), now)}` : null,
  ].filter((x): x is string => x !== null);
  return (
    <li className="wk-learn-item wk-card" data-testid={`learn-topic-${topic.slug}`}>
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
