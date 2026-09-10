import { describe, it, expect } from 'vitest';
import { describeGate, repoSlugOf, resolveLaunchTarget } from '../src/components/launchTarget.js';

/**
 * F-028 — the ONE derivation of `LaunchRunBody.repoRef`. Acceptance run
 * 1f12f9ab: a project auto-attached nine repos, the operator ticked
 * `wicked-studio`, the body carried `repoRef: wicked-core` (chip[0]) and a
 * studio fix was dispatched into wicked-core. These pin the precedence the
 * composer now derives the target from:
 *   Target-repo choice > explicit popover tick > the lone attached repo >
 *   (build-kind) AMBIGUOUS with no default / (non-build) the first, as before.
 */
const build = { selectedTarget: null, requireExplicit: true } as const;
const nonBuild = { selectedTarget: null, requireExplicit: false } as const;

describe('resolveLaunchTarget (F-028)', () => {
  it('nothing attached → none (the preflight block, not this, is what speaks)', () => {
    expect(resolveLaunchTarget({ repoRefs: [], explicitRefs: [], ...build })).toEqual({ kind: 'none' });
  });

  it('one attached repo IS the target — no choice to make, whatever the kind', () => {
    expect(resolveLaunchTarget({ repoRefs: ['studio'], explicitRefs: [], ...build }))
      .toEqual({ kind: 'resolved', repoRef: 'studio', source: 'only' });
    expect(resolveLaunchTarget({ repoRefs: ['studio'], explicitRefs: [], ...nonBuild }))
      .toEqual({ kind: 'resolved', repoRef: 'studio', source: 'only' });
  });

  it('several auto-attached repos + build-kind → AMBIGUOUS: candidates in attach order, NO default', () => {
    const t = resolveLaunchTarget({ repoRefs: ['core', 'estate', 'studio'], explicitRefs: [], ...build });
    expect(t).toEqual({ kind: 'ambiguous', candidates: ['core', 'estate', 'studio'] });
    // The defect: chip[0] must never be inferred for build work.
    expect(t.kind).not.toBe('resolved');
  });

  it('several auto-attached repos + non-build (chat/freeform) keep the first — the repo is context there', () => {
    expect(resolveLaunchTarget({ repoRefs: ['core', 'estate', 'studio'], explicitRefs: [], ...nonBuild }))
      .toEqual({ kind: 'resolved', repoRef: 'core', source: 'first' });
  });

  it('an explicit popover tick ALWAYS wins over auto-attached chips — even when listed last', () => {
    expect(resolveLaunchTarget({ repoRefs: ['core', 'estate', 'studio'], explicitRefs: ['studio'], ...build }))
      .toEqual({ kind: 'resolved', repoRef: 'studio', source: 'explicit' });
    expect(resolveLaunchTarget({ repoRefs: ['core', 'estate', 'studio'], explicitRefs: ['studio'], ...nonBuild }))
      .toEqual({ kind: 'resolved', repoRef: 'studio', source: 'explicit' });
  });

  it('two explicit ticks + build-kind → ambiguous among the TICKS only (auto chips are out of the running)', () => {
    expect(resolveLaunchTarget({ repoRefs: ['core', 'estate', 'studio', 'bus'], explicitRefs: ['studio', 'estate'], ...build }))
      .toEqual({ kind: 'ambiguous', candidates: ['studio', 'estate'] });
    // Non-build: the first TICK, not the first chip.
    expect(resolveLaunchTarget({ repoRefs: ['core', 'estate', 'studio', 'bus'], explicitRefs: ['studio', 'estate'], ...nonBuild }))
      .toEqual({ kind: 'resolved', repoRef: 'studio', source: 'first' });
  });

  it('the Target-repo choice outranks an explicit tick', () => {
    expect(resolveLaunchTarget({ repoRefs: ['core', 'estate', 'studio'], explicitRefs: ['studio'], selectedTarget: 'core', requireExplicit: true }))
      .toEqual({ kind: 'resolved', repoRef: 'core', source: 'selected' });
  });

  it('a choice or a tick that is no longer attached is ignored — never a phantom repoRef', () => {
    expect(resolveLaunchTarget({ repoRefs: ['core', 'estate'], explicitRefs: ['studio'], selectedTarget: 'bus', requireExplicit: true }))
      .toEqual({ kind: 'ambiguous', candidates: ['core', 'estate'] });
    expect(resolveLaunchTarget({ repoRefs: ['core'], explicitRefs: ['studio'], selectedTarget: 'bus', requireExplicit: true }))
      .toEqual({ kind: 'resolved', repoRef: 'core', source: 'only' });
  });

  it('dedupes attached refs and ignores empty ones', () => {
    expect(resolveLaunchTarget({ repoRefs: ['', 'core', 'core'], explicitRefs: [], ...build }))
      .toEqual({ kind: 'resolved', repoRef: 'core', source: 'only' });
    expect(resolveLaunchTarget({ repoRefs: ['', ''], explicitRefs: [], ...build })).toEqual({ kind: 'none' });
  });
});

describe('repoSlugOf — the "→ opens a PR on <owner/repo>" label', () => {
  it('reads owner/repo off https, ssh and scp git URLs, with or without .git', () => {
    expect(repoSlugOf({ name: 'x', git_url: 'https://github.com/acme/widgets.git' })).toBe('acme/widgets');
    expect(repoSlugOf({ name: 'x', git_url: 'https://github.com/acme/widgets' })).toBe('acme/widgets');
    expect(repoSlugOf({ name: 'x', git_url: 'https://github.com/acme/widgets.git/' })).toBe('acme/widgets');
    expect(repoSlugOf({ name: 'x', git_url: 'git@github.com:acme/widgets.git' })).toBe('acme/widgets');
    expect(repoSlugOf({ name: 'x', git_url: 'ssh://git@github.com/acme/widgets' })).toBe('acme/widgets');
    expect(repoSlugOf({ name: 'x', git_url: 'https://gitlab.example.com/group/sub/widgets.git' })).toBe('sub/widgets');
  });

  it('falls back to the registered name when there is no URL or no owner/name pair', () => {
    expect(repoSlugOf({ name: 'wicked-studio' })).toBe('wicked-studio');
    expect(repoSlugOf({ name: 'wicked-studio', git_url: '' })).toBe('wicked-studio');
    expect(repoSlugOf({ name: 'wicked-studio', git_url: null })).toBe('wicked-studio');
    expect(repoSlugOf({ name: 'wicked-studio', git_url: 'https://github.com/acme' })).toBe('wicked-studio');
    expect(repoSlugOf({ name: 'wicked-studio', git_url: 'git@github.com:widgets.git' })).toBe('wicked-studio');
    expect(repoSlugOf({ name: 'wicked-studio', git_url: '/local/path/only' })).toBe('wicked-studio');
  });
});

describe('describeGate — the summary speaks the same precedence submit applies', () => {
  it('Ask and Autonomous override the selector', () => {
    expect(describeGate('ask', 'none', 1)).toBe('every unit');
    expect(describeGate('autonomous', 'all', 1)).toBe('no human gates');
  });
  it('Balanced / no mode lets the selector speak', () => {
    expect(describeGate('balanced', 'all', 1)).toBe('every unit');
    expect(describeGate(undefined, 'before', 1)).toBe('first gate');
    expect(describeGate('balanced', 'before', 3)).toBe('before unit #3');
    expect(describeGate(undefined, 'none', 1)).toBe('no gates');
  });
});
