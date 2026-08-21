import type { Blocker } from '../store/readiness.js';
import { MODE_SPECS } from './ModeSwitcher.js';
import { PANEL, S } from './SurfaceState.js';
import type { Mode } from '../hooks/useRoute.js';

// The install gate (DES-MERGE-001 §5.6, §4.9, slice 17) — interactive's `InstallGate.jsx`
// rebuilt on studio's merged readiness model.
//
// It stands in for the mode surface ONLY when a hard dependency is absent, and it is an
// ACTIONABLE status in the §3.3 sense: it names the missing subject, carries the service's
// install command verbatim (never paraphrased — the user has to type it), and keeps both
// controls in the same block. Re-check re-runs the proxied preflight so a just-run install
// lands without a reload; Continue anyway is interactive's #159 escape, kept because a
// preflight can be wrong and a user who knows better must not be locked out of their own
// document.

const CODE: React.CSSProperties = {
  background: 'var(--surface-base)', border: `1px solid ${S.border}`, borderRadius: '6px',
  color: S.ink, display: 'block', fontFamily: 'ui-monospace, monospace', fontSize: '12px',
  margin: '6px 0 0', padding: '8px 10px', userSelect: 'all', whiteSpace: 'pre-wrap',
};

const BUTTON: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${S.border}`, borderRadius: '6px',
  color: S.ink, cursor: 'pointer', fontSize: '12px', padding: '6px 12px',
};

export interface InstallGateProps {
  mode: Mode;
  /** Every hard dependency the service reported missing — all of them, not just the first. */
  blockers: Blocker[];
  onContinue: () => void;
  onRecheck: () => void;
}

export function InstallGate({ mode, blockers, onContinue, onRecheck }: InstallGateProps): React.ReactElement {
  const label = MODE_SPECS[mode].label;
  const subjects = blockers.map((b) => b.subject).join(', ');

  return (
    <div data-testid="install-gate" data-mode={mode} style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
      <div style={PANEL}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, color: S.ink, margin: '0 0 8px' }}>
          {label} mode needs {subjects}
        </h2>
        <p style={{ fontSize: '13px', color: S.muted, margin: '0 0 14px', lineHeight: 1.5 }}>
          {label} runs on this project’s document service, and the service reports the
          dependency below as missing. Install it, then re-check — or continue anyway and
          find out where it bites.
        </p>
        {blockers.map((b) => (
          <div key={b.subject} data-testid="install-gate-dep" data-dep={b.subject} style={{ margin: '0 0 14px' }}>
            <p style={{ fontSize: '13px', color: S.ink, margin: 0 }}>
              <strong>{b.subject}</strong> is not installed.
            </p>
            {b.install
              ? <code data-testid="install-gate-command" style={CODE}>{b.install}</code>
              : (
                <p data-testid="install-gate-no-command" style={{ fontSize: '13px', color: S.muted, margin: '6px 0 0' }}>
                  The service named no install command for it — see this project’s setup notes.
                </p>
              )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" data-testid="install-gate-recheck" onClick={onRecheck} style={BUTTON}>
            Re-check
          </button>
          <button
            type="button"
            data-testid="install-gate-continue"
            onClick={onContinue}
            style={{ ...BUTTON, borderColor: S.accent, color: S.accent }}
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
