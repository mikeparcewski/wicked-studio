/**
 * The bridge's additive export report (wicked-interactive #219; acceptance finding F-4R2-016).
 *
 * `POST /d/:doc/api/export` and the `wicked.interactive.export.generated` echo gained four
 * optional fields describing what was actually printed: `layout` (`document` | `deck`),
 * `layout_source` (why — the author's `@page`, a recorded style, declared slides…),
 * `page_size` (measured from the produced PDF, e.g. `A4 portrait`, `16:9 (960 × 540 pt)`) and
 * `pages`. Read DEFENSIVELY off an untyped bag — every field optional, wrong types ignored — so
 * an older bridge that sends none of them changes nothing on screen.
 */

export interface ExportReport {
  layout: string | null;
  layoutSource: string | null;
  pageSize: string | null;
  pages: number | null;
}

function str(bag: Record<string, unknown>, key: string): string | null {
  const v = bag[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** The report the bag carries, or `null` when it carries none of the four fields. */
export function exportReportOf(bag: unknown): ExportReport | null {
  if (typeof bag !== 'object' || bag === null) return null;
  const b = bag as Record<string, unknown>;
  const pagesRaw = b['pages'];
  const pages = typeof pagesRaw === 'number' && Number.isInteger(pagesRaw) && pagesRaw >= 0 ? pagesRaw : null;
  const report: ExportReport = {
    layout: str(b, 'layout'),
    layoutSource: str(b, 'layout_source'),
    pageSize: str(b, 'page_size'),
    pages,
  };
  return report.layout === null && report.layoutSource === null && report.pageSize === null && report.pages === null
    ? null
    : report;
}

/**
 * The short customer phrase — "2 pages · A4 portrait", "deck · 3 pages · 16:9 (960 × 540 pt)".
 * A `document` layout is the default reading and goes unsaid; `deck` is worth a word because
 * it is the surprise the #219 fix exists for. `null` when there is nothing to say.
 */
export function describeExportReport(report: ExportReport | null): string | null {
  if (report === null) return null;
  const parts: string[] = [];
  if (report.layout !== null && report.layout !== 'document') parts.push(report.layout);
  if (report.pages !== null) parts.push(`${report.pages} page${report.pages === 1 ? '' : 's'}`);
  if (report.pageSize !== null) parts.push(report.pageSize);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The hover text: the phrase plus WHY the layout was chosen, when the bridge said. */
export function exportReportTitle(report: ExportReport | null): string | null {
  const phrase = describeExportReport(report);
  if (phrase === null) return null;
  return report?.layoutSource !== null && report?.layoutSource !== undefined
    ? `${phrase} — layout from ${report.layoutSource}`
    : phrase;
}
