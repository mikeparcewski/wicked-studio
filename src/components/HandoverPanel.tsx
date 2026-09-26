import { clockTime, type HandoverSectionKey } from '../board/handover.js';
import { COUNT_TONE_COLOR, countTone, type CountKind } from '../board/countTone.js';
import type { Handover } from '../hooks/useHandover.js';
import type { Navigate } from '../hooks/useRoute.js';
import { ago } from './ProjectCard.js';
import { humanTitle } from './runIdentity.js';

/**
 * The HANDOVER panel (studio wave 2b, behaviour 1) — the first thing Home shows after an
 * absence. Renders what `useHandover` folded: four sections in a fixed order, each row a
 * real link to its run, one Dismiss. Rendering only; no derivation lives here.
 */

/** What a non-zero count of each section means (zero is always neutral — countTone). */
const SECTION_KIND: Record<HandoverSectionKey, CountKind> = {
  decisions: 'gate',
  broke: 'fail',
  finished: 'neutral',
  system: 'neutral',
};

const EMPTY_COPY: Record<HandoverSectionKey, string> = {
  decisions: 'Nothing waiting on you.',
  broke: 'Nothing broke.',
  finished: 'Nothing finished.',
  system: 'The system took no actions.',
};

export function HandoverPanel({ handover, navigate, now }: {
  handover: Handover;
  navigate: Navigate;
  now: number;
}): React.ReactElement | null {
  if (handover.since === null) return null;
  const since = handover.since;
  return (
    <section
      data-testid="handover-panel"
      aria-label="While you were away"
      style={{
        margin: '0 var(--space-6) var(--space-3)', flexShrink: 0,
        background: 'var(--surface-card)', border: '1px solid var(--surface-raised)',
        borderLeft: '3px solid var(--accent)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3) var(--space-4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: 'var(--space-2)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--ink-high)' }}>
          While you were away
        </h2>
        <span data-testid="handover-since" style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
          since {clockTime(since)} · {ago(since, now)} ago
        </span>
        <button
          type="button"
          data-testid="handover-dismiss"
          onClick={handover.dismiss}
          style={{
            marginLeft: 'auto', background: 'none', cursor: 'pointer',
            border: '1px solid var(--surface-raised)', borderRadius: 'var(--radius-md)',
            padding: '2px 10px', fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
            color: 'var(--ink-muted)',
          }}
        >
          Dismiss
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 'var(--space-3)' }}>
        {handover.sections.map((sec) => {
          const tone = countTone(sec.items.length, SECTION_KIND[sec.key]);
          return (
            <div key={sec.key} data-testid="handover-section" data-section={sec.key} data-count={sec.items.length} style={{ minWidth: 0 }}>
              <p
                style={{
                  margin: '0 0 4px', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
                  letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-dim)',
                  display: 'flex', gap: '6px', alignItems: 'baseline',
                }}
              >
                {sec.title}
                <span data-testid="handover-count" data-tone={tone} style={{ color: COUNT_TONE_COLOR[tone] ?? 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}>
                  {sec.items.length}
                </span>
              </p>
              {sec.items.length === 0 ? (
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-dim)' }}>
                  {sec.available ? EMPTY_COPY[sec.key] : 'This daemon cannot say (no audit read).'}
                </p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {sec.items.map((it) => (
                    <li key={it.key} style={{ minWidth: 0 }}>
                      <a
                        data-testid="handover-row"
                        data-run-id={it.runId ?? undefined}
                        href={it.path}
                        onClick={(e) => { e.preventDefault(); navigate(it.path); }}
                        title={`${it.subject} — ${it.text}`}
                        style={{
                          display: 'flex', flexDirection: 'column', textDecoration: 'none',
                          fontSize: 'var(--text-xs)', minWidth: 0, padding: '2px 0',
                        }}
                      >
                        <span style={{ color: 'var(--ink-high)', fontWeight: 'var(--weight-semi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {humanTitle(it.subject)}
                        </span>
                        <span style={{ display: 'flex', gap: '6px', alignItems: 'baseline', minWidth: 0 }}>
                          <span style={{ color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                            {it.text}
                          </span>
                          {it.at !== null && (
                            <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', flexShrink: 0 }}>
                              {ago(it.at, now)} ago
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
