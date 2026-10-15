/**
 * `wicked.editor/2` surfaces (DES-EDITOR-PLUGIN-CONTRACT-001 §5): what a plugin declares, and the host renders, for
 * its three surfaces — the inline card in the thread, the options tabs in the host panel, and full screen. Pure:
 * the parser, the word and bound rules, the controls vocabulary and its value checks, and the canonical form the
 * host compares the registry copy and the `plugin.ready` copy with. Host and conformance use this one module.
 */

export type CardAspect = '16:9' | '4:3' | 'auto';
export type ActionVerb = 'plugin' | 'host:export' | 'host:ask';
export interface CardAction { id: string; label: string; primary: boolean; verb: ActionVerb }
export type ControlType = 'toggle' | 'segmented' | 'select' | 'color' | 'text' | 'range';
export interface ControlOption { id: string; label: string }
export interface Control {
  id: string;
  label: string;
  type: ControlType;
  options?: ControlOption[];
  min?: number;
  max?: number;
  step?: number;
  maxChars?: number;
}
export interface OptionsTab { id: string; label: string; render: 'plugin' | 'controls'; controls?: Control[] }
export type FullMode = 'simple' | 'advanced';
export interface Surfaces {
  card: { interactive: boolean; aspect: CardAspect; actions: CardAction[] };
  options: { tabs: OptionsTab[] } | null;
  full: { modes: FullMode[] | null; default: FullMode } | null;
}

export const SURFACE_LIMITS = {
  actions: 4,
  tabs: 5,
  controls: 12,
  options: 8,
  labelChars: 24,
  maxChars: 200,
  values: 16,
  cardMinPx: 120,
  cardMaxPx: 560,
} as const;

const ID = /^[a-z][a-z0-9-]{0,31}$/u;
/** ASCII letters and digits, space and `·-'`; 1 to 24 characters. Plugin words sit in host chrome, so no other
 *  script is accepted: a look-alike of a decision word (`ınstall`, `Аpprove`) cannot be spelled at all (codex
 *  h1-r2 P1). */
const LABEL = /^[A-Za-z0-9 ·'-]{1,24}$/u;

/**
 * The host's decision words: they appear only on host-owned controls (§5.2; EP §5.5 "gate actions stay in the
 * host"). A label is folded (NFKC, lower case, common look-alike letters mapped to ASCII) before the check, so a
 * homoglyph "Аpprove" is refused like "Approve".
 */
export const DECISION_WORDS = [
  'approve', 'accept', 'deliver', 'merge', 'send', 'launch', 'delete', 'remove', 'stop', 'deny', 'allow', 'grant', 'install',
] as const;

const CONFUSABLES: Readonly<Record<string, string>> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ӏ': 'l',
  'α': 'a', 'ε': 'e', 'ο': 'o', 'ρ': 'p', 'ν': 'v', 'τ': 't', 'κ': 'k', 'ι': 'i', 'μ': 'm',
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't',
};

/** The ASCII skeleton words the decision-word check reads: NFKC, lower case, look-alikes folded, split on
 *  anything that is not a letter. */
export function skeleton(label: string): string[] {
  // NFKD, then every combining mark dropped (codex h1-r1 P1: "İnstall" lowercases to "i̇nstall", whose dot
  // would split the word), then look-alikes folded.
  const folded = label.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
  let out = '';
  for (const ch of folded) out += CONFUSABLES[ch] ?? ch;
  return out.split(/[^a-z]+/u).filter((w) => w !== '');
}

/** A word that starts with a decision word ("Approve", "approved", "ApproveAll", "Аpprove") is refused;
 *  one that only contains it ("Shallow") is not. */
export function usesDecisionWord(label: string): boolean {
  return skeleton(label).some((word) => DECISION_WORDS.some((w) => word.startsWith(w)));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };
const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** A word that mixes letters and digits ("1nstall", "De1iver", "Mp4"): refused, since a digit can stand in for a
 *  letter (codex h1-r3). Numbers stand alone ("Step 3"). */
