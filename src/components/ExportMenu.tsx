import { useEffect } from 'react';
import { interactiveUrl } from '../api/interactive.js';
import type { ExportFormat } from '../api/interactive.js';
import { describeExportReport, exportReportTitle } from '../interactive/exportReport.js';
import { EXPORT_FORMATS, runExport } from '../interactive/exportWire.js';
import { exportKey, NO_ANSWERS, useExportAnswers } from '../store/exportAnswers.js';
import type { ExportAnswer } from '../store/exportAnswers.js';

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
//
// Round-3 J3: the answers live in the exportAnswers STORE, not component state — a
// landing that advances the addressed version (the route follows the head), a strip
// re-render, or a selection move must never wipe an un-acted answer. An answer for
// another version of the same doc stays visible here, labeled with ITS version.

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

export interface ExportMenuProps {
  projectId: string;
  docId: string;
  /** The version to export — the strip's selection, or the tile's head. Never "latest":
   *  §4.2 addresses versions explicitly, and a download is a thing you keep. */
  version: number;
  compact?: boolean;
  /**
   * §7.2, the J3 closed-drawer pin: told `true` while this control owes (or is
   * showing) an answer — an export in flight, a READY download not yet acted on,
   * a FAILED hint. The strip host pins itself visible on it: auto-hide fading the
   * click site's answer out from under a closed drawer IS the "clicked, nothing
   * visibly happened" failure. Optional — the board tile has no auto-hide to pin.
   */
  onHold?: ((held: boolean) => void) | undefined;
  /**
   * VIDEO-FB: the addressed version's recorded video, when the OWNER has proven
   * one exists on the wire (`/d/:id/api/demo/recording/_v<N>.webm`, probed —
   * never offered on faith). A same-origin project-scoped download beside the
   * export formats: no render step, so it is an anchor from the start.
   */
  recording?: { href: string; file: string } | null;
}

