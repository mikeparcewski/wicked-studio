import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Archive, ExternalLink, RotateCcw } from 'lucide-react';
import { api } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';
import type { NeedRow } from '../../board/needsYou.js';
import { needCount, needSection, type NeedSection } from '../../board/needsQueue.js';
import { needRunId } from '../../board/deskModel.js';
import { deskVerb, jobTitle, plainRunTitle } from '../../board/deskWords.js';
import { leadAgentOf, workflowOf } from '../../board/deskInsights.js';
import { relTime } from '../../board/relTime.js';
import { useNeedsQueue } from '../../hooks/useNeedsQueue.js';
import { NeedsYouQueue, type InboxRowLook } from '../NeedsYouQueue.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { GateRow } from '../session/GateRow.js';
import { useGateStore } from '../../store/gates.js';
import { ApprovalGroupActions } from './ApprovalGroupActions.js';
import { FailureWhy } from './FailureWhy.js';
import { agentColor } from '../charts/Chart.js';
import { Skeleton, StateBanner } from '../ui/index.js';
import { handleTabKeyDown } from '../ui/tabKeys.js';

/**
 * NEEDS YOU, AS AN INBOX (DES-desk-v2 §2.1). The rows are the needs fold (`useNeedsRows` →
 * `useNeedsQueue`), counted by the attention model (`board/attention.ts`): one row per thing that
 * waits on you, like a mail list — the sender (the helper on the step, or the job's workflow),
 * the subject (the decision or the failure, in plain words), a snippet (the job), the age, and
 * bold while unread. Selecting a row opens it in the reading pane, where it is answered in place
 * through the moves studio already has: a gate's answers (`QuestionRow`), a failure's See why +
 * Retry (a prefill, nothing posted) + Mark done (archive, `POST /runs/:id/archive`), a group's
 * batch answers. There is no snooze on the wire (DES §6 ask), so there is none here.
 *
 * Unread is this browser's own memory of which rows you opened (`localStorage`), said as such.
 */

type Folder = 'all' | NeedSection;
const FOLDERS: readonly { id: Folder; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'decision', label: 'Decisions' },
  { id: 'failure', label: 'Failures' },
  { id: 'review', label: 'To review' },
  { id: 'other', label: 'Other' },
];

const SEEN_KEY = 'studio.desk.inboxSeen';

function readSeen(): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []); } catch { return new Set(); }
}

function seenId(row: NeedRow): string { return `${row.key}@${row.at ?? ''}`; }

