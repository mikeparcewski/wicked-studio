import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Markdown } from '../src/components/Markdown.js';

describe('Markdown', () => {
  it('renders plain text', () => {
    render(<Markdown>Hello world</Markdown>);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders a heading', () => {
    render(<Markdown>{'# My Heading'}</Markdown>);
    expect(screen.getByRole('heading', { level: 1, name: 'My Heading' })).toBeInTheDocument();
  });

  it('renders inline code without forwarding node prop', () => {
    render(<Markdown>{'Use `foo()` here'}</Markdown>);
    expect(screen.getByText('foo()')).toBeInTheDocument();
  });

  it('renders a fenced code block', () => {
    render(<Markdown>{'```js\nconsole.log("hi")\n```'}</Markdown>);
    expect(screen.getByText('console.log("hi")')).toBeInTheDocument();
  });

  it('renders a fenced code block without a language specifier as a block', () => {
    const { container } = render(<Markdown>{'```\nplain code\n```'}</Markdown>);
    const el = container.querySelector('code');
    expect(el?.textContent).toContain('plain code');
    expect(el?.className).toContain('block');
  });

  it('renders a GFM table', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    render(<Markdown>{md}</Markdown>);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders a blockquote', () => {
    render(<Markdown>{'> some quote'}</Markdown>);
    expect(screen.getByText('some quote')).toBeInTheDocument();
  });
});

describe('Markdown: no home folder renders (e2e-1105 privacy)', () => {
  it('text, inline code and code blocks read ~/…; a file link opens by its real path', () => {
    const open = vi.fn();
    const md = [
      '[wicked-crew] EXPECTED: /Users/reel-operator/.wicked/reviews/r1/out/report.json',
      '',
      'Read `/home/alice/repo/src/a.ts` and [the report](/Users/reel-operator/.wicked/reviews/r1/out/report.json).',
      '',
      '```',
      'cat /Users/reel-operator/notes.md',
      '```',
    ].join('\n');
    const { container } = render(<Markdown onOpenFile={open}>{md}</Markdown>);
    expect(container.textContent).toContain('EXPECTED: ~/.wicked/reviews/r1/out/report.json');
    expect(container.textContent).toContain('~/repo/src/a.ts');
    expect(container.textContent).toContain('cat ~/notes.md');
    expect(container.innerHTML).not.toMatch(/reel-operator|alice/);
    fireEvent.click(screen.getByTestId('evidence-ref'));
    expect(open).toHaveBeenCalledWith('/Users/reel-operator/.wicked/reviews/r1/out/report.json');
  });

  it('macOS per-user temp and Windows home folders are collapsed too', () => {
    const { container } = render(<Markdown>{'wrote /var/folders/x7/abc123/T/wicked-1/out.json and C:\\Users\\jane.doe\\repo\\a.ts'}</Markdown>);
    expect(container.textContent).toContain('$TMPDIR/wicked-1/out.json');
    expect(container.textContent).toContain('~\\repo\\a.ts');
    expect(container.textContent).not.toMatch(/jane\.doe|abc123/);
  });
});

describe('Markdown privacy: link targets, image text, citation verdicts (e2e-1105 r2)', () => {
  it('a file link without an opener shows ~/… as its target; an image\'s words collapse too', () => {
    const { container } = render(<Markdown>{'See [the notes](/Users/reel-operator/notes.md) and ![shot of /Users/reel-operator/a.png](x.png)'}</Markdown>);
    expect(container.querySelector('a')!.getAttribute('href')).toBe('~/notes.md');
    expect(container.textContent).toContain('[image: shot of ~/a.png]');
    expect(container.innerHTML).not.toMatch(/reel-operator/);
  });

  it('two tokens that collapse to the same ~/… keep their own verdicts', async () => {
    const { citationMarks } = await import('../src/components/citations.js');
    const marks = citationMarks({ verified: 0, unverifiable: 0, corrected: 0, unchecked: 0, items: [
      { raw: '~/repo/a.ts:1', kind: 'file', status: 'unchecked' },
      { raw: '/Users/reel-operator/repo/a.ts:1', kind: 'file', status: 'unverified' },
    ] } as never);
    const { container } = render(<Markdown marks={marks}>{'First `~/repo/a.ts:1`, then `/Users/reel-operator/repo/a.ts:1`.'}</Markdown>);
    const statuses = [...container.querySelectorAll('[data-status]')].map((e) => e.getAttribute('data-status'));
    expect(statuses).toEqual(['unchecked', 'unverified']);
    expect(container.innerHTML).not.toMatch(/reel-operator/);
  });
});

describe('citation marks and the strip never print a home folder (e2e-1105 r3)', () => {
  it('raw, correction and note read ~/… on the inline mark and on the strip', async () => {
    const { citationMarks, CitationStrip } = await import('../src/components/citations.js');
    const c = { verified: 0, unverifiable: 0, corrected: 1, unchecked: 0, items: [
      { raw: '/Users/reel-operator/repo/a.ts:9', kind: 'file', status: 'corrected', resolved: '/Users/reel-operator/repo/a.ts:12', note: 'moved in /Users/reel-operator/repo' },
    ] } as never;
    const { container } = render(<><Markdown marks={citationMarks(c)}>{'See `/Users/reel-operator/repo/a.ts:9`.'}</Markdown><CitationStrip citations={c} /></>);
    expect(container.querySelector('[data-testid="citation-mark"]')!.getAttribute('data-status')).toBe('corrected');
    expect(container.textContent).toContain('→ ~/repo/a.ts:12');
    expect(screen.getByTestId('citation-flag').textContent).toContain('~/repo/a.ts:9 → ~/repo/a.ts:12');
    expect(container.innerHTML).not.toMatch(/reel-operator/);
  });
});
