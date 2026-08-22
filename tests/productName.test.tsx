import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';

/**
 * The merged product (DES-MERGE-001) ships under its own name. These cases pin the
 * two places a user actually reads it — the sidebar wordmark and the browser tab —
 * so a rename back to the old "wicked-crew studio" wordmark fails the suite.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ ok: true, version: '0.2.0' }),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
  },
}));

const { LeftSidebar } = await import('../src/components/LeftSidebar.js');

describe('visible product name', () => {
  it('the sidebar wordmark reads wicked-studio', async () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/" />);

    // The wordmark is the home button next to the logo. `findByRole` also settles the
    // health/repos fetches the sidebar kicks off on mount. Matched exactly, so the old
    // "wicked-crew studio" (which contains this text) cannot satisfy it.
    const wordmark = await screen.findByRole('button', { name: 'wicked-studio' });
    expect(wordmark.textContent?.trim()).toBe('wicked-studio');
  });

  it('the document title reads wicked-studio', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/<title>\s*wicked-studio\s*<\/title>/);
  });
});
