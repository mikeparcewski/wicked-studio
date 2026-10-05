/**
 * Structural guards over the INSTALLED `wicked-crew-api-types` and studio's own readers — the two
 * prohibitions the deleted wave-6 byte-pin test carried beyond byte equality (codex on #519):
 *
 *  1. The produced test sets ride the TOP-LEVEL `CampaignsListResponse.test_sets`; no row-level
 *     `Campaign.test_set` / `RunGroup.test_set` join exists in the contract, and studio declares none.
 *  2. `TestingReconBody` has no `workflow` key, and studio's recon launch sends none (the
 *     recon+workflow ladder rung was dead code).
 *
 * The behavioural halves live beside their consumers (`tests/campaignStats.testsets.test.ts`,
 * `tests/testingGoverned.wire.test.ts`); these read the contract's text so a pin bump that
 * reintroduces either shape fails here and says what moved.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const INSTALLED = fileURLToPath(new URL('../node_modules/wicked-crew-api-types/index.d.ts', import.meta.url));
const CAMPAIGNS_SRC = fileURLToPath(new URL('../src/api/campaigns.ts', import.meta.url));
const TESTING_SRC = fileURLToPath(new URL('../src/api/testing.ts', import.meta.url));

/** The body of one top-level `export interface NAME { … }` in a .d.ts (brace-balanced). */
function interfaceBody(dts: string, name: string): string {
  const start = dts.indexOf(`export interface ${name} `);
  if (start === -1) throw new Error(`${name} is not declared by the installed contract`);
  const open = dts.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < dts.length; i++) {
    if (dts[i] === '{') depth++;
    else if (dts[i] === '}' && --depth === 0) return dts.slice(open, i + 1);
  }
  throw new Error(`${name}: unbalanced braces`);
}

/** Field names a body declares at its top level (one per line, `name?:` or `name:`). */
function fields(body: string): string[] {
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
}

const dts = readFileSync(INSTALLED, 'utf8');

describe('the installed contract keeps the two wave-6 shapes studio stopped assuming', () => {
  it('test sets are TOP-LEVEL on CampaignsListResponse; no row-level test_set join on Campaign or RunGroup', () => {
    expect(fields(interfaceBody(dts, 'CampaignsListResponse'))).toContain('test_sets');
    expect(fields(interfaceBody(dts, 'Campaign'))).not.toContain('test_set');
    expect(fields(interfaceBody(dts, 'RunGroup'))).not.toContain('test_set');
  });

  it('TestingReconBody declares no `workflow` key', () => {
    expect(fields(interfaceBody(dts, 'TestingReconBody'))).not.toContain('workflow');
  });
});

describe('studio declares and sends neither', () => {
  it('campaigns.ts declares no row-level test_set field', () => {
    const src = readFileSync(CAMPAIGNS_SRC, 'utf8');
    expect(src).not.toMatch(/^\s+test_set\??:/m);
  });

  it('the recon launch never adds a workflow key to the pinned body', () => {
    const src = readFileSync(TESTING_SRC, 'utf8');
    expect(src).not.toContain('testing-recon-workflow');
    expect(src).not.toMatch(/\.\.\.pinned,\s*workflow/);
  });
});
