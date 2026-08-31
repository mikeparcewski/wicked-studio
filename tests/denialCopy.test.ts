import { describe, it, expect } from 'vitest';
import { denialAdvice, denialHeadline, parseDenial } from '../src/components/denialCopy.js';

// The review's exact blocker prose (run 61fcefaa): the banner must translate this, not echo it.
const BOUNDARY_PROSE = 'input governance denied a tool-call in unit-2 (claim boundary-deny:unit-2)';

describe('denialCopy (review Top-10 #1 — plain-language failure copy)', () => {
  it('translates the boundary-deny prose into the sandbox-write sentence', () => {
    const f = parseDenial(BOUNDARY_PROSE);
    expect(f.kind).toBe('sandbox-write');
    expect(f.claimId).toBe('boundary-deny:unit-2');
    expect(denialHeadline(f, 2)).toBe(
      'Unit #2 tried to write outside its workspace and was stopped to protect your files.',
    );
    expect(denialAdvice(f)).toMatch(/retry/i);
    expect(f.raw).toBe(BOUNDARY_PROSE); // the engine detail line keeps the verbatim prose
  });

  it('reads the STRUCTURED denial when a 0.7.6+ engine serves it (both casings)', () => {
    const snake = parseDenial('whatever prose', { claim_id: 'x', rule_ids: ['SEC-101'] });
    expect(snake.kind).toBe('rule');
    expect(snake.ruleIds).toEqual(['SEC-101']);
    const camel = parseDenial(null, { claimId: 'x', ruleIds: ['SEC-101', 'POL-9'] });
    expect(camel.ruleIds).toEqual(['SEC-101', 'POL-9']);
    expect(denialHeadline(camel, 3)).toContain('SEC-101');
  });

  it('never links engine-internal rule ids', () => {
    const f = parseDenial(null, { claim_id: 'phase-scope:unit-1', rule_ids: ['engine:phase-scope'] });
    expect(f.kind).toBe('phase-scope');
    expect(f.ruleIds).toEqual([]); // named in prose maybe, never a drawer link
  });

  it('classifies triage and worker failures', () => {
    expect(parseDenial('triage escalation: flaky network — retry likely').kind).toBe('triage');
    expect(parseDenial('Worker FAILED on unit 4 (triage: bad merge): tail...').kind).toBe('worker-failed');
  });

  it('advisory read denies say so instead of alarming', () => {
    const f = parseDenial('read blocked (claim boundary-read-deny:unit-1)');
    expect(f.kind).toBe('sandbox-read');
    expect(denialAdvice(f)).toMatch(/harmless/i);
  });
});
