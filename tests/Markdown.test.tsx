import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
