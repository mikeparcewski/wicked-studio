/** E1's demo cut, shared as data only: no transport or UI framework. */
import type { Op } from './protocol.js';
/** E1's default video colours (interactive's style defaults, E1-API.md): data, so it lives in JSON. */
import VIDEO_COLOURS from './videoStyleDefaults.json';
/** Interactive's built-in themes as video colours (src/themes/*.json): overrides of the studio skin. */
import VIDEO_PALETTES from './videoPalettes.json';

export interface VideoStyle {
  theme: {
    titleCard: { on: boolean; title: string; subtitle: string; seconds: number };
    endCard: { on: boolean; title: string; subtitle: string; seconds: number };
    palette?: 'skin' | 'custom';
    background: string; foreground: string; accent: string;
    font: 'Inter' | 'Roboto' | 'Source Sans 3' | 'IBM Plex Sans' | 'system-ui' | 'Archivo';
  };
  captions: { on: boolean; burnIn: boolean; position: 'bottom' | 'top'; size: number; maxLines: number; wrapChars: number; style: 'bar' | 'outline' | 'plain' };
}
export interface DemoTake { file: string; durationSec: number; at?: string }
export type RecordingVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | null;
export interface RecordingProof {
  verdict: RecordingVerdict;
  /** Seconds in the stitched take, never a chapter-relative offset. */
  failedAtSec: number | null;
  checks: { id: string; chapter: string; atSec: number | null; text: string; state: 'PASS' | 'FAIL' | 'PENDING' }[];
}
export interface DemoChapter { id: string; title: string; say: string; take: string; inSec: number; outSec: number; durationSec: number; startSec: number; verdict?: RecordingVerdict }
export interface DemoCut { type: 'demo-cut'; title: string; rev: number; version: number; chapters: DemoChapter[]; takes: Record<string, DemoTake[]>; style: VideoStyle; resolvedTheme?: VideoColours & { font?: VideoStyle['theme']['font'] }; ffmpeg?: { ok: boolean; burnIn: boolean }; proof?: RecordingProof }
export type ChapterOp = Extract<Op, { chapter: string }>;

