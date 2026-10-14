import { describe, expect, it } from 'vitest';
import { fakeSurfaceFor } from '../src/editors/adapters/fake.js';

/** The editor test page's sample per kind: a video editor gets the scripted four-chapter cut, not the sample page
 *  ("No cut is available here", orchestrator 2026-10-14). */
describe('fakeSurfaceFor', () => {
  it('a recording kind reads the four-chapter cut', async () => {
    for (const kind of ['demo-video', 'walkthrough']) {
      const a = fakeSurfaceFor({ kind, title: 'Build a team' });
      const r = await a.read();
      expect('error' in r).toBe(false);
      const content = (r as unknown as { content: { type: string; chapters: { title: string }[] } }).content;
      expect(content.type).toBe('demo-cut');
      expect(content.chapters.map((c) => c.title)).toEqual(['Open the scope', 'Pick a plan', 'Add a seat', 'Invite the team']);
      expect(a.capabilities()).toContain('media');
      expect(a.capabilities()).not.toContain('versions'); // the host's Versions tab would read interactive for it
    }
  });
  it('a page or a deck reads its sample document', async () => {
    const page = await fakeSurfaceFor({ kind: 'page', title: 'P' }).read();
    expect('error' in page).toBe(false);
    expect(fakeSurfaceFor({ kind: 'deck', title: 'D' }).artifact().kind).toBe('deck');
  });
});
