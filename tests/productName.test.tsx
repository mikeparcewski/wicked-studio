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

const { SessionRail } = await import('../src/components/desk/SessionRail.js');

describe('visible product name', () => {
  it('the session rail brand reads wicked studio', () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    // The Desk's rail brand (the classic sidebar's "wicked-studio" button retired with S18d).
    expect(screen.getByTestId('desk-rail-brand').textContent?.replace(/\s+/g, ' ').trim()).toBe('wicked studio');
  });

  it('the document title reads wicked-studio', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/<title>\s*wicked-studio\s*<\/title>/);
  });
});
