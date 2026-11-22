import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builtinDefaults } from '../src/editors/model.js';

/**
 * studio#957, studio#888: README sentences that were false on main, each held to the code it describes.
 * The README is read as one line of prose (its own line wrapping is not meaning).
 * @vitest-environment node
 */
const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8').replace(/\s+/g, ' ');

describe('README truth (studio#957, studio#888)', () => {
  it('sells no warm CLI seats: ASK-K4 deleted them (studio#888)', () => {
    expect(readme).not.toMatch(/\bwarm (CLI )?seats?\b/i);
    // codex r1 on #1304: an analysis chat seats one helper and no reviewer (crew's chat-workflow contract).
    expect(readme).toMatch(/an Understand analysis chat uses one helper and no reviewer/);
  });

  it('the editors sentence names network.media, which the built-in Page and Document editors hold (studio#957)', () => {
    expect(builtinDefaults('wicked-page')).toContain('network.media');
    expect(builtinDefaults('wicked-doc')).toContain('network.media');
    expect(builtinDefaults('some-other-editor')).not.toContain('network.media');
    expect(readme).not.toMatch(/sandboxed frame with no network/);
    expect(readme).toContain('`network.media`');
    expect(readme).toMatch(/Page and Document editors hold it by default/);
  });

  it('power mode: where it is switched off, and that crew decides which launches run power (studio#957)', () => {
    const src = (f: string): string => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8');
    // New job's Options step: `offerPower = powerCap && !drafting && !demoing` (not withheld from phase-based workflows).
    expect(src('components/launch/LaunchWizard.tsx')).toMatch(/const offerPower = powerCap && !drafting && !demoing;/);
    // A job shaped in chat (New job's cards start in chat, codex r2 on #1304): the Start row's Review plan switch.
    expect(src('components/session/InlineStart.tsx')).toMatch(/<Switch label="Review plan"/);
    expect(readme).not.toMatch(/a chat's own run and a phase-based workflow run phased/);
    expect(readme).toMatch(/a \*\*Review plan\*\* switch beside a chat's Start, or New job's \*\*Power mode\*\* switch \(not offered for Draft epics or Demo video\)/);
    expect(readme).toMatch(/any other workflow runs phased even with power on/);
  });
});
