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

/** One issue's words: "#539 — Title · 2,140 chars", or why it is not appended. Pure. */
export function linkedIssueWords(issue: LinkedIssue): string {
  // crew answers a left-out ref as `{resolved: false, excluded: true}` (it was not read): left out,
  // not unreadable (codex r1).
  if (issue.excluded === true) return `${issue.ref}${issue.title !== undefined ? ` — ${issue.title}` : ''} · left out`;
  if (!issue.resolved) return `${issue.ref} — could not be read${issue.error !== undefined ? `: ${issue.error}` : ''}`;
  const size = typeof issue.chars === 'number' ? ` · ${issue.chars.toLocaleString('en-US')} chars` : '';
  return `${issue.ref}${issue.title !== undefined ? ` — ${issue.title}` : ''}${size}${issue.excluded === true ? ' · left out' : ''}`;
}

/** Reads the preview for `problem` (debounced), re-read whenever the left-out set changes. */
export function useLinkedIssuesPreview(input: { enabled: boolean; problem: string; repoRef: string | null; exclude: readonly string[] }): LinkedIssuesPreviewResponse | null {
  const { enabled, problem, repoRef, exclude } = input;
  // The preview is shown only for the inputs it was read for (codex r1): while the text, the repo or
  // the left-out set changes, the old answer is not displayed as this launch's.
  const [read, setRead] = useState<{ key: string; preview: LinkedIssuesPreviewResponse } | null>(null);
  const text = problem.trim();
  const key = [text, repoRef ?? '', ...exclude].join('\u0000');
  useEffect(() => {
    if (!enabled || text === '') return;
    let live = true;
    const timer = setTimeout(() => {
      api.previewLinkedIssues({ problem: text, ...(repoRef !== null ? { repoRef } : {}), ...(exclude.length > 0 ? { excludeLinkedIssues: [...exclude] } : {}) })
        .then((p) => { if (live) setRead({ key, preview: p }); })
        .catch((e: unknown) => { if (live) setRead({ key, preview: { issues: [], appendedChars: 0, error: e instanceof Error ? e.message : String(e) } }); });
    }, 500);
    return () => { live = false; clearTimeout(timer); };
    // `key` stands for `text`, `repoRef` and `exclude` (a fresh array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return enabled && text !== '' && read !== null && read.key === key ? read.preview : null;
}

export function LinkedIssuesLine({ preview, exclude, onToggle }: {
  preview: LinkedIssuesPreviewResponse | null;
  exclude: readonly string[];
  onToggle: (ref: string, leaveOut: boolean) => void;
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
