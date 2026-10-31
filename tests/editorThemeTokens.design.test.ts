import { describe, expect, it } from 'vitest';
import tokens from '../src/vendor/wicked-design/dist/tokens.json';
import { THEME_TOKENS } from '../src/editors/theme.js';

// The plugin host hands plugins the resolved theme (host.hello.theme / host.theme): studio's own names
// plus every name the design system gives plugins, so plugin cards and previews follow the synthesis
// (or the user's theme).
describe('the plugin theme handoff', () => {
  it('includes every wicked-design plugin property', () => {
    for (const p of tokens.pluginProperties) expect(THEME_TOKENS).toContain(p);
  });
  it('keeps studio names plugins already read, once each', () => {
    for (const p of ['--surface-base', '--accent', '--accent-fg', '--font-sans', '--status-ok']) expect(THEME_TOKENS).toContain(p);
    expect(new Set(THEME_TOKENS).size).toBe(THEME_TOKENS.length);
  });
});
