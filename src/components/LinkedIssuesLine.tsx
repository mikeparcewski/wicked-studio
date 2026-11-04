import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { LinkedIssue, LinkedIssuesPreviewResponse } from '../api/types.js';

/**
 * studio#596 (crew#825): before Send, what a WORKFLOW launch will append to its problem — the issues
 * its intent links (`#N`, `owner/repo#N`, an issue URL), which the daemon reads under its own
 * identity and appends as background. The line says "N linked issues will be appended (≈K chars)",
 * then each issue as ref + title + size with a toggle to leave it out; the left-out refs ride the
 * launch as `excludeLinkedIssues`, exactly as the preview spelled them. Excluded and unreadable refs
 * say so. A preview `error` is a plain line, never a blocker: the launch then runs on the intent
 * alone, as `POST /runs` does on the same fault. Nothing renders while the intent links nothing.
 */

/** The confirm line: what will be appended, in words. Pure. */
export function linkedIssuesLine(preview: LinkedIssuesPreviewResponse): string | null {
  const appended = preview.issues.filter((i) => i.resolved && i.excluded !== true);
  if (preview.issues.length === 0) return null;
  if (appended.length === 0) return 'No linked issue will be appended.';
  const n = appended.length === 1 ? '1 linked issue will be appended' : `${appended.length} linked issues will be appended`;
  return `${n} (≈${preview.appendedChars.toLocaleString('en-US')} chars).`;
}

/** (DES-PM-001 §3.2, api-types 0.187.0) Why crew did not read a ref through the tracker set, in plain words. */
const NOT_READ: Record<string, string> = {
  not_linked: 'not in a tracker linked to this project or its repositories',
  ambiguous: 'two linked trackers have this key: pick one below',
  hidden: 'the tool’s Agents switches keep this project out',
  query_off: 'agents can’t read issues from that tool (its “read issues” switch is off)',
  unavailable: 'the tool couldn’t be reached',
  not_found: 'the tracker has no such issue',
};

/** One issue's words: "#539 — Title · 2,140 chars", or why it is not appended. Pure. */
export function linkedIssueWords(issue: LinkedIssue): string {
  const code = (issue as { code?: unknown }).code;
  if (!issue.resolved && issue.excluded !== true && typeof code === 'string' && Object.hasOwn(NOT_READ, code)) return `${issue.ref} — not read: ${NOT_READ[code]}`;
  // crew answers a left-out ref as `{resolved: false, excluded: true}` (it was not read): left out,
  // not unreadable (codex r1).
  if (issue.excluded === true) return `${issue.ref}${issue.title !== undefined ? ` — ${issue.title}` : ''} · left out`;
  if (!issue.resolved) return `${issue.ref} — could not be read${issue.error !== undefined ? `: ${issue.error}` : ''}`;
  const size = typeof issue.chars === 'number' ? ` · ${issue.chars.toLocaleString('en-US')} chars` : '';
  return `${issue.ref}${issue.title !== undefined ? ` — ${issue.title}` : ''}${size}${issue.excluded === true ? ' · left out' : ''}`;
}

