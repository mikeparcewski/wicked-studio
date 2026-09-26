import { countTone, COUNT_TONE_COLOR } from '../board/countTone.js';
import type { ProjectBriefView } from '../hooks/useProjectVisits.js';

/**
 * The "since you were last here" band (studio wave 2b, behaviour 7): one line under the
 * project header — what changed while the operator was in another project, and the
 * decisions open now. Renders `useProjectBrief`; absent when there is nothing to say.
 */
export function ProjectBrief({ brief }: { brief: ProjectBriefView | null }): React.ReactElement | null {
  if (brief === null) return null;
  const tone = countTone(brief.counts.gates + brief.counts.failed, brief.counts.failed > 0 ? 'fail' : 'gate');
  return (
    <div
      data-testid="project-brief"
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
        padding: '4px 14px', borderBottom: '1px solid var(--surface-raised)',
        background: 'var(--surface-card)', fontSize: 'var(--text-xs)',
      }}
    >
      <span aria-hidden style={{ color: COUNT_TONE_COLOR[tone] ?? 'var(--ink-dim)' }}>◷</span>
      <span data-testid="project-brief-line" style={{ color: 'var(--ink-high)', fontFamily: 'var(--font-mono)' }}>
        {brief.line}
      </span>
      <button
        type="button"
        data-testid="project-brief-dismiss"
        aria-label="Dismiss the brief"
        onClick={brief.dismiss}
        style={{
          marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--ink-dim)', fontSize: 'var(--text-xs)', padding: '0 4px',
        }}
      >
        ×
      </button>
    </div>
  );
}
