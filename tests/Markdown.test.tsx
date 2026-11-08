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
});
