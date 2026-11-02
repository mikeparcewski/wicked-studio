import { describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), apiBase: () => '' }));
const { fetchGrants } = await import('../src/editors/model.js');

// artifact-runs-fix (rig): the Document editor said "This editor asks for network.media". A pending permission is
// said in a person's words.
describe('the editor’s pending-permission note', () => {
  it('names what it asks to do, not the permission id', async () => {
    apiFetch.mockResolvedValueOnce({ grants: [
      { permission: 'artifact.read', decision: 'allow' },
      { permission: 'network.media', decision: 'ask' },
    ] });
    const got = await fetchGrants('wicked-doc', '0.13.0', 'a'.repeat(64), null);
    expect(got.grants).toEqual(['artifact.read']);
    expect(got.note).toBe('This editor asks to load images and fonts from the internet — allow it under Settings → Editors.');
    expect(got.note).not.toContain('network.media');
  });
});
