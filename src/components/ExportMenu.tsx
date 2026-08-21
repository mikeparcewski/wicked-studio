import { useState } from 'react';
import type { ExportFormat } from '../api/interactive.js';
import { EXPORT_FORMATS, runExport } from '../interactive/exportWire.js';

// The export control (DES-MERGE-001 §4.4, §6.4 slice 15) — ONE component in both places
// the design puts it: per-version on the document's version strip, and as a quick action
// on the board card's doc tile (§1.4). "Export this document at this version" is one
// action wherever it is offered; what differs is only how loud it is on a surface the
// user is scanning, which is what `compact` is.
//
// Everything a READER needs lands in the thread (§4.4, §2.5): the in-flight line, the
// downloadable artifact, and the install hint of an export that could not run. What stays
// here is only what the pressed button owes the finger that pressed it — which format is
// running, and, on the board where no thread is on screen, the reason it stopped.

// DES-VISION-001 §2.11: semantic tokens only. The RUNNING format speaks the
// brand accent (an affordance state); the hint below is an actionable install
// command, so it speaks the §2.6 gate layer in the mono (data, §2.8).
const S = {
  border: 'var(--surface-raised)',
  muted:  'var(--ink-muted)',
  faint:  'var(--ink-dim)',
  accent: 'var(--accent)',
  hint:   'var(--status-gate)',
};

const BUTTON: React.CSSProperties = {
  background: 'transparent', border: `1px solid ${S.border}`, borderRadius: 'var(--radius-sm)',
  color: S.muted, cursor: 'pointer', fontSize: 'var(--text-2xs)',
  fontFamily: 'var(--font-sans)', lineHeight: 1.6, padding: '1px 6px',
};

/** The tile variant: bare text, because a card is scanned and a box is a claim on the eye. */
const COMPACT: React.CSSProperties = {
  background: 'none', border: 'none', color: S.muted, cursor: 'pointer',
  fontFamily: 'var(--font-mono)', fontSize: '9px', padding: 0,
};

export interface ExportMenuProps {
  projectId: string;
  docId: string;
  /** The version to export — the strip's selection, or the tile's head. Never "latest":
   *  §4.2 addresses versions explicitly, and a download is a thing you keep. */
  version: number;
  compact?: boolean;
}

export function ExportMenu({ projectId, docId, version, compact = false }: ExportMenuProps): React.ReactElement {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  function run(format: ExportFormat): void {
    setBusy(format);
    setHint(null);
    void runExport({ projectId, docId, version, format })
      .then((outcome) => { if (!outcome.ok) setHint(outcome.hint); })
      .finally(() => setBusy(null));
  }

  return (
    <div
      data-testid="export-menu"
      data-doc-id={docId}
      data-version={version}
      // Capped: the hint below can be a whole install command, and a control that grows to
      // fit its own error message would push the surface it sits on out of the way.
      style={{ alignSelf: 'center', display: 'flex', flexDirection: 'column',
               flexShrink: 0, gap: '2px', maxWidth: '220px', minWidth: 0 }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: compact ? '7px' : '5px' }}>
        {!compact && (
          <span style={{ color: S.faint, fontSize: 'var(--text-2xs)', letterSpacing: '0.06em',
                         fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
            Export v{version}
          </span>
        )}
        {EXPORT_FORMATS.map((format) => (
          <button
            key={format}
            type="button"
            data-testid="export-format"
            data-format={format}
            disabled={busy !== null}
            onClick={() => run(format)}
            title={`Export “${docId}” v${version} as ${format.toUpperCase()} — it lands in the thread as a download`}
            style={{ ...(compact ? COMPACT : BUTTON),
                     color: busy === format ? S.accent : S.muted,
                     opacity: busy !== null && busy !== format ? 0.4 : 1 }}
          >
            {busy === format ? `${format}…` : compact ? format : format.toUpperCase()}
          </button>
        ))}
      </div>
      {/* §3.3: the reason is stated and the control that retries it is the row above —
          adjacent, not a toast that takes the fix away with it when it fades. */}
      {hint !== null && (
        <span
          data-testid="export-hint"
          title={hint}
          style={{ color: S.hint, fontSize: '9px', fontFamily: 'var(--font-mono)',
                   overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
