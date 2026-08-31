import type { RunArtifact } from './narrator.js';

/**
 * One artifact the run produced (DES-RUN-NARRATOR §6): a file the worker
 * touched (opens in the existing FileViewer — never a dead click) or the
 * delivered PR (an external link). Rendered inline in the narrated feed right
 * behind the narration line that produced it, and reused by the now-bar's
 * collected-artifacts popover.
 */
export function ArtifactCard({
  artifact,
  onOpenFile,
  compact = false,
}: {
  artifact: RunArtifact;
  onOpenFile?: ((path: string) => void) | undefined;
  /** Popover dress: tighter padding, no phase caption. */
  compact?: boolean;
}): React.ReactElement {
  const dir = artifact.kind === 'file' ? artifact.ref.slice(0, artifact.ref.length - artifact.name.length) : '';
  return (
    <div
      data-testid="artifact-card"
      data-artifact-kind={artifact.kind}
      className={`flex items-center gap-2 rounded-lg font-mono ${compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs self-start max-w-[85%]'}`}
      style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
    >
      <span aria-hidden="true" className="shrink-0" style={{ color: 'var(--ink-dim)' }}>
        {artifact.kind === 'pr' ? '⇡' : '▤'}
      </span>
      <span className="min-w-0 flex items-baseline gap-1.5">
        <span className="truncate font-medium" style={{ color: 'var(--ink-body)' }} title={artifact.ref}>
          {artifact.name}
        </span>
        {!compact && dir !== '' && (
          <span className="truncate" style={{ color: 'var(--ink-dim)', maxWidth: '18rem' }}>{dir}</span>
        )}
        {!compact && artifact.phase !== null && (
          <span className="shrink-0" style={{ color: 'var(--ink-dim)' }}>· {artifact.phase}</span>
        )}
      </span>
      {artifact.kind === 'pr' ? (
        <a
          data-testid="artifact-open"
          href={artifact.ref}
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Open ›
        </a>
      ) : onOpenFile !== undefined ? (
        <button
          type="button"
          data-testid="artifact-open"
          onClick={() => onOpenFile(artifact.ref)}
          className="ml-auto shrink-0 hover:underline"
          style={{ color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
        >
          View ›
        </button>
      ) : null}
    </div>
  );
}
