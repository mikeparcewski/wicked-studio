/**
 * Copy triage (operator UX audit → DES-COPY-001): internal engineering vocabulary and
 * debug artifacts must not render as product copy. String-pinned like productName.test.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CampaignDagStub } from '../src/components/CampaignDagStub.js';

describe('copy triage — internal vocabulary stays internal', () => {
  it('the campaigns placeholder speaks product, not spec', () => {
    render(<CampaignDagStub />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/§|primitive|RunFinished|DAG/);
    expect(text).toMatch(/Campaigns are coming/);
  });

  it('no user-visible "warm seat" phrasing in the chat composer', async () => {
    const src = (await import('node:fs')).readFileSync('src/components/GroupChat.tsx', 'utf8');
    const placeholders = src.match(/placeholder="[^"]*"/g) ?? [];
    for (const p of placeholders) expect(p).not.toMatch(/warm seat/i);
  });

  it('the End chat button is not styled as a destructive action', async () => {
    const src = (await import('node:fs')).readFileSync('src/components/GroupChat.tsx', 'utf8');
    const btn = src.slice(src.indexOf('End chat') - 600, src.indexOf('End chat'));
    expect(btn).not.toMatch(/f85149|248,\s*81,\s*73/);
  });
});