export function DeskInbox({ rows, runs, navigate, now, settled, agentName, extra = null, missing = [], onRetry, retrying = false }: {
  /** Needs sources that did not answer (a partial read): named, with a retry. */
  missing?: readonly string[];
  onRetry?: () => void;
  retrying?: boolean;
  /** The chores for whoever runs studio, listed above the needs (they need a person too). */
  extra?: React.ReactNode;
  rows: NeedRow[];
  runs: SessionView[];
  navigate: Navigate;
  now: number;
  /** The needs sources have all answered (or 15 s passed): before it, no row list and no count. */
  settled: 'loading' | 'complete' | 'partial';
  agentName: (cli: string) => string;
}): React.ReactElement {
  const [folder, setFolder] = useState<Folder>('all');
  const tabPrefix = useId();
  const tabId = (f: Folder): string => `${tabPrefix}-tab-${f}`;
  const panelId = (f: Folder): string => `${tabPrefix}-panel-${f}`;
  const [selected, setSelected] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(readSeen);
  const byFolder = useMemo(() => {
    const m = new Map<Folder, number>();
    m.set('all', needCount(rows));
    for (const f of FOLDERS) if (f.id !== 'all') m.set(f.id, needCount(rows.filter((r) => needSection(r) === f.id)));
    return m;
  }, [rows]);
  // A folder is the same queue over its section's rows (the queue's own ranking, groups and keys).
  const inFolder = useMemo(() => (folder === 'all' ? rows : rows.filter((r) => needSection(r) === folder)), [rows, folder]);
  const queue = useNeedsQueue(inFolder, navigate, now);
  const flat = useMemo(() => queue.rows.flatMap((r) => [r, ...(r.members ?? [])]), [queue.rows]);
  const current = flat.find((r) => r.key === selected) ?? null;
  const runOf = (row: NeedRow): SessionView | null => { const id = needRunId(row); return id === null ? null : runs.find((v) => v.session.id === id) ?? null; };

  // The reading pane opens on the first row the first time there is one (desktop), like a mail client.
  useEffect(() => { if (current === null && queue.rows[0] !== undefined && window.matchMedia?.('(min-width: 768px)').matches) setSelected(queue.rows[0].key); }, [current, queue.rows]);

  const open = (row: NeedRow): void => {
    setSelected(row.key);
    setSeen((cur) => {
      if (cur.has(seenId(row))) return cur;
      const next = new Set(cur); next.add(seenId(row));
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-400))); } catch { /* private mode */ }
      return next;
    });
  };
  const unread = flat.filter((r) => r.members === undefined && !seen.has(seenId(r))).length;
  const look: InboxRowLook = {
    sender: (row) => {
      const v = runOf(row);
      const agent = v === null ? null : leadAgentOf(v);
      return { label: agent !== null ? agentName(agent) : v !== null ? workflowOf(v).label : senderOf(row), color: agent !== null ? agentColor(agent) : null };
    },
    snippet: (row) => snippetOf(row, runOf(row)),
    unread: (row) => !seen.has(seenId(row)),
    selectedKey: current?.key ?? null,
    onSelect: open,
    ageWords: (t) => (t === null ? '' : relTime(t, now)),
  };

  return (
    <section id="desk-inbox" aria-labelledby="desk-inbox-title" data-testid="desk-inbox" className="wk-card wk-inbox">
      <header className="wk-inbox-head">
        <h2 id="desk-inbox-title" className="wk-desk2-title">Needs you</h2>
        {settled !== 'loading' && <span className="wk-viz-meta" data-testid="desk-inbox-count" data-phase={settled} data-count={needCount(rows)}>{byFolder.get('all') === 0 ? (settled === 'partial' ? 'not everything could be read' : 'nothing is waiting for you') : `${byFolder.get('all')}${settled === 'partial' ? '+' : ''} waiting${unread > 0 ? ` · ${unread} unread` : ''}`}</span>}
        <div role="tablist" aria-label="Show" className="wk-inbox-folders">
          {FOLDERS.filter((f) => f.id === 'all' || (byFolder.get(f.id) ?? 0) > 0 || folder === f.id).map((f) => (
            <button key={f.id} type="button" role="tab" id={tabId(f.id)} aria-controls={panelId(f.id)} tabIndex={folder === f.id ? 0 : -1}
              aria-selected={folder === f.id} data-testid={`desk-inbox-folder-${f.id}`} className="wk-chip wk-inbox-folder"
              onKeyDown={handleTabKeyDown} onClick={() => setFolder(f.id)}>
              {f.label}{settled !== 'loading' && <span className="wk-inbox-folder-n">{byFolder.get(f.id) ?? 0}</span>}
            </button>
          ))}
        </div>
      </header>
      {/* A partial read never reads as all clear: it names what did not answer and offers a retry. */}
      {settled === 'partial' && missing.length > 0 && <StateBanner data-testid="desk-needs-partial" kind="partial" what={missing.join(', ')} {...(onRetry !== undefined ? { onRetry } : {})} retrying={retrying} />}
      {settled === 'loading' && rows.length === 0 && extra === null ? <div role="tabpanel" id={panelId(folder)} aria-labelledby={tabId(folder)} className="wk-inbox-empty" data-testid="desk-loading" aria-busy="true"><Skeleton rows={4} variant="row" /></div> : (
        <div role="tabpanel" id={panelId(folder)} aria-labelledby={tabId(folder)} className={`wk-inbox-split${queue.rows.length === 0 ? ' wk-inbox-split--calm' : ''}`}>
          <div className="wk-inbox-list" data-testid="desk-inbox-list">
            {extra}
            {/* Not read yet (or the read failed): never a "nothing needs you" verdict, only the placeholder. */}
            {settled === 'loading' && rows.length === 0 ? <div data-testid="desk-loading" aria-busy="true"><Skeleton rows={3} variant="row" /></div> : <NeedsYouQueue queue={queue} runs={runs} navigate={navigate} now={now} inbox={look} partial={settled === 'partial'} />}
          </div>
          {queue.rows.length > 0 && (
            <div className="wk-inbox-pane" data-testid="desk-inbox-pane" aria-live="polite">
              {current === null ? <p className="wk-viz-state">Pick an item to read it here.</p> : (
                <ReadingPane row={current} view={runOf(current)} queueAct={queue.act} navigate={navigate} now={now} agentName={agentName} />
              )}
            </div>
          )}
        </div>
      )}
      <footer className="wk-inbox-foot">
        <a href="/watch?filter=decision" onClick={(e) => { e.preventDefault(); navigate('/watch?filter=decision'); }} className="wk-link" data-testid="desk-inbox-all">
          {settled === 'loading' ? 'See all in Watchtower' : `See all in Watchtower (${needCount(rows)})`}
        </a>
      </footer>
    </section>
  );
}