const MIXED = /(?:[A-Za-z][0-9]|[0-9][A-Za-z])/u;

function labelOk(v: unknown, where: string): string | null {
  if (typeof v !== 'string' || !LABEL.test(v)) return `${where}: a label is 1 to ${SURFACE_LIMITS.labelChars} plain characters`;
  if (MIXED.test(v)) return `${where}: a word in a label is letters or digits, not both`;
  if (usesDecisionWord(v)) return `${where}: "${v}" uses a word only the host's own controls may use`;
  return null;
}

function uniqueIds(items: readonly { id: string }[], where: string): string | null {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) return `${where}: the id "${it.id}" is used twice`;
    seen.add(it.id);
  }
  return null;
}

const ONLY = (o: Record<string, unknown>, keys: readonly string[], where: string): string | null => {
  for (const k of Object.keys(o)) if (!keys.includes(k)) return `${where}: unknown field "${k}"`;
  return null;
};

function parseControl(raw: unknown, where: string): Parsed<Control> {
  if (!isObj(raw)) return no(`${where}: not an object`);
  const extra = ONLY(raw, ['id', 'label', 'type', 'options', 'min', 'max', 'step', 'maxChars'], where);
  if (extra !== null) return no(extra);
  if (typeof raw['id'] !== 'string' || !ID.test(raw['id'])) return no(`${where}: a bad id`);
  const lbl = labelOk(raw['label'], where);
  if (lbl !== null) return no(lbl);
  const type = raw['type'];
  if (type !== 'toggle' && type !== 'segmented' && type !== 'select' && type !== 'color' && type !== 'text' && type !== 'range') {
    return no(`${where}: an unknown control type`);
  }
  const c: Control = { id: raw['id'], label: raw['label'] as string, type };
  if (type === 'segmented' || type === 'select') {
    const opts = raw['options'];
    if (!Array.isArray(opts) || opts.length < 2 || opts.length > SURFACE_LIMITS.options) return no(`${where}: ${type} needs 2 to ${SURFACE_LIMITS.options} options`);
    const list: ControlOption[] = [];
    for (const [i, o] of opts.entries()) {
      if (!isObj(o) || typeof o['id'] !== 'string' || !ID.test(o['id'])) return no(`${where}.options[${i}]: a bad id`);
      const ol = labelOk(o['label'], `${where}.options[${i}]`);
      if (ol !== null) return no(ol);
      const oe = ONLY(o, ['id', 'label'], `${where}.options[${i}]`);
      if (oe !== null) return no(oe);
      list.push({ id: o['id'], label: o['label'] as string });
    }
    const dup = uniqueIds(list, `${where}.options`);
    if (dup !== null) return no(dup);
    c.options = list;
  } else if (raw['options'] !== undefined) return no(`${where}: only select and segmented take options`);
  if (type === 'range') {
    const { min, max, step } = raw as { min?: unknown; max?: unknown; step?: unknown };
    if (!isFiniteNum(min) || !isFiniteNum(max) || !isFiniteNum(step)) return no(`${where}: range needs finite min, max and step`);
    if (!(min < max) || !(step > 0) || step > max - min) return no(`${where}: range needs min < max and 0 < step ≤ max - min`);
    // A UI range, sized so its step check is exact enough (codex h1-r4): bounds within ±1e9, a step of at least
    // 1e-6, and at most 1e6 steps.
    if (Math.abs(min) > 1e9 || Math.abs(max) > 1e9 || step < 1e-6 || (max - min) / step > 1e6) return no(`${where}: range bounds are within ±1e9, step ≥ 1e-6, at most 1e6 steps`);
    // ...and a step float arithmetic can tell apart at that magnitude (codex h1-r5).
    if (step < Math.max(Math.abs(min), Math.abs(max)) * 1e-12) return no(`${where}: range step is too fine for its bounds`);
    c.min = min; c.max = max; c.step = step;
  } else if (raw['min'] !== undefined || raw['max'] !== undefined || raw['step'] !== undefined) return no(`${where}: only range takes min, max and step`);
  if (type === 'text') {
    const m = raw['maxChars'] === undefined ? SURFACE_LIMITS.maxChars : raw['maxChars'];
    if (!Number.isInteger(m) || (m as number) < 1 || (m as number) > SURFACE_LIMITS.maxChars) return no(`${where}: maxChars is 1 to ${SURFACE_LIMITS.maxChars}`);
    c.maxChars = m as number;
  } else if (raw['maxChars'] !== undefined) return no(`${where}: only text takes maxChars`);
  return { ok: true, value: c };
}

