import { describe, expect, it } from 'vitest';
import { changedVideoStyle, defaultVideoStyle, paletteOf, shownColours, videoValues } from '../src/editors/demoCutModel.js';
import palettes from '../src/editors/videoPalettes.json';

/** The video's colours default to the active studio skin (operator, 2026-10-14); presets and custom colours override. */
const skin = { background: 'rgb(24, 27, 34)', foreground: 'rgb(240, 242, 245)', accent: 'rgb(79, 163, 199)' };

describe('video palette', () => {
  it('an untouched cut wears the studio skin, shown in the skin colours', () => {
    const style = defaultVideoStyle('Demo');
    expect(paletteOf(style.theme, skin)).toBe('studio');
    expect(shownColours(style.theme, skin)).toEqual(skin);
    const v = videoValues(style, 'theme', skin);
    expect(v['palette']).toBe('studio');
    expect([v['background'], v['foreground'], v['accent']]).toEqual([skin.background, skin.foreground, skin.accent]);
  });
  it('a preset overrides the skin and is recognised again on read', () => {
    const next = changedVideoStyle(defaultVideoStyle('Demo'), 'theme', 'palette', 'midnight', skin);
    expect({ background: next.theme.background, foreground: next.theme.foreground, accent: next.theme.accent }).toEqual(palettes.midnight);
    expect(paletteOf(next.theme, skin)).toBe('midnight');
  });
  it('choosing the studio skin writes the skin colours; changing a colour makes it custom', () => {
    const midnight = changedVideoStyle(defaultVideoStyle('Demo'), 'theme', 'palette', 'midnight', skin);
    const back = changedVideoStyle(midnight, 'theme', 'palette', 'studio', skin);
    expect(paletteOf(back.theme, skin)).toBe('studio');
    expect(back.theme.background).toBe(skin.background);
    const custom = changedVideoStyle(back, 'theme', 'accent', '#123456', skin);
    expect(paletteOf(custom.theme, skin)).toBe('custom');
  });
  it('without host tokens the studio palette keeps the cut colours', () => {
    const style = defaultVideoStyle('Demo');
    expect(shownColours(style.theme, null)).toEqual({ background: style.theme.background, foreground: style.theme.foreground, accent: style.theme.accent });
  });
});
