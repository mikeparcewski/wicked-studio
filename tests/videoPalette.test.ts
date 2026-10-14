import { describe, expect, it } from 'vitest';
import { changedVideoStyle, defaultVideoStyle, paletteOf, shownColours, videoValues } from '../src/editors/demoCutModel.js';
import palettes from '../src/editors/videoPalettes.json';

/** The video's colours default to the active studio skin (operator, 2026-10-14); presets and custom colours override. */
const skin = { background: 'rgb(24, 27, 34)', foreground: 'rgb(240, 242, 245)', accent: 'rgb(79, 163, 199)' };

describe('video palette', () => {
  it('an untouched cut wears the studio skin, shown in the skin colours', () => {
    const style = defaultVideoStyle('Demo');
    expect(style.theme).toMatchObject({ palette: 'skin', background: '#16181d', foreground: '#f5f6f8', accent: '#b8bec9', font: 'system-ui' });
    expect(paletteOf(style.theme)).toBe('studio');
    expect(shownColours(style.theme, skin)).toEqual(skin);
    const v = videoValues(style, 'theme', skin);
    expect(v['palette']).toBe('studio');
    expect([v['background'], v['foreground'], v['accent']]).toEqual([skin.background, skin.foreground, skin.accent]);
  });
  it('a preset overrides the skin and is recognised again on read', () => {
    const next = changedVideoStyle(defaultVideoStyle('Demo'), 'theme', 'palette', 'midnight');
    expect(next.theme.palette).toBe('custom');
    expect({ background: next.theme.background, foreground: next.theme.foreground, accent: next.theme.accent }).toEqual(palettes.midnight);
    expect(paletteOf(next.theme)).toBe('midnight');
  });
  it('choosing the studio skin keeps stored colours; changing a colour makes it custom', () => {
    const midnight = changedVideoStyle(defaultVideoStyle('Demo'), 'theme', 'palette', 'midnight');
    const back = changedVideoStyle(midnight, 'theme', 'palette', 'studio');
    expect(paletteOf(back.theme)).toBe('studio');
    expect(back.theme).toEqual({ ...midnight.theme, palette: 'skin' });
    expect(shownColours(back.theme, skin)).toEqual(skin);
    const custom = changedVideoStyle(back, 'theme', 'accent', '#123456');
    expect(paletteOf(custom.theme)).toBe('custom');
    expect(custom.theme.palette).toBe('custom');
  });
  it('without host tokens the studio palette keeps the cut colours', () => {
    const style = defaultVideoStyle('Demo');
    expect(shownColours(style.theme, null)).toEqual({ background: style.theme.background, foreground: style.theme.foreground, accent: style.theme.accent });
  });
  it('uses the cut resolvedTheme before host tokens, including the skin face in controls', () => {
    const style = defaultVideoStyle('Demo');
    const resolved = { background: '#010203', foreground: '#fafafa', accent: '#abcdef', font: 'Archivo' as const };
    expect(shownColours(style.theme, skin, resolved)).toEqual({ background: resolved.background, foreground: resolved.foreground, accent: resolved.accent });
    expect(videoValues(style, 'theme', skin, resolved)).toMatchObject({ palette: 'studio', ...resolved, font: 'archivo' });
    const preset = changedVideoStyle(style, 'theme', 'palette', 'warm');
    expect(shownColours(preset.theme, skin, resolved)).toEqual(palettes.warm);
  });
  it('uses the explicit palette flag even when custom colours match neutral defaults or the host skin', () => {
    const theme = defaultVideoStyle('Demo').theme;
    expect(paletteOf({ ...theme, palette: 'custom' })).toBe('custom');
    expect(paletteOf({ ...theme, ...skin, palette: 'custom' })).toBe('custom');
    expect(paletteOf({ ...theme, ...palettes.midnight, palette: 'skin' })).toBe('studio');
    const legacy = { ...theme, ...palettes.midnight }; delete legacy.palette;
    expect(paletteOf(legacy)).toBe('studio');
  });
  it.each(['background', 'foreground', 'accent'])('changing %s opts into custom even if the colour is unchanged', id => {
    const style = defaultVideoStyle('Demo');
    const next = changedVideoStyle(style, 'theme', id, style.theme[id as 'background' | 'foreground' | 'accent']);
    expect(next.theme.palette).toBe('custom'); expect(style.theme.palette).toBe('skin');
  });
  it('changing the font opts into custom and Archivo round-trips through the font control', () => {
    const next = changedVideoStyle(defaultVideoStyle('Demo'), 'theme', 'font', 'archivo');
    expect(next.theme).toMatchObject({ palette: 'custom', font: 'Archivo' });
    expect(videoValues(next, 'theme', skin)).toMatchObject({ palette: 'custom', font: 'archivo' });
    expect(changedVideoStyle(next, 'theme', 'palette', 'custom').theme.palette).toBe('custom');
  });
});