export function defaultVideoStyle(title: string): VideoStyle {
  return { theme: { titleCard: { on: true, title, subtitle: '', seconds: 2.5 }, endCard: { on: true, title: 'Thanks for watching', subtitle: '', seconds: 2.5 }, palette: 'skin', ...VIDEO_COLOURS, font: 'system-ui' }, captions: { on: true, burnIn: true, position: 'bottom', size: 36, maxLines: 2, wrapChars: 42, style: 'bar' } };
}
/** E1 accepts partial styles; the editor publishes their effective defaults. */
export function effectiveVideoStyle(title: string, style: Partial<VideoStyle> = {}): VideoStyle {
  const d = defaultVideoStyle(title);
  return { theme: { ...d.theme, ...style.theme, titleCard: { ...d.theme.titleCard, ...style.theme?.titleCard }, endCard: { ...d.theme.endCard, ...style.theme?.endCard } }, captions: { ...d.captions, ...style.captions } };
}
/** Chapters' starts include the title card in the rendered video. */
export function timedCut(cut: DemoCut): DemoCut {
  let start = cut.style.theme.titleCard.on ? cut.style.theme.titleCard.seconds : 0;
  return { ...cut, chapters: cut.chapters.map(c => {
    const durationSec = c.outSec - c.inSec;
    const chapter = { ...c, durationSec, startSec: start };
    start += durationSec;
    return chapter;
  }) };
}
export function applyChapterOp(cut: DemoCut, op: ChapterOp): DemoCut {
  const chapters = cut.chapters.map(c => ({ ...c }));
  const index = chapters.findIndex(c => c.id === op.chapter);
  const c = chapters[index];
  if (c === undefined) throw new Error('chapter not in this cut');
  switch (op.op) {
    case 'chapter-move': {
      chapters.splice(index, 1);
      chapters.splice(op.after === null ? 0 : chapters.findIndex(x => x.id === op.after) + 1, 0, c);
      break;
    }
    case 'chapter-rename': c.title = op.title; break;
    case 'chapter-trim': c.inSec = op.inSec; c.outSec = op.outSec; break;
    case 'chapter-take': {
      const take = cut.takes[c.id]?.find(t => t.file === op.take);
      if (take === undefined) throw new Error('take not in this chapter');
      c.take = take.file; c.inSec = 0; c.outSec = take.durationSec;
      break;
    }
  }
  return timedCut({ ...cut, chapters });
}
/** The video's colours. The default is the active studio skin (operator, 2026-10-14): presets and custom colours override it. */
export interface VideoColours { background: string; foreground: string; accent: string }
export type PaletteId = 'studio' | 'corporate' | 'midnight' | 'warm' | 'custom';
const PALETTES = VIDEO_PALETTES as Readonly<Record<'corporate' | 'midnight' | 'warm', VideoColours>>;
const same = (a: VideoColours, b: VideoColours): boolean => (['background', 'foreground', 'accent'] as const).every((k) => a[k].toLowerCase() === b[k].toLowerCase());
/** E1 resolves the studio skin per render; stored colours only select a preset in custom mode. */
export function paletteOf(t: VideoColours & { palette?: 'skin' | 'custom' }): PaletteId {
  if (t.palette === undefined || t.palette === 'skin') return 'studio';
  for (const [id, p] of Object.entries(PALETTES)) if (same(t, p)) return id as PaletteId;
  return 'custom';
}
/** The colours a style shows: the skin's while it wears the studio palette. */
export function shownColours(t: VideoColours & { palette?: 'skin' | 'custom' }, skin: VideoColours | null, resolved?: VideoColours): VideoColours {
  const shown = paletteOf(t) === 'studio' ? resolved ?? skin ?? t : t;
  return { background: shown.background, foreground: shown.foreground, accent: shown.accent };
}
const fonts = { inter: 'Inter', roboto: 'Roboto', 'source-sans': 'Source Sans 3', plex: 'IBM Plex Sans', system: 'system-ui', archivo: 'Archivo' } as const;
export function videoValues(style: VideoStyle, tab: string, skin: VideoColours | null = null, resolved?: DemoCut['resolvedTheme']): Record<string, unknown> {
  const c = style.captions, t = style.theme;
  if (tab === 'captions') return { on: c.on, burn: c.burnIn, position: c.position, size: c.size, lines: c.maxLines, wrap: c.wrapChars, look: c.style };
  if (tab === 'theme') { const shown = shownColours(t, skin, resolved), font = paletteOf(t) === 'studio' ? resolved?.font ?? t.font : t.font; return { palette: paletteOf(t), title: t.titleCard.on, titletext: t.titleCard.title, end: t.endCard.on, endtext: t.endCard.title, background: shown.background, foreground: shown.foreground, accent: shown.accent, font: Object.keys(fonts).find(k => fonts[k as keyof typeof fonts] === font) ?? 'system' }; }
  return {};
}
/** The caller checks the value against the declared control before applying it. */
export function changedVideoStyle(style: VideoStyle, tab: string, id: string, value: unknown): VideoStyle {
  const next = JSON.parse(JSON.stringify(style)) as VideoStyle;
  if (tab === 'captions') {
    const keys = { on: 'on', burn: 'burnIn', position: 'position', size: 'size', lines: 'maxLines', wrap: 'wrapChars', look: 'style' } as const;
    Object.assign(next.captions, { [keys[id as keyof typeof keys]]: value });
  } else if (tab === 'theme') {
    switch (id) {
      case 'title': next.theme.titleCard.on = value as boolean; break;
      case 'titletext': next.theme.titleCard.title = value as string; break;
      case 'end': next.theme.endCard.on = value as boolean; break;
      case 'endtext': next.theme.endCard.title = value as string; break;
      case 'font': next.theme.font = fonts[value as keyof typeof fonts]; next.theme.palette = 'custom'; break;
      case 'palette':
        next.theme.palette = value === 'studio' ? 'skin' : 'custom';
        if (value === 'corporate' || value === 'midnight' || value === 'warm') Object.assign(next.theme, PALETTES[value]);
        break;
      default: Object.assign(next.theme, { [id]: value, palette: 'custom' });
    }
  }
  return next;
}
