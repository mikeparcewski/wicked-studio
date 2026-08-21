/**
 * Copy triage (operator UX audit → DES-COPY-001): internal engineering vocabulary and
 * debug artifacts must not render as product copy. String-pinned like productName.test.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { CampaignDagStub } from '../src/components/CampaignDagStub.js';

describe('copy triage — internal vocabulary stays internal', () => {
  it('the campaigns placeholder speaks product, not spec', () => {
    render(<CampaignDagStub />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/§|primitive|RunFinished|DAG/);
    expect(text).toMatch(/Campaigns are coming/);
  });

  it('no spec citations in the Build dashboard source', async () => {
    // Comments and event-name code legitimately mention RunFinished etc. — only the
    // user-visible COPY sentence is banned.
    const src = (await import('node:fs')).readFileSync('src/components/CenterDashboard.tsx', 'utf8');
    expect(src).not.toMatch(/Pending core.{0,40}Campaign primitive/);
    expect(src).toMatch(/Campaigns are coming/);
  });

  it('no user-visible "warm seat" phrasing in the chat composer', async () => {
    const src = (await import('node:fs')).readFileSync('src/components/GroupChat.tsx', 'utf8');
    const placeholders = src.match(/placeholder="[^"]*"/g) ?? [];
    for (const p of placeholders) expect(p).not.toMatch(/warm seat/i);
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
