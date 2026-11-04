import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { isRouteAbsent } from '../../api/errors.js';
import { trackerIssuesOf, trackerRefusal, trackersApi, trackerTitle, type TrackerIssue, type TrackerIssuesResponse } from '../../api/trackers.js';
import { useModalEscape } from '../Modal.js';
import { FromTag, TrackerBadge } from './TrackerParts.js';

type Tracker = TrackerIssuesResponse['trackers'][number];

/**
 * How a picked issue is named in the intent: as the tracker names it, qualified by its source (`<source>:KEY-N`) when
 * another tracker of the set has the same key (two Jira sites), so crew resolves exactly that one (DES-PM-001 §3.2).
 */
export function issueRef(t: Tracker, issue: TrackerIssue, all: readonly Tracker[]): string {
  const clashes = all.filter((o) => o.trackerId !== t.trackerId && o.system === t.system && o.key === t.key);
  if (clashes.length === 0) return issue.key;
  // Two sites behind ONE source need the site too (`<source>@<cloudId>:KEY-N`); without it, the bare key goes in and
  // the "Appended at launch" line asks the person to pick (crew reports it ambiguous).
  if (clashes.some((o) => o.source === t.source)) return typeof t.tenant === 'string' && t.tenant !== '' ? `${t.source}@${t.tenant}:${issue.key}` : issue.key;
  return `${t.source}:${issue.key}`;
}

/** The intent with the issue in it: "BILL-142: Proration rounds annual plans down", or the person's words and the ref. */
export function withIssue(text: string, ref: string, title: string): string {
  const t = text.trimEnd();
  if (t === '') return `${ref}: ${title}`;
  return hasRef(t, ref) ? t : `${t} (${ref})`;
}

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `text` already names exactly `ref` (a whole reference: `BILL-1` is not in `BILL-142`, nor `#4` in `#42`). */
export function hasRef(text: string, ref: string): boolean {
  return new RegExp(`(^|[^\\w:/#@-])${escRe(ref)}(?![\\w-])`).test(text);
}

/**
 * FROM AN ISSUE (DES-PM-001 §6.1, mockup screen 6): the open issues of the tracker set of the chosen project and repo,
 * grouped by tracker (each labelled with where it comes from), searched as the person types. Picking one writes its
 * key into the intent; crew reads it at launch through the same tracker set (the "Appended at launch" line below the
 * composer is crew's preview of exactly that). Only crew's answer is listed.
 */