function senderOf(row: NeedRow): string {
  if (row.kind === 'repo-graph') return 'Repositories';
  if (row.kind === 'proposal') return 'Steering';
  if (row.kind === 'campaign') return 'Tests';
  if (row.kind === 'stalled-chat') return 'Chat';
  return 'Studio';
}

function subjectOf(row: NeedRow): string {
  if (row.members !== undefined) return row.subject;
  return row.question ?? row.text;
}

function snippetOf(row: NeedRow, v: SessionView | null): string {
  if (row.members !== undefined) return row.text;
  return v !== null ? jobTitle(v.session) : plainRunTitle(row.subject);
}

function ReadingPane({ row, view, queueAct, navigate, now, agentName }: {
  row: NeedRow;
  view: SessionView | null;
  queueAct: (a: NeedRow['action'], key?: string) => void;
  navigate: Navigate;
  now: number;
  agentName: (cli: string) => string;
}): React.ReactElement {
  const [archive, setArchive] = useState<'idle' | 'confirm' | 'sending' | 'done' | 'failed'>('idle');
  const gate = useGateStore((st) => (view === null ? undefined : st.gates[view.session.id]));
  // The pane is reused across rows: an archive answers only for the row it was sent for, while mounted.
  const current = useRef(row.key);
  useEffect(() => { current.current = row.key; setArchive('idle'); }, [row.key]);
  useEffect(() => () => { current.current = ''; }, []);
  const a = row.action;
  const agent = view === null ? null : leadAgentOf(view);
  const openPath = a.kind === 'open' ? a.path : row.subjectPath;
  const onOpen = (e: React.MouseEvent): void => { e.preventDefault(); if (a.kind === 'open') queueAct(a, row.key); else navigate(row.subjectPath); };
  const markDone = (): void => {
    if (view === null) return;
    setArchive('sending');
    const sentFor = row.key;
    api.archiveRun(view.session.id, true, 'Marked done from the Desk').then(
      () => { if (current.current === sentFor) setArchive('done'); },
      () => { if (current.current === sentFor) setArchive('failed'); },
    );
  };
  return (
    <article data-testid="desk-inbox-read" data-key={row.key} className="wk-inbox-read">
      {/* What it is scrolls; what you can do about it is pinned under it, always in view. */}
      <div className="wk-inbox-read-scroll">
        <p className="wk-inbox-read-meta">
          {agent !== null && <><i aria-hidden className="wk-chart-swatch" style={{ background: agentColor(agent) }} />{agentName(agent)} · </>}
          {view !== null ? workflowOf(view).label : senderOf(row)}
          {row.at !== null && <> · {relTime(row.at, now)}</>}
        </p>
        <h3 className="wk-inbox-read-subject">{subjectOf(row)}</h3>
        <a href={row.subjectPath} onClick={(e) => { e.preventDefault(); navigate(row.subjectPath); }} className="wk-link wk-inbox-read-job" title={row.subjectFull ?? row.subject}>
          {row.members !== undefined ? 'Open the first one' : view !== null ? jobTitle(view.session) : plainRunTitle(row.subject)}
        </a>
        {row.kind === 'failed-run' && view !== null && <FailureWhy view={view} />}
        {row.members !== undefined && (
          <ul className="wk-inbox-members">
            {row.members.map((m) => (
              <li key={m.key}><a href={m.subjectPath} onClick={(e) => { e.preventDefault(); navigate(m.subjectPath); }} className="wk-link">{plainRunTitle(m.subject)}</a><span className="wk-viz-meta"> · {m.question ?? m.text}</span></li>
            ))}
          </ul>
        )}
        {row.kind !== 'gate' && row.kind !== 'failed-run' && row.members === undefined && <p className="wk-inbox-read-body">{row.text}</p>}
      </div>
      <div className="wk-inbox-read-dock" data-testid="desk-inbox-dock">
        {row.kind === 'gate' && view !== null && (
          <>
            {/* The decision's own choices, exactly as the job's thread offers them (GateRow: the same
                model, the same commit paths and undo window) — never a generic Retry. */}
            <div className="wk-inbox-read-gate" data-testid="desk-inbox-gate"><GateRow view={view} gate={gate} navigate={navigate} /></div>
            <div className="wk-inbox-read-acts">
              <a href={openPath} onClick={onOpen} className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="desk-inbox-open"><ExternalLink size={13} aria-hidden />Open job</a>
            </div>
          </>
        )}
        {row.kind === 'failed-run' && view !== null && (
          <div className="wk-inbox-read-acts">
            {a.kind === 'retry-prefill' && <button type="button" data-testid="desk-inbox-retry" className="wk-btn wk-btn--primary wk-btn--sm" onClick={() => queueAct(a, row.key)}><RotateCcw size={13} aria-hidden />{deskVerb(a.label)}</button>}
            <a href={openPath} onClick={onOpen} className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="desk-inbox-open"><ExternalLink size={13} aria-hidden />Open job</a>
            {archive === 'idle' && <button type="button" data-testid="desk-inbox-done" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => setArchive('confirm')}><Archive size={13} aria-hidden />Mark done</button>}
            {archive === 'confirm' && (
              <span className="wk-inbox-confirm">
                <span>Archive this job? It leaves Needs you; nothing is deleted.</span>
                <button type="button" data-testid="desk-inbox-done-confirm" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={markDone}>Archive</button>
                <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" onClick={() => setArchive('idle')}>Cancel</button>
              </span>
            )}
            {archive === 'sending' && <span className="wk-viz-meta">Archiving…</span>}
            {archive === 'done' && <span className="wk-viz-meta">Archived.</span>}
            {archive === 'failed' && <span className="wk-viz-meta">Couldn’t archive it. Try again from the job.</span>}
          </div>
        )}
        {row.members !== undefined && a.kind === 'batch-approve' && <div className="wk-inbox-read-acts"><ApprovalGroupActions runIds={a.runIds} label={a.label} /></div>}
        {row.kind !== 'gate' && row.kind !== 'failed-run' && row.members === undefined && (
          <div className="wk-inbox-read-acts">
            {a.kind === 'open'
              ? <a href={a.path} onClick={onOpen} className="wk-btn wk-btn--primary wk-btn--sm">{deskVerb(a.label)}</a>
              : <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" onClick={() => queueAct(a, row.key)}>{deskVerb(a.label)}</button>}
          </div>
        )}
      </div>
    </article>
  );
}