export function ExportMenu({
  projectId, docId, version, compact = false, onHold, recording = null,
}: ExportMenuProps): React.ReactElement {
  const key = exportKey(projectId, docId);
  const answers = useExportAnswers((s) => s.answers[key] ?? NO_ANSWERS);

  const pending = answers.find((a) => a.state === 'pending');
  // F-4R2-016: readiness is PER FORMAT. The first-ready-answer lookup this replaced let an
  // un-consumed HTML answer shadow the PDF that finished after it — the PDF button never
  // became its download while the file already sat in the thread. Each button asks for its
  // own (version, format) answer, so every finished format flips independently.
  const readyHere = (format: ExportFormat): Extract<ExportAnswer, { state: 'ready' }> | undefined =>
    answers.find((a): a is Extract<ExportAnswer, { state: 'ready' }> =>
      a.state === 'ready' && a.version === version && a.format === format);
  const readyHereAll = answers.filter((a): a is Extract<ExportAnswer, { state: 'ready' }> =>
    a.state === 'ready' && a.version === version);
  const failedHere = answers.filter((a) => a.state === 'failed' && a.version === version);
  // Round-3 J3: un-acted answers for OTHER versions of this doc stay at the click
  // site, labeled with their own version — never wiped by a selection move or a
  // head-follow landing, and never mislabeled as the addressed version.
  const readyElsewhere = answers.filter((a) => a.state === 'ready' && a.version !== version);
  const failedElsewhere = answers.filter((a) => a.state === 'failed' && a.version !== version);

  // The J3 hold: pending, ready and failed are all states the user has not acted
  // on yet — each keeps the click site on screen until it is consumed or replaced.
  const answering = answers.length > 0;
  useEffect(() => {
    if (!answering || onHold === undefined) return;
    onHold(true);
    return () => { onHold(false); };
  }, [answering, onHold]);

  function run(format: ExportFormat): void {
    const store = useExportAnswers.getState();
    store.begin(key, version, format);
    // The continuation writes to the module-level store, so the answer lands even
    // if this click site unmounted meanwhile (round-3 J3: churn-proof answers).
    void runExport({ projectId, docId, version, format })
      .then((outcome) => {
        useExportAnswers.getState().settle(key, outcome.ok
          ? { state: 'ready', version, format,
              // READY at the click site: the service's `download` is bridge-root-relative;
              // resolved through the proxy it stays on the one origin (§5.3). `report` is
              // the bridge's additive layout report (interactive#219) — null on an older one.
              href: interactiveUrl(projectId, outcome.result.download), file: outcome.file,
              report: outcome.report }
          : { state: 'failed', version, format, hint: outcome.hint });
      });
  }

  /** The READY anchor — the artifact IS the affordance now (§7.2). Acting on it
   *  (the download click) consumes the answer, which releases the strip hold. */
  function readyAnchor(a: Extract<ExportAnswer, { state: 'ready' }>, labelVersion: boolean): React.ReactElement {
    const label = labelVersion
      ? (compact ? `${a.format} v${a.version} ↓` : `${a.format.toUpperCase()} v${a.version} ↓`)
      : (compact ? `${a.format} ↓` : `${a.format.toUpperCase()} ↓`);
    // interactive#219: what was printed, when the bridge said — on the hover text here, and
    // as its own line under the row (below) where the control is not compact.
    const printed = exportReportTitle(a.report ?? null);
    return (
      <a
        key={`${a.format}-${a.version}`}
        data-testid="export-ready"
        data-format={a.format}
        data-version={String(a.version)}
        data-pages={a.report?.pages ?? undefined}
        data-page-size={a.report?.pageSize ?? undefined}
        href={a.href}
        download={a.file}
        onClick={() => useExportAnswers.getState().consume(key, a.version, a.format)}
        title={`${a.format.toUpperCase()} of v${a.version} ready — download ${a.file}${printed === null ? '' : ` · ${printed}`}`}
        style={{ ...(compact ? COMPACT : BUTTON), ...READY }}
      >
        {label}
      </a>
    );
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
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: compact ? '7px' : '5px' }}>
        {!compact && (
          <span style={{ color: S.faint, fontSize: 'var(--text-2xs)', letterSpacing: '0.06em',
                         fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
            Export v{version}
          </span>
        )}
        {EXPORT_FORMATS.map((format) => {
          // §7.2 READY: the control that was clicked IS the download now — a real
          // anchor with the artifact's name, at the click site. The thread message
          // remains; this is the click site answering (EC37). Per format (F-4R2-016).
          const ready = readyHere(format);
          return ready !== undefined ? (
            readyAnchor(ready, false)
          ) : (
            <button
              key={format}
              type="button"
              data-testid="export-format"
              data-format={format}
              disabled={pending !== undefined}
              onClick={() => run(format)}
              title={`Export “${docId}” v${version} as ${format.toUpperCase()} — it lands in the thread as a download`}
              style={{ ...(compact ? COMPACT : BUTTON),
                       color: pending !== undefined && pending.format === format
                              && pending.version === version ? S.accent : S.muted,
                       opacity: pending !== undefined
                         && (pending.format !== format || pending.version !== version) ? 0.4 : 1 }}
            >
              {/* §7.2 PENDING: the spinner lives ON the clicked control. */}
              {pending !== undefined && pending.format === format && pending.version === version
                ? <span data-testid="export-pending" className="animate-pulse">{format}…</span>
                : compact ? format : format.toUpperCase()}
            </button>
          );
        })}
        {/* VIDEO-FB: the recording is already an artifact — no render step, so it
            is a download from the start, same-origin through the project proxy. */}
        {recording !== null && (
          <a
            data-testid="export-recording"
            data-version={String(version)}
            href={recording.href}
            download={recording.file}
            title={`Download the recorded video of v${version} — ${recording.file}`}
            style={{ ...(compact ? COMPACT : BUTTON), ...READY }}
          >
            {compact ? 'recording ↓' : 'RECORDING ↓'}
          </a>
        )}
        {/* Round-3 J3: answers the user has not acted on, for other versions of THIS
            doc — visible at the click site, wearing their own version. */}
        {readyElsewhere.map((a) => readyAnchor(a as Extract<ExportAnswer, { state: 'ready' }>, true))}
        {pending !== undefined && pending.version !== version && (
          <span data-testid="export-pending" data-version={String(pending.version)}
                className="animate-pulse"
                style={{ color: S.accent, fontSize: compact ? '9px' : 'var(--text-2xs)',
                         fontFamily: compact ? 'var(--font-mono)' : 'var(--font-sans)' }}>
            {pending.format} v{pending.version}…
          </span>
        )}
      </div>
      {/* interactive#219 (F-4R2-016): what the finished export actually printed — "PDF ready —
          2 pages · A4 portrait" — under the row, where the download is. Only when the bridge
          reported it; an older bridge renders nothing here. Compact controls carry it on hover. */}
      {!compact && readyHereAll.map((a) => {
        const phrase = describeExportReport(a.report ?? null);
        if (phrase === null) return null;
        return (
          <span
            key={`report-${a.format}-${a.version}`}
            data-testid="export-report"
            data-format={a.format}
            data-version={String(a.version)}
            title={exportReportTitle(a.report ?? null) ?? undefined}
            style={{ color: S.muted, fontSize: '9px', fontFamily: 'var(--font-mono)',
                     overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {a.format.toUpperCase()} ready — {phrase}
          </span>
        );
      })}
      {/* §7.2 FAILED, §3.3: the reason is stated and the control that retries it is the
          row above — adjacent, not a toast that takes the fix away with it when it fades. */}
      {[...failedHere, ...failedElsewhere].map((a) => (
        <span
          key={`hint-${a.format}-${a.version}`}
          data-testid="export-hint"
          data-version={String(a.version)}
          title={a.state === 'failed' ? a.hint : undefined}
          style={{ color: S.hint, fontSize: '9px', fontFamily: 'var(--font-mono)',
                   overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {a.state === 'failed'
            ? (a.version === version ? a.hint : `v${a.version}: ${a.hint}`)
            : null}
        </span>
      ))}
    </div>
  );
}
