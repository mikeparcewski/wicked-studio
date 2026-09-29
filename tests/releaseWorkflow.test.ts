import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * studio#331 — the post-publish registry probe must not gate the GitHub Release.
 *
 * On v0.5.14 `npm publish` succeeded, the serve probe 404'd through its whole 60 s window,
 * and `Create the GitHub Release from CHANGELOG` was skipped; the same version resolved a
 * minute later, so the Release had to be cut by hand from the CHANGELOG. The publish was
 * fine — the registry served it late. These assertions pin the two properties that keeps
 * that from recurring: the probe waits long enough to cover normal lag, and it reports
 * rather than fails.
 *
 * @vitest-environment node
 *   (pure filesystem test — the suite-wide jsdom env rewrites import.meta.url to a
 *   non-file scheme, which readFileSync rejects; see tests/testidInventory.test.ts)
 */
const WORKFLOW = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

function stepBlock(name: string): string {
  const lines = WORKFLOW.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  const head = lines[start];
  expect(head, `step "${name}" is missing from release.yml`).toBeDefined();
  const indent = head!.indexOf('-');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.trim().startsWith('- ') && l.indexOf('-') === indent);
  return [head!, ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}

describe('release.yml', () => {
  const probe = stepBlock('The registry can actually serve it');

  it('publishes before it probes, and cuts the GitHub Release after both', () => {
    const order = ['Publish to npm', 'The registry can actually serve it', 'Create the GitHub Release'];
    const at = order.map((n) => WORKFLOW.indexOf(`- name: ${n}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    // Strictly increasing offsets = publish, then probe, then release.
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('reports registry lag as a warning instead of failing the job', () => {
    expect(probe).toMatch(/::warning::/);
    expect(probe).not.toMatch(/::error::/);
    // A non-zero exit anywhere in the probe would skip every later step, the Release included.
    expect(probe).not.toMatch(/^\s*exit [1-9]/m);
    expect(probe).not.toMatch(/continue-on-error/);
  });

  it('waits at least five minutes for the registry before giving up', () => {
    const backoff = probe.match(/^\s*BACKOFF="([^"]+)"/m)?.[1];
    expect(backoff, 'the probe should declare its backoff schedule as BACKOFF="…"').toBeDefined();
    const total = (backoff ?? '')
      .trim()
      .split(/\s+/)
      .map(Number)
      .reduce((a, b) => a + b, 0);
    expect(Number.isNaN(total)).toBe(false);
    expect(total).toBeGreaterThanOrEqual(300);
  });

  it('does not condition the GitHub Release step on the probe outcome', () => {
    const release = stepBlock('Create the GitHub Release from CHANGELOG');
    expect(release).not.toMatch(/steps\.serve_probe/);
    expect(release).not.toMatch(/^\s*if:/m);
  });
});
