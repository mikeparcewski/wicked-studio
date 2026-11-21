import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '../src/api/client.js';
import { SourceChips } from '../src/components/session/SourceChips.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('masks citation hovers and passage headings while preserving source keys and file requests', async () => {
  const raw = '/home/reel-operator/repo/file.ts:1';
  const read = vi.spyOn(api, 'getRunFile').mockResolvedValue({ content: 'const ok = true;', binary: false, truncated: false, path: '/repo/file.ts' } as never);
  render(<SourceChips citations={{ verified: 1, unverifiable: 0, corrected: 0, unchecked: 0, items: [{ raw, kind: 'line', status: 'verified', note: 'Read /home/reel-operator/note' }] }} runs={[{ id: 'sources-c3', workdir: '/tmp/tree' }]} />);
  const chip = screen.getByTestId('session-source');
  expect.soft(chip.title).toBe('~/repo/file.ts:1 — Read ~/note');
  expect.soft(chip.title).not.toContain('reel-operator');
  fireEvent.click(chip);
  await screen.findByText('const ok = true;');
  const heading = screen.getByTestId('session-passage').querySelector('.wk-passage-head')!;
  expect.soft(heading.textContent).toContain('~/repo/file.ts:1');
  expect.soft(heading.textContent).not.toContain('reel-operator');
  expect(chip).toHaveAttribute('data-source', raw);
  expect(read).toHaveBeenCalledWith('sources-c3', '/tmp/tree/home/reel-operator/repo/file.ts');
});