/** Parse a `surfaces` declaration strictly: any violation refuses the whole of it, with the reason. */
export function parseSurfaces(raw: unknown): Parsed<Surfaces> {
  if (!isObj(raw)) return no('surfaces: not an object');
  const top = ONLY(raw, ['card', 'options', 'full'], 'surfaces');
  if (top !== null) return no(top);
  const card = raw['card'];
  if (!isObj(card)) return no('surfaces.card is required');
  const ce = ONLY(card, ['interactive', 'aspect', 'actions'], 'surfaces.card');
  if (ce !== null) return no(ce);
  // Defaults apply only to an OMITTED field: an explicit null is a wrong type (codex h1-r1 P2).
  const interactive = card['interactive'] === undefined ? false : card['interactive'];
  if (typeof interactive !== 'boolean') return no('surfaces.card.interactive: a boolean');
  const aspect = card['aspect'] === undefined ? '16:9' : card['aspect'];
  if (aspect !== '16:9' && aspect !== '4:3' && aspect !== 'auto') return no('surfaces.card.aspect: 16:9, 4:3 or auto');
  const rawActions = card['actions'] === undefined ? [] : card['actions'];
  if (!Array.isArray(rawActions) || rawActions.length > SURFACE_LIMITS.actions) return no(`surfaces.card.actions: at most ${SURFACE_LIMITS.actions}`);
  const actions: CardAction[] = [];
  for (const [i, a] of rawActions.entries()) {
    const where = `surfaces.card.actions[${i}]`;
    if (!isObj(a)) return no(`${where}: not an object`);
    const ae = ONLY(a, ['id', 'label', 'primary', 'verb'], where);
    if (ae !== null) return no(ae);
    if (typeof a['id'] !== 'string' || !ID.test(a['id'])) return no(`${where}: a bad id`);
    const lbl = labelOk(a['label'], where);
    if (lbl !== null) return no(lbl);
    const verb = a['verb'];
    if (verb !== 'plugin' && verb !== 'host:export' && verb !== 'host:ask') return no(`${where}: verb is plugin, host:export or host:ask`);
    const primary = a['primary'] === undefined ? false : a['primary'];
    if (typeof primary !== 'boolean') return no(`${where}: primary is a boolean`);
    actions.push({ id: a['id'], label: a['label'] as string, primary, verb });
  }
  const dupA = uniqueIds(actions, 'surfaces.card.actions');
  if (dupA !== null) return no(dupA);

  let options: Surfaces['options'] = null;
  if (raw['options'] !== undefined) {
    const o = raw['options'];
    if (!isObj(o)) return no('surfaces.options: not an object');
    const oe = ONLY(o, ['tabs'], 'surfaces.options');
    if (oe !== null) return no(oe);
    const rawTabs = o['tabs'];
    if (!Array.isArray(rawTabs) || rawTabs.length < 1 || rawTabs.length > SURFACE_LIMITS.tabs) return no(`surfaces.options.tabs: 1 to ${SURFACE_LIMITS.tabs}`);
    const tabs: OptionsTab[] = [];
    for (const [i, t] of rawTabs.entries()) {
      const where = `surfaces.options.tabs[${i}]`;
      if (!isObj(t)) return no(`${where}: not an object`);
      const te = ONLY(t, ['id', 'label', 'render', 'controls'], where);
      if (te !== null) return no(te);
      if (typeof t['id'] !== 'string' || !ID.test(t['id'])) return no(`${where}: a bad id`);
      const lbl = labelOk(t['label'], where);
      if (lbl !== null) return no(lbl);
      const render = t['render'];
      if (render !== 'plugin' && render !== 'controls') return no(`${where}: render is plugin or controls`);
      const tab: OptionsTab = { id: t['id'], label: t['label'] as string, render };
      if (render === 'controls') {
        const rc = t['controls'];
        if (!Array.isArray(rc) || rc.length < 1 || rc.length > SURFACE_LIMITS.controls) return no(`${where}.controls: 1 to ${SURFACE_LIMITS.controls}`);
        const controls: Control[] = [];
        for (const [j, c] of rc.entries()) {
          const pc = parseControl(c, `${where}.controls[${j}]`);
          if (!pc.ok) return pc;
          controls.push(pc.value);
        }
        const dupC = uniqueIds(controls, `${where}.controls`);
        if (dupC !== null) return no(dupC);
        tab.controls = controls;
      } else if (t['controls'] !== undefined) return no(`${where}: a plugin-rendered tab has no controls`);
      tabs.push(tab);
    }
    const dupT = uniqueIds(tabs, 'surfaces.options.tabs');
    if (dupT !== null) return no(dupT);
    options = { tabs };
  }

  let full: Surfaces['full'] = null;
  if (raw['full'] !== undefined) {
    const f = raw['full'];
    if (!isObj(f)) return no('surfaces.full: not an object');
    const fe = ONLY(f, ['modes', 'default'], 'surfaces.full');
    if (fe !== null) return no(fe);
    let modes: FullMode[] | null = null;
    if (f['modes'] !== undefined) {
      const m = f['modes'];
      if (!Array.isArray(m) || m.length !== 2 || m[0] !== 'simple' || m[1] !== 'advanced') return no('surfaces.full.modes: exactly ["simple","advanced"]');
      modes = ['simple', 'advanced'];
    }
    const def = f['default'] === undefined ? 'simple' : f['default'];
    if (def !== 'simple' && def !== 'advanced') return no('surfaces.full.default: simple or advanced');
    if (modes === null && f['default'] !== undefined) return no('surfaces.full.default needs modes');
    full = { modes, default: def };
  }
  return { ok: true, value: { card: { interactive, aspect, actions }, options, full } };
}