/** Reads the preview for `problem` (debounced), re-read whenever the left-out set changes. */
export function useLinkedIssuesPreview(input: { enabled: boolean; problem: string; repoRef: string | null; exclude: readonly string[]; projectId?: string | null }): LinkedIssuesPreviewResponse | null {
  const { enabled, problem, repoRef, exclude } = input;
  // (DES-PM-001 §3.2) Sent only by a caller on a crew with tracker links: an older crew's preview schema never sees it.
  const projectId = input.projectId === undefined || input.projectId === null || input.projectId === 'default' ? null : input.projectId;
  // The preview is shown only for the inputs it was read for (codex r1): while the text, the repo or
  // the left-out set changes, the old answer is not displayed as this launch's.
  const [read, setRead] = useState<{ key: string; preview: LinkedIssuesPreviewResponse } | null>(null);
  const text = problem.trim();
  const key = [text, repoRef ?? '', projectId ?? '', ...exclude].join('\u0000');
  useEffect(() => {
    if (!enabled || text === '') return;
    let live = true;
    const timer = setTimeout(() => {
      api.previewLinkedIssues({ problem: text, ...(repoRef !== null ? { repoRef } : {}), ...(projectId !== null ? { projectId } : {}), ...(exclude.length > 0 ? { excludeLinkedIssues: [...exclude] } : {}) } as Parameters<typeof api.previewLinkedIssues>[0])
        .then((p) => { if (live) setRead({ key, preview: p }); })
        .catch((e: unknown) => { if (live) setRead({ key, preview: { issues: [], appendedChars: 0, error: e instanceof Error ? e.message : String(e) } }); });
    }, 500);
    return () => { live = false; clearTimeout(timer); };
    // `key` stands for `text`, `repoRef`, `projectId` and `exclude` (a fresh array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return enabled && text !== '' && read !== null && read.key === key ? read.preview : null;
}

export function LinkedIssuesLine({ preview, exclude, onToggle, onQualify }: {
  preview: LinkedIssuesPreviewResponse | null;
  exclude: readonly string[];
  onToggle: (ref: string, leaveOut: boolean) => void;
  /** (DES-PM-001 §3.2) A key two linked trackers share: the person picks one, which writes `<source>:<ref>`. */
  onQualify?: (ref: string, qualified: string) => void;
}): React.ReactElement | null {
  if (preview === null) return null;
  const line = linkedIssuesLine(preview);
  if (line === null && preview.error === undefined) return null;
  return (
    <div data-testid="launch-linked-issues" className="wk-composer-note">
      {line !== null && <p data-testid="launch-linked-issues-line">{line}</p>}
      {preview.issues.length > 0 && (
        <ul className="wk-linked-issues">
          {preview.issues.map((issue) => {
            const out = exclude.includes(issue.ref) || issue.excluded === true;
            return (
              <li key={issue.ref} data-testid="launch-linked-issue" data-ref={issue.ref} data-resolved={issue.resolved ? 'true' : 'false'} data-excluded={out ? 'true' : 'false'}>
                {/* An unreadable ref is never appended, so there is nothing to leave out: words only. A
                    left-out ref keeps its toggle, so it can be put back (codex r1). */}
                {issue.resolved || issue.excluded === true ? (
                  <label>
                    <input
                      type="checkbox"
                      data-testid="launch-linked-issue-include"
                      checked={!out}
                      onChange={(e) => onToggle(issue.ref, !e.target.checked)}
                      aria-label={`Append ${issue.ref} to the launch`}
                    />{' '}
                    {linkedIssueWords(issue)}
                  </label>
                ) : linkedIssueWords(issue)}
                {onQualify !== undefined && <AmbiguousPick issue={issue} onQualify={onQualify} />}
              </li>
            );
          })}
        </ul>
      )}
      {preview.error !== undefined && (
        <p data-testid="launch-linked-issues-error">Linked issues could not be read ({preview.error}); the launch runs on your words alone.</p>
      )}
    </div>
  );
}

/** The trackers an ambiguous key is in, as buttons: picking one writes `<source>:<ref>` into the intent. */
function AmbiguousPick({ issue, onQualify }: { issue: LinkedIssue; onQualify: (ref: string, qualified: string) => void }): React.ReactElement | null {
  const raw = issue as { code?: unknown; candidates?: unknown };
  if (raw.code !== 'ambiguous' || !Array.isArray(raw.candidates)) return null;
  const cands = (raw.candidates as unknown[]).filter((c): c is { source: string; tenant: string; tenantLabel?: string } =>
    typeof c === 'object' && c !== null && typeof (c as { source?: unknown }).source === 'string' && typeof (c as { tenant?: unknown }).tenant === 'string');
  if (cands.length === 0) return null;
  // The key itself, whatever qualification the ref already had (Jira keys and GitHub refs hold no colon).
  const bare = issue.ref.slice(issue.ref.lastIndexOf(':') + 1);
  return (
    <span className="wk-linked-issue-pick" data-testid="launch-linked-issue-ambiguous">
      {cands.map((c) => (
        <button key={`${c.source}\u0000${c.tenant}`} type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="launch-linked-issue-qualify"
          // Two sites behind one source: the site names it too (`<source>@<cloudId>:KEY-N`, DES-PM-001 §3.2).
          onClick={() => onQualify(issue.ref, cands.filter((o) => o.source === c.source).length > 1 ? `${c.source}@${c.tenant}:${bare}` : `${c.source}:${bare}`)}>
          {c.source}{typeof c.tenantLabel === 'string' ? ` · ${c.tenantLabel}` : cands.filter((o) => o.source === c.source).length > 1 ? ` · ${c.tenant}` : ''}
        </button>
      ))}
    </span>
  );
}
