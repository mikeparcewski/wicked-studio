import type { AppCell, AppFormat } from '../../../api/types.js';

/**
 * A cell as TEXT (DES-APPS-001 §7.1: "values render as text; no HTML or markdown from data"). Every caller puts the
 * result in `textContent`; nothing here ever builds markup.
 */

const CURRENCY = /^[A-Z]{3}$/u;

export function cellText(v: AppCell | undefined, format: AppFormat | undefined, locale: string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  const decimals = typeof format?.decimals === 'number' && Number.isInteger(format.decimals) ? Math.min(10, Math.max(0, format.decimals)) : undefined;
  const num = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  try {
    switch (format?.kind) {
      case 'currency':
        if (num === null || !CURRENCY.test(format.currency)) break;
        return new Intl.NumberFormat(locale, { style: 'currency', currency: format.currency, ...(decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {}) }).format(num);
      case 'percent':
        if (num === null) break;
        return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: decimals ?? 1 }).format(num);
      case 'number':
        if (num === null) break;
        return new Intl.NumberFormat(locale, decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {}).format(num);
      case 'date': case 'datetime': {
        const d = new Date(typeof v === 'number' ? v : String(v));
        if (Number.isNaN(d.getTime())) break;
        return new Intl.DateTimeFormat(locale, format.kind === 'date' ? { dateStyle: 'medium', timeZone: 'UTC' } : { dateStyle: 'medium', timeStyle: 'short' }).format(d);
      }
      case 'duration': {
        if (num === null) break;
        const s = Math.abs(Math.round(num));
        const d = Math.floor(s / 86_400);
        const h = Math.floor((s % 86_400) / 3_600);
        const m = Math.floor((s % 3_600) / 60);
        return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
      }
      default:
        break;
    }
  } catch { /* a locale or currency the engine refuses: fall back to the plain value */ }
  // No format: an integer is shown as it is (a ticket 4821, not 4,821); a fraction in the viewer's locale.
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(v);
  return String(v);
}

/** Plain characters only for one line of chrome (a title, a label): control characters become spaces. */
export function lineOf(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/gu, ' ').slice(0, max) : '';
}
