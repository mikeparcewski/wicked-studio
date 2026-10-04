import { describe, expect, it } from 'vitest';
import { grantedOf } from '../src/editors/model.js';

/** EP-P2 — crew's decided grants as the host reads them (DES-EDITOR-PLUGINS-001 §6.2): deny dominates. */
describe('grantedOf', () => {
  it('an allow grants; an ask is named, not granted; a deny grants nothing', () => {
    expect(grantedOf([
      { permission: 'artifact.read', decision: 'allow', ruleIds: [], token: 't1' },
      { permission: 'artifact.write', decision: 'ask', ruleIds: ['r1'], token: 't2' },
      { permission: 'network.media', decision: 'deny', ruleIds: ['r2'], token: 't3' },
    ])).toEqual({ grants: ['artifact.read'], asking: ['artifact.write'] });
  });
  it('codex r1: deny dominates an allow for the same permission, whichever comes first — and a bare id too', () => {
    expect(grantedOf([
      { permission: 'artifact.write', decision: 'allow', ruleIds: [], token: 'a' },
      { permission: 'artifact.write', decision: 'deny', ruleIds: ['r'], token: 'b' },
    ]).grants).toEqual([]);
    expect(grantedOf([
      { permission: 'artifact.write', decision: 'deny', ruleIds: ['r'], token: 'b' },
      { permission: 'artifact.write', decision: 'allow', ruleIds: [], token: 'a' },
    ]).grants).toEqual([]);
    expect(grantedOf(['artifact.write', { permission: 'artifact.write', decision: 'deny', ruleIds: [], token: 'b' }]).grants).toEqual([]);
    // A deny also silences an ask for the same permission: nothing to ask the operator for.
    expect(grantedOf([
      { permission: 'artifact.write', decision: 'ask', ruleIds: [], token: 'a' },
      { permission: 'artifact.write', decision: 'deny', ruleIds: ['r'], token: 'b' },
    ])).toEqual({ grants: [], asking: [] });
  });
  it('the EP-P1 fixture’s bare list of ids reads as allowed; unknown ids and junk are dropped', () => {
    expect(grantedOf(['artifact.read', 'selection.chip', 'not.a.permission', 42, null, { permission: 'x', decision: 'allow' }]))
      .toEqual({ grants: ['artifact.read', 'selection.chip'], asking: [] });
    expect(grantedOf(undefined)).toEqual({ grants: [], asking: [] });
  });
});