export function IssuePicker({ projectId, repoId, projectName, repoName, onPick, onClose }: {
  projectId: string | null;
  repoId: string | null;
  projectName: string | null;
  repoName: string | null;
  onPick: (ref: string, issue: TrackerIssue) => void;
  onClose: () => void;
}): React.ReactElement {
  useModalEscape(onClose);
  const [q, setQ] = useState('');
  const [read, setRead] = useState<{ key: string; state: 'ok'; r: TrackerIssuesResponse } | { key: string; state: 'unreadable' | 'absent' } | { key: string; state: 'failed'; words: string } | null>(null);
  const gen = useRef(0);
  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const key = `${projectId ?? ''}\u0000${repoId ?? ''}\u0000${q.trim()}`;
  useEffect(() => {
    const mine = ++gen.current;
    const timer = setTimeout(() => {
      trackersApi.issues({ project: projectId, repo: repoId, q: q.trim() }).then(
        (raw) => {
          if (mine !== gen.current) return;
          const r = trackerIssuesOf(raw);
          setRead(r === null ? { key, state: 'unreadable' } : { key, state: 'ok', r });
        },
        (e: unknown) => { if (mine === gen.current) setRead(isRouteAbsent(e) ? { key, state: 'absent' } : { key, state: 'failed', words: trackerRefusal(e, 'read') }); },
      );
    }, q === '' ? 0 : 300);
    return () => clearTimeout(timer);
    // `key` stands for the project, the repo and the trimmed text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const shown = read !== null && read.key === key ? read : null;
  const trackers = shown?.state === 'ok' ? shown.r.trackers : [];
  const where = [projectName !== null ? `a job in ${projectName}` : 'a job', repoName !== null ? `on ${repoName}` : null].filter(Boolean).join(' ');
  return (
    <div className="wk-trk-issues" role="dialog" aria-label="Start from an issue" data-testid="issue-picker">
      <label className="wk-trk-search">
        <Search size={14} aria-hidden />
        <input ref={box} type="search" className="wk-field wk-src-input" data-testid="issue-picker-search" placeholder="Search issues in this job’s trackers" aria-label="Search issues in this job’s trackers" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {shown === null && <p className="wk-src-cap">Reading the issues…</p>}
      {shown?.state === 'absent' && <p className="wk-src-note" data-testid="issue-picker-absent">This crew can’t list issues here yet: write the issue’s key (BILL-142, #212) in your words, and crew reads it at launch.</p>}
      {shown?.state === 'unreadable' && <p className="wk-src-note wk-src-tone-fail" data-testid="issue-picker-unreadable">crew’s list of issues could not be read, so none is shown: update studio or crew.</p>}
      {shown?.state === 'failed' && <p className="wk-src-note wk-src-tone-fail" data-testid="issue-picker-failed">{shown.words}</p>}
      {shown?.state === 'ok' && trackers.length === 0 && <p className="wk-src-note" data-testid="issue-picker-none">No tracker is linked to this project or its repositories, so there are no issues to start from.</p>}
      {trackers.map((t) => (
        <div key={t.trackerId} className="wk-trk-ig" data-testid="issue-picker-group" data-tracker={t.trackerId}>
          <h4><TrackerBadge system={t.system} small />{trackerTitle(t)}
            {/* Two trackers with one key (two sites, or two tools): each says which it is. */}
            {trackers.some((o) => o.trackerId !== t.trackerId && o.system === t.system && o.key === t.key) && <span className="wk-src-cap" data-testid="issue-picker-group-where">{t.source}{t.tenantLabel !== undefined ? ` · ${t.tenantLabel}` : t.tenant !== undefined ? ` · ${t.tenant}` : ''}</span>}{' '}
            {t.via.kind === 'project' ? <FromTag via="project">linked to {projectName ?? 'the project'}</FromTag> : <FromTag via="repo">through repo {t.via.id}</FromTag>}
          </h4>
          {t.error !== undefined && <p className="wk-src-note wk-src-tone-warn" data-testid="issue-picker-group-error">Its issues couldn’t be listed ({t.error.replace(/_/g, ' ')}).</p>}
          {t.error === undefined && t.issues.length === 0 && <p className="wk-src-note">No open issue{q.trim() !== '' ? ' matches' : ''}.</p>}
          {t.issues.map((i) => (
            <button key={i.key} type="button" className="wk-trk-iss" data-testid="issue-picker-issue" data-key={i.key} onClick={() => onPick(issueRef(t, i, trackers), i)}>
              {/* A GitHub issue under its repo's heading reads as `#212`; the pick keeps the whole ref. */}
              <code title={i.key}>{t.system === 'github' && i.key.startsWith(`${t.key}#`) ? i.key.slice(t.key.length) : i.key}</code><span>{i.title}</span>{i.state !== null && <em>{i.state}</em>}
            </button>
          ))}
        </div>
      ))}
      <p className="wk-src-note">{shown?.state === 'ok' ? `Issues from the ${trackers.length} tracker${trackers.length === 1 ? '' : 's'} ${where} can read. Type to search all of them.` : ''}</p>
      <div className="wk-trk-pop-foot"><button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="issue-picker-close" onClick={onClose}>Close</button></div>
    </div>
  );
}

/**
 * The intent with an ambiguous bare ref replaced by the source-qualified form the person picked: every whole-word
 * `PROJ-1` (not already qualified) becomes `<source>:PROJ-1`.
 */
export function qualifyRef(text: string, ref: string, qualified: string): string {
  return text.replace(new RegExp(`(^|[^\\w:/#@-])${escRe(ref)}(?![\\w-])`, 'g'), (_m, pre: string) => `${pre}${qualified}`);
}
