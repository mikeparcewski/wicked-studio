/**
 * Copy triage (operator UX audit → DES-COPY-001): internal engineering vocabulary and
 * debug artifacts must not render as product copy. String-pinned like productName.test.
 */
import { describe, it, expect } from 'vitest';

describe('copy triage — internal vocabulary stays internal', () => {
  it('the campaigns shell is gone from the Build dashboard (V4, DES-UXFIX-001 §2.7)', async () => {
    // Slice 5 deleted the inert "Campaigns are coming" panel (and the dead
    // CampaignDagStub/InsightRail components with it): an inert shell teaches a
    // newcomer the product is unfinished. Neither the copy, the testid, nor the
    // old spec-citation phrasing may resurface on the Build surface.
    const src = (await import('node:fs')).readFileSync('src/components/CenterDashboard.tsx', 'utf8');
    expect(src).not.toMatch(/Campaigns are coming/);
    expect(src).not.toMatch(/campaign-dag-stub/);
    expect(src).not.toMatch(/Pending core.{0,40}Campaign primitive/);
  });

  it('no user-visible "warm seat" phrasing in the chat composer', async () => {
    const src = (await import('node:fs')).readFileSync('src/components/GroupChat.tsx', 'utf8');
    const placeholders = src.match(/placeholder="[^"]*"/g) ?? [];
    for (const p of placeholders) expect(p).not.toMatch(/warm seat/i);
  });

  it('no user-visible "inject" phrasing on the Build surface (V15: the user word is steer)', async () => {
    const src = (await import('node:fs')).readFileSync('src/components/CenterDashboard.tsx', 'utf8');
    const placeholders = src.match(/placeholder="[^"]*"/g) ?? [];
    for (const p of placeholders) expect(p).not.toMatch(/inject/i);
  });

  it('the Close button (né "End chat", V8) is not styled as a destructive action', async () => {
    const src = (await import('node:fs')).readFileSync('src/components/GroupChat.tsx', 'utf8');
    const anchor = src.indexOf('data-testid="chat-close"');
    expect(anchor).toBeGreaterThan(-1);
    const btn = src.slice(anchor, anchor + 600);
    expect(btn).not.toMatch(/f85149|248,\s*81,\s*73/);
    // V8's rename holds: the old label must not resurface as user copy.
    expect(src).not.toContain('End chat');
  });
});
