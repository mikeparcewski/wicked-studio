/**
 * New job's document cards open New document on their exact format (launch-modal): `?format=` rides
 * with `new=document`, and a new request remounts an open form (codex r2: the open form kept its old
 * format, and the create would have used it).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { everythingPath, readEverythingQuery } from '../src/board/everythingModel.js';

vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: () => () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: true, error: null, failedAt: null }),
}));
const { EverythingPage } = await import('../src/components/everything/EverythingPage.js');

afterEach(() => cleanup());

describe('?format= on the Made door', () => {
  it('round-trips only with new=document, and only a known format', () => {
    const path = everythingPath({ tab: 'made', kind: 'decks', new: 'document', format: 'ppt' });
    expect(path).toBe('/everything?tab=made&kind=decks&new=document&format=ppt');
    expect(readEverythingQuery(new URL(`http://x${path}`).search).format).toBe('ppt');
    expect(readEverythingQuery('?tab=made&format=ppt').format).toBeNull();
    expect(readEverythingQuery('?tab=made&new=document&format=constructor').format).toBeNull();
    expect(everythingPath({ tab: 'made', format: 'doc' })).toBe('/everything?tab=made');
  });

  it('the form starts on the requested format, and a new request with another format is a new form', () => {
    const page = (search: string) => <EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => {}} search={search} />;
    const { rerender } = render(page('?tab=made&kind=documents&new=document&format=doc'));
    expect(screen.getByTestId('doc-format')).toHaveValue('doc');
    rerender(page('?tab=made&kind=decks&new=document&format=ppt'));
    expect(screen.getByTestId('doc-format')).toHaveValue('ppt');
  });
});