/**
 * Parse the registry's copy of `surfaces` (`EditorSurfaces` in `wicked-crew-api-types`, wicked-studio#791).
 * Crew's `GET /api/v1/editors` serves the parsed wire form (defaults filled, `options`/`full` `null` when
 * omitted, `full.modes: null` with `default: "simple"` for a single-mode full surface), whereas `plugin.ready`
 * carries the raw declaration. Map the wire form back to a declaration so `parseSurfaces` enforces one set of
 * rules on both.
 */
export function parseWireSurfaces(raw: unknown): Parsed<Surfaces> {
  if (!isObj(raw)) return parseSurfaces(raw);
  const { options, full, ...rest } = raw;
  let fullDecl: unknown = full;
  if (isObj(full) && full['modes'] === null && (full['default'] === undefined || full['default'] === 'simple')) {
    const f = { ...full };
    delete f['modes'];
    delete f['default'];
    fullDecl = f;
  }
  return parseSurfaces({
    ...rest,
    ...(options !== null && options !== undefined ? { options } : {}),
    ...(full !== null && full !== undefined ? { full: fullDecl } : {}),
  });
}

/** The canonical JSON of parsed surfaces (fields in a fixed order, defaults filled): what "the same" means. */
export function canonicalSurfaces(s: Surfaces): string {
  const control = (c: Control): unknown => ({
    id: c.id, label: c.label, type: c.type,
    ...(c.options !== undefined ? { options: c.options.map((o) => ({ id: o.id, label: o.label })) } : {}),
    ...(c.min !== undefined ? { min: c.min, max: c.max, step: c.step } : {}),
    ...(c.maxChars !== undefined ? { maxChars: c.maxChars } : {}),
  });
  return JSON.stringify({
    card: { interactive: s.card.interactive, aspect: s.card.aspect, actions: s.card.actions.map((a) => ({ id: a.id, label: a.label, primary: a.primary, verb: a.verb })) },
    options: s.options === null ? null : { tabs: s.options.tabs.map((t) => ({ id: t.id, label: t.label, render: t.render, ...(t.controls !== undefined ? { controls: t.controls.map(control) } : {}) })) },
    full: s.full === null ? null : { modes: s.full.modes, default: s.full.default },
  });
}

