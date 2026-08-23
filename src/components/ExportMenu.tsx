import { useEffect, useState } from 'react';
import { interactiveUrl } from '../api/interactive.js';
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
// here is what the pressed button owes the finger that pressed it — DES-UX-001 §7.2
// (B5, EC37) makes that a contract: the clicked control answers PENDING (a spinner on
// the control), READY (the control itself becomes the download affordance), or FAILED
// (the reason, adjacent, with the retriable row above it) — where the click happened,
// never only in a thread that may be off screen.

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

/** The READY state at the click site (§7.2): a real anchor, wearing the accent —
 *  the finished artifact is the affordance now, not a report about one. */
const READY: React.CSSProperties = {
  border: '1px solid var(--accent-subtle)', color: S.accent,
  textDecoration: 'none',
};

/** What the click site holds once its export finished: the artifact itself. */
interface ReadyArtifact { format: ExportFormat; href: string; file: string }

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
  const [ready, setReady] = useState<ReadyArtifact | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // §7.2: the click site answers for THIS version. A new selection retires the
  // previous answer — a v3 artifact link must not sit under an "Export v4" label.
  useEffect(() => { setReady(null); setHint(null); }, [docId, version]);

  function run(format: ExportFormat): void {
    setBusy(format);
    setReady(null);
    setHint(null);
    void runExport({ projectId, docId, version, format })
      .then((outcome) => {
        if (outcome.ok) {
          // READY at the click site: the service's `download` is bridge-root-relative;
          // resolved through the proxy it stays on the one origin (§5.3).
          setReady({ format, href: interactiveUrl(projectId, outcome.result.download),
                     file: outcome.file });
        } else {
          setHint(outcome.hint);
        }
      })
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
          // §7.2 READY: the control that was clicked IS the download now — a real
          // anchor with the artifact's name, at the click site. The thread message
          // remains; this is the click site answering (EC37).
          ready !== null && ready.format === format ? (
            <a
              key={format}
              data-testid="export-ready"
              data-format={format}
              href={ready.href}
              download={ready.file}
              title={`${format.toUpperCase()} ready — download ${ready.file}`}
              style={{ ...(compact ? COMPACT : BUTTON), ...READY }}
            >
              {compact ? `${format} ↓` : `${format.toUpperCase()} ↓`}
            </a>
          ) : (
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
              {/* §7.2 PENDING: the spinner lives ON the clicked control. */}
              {busy === format
                ? <span data-testid="export-pending" className="animate-pulse">{format}…</span>
                : compact ? format : format.toUpperCase()}
            </button>
          )
        ))}
      </div>
      {/* §7.2 FAILED, §3.3: the reason is stated and the control that retries it is the
          row above — adjacent, not a toast that takes the fix away with it when it fades. */}
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
