// studio#567: the document row's grounding chip, read from the structured record crew#512 emits.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { groundingChip } from '../src/board/groundingChip.js';
import { GroundingChip } from '../src/components/GroundingChip.js';
import { madeRows } from '../src/board/everythingModel.js';
import type { DocGrounding } from '../src/api/interactive.js';

const PRESENT: DocGrounding = { repo_refs: ['repo-a', 'repo-b'], source: 'named', skipped: [], member_count: 3 };
const SKIPPED_ONLY: DocGrounding = {
  repo_refs: [], source: 'none', member_count: 2,
  skipped: [{ ref: 'payments', reason: 'not-a-member' }, { ref: 'web', reason: 'unsnapshotable' }],
};

afterEach(() => { cleanup(); });

describe('groundingChip (model)', () => {
  it('present: N of M repos, the refs for the hover, the source in words, no skipped segment', () => {
    expect(groundingChip(PRESENT)).toEqual({
      label: 'Grounded on 2 of 3 repos', reposTitle: 'repo-a\nrepo-b', source: 'named on the ask', skipped: null,
    });
    expect(groundingChip({ ...PRESENT, repo_refs: ['solo'], source: 'sole-member', member_count: 1 })!.label).toBe('Grounded on 1 repo');
  });
  it('absent (older daemon / pre-sidecar document) or malformed → null, the row is unchanged', () => {
    expect(groundingChip(undefined)).toBeNull();
    expect(groundingChip(null)).toBeNull();
    expect(groundingChip({ source: 'named' } as unknown as DocGrounding)).toBeNull();
  });
  it('skipped-only: not grounded, with each skipped ref and its reason on the muted segment', () => {
    const c = groundingChip(SKIPPED_ONLY)!;
    expect(c.label).toBe('Not grounded on a repo');
    expect(c.source).toBe('nothing named');
    expect(c.skipped).toEqual({ count: 2, title: 'payments — not a project member\nweb — its snapshot failed' });
  });
});

describe('<GroundingChip> (render)', () => {
  it('renders one testid per element; the repo refs and the skips ride the titles', () => {
    render(<GroundingChip grounding={{ ...PRESENT, skipped: [{ ref: 'x', reason: 'ambiguous' }] }} />);
    expect(screen.getByTestId('doc-grounding-repos')).toHaveTextContent('Grounded on 2 of 3 repos');
    expect(screen.getByTestId('doc-grounding-repos')).toHaveAttribute('title', 'repo-a\nrepo-b');
    expect(screen.getByTestId('doc-grounding-source')).toHaveTextContent('named on the ask');
    expect(screen.getByTestId('doc-grounding-skipped')).toHaveTextContent('skipped 1');
    expect(screen.getByTestId('doc-grounding-skipped')).toHaveAttribute('title', 'x — several members share that name');
  });
  it('renders nothing when the field is absent', () => {
    const { container } = render(<GroundingChip grounding={undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('doc-grounding-chip')).toBeNull();
  });
});

describe('madeRows carries the record to the Made row', () => {
  it('a doc with grounding keeps it; one without carries no key', () => {
    const rows = madeRows({ p1: [
      { name: 'grounded', kind: 'doc', head: 1, versions: 1, updated_at: '2026-10-08T00:00:00Z', grounding: PRESENT },
      { name: 'plain', kind: 'doc', head: 1, versions: 1, updated_at: '2026-10-07T00:00:00Z' },
    ] }, [], {});
    expect(rows.find((r) => r.title === 'grounded')!.doc!.grounding).toEqual(PRESENT);
    expect(rows.find((r) => r.title === 'plain')!.doc).toEqual({ name: 'plain', kind: 'doc' });
  });
});
