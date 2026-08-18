import type { Mode } from '../hooks/useRoute.js';
import { MODE_SPECS } from './ModeSwitcher.js';

const S = {
  card:   '#161b22',
  border: 'rgba(230,237,243,0.1)',
  ink:    '#e6edf3',
  muted:  'rgba(230,237,243,0.55)',
  accent: '#ffda19',
};

/**
 * The surface a mode shows before its transport lands (Document → slice 8,
 * Video → slice 13). Deliberately NOT a spinner: §3.3 bans a working state with
 * no subject, so this states what the mode is, with its subject, and names the
 * one action that enables it — the same string the disabled tab's tooltip carries.
 */
export function ModePlaceholder({ mode }: { mode: Mode }): React.ReactElement {
  const spec = MODE_SPECS[mode];
  return (
    <div style={{ padding: '32px', overflowY: 'auto' }}>
      <div
        data-testid={`mode-placeholder-${mode}`}
        style={{
          background: S.card, border: `1px solid ${S.border}`, borderRadius: '10px',
          padding: '20px 22px', maxWidth: '640px',
        }}
      >
        <h2 style={{ fontSize: '15px', fontWeight: 700, color: S.ink, margin: '0 0 8px' }}>
          {spec.label} mode is not connected yet
        </h2>
        <p style={{ fontSize: '13px', color: S.muted, margin: '0 0 14px', lineHeight: 1.5 }}>
          {spec.summary}
        </p>
        <p
          data-testid={`mode-enabling-action-${mode}`}
          style={{
            fontSize: '13px', color: S.ink, margin: 0, lineHeight: 1.5,
            borderLeft: `2px solid ${S.accent}`, paddingLeft: '10px',
          }}
        >
          <strong>To enable it:</strong> {spec.enables}
        </p>
      </div>
    </div>
  );
}
