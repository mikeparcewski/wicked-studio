import type React from 'react';
import { apiBase } from '../../api/client.js';
import type { SessionView } from '../../api/types.js';

/**
 * crew#720 (operator ruling 2026-10-10): every delivery leaves a zip of the run's final codebase,
 * whatever came of it — delivered, push refused, credentials missing, wrong account, a lift
 * conflict, a run that failed after building. The delivery card and the run record both offer it,
 * in every outcome, as "Download code (.zip)" with the zip's sha256; and a deliver phase that
 * refused for want of the provider credential says so here, naming what to set.
 *
 * Pure over the run DTO (`session.codebase_archive`, `session.deliver_credentials`, api-types
 * 0.104.0): no fetch, so it costs nothing on any surface.
 */

/** The absolute download URL for a daemon-relative `codebase_archive.url`. */
export function codebaseHref(url: string): string {
  return `${apiBase().replace(/\/api\/v1$/, '')}${url}`;
}

function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PROVIDER_WORD = { github: 'GitHub', azure_devops: 'Azure DevOps' } as const;

/** "Download code (.zip)" — rendered whenever the run carries an archive. */
export function CodebaseDownload({ view, testId = 'run-codebase-zip' }: { view: SessionView; testId?: string }): React.ReactElement | null {
  const a = view.session.codebase_archive;
  if (a === undefined) return null;
  const name = `${view.session.id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)}-codebase.zip`;
  return (
    <p data-testid={testId} className="wk-session-codebase">
      <a href={codebaseHref(a.url)} download={name} data-testid={`${testId}-link`} title={`The run's final tree (${a.source === 'branch' ? 'from its branch' : 'from its worktree'}), tracked files only — sha256 ${a.sha256}`}>
        Download code (.zip)
      </a>
      <span className="wk-session-grey">
        {' '}· {sizeWords(a.bytes)} · sha256 <code data-testid={`${testId}-sha`}>{a.sha256.slice(0, 12)}</code>
      </span>
    </p>
  );
}

/** The credentials-missing state — present only when the deliver phase refused for want of it. */
export function DeliverCredentialsNotice({ view }: { view: SessionView }): React.ReactElement | null {
  const c = view.session.deliver_credentials;
  if (c === undefined || c.status !== 'missing') return null;
  return (
    <div role="alert" data-testid="run-deliver-credentials" data-provider={c.provider} className="wk-session-credentials">
      <p className="wk-session-credentials-head">{PROVIDER_WORD[c.provider]} credentials not configured — nothing was pushed; the work is kept.</p>
      <p className="wk-session-grey">{c.message}</p>
      {c.missing.length > 0 && (
        <p className="wk-session-grey">
          Set: {c.missing.map((m, i) => (
            <span key={m}>
              {i > 0 ? ', ' : ''}
              <code>{m}</code>
            </span>
          ))}
          . Then approve the deliver gate to retry.
        </p>
      )}
    </div>
  );
}
