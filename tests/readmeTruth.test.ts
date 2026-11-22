import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtinDefaults } from '../src/editors/model.js';

/**
 * studio#957, studio#888: README sentences that were false on main stay gone, and the corrected ones keep their
 * key fact. Only short anchors are held, so a rewording that keeps the meaning passes. The behaviour each
 * sentence describes is pinned by its own tests: tests/launchWizard.test.tsx (`launch-wizard-power`),
 * tests/inlineStart.test.tsx (`composer-start-review-plan-toggle`) and tests/editorHost.test.ts (`builtinDefaults`).
 * The README is read as one line of prose (its own line wrapping is not meaning).
 * @vitest-environment node
 */
const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8').replace(/\s+/g, ' ');

describe('README truth (studio#957, studio#888)', () => {
  it('sells no warm CLI seats: ASK-K4 deleted them (studio#888)', () => {
    expect(readme).not.toMatch(/\bwarm (CLI )?seats?\b/i);
    // codex r1 on #1304: an analysis chat seats one helper and no reviewer (crew's chat-workflow contract).
    expect(readme).toMatch(/one helper and no reviewer/);
  });

  it('the editors sentence names network.media, which the built-in Page and Document editors hold (studio#957)', () => {
    expect(builtinDefaults('wicked-page')).toContain('network.media');
    expect(builtinDefaults('wicked-doc')).toContain('network.media');
    expect(builtinDefaults('some-other-editor')).not.toContain('network.media');
    expect(readme).not.toMatch(/sandboxed frame with no network/);
    expect(readme).toContain('`network.media`');
    expect(readme).toMatch(/Page and Document/);
  });

  it('power mode: where it is switched off, and that crew decides which launches run power (studio#957)', () => {
    expect(readme).not.toMatch(/a chat's own run and a phase-based workflow run phased/);
    expect(readme).toMatch(/Review plan/);
    expect(readme).toMatch(/Draft epics or Demo video/);
    expect(readme).toMatch(/runs phased even with power on/);
  });
});
