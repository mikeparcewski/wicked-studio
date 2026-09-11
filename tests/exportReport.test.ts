// F-4R2-016 / wicked-interactive #219 — the additive export report (`layout`, `layout_source`,
// `page_size`, `pages`), read null-safely off the response and the event, and phrased for the
// thread line and the click site. An older bridge that sends none of it renders nothing new.
import { describe, expect, it } from 'vitest';
import { describeExportReport, exportReportOf, exportReportTitle } from '../src/interactive/exportReport.js';
import { exportReadyText } from '../src/interactive/exportWire.js';

describe('exportReportOf', () => {
  it('reads the four #219 fields and ignores wrong types', () => {
    expect(exportReportOf({ format: 'pdf', layout: 'document', layout_source: "author @page", page_size: 'A4 portrait', pages: 2 }))
      .toEqual({ layout: 'document', layoutSource: 'author @page', pageSize: 'A4 portrait', pages: 2 });
    expect(exportReportOf({ pages: '2', page_size: '' })).toBeNull();
    expect(exportReportOf({ pages: -1 })).toBeNull();
    expect(exportReportOf(null)).toBeNull();
    expect(exportReportOf({ format: 'html', file: 'x.html', download: '/d/x' })).toBeNull();
  });
});

describe('describeExportReport / exportReportTitle', () => {
  it('phrases pages and page size; a document layout goes unsaid, a deck is named', () => {
    expect(describeExportReport({ layout: 'document', layoutSource: null, pageSize: 'A4 portrait', pages: 2 })).toBe('2 pages · A4 portrait');
    expect(describeExportReport({ layout: 'deck', layoutSource: 'declared .wi-slide', pageSize: '16:9 (960 × 540 pt)', pages: 3 }))
      .toBe('deck · 3 pages · 16:9 (960 × 540 pt)');
    expect(describeExportReport({ layout: null, layoutSource: null, pageSize: null, pages: 1 })).toBe('1 page');
    expect(describeExportReport({ layout: 'document', layoutSource: 'recorded style', pageSize: null, pages: null })).toBeNull();
    expect(describeExportReport(null)).toBeNull();
    expect(exportReportTitle({ layout: 'document', layoutSource: 'author @page', pageSize: 'A4 portrait', pages: 2 }))
      .toBe('2 pages · A4 portrait — layout from author @page');
    expect(exportReportTitle({ layout: 'document', layoutSource: null, pageSize: 'A4 portrait', pages: 2 })).toBe('2 pages · A4 portrait');
  });

  it('the thread line carries the report after the file, and stays the old line without one', () => {
    expect(exportReadyText('pdf', 'brochure_v3.pdf', { layout: 'document', layoutSource: null, pageSize: 'A4 portrait', pages: 2 }))
      .toBe('PDF export ready — brochure_v3.pdf · 2 pages · A4 portrait');
    expect(exportReadyText('html', 'brochure_v3.html', null)).toBe('HTML export ready — brochure_v3.html');
  });
});
