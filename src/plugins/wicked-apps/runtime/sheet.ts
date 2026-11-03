/**
 * The runtime's ONE stylesheet (DES-APPS-001 §7.1: "styles only through CSSOM properties and its one stylesheet,
 * never `style` attributes", so the standalone CSP can pin the stylesheet by hash).
 *
 * The template's `<style>` holds every static rule. The runtime adds the rest here, through the CSSOM only:
 *  - selectors come from a fixed vocabulary the runtime itself writes (`.wk-c<n>` for the n-th component it drew,
 *    `:root`), never from the spec;
 *  - every value goes through `CSSStyleDeclaration.setProperty`, one property at a time, after a grammar check:
 *    colours `#rrggbb`, integers clamped to their range, the host's theme tokens refused when they hold `url(`.
 * A spec value that does not pass is dropped, so nothing an agent wrote can name a selector, open a block, or load.
 */

const COLOUR = /^#[0-9a-fA-F]{6}$/u;
const SELECTOR = /^(?::root|\.wk-c\d{1,4}(?: \.wk-[a-z]+)?)$/u;
const PROPERTY = /^(?:--[a-z0-9-]{1,40}|[a-z-]{1,40})$/u;
export const PHONE_MEDIA = '(max-width: 639px)';

export function colourOf(v: unknown): string | null {
  return typeof v === 'string' && COLOUR.test(v) ? v.toLowerCase() : null;
}

export function intIn(v: unknown, min: number, max: number, fallback: number): number {
  return Number.isInteger(v) ? Math.min(max, Math.max(min, v as number)) : fallback;
}

/** A host theme token: a short value with no `url(`, no `;`, no braces and no comment. */
function tokenValue(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 200 && !/url\(|[;{}]|\/\*|\\/iu.test(v) ? v : null;
}

export interface Box { x: number; y: number; w: number; h: number }

export class Sheet {
  private readonly sheet: CSSStyleSheet;
  private readonly base: number;
  private readonly rules = new Map<string, CSSStyleRule>();
  private phone: CSSMediaRule | null = null;
  private readonly phoneRules = new Map<string, CSSStyleRule>();

  constructor(el: HTMLStyleElement) {
    if (el.sheet === null) throw new Error('the runtime stylesheet did not load');
    this.sheet = el.sheet;
    this.base = this.sheet.cssRules.length;
  }

  /** Drop every rule the runtime added (a new page or version is drawn from scratch). */
  reset(): void {
    while (this.sheet.cssRules.length > this.base) this.sheet.deleteRule(this.sheet.cssRules.length - 1);
    this.rules.clear();
    this.phoneRules.clear();
    this.phone = null;
  }

  private rule(selector: string): CSSStyleRule {
    if (!SELECTOR.test(selector)) throw new Error('a selector outside the runtime’s vocabulary');
    const had = this.rules.get(selector);
    if (had !== undefined) return had;
    const at = this.sheet.insertRule(`${selector} {}`, this.sheet.cssRules.length);
    const r = this.sheet.cssRules[at] as CSSStyleRule;
    this.rules.set(selector, r);
    return r;
  }

  private phoneRule(selector: string): CSSStyleRule {
    if (!SELECTOR.test(selector)) throw new Error('a selector outside the runtime’s vocabulary');
    const had = this.phoneRules.get(selector);
    if (had !== undefined) return had;
    if (this.phone === null) {
      const at = this.sheet.insertRule(`@media ${PHONE_MEDIA} {}`, this.sheet.cssRules.length);
      this.phone = this.sheet.cssRules[at] as CSSMediaRule;
    }
    const at = this.phone.insertRule(`${selector} {}`, this.phone.cssRules.length);
    const r = this.phone.cssRules[at] as CSSStyleRule;
    this.phoneRules.set(selector, r);
    return r;
  }

  private set(r: CSSStyleRule, prop: string, value: string): void {
    if (!PROPERTY.test(prop)) return;
    r.style.setProperty(prop, value);
  }

  /** The host's theme tokens and the app's own colours, on `:root`. */
  theme(tokens: Record<string, unknown>, app: { accent?: unknown; palette?: unknown }): void {
    const root = this.rule(':root');
    for (const [k, v] of Object.entries(tokens)) {
      const val = tokenValue(v);
      if (/^--[a-z0-9-]{1,40}$/u.test(k) && val !== null) this.set(root, k, val);
    }
    const accent = colourOf(app.accent);
    if (accent !== null) this.set(root, '--app-accent', accent);
    const palette = Array.isArray(app.palette) ? app.palette : [];
    for (let i = 0; i < 12; i += 1) {
      const c = colourOf(palette[i]);
      if (c !== null) this.set(root, `--s${i}`, c);
    }
  }

  /** Component n's grid box (12 columns). Called again while a drag or a resize moves it. */
  place(n: number, box: Box): void {
    const r = this.rule(`.wk-c${n}`);
    const x = intIn(box.x, 0, 11, 0);
    const w = intIn(box.w, 1, 12 - x, 1);
    const y = intIn(box.y, 0, 999, 0);
    const h = intIn(box.h, 1, 50, 1);
    this.set(r, 'grid-column', `${x + 1} / span ${w}`);
    this.set(r, 'grid-row', `${y + 1} / span ${h}`);
  }

  /** Below 640 px the grid is one column in (row, column) order; a component may be hidden there. */
  phoneOrder(n: number, order: number, hidden: boolean): void {
    const r = this.phoneRule(`.wk-c${n}`);
    this.set(r, 'order', String(intIn(order, 0, 9_999, 0)));
    if (hidden) this.set(r, 'display', 'none'); else r.style.removeProperty('display');
  }

  /** A chart series' own colour (`#rrggbb` only), as `--series` on that component's chart. */
  seriesColour(n: number, index: number, colour: unknown): void {
    const c = colourOf(colour);
    if (c === null) return;
    this.set(this.rule(`.wk-c${n}`), `--c${intIn(index, 0, 11, 0)}`, c);
  }
}