export function sameSurfaces(a: Surfaces, b: Surfaces): boolean {
  return canonicalSurfaces(a) === canonicalSurfaces(b);
}

/** Interactive's own colour grammar (`theme-grammar.js` HEX and COLOR_FN): a hex colour, or rgb/hsl with 3 or 4
 *  plain numbers (codex h1-r1 P2: no `rgb(.,.,.)`). */
const NUM = String.raw`(?:\d{1,3}(?:\.\d+)?%?|\.\d+%?)`;
const COLOR = new RegExp(String.raw`^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?)\(\s*${NUM}(?:\s*,\s*${NUM}){2,3}\s*\))$`, 'iu');

/** Is `value` a value `control` can hold? The host checks before it sends and on every snapshot. */
export function controlValueOk(control: Control, value: unknown): boolean {
  switch (control.type) {
    case 'toggle': return typeof value === 'boolean';
    case 'segmented': case 'select': return typeof value === 'string' && (control.options ?? []).some((o) => o.id === value);
    case 'color': return typeof value === 'string' && value.length <= 64 && COLOR.test(value);
    case 'text': return typeof value === 'string' && value.length <= (control.maxChars ?? SURFACE_LIMITS.maxChars) && !/[\r\n]/u.test(value);
    case 'range': {
      if (!isFiniteNum(value) || control.min === undefined || control.max === undefined || control.step === undefined) return false;
      if (value < control.min || value > control.max) return false;
      // The nearest step, reconstructed, and the value compared with it to a thousandth of a step (codex h1-r3..r5):
      // the parser guarantees a step float arithmetic can resolve at these magnitudes.
      const n = Math.round((value - control.min) / control.step);
      return Math.abs(value - (control.min + n * control.step)) <= control.step * 1e-3;
    }
  }
}

/** A values snapshot for a tab, checked against its controls: every key a control, every value one it can hold. */
export function valuesOk(tab: OptionsTab, values: unknown): values is Record<string, unknown> {
  if (!isObj(values) || tab.controls === undefined) return false;
  const keys = Object.keys(values);
  if (keys.length > SURFACE_LIMITS.values) return false;
  return keys.every((k) => {
    const c = tab.controls?.find((x) => x.id === k);
    return c !== undefined && controlValueOk(c, values[k]);
  });
}

/** The v1 mapping (§4): a protocol-1 plugin's sizes as surfaces. `pane` → one "Editor" tab; `full` → no modes. */
export function v1Surfaces(sizes: readonly string[]): Surfaces {
  return {
    card: { interactive: false, aspect: '16:9', actions: [] },
    options: sizes.includes('pane') ? { tabs: [{ id: 'editor', label: 'Editor', render: 'plugin' }] } : null,
    full: sizes.includes('full') ? { modes: null, default: 'simple' } : null,
  };
}

/** The card height a plugin asked for, clamped (`aspect:"auto"` only). */
export function clampCardHeight(px: number): number {
  return Math.min(SURFACE_LIMITS.cardMaxPx, Math.max(SURFACE_LIMITS.cardMinPx, Math.round(px)));
}
