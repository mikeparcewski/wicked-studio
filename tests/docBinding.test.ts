import { describe, expect, it, vi } from 'vitest';

/**
 * DES-UX-001 §6.2 (slice U): the Unfiled path's binding contract.
 *
 * BRIDGE-UX-1 probe 3 (§8.4.1): the bridge hosts a project-unbound doc
 * natively — `POST /api/docs` with NO `project` field — while a bind is a
 * crew registration that `default` (synthesized, never stored) would refuse
 * with the loud 502. So a create THROUGH the default mount must omit the
 * field, and a create through a real project's mount must keep binding.
 */
import { docBinding, UNFILED_MOUNT } from '../src/api/interactive.js';
import { ensureScratchDoc } from '../src/theming/scratchDoc.js';
import { demoDraftBody } from '../src/interactive/demoWire.js';

describe('docBinding (§6.2 slice U)', () => {
  it('omits `project` on the Unfiled mount — unbound is the native shape', () => {
    expect(UNFILED_MOUNT).toBe('default');
    expect(docBinding(UNFILED_MOUNT)).toEqual({});
    expect('project' in docBinding(UNFILED_MOUNT)).toBe(false);
  });

  it('binds real projects exactly as before — registration stays the authority', () => {
    expect(docBinding('q3-review-deck')).toEqual({ project: 'q3-review-deck' });
  });

  it('a demo draft through the default mount carries no binding field', () => {
    const body = demoDraftBody(UNFILED_MOUNT, {
      name: 'unfiled-demo', targetUrl: 'https://example.com',
      steps: [{ subject: 'the storefront', action: 'open it' }],
    }, 'msg-1');
    expect(body.project).toBeUndefined();
    expect(body.kind).toBe('demo');
  });

  it('the scratch doc on the default mount is created unbound', async () => {
    const listDocs = vi.fn().mockResolvedValue([]);
    const createDoc = vi.fn().mockResolvedValue({ name: 'brand-learn', head: 1 });
    await ensureScratchDoc(UNFILED_MOUNT, { listDocs, createDoc });
    const [, body] = createDoc.mock.calls[0] as [string, { project?: string }];
    expect(body.project).toBeUndefined();
  });
});
