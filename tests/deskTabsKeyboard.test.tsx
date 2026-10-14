import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DeskInbox } from '../src/components/desk/DeskInbox.js';
import type { NeedRow } from '../src/board/needsYou.js';

vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
afterEach(cleanup);

const rows: NeedRow[] = ['gate', 'failed-run', 'campaign'].map((kind, i): NeedRow => ({
  key: `row-${i}`, kind: kind as NeedRow['kind'], severity: 100 - i, stakes: 1,
  subject: `Subject ${i}`, text: `Body ${i}`, tone: 'gate', at: null,
  subjectPath: '/watch', action: { kind: 'open', path: '/watch', label: 'Open' },
}));

function inbox(): void {
  render(<DeskInbox rows={rows} runs={[]} navigate={vi.fn()} now={Date.UTC(2026, 9, 13)} settled="complete" agentName={(s) => s} />);
}

function expectSelected(tab: HTMLElement): void {
  expect(tab).toHaveFocus();
  expect(tab).toHaveAttribute('aria-selected', 'true');
  const tabs = within(screen.getByRole('tablist', { name: 'Show' })).getAllByRole('tab');
  for (const t of tabs) expect(t).toHaveAttribute('tabindex', t === tab ? '0' : '-1');
  const panel = screen.getByRole('tabpanel');
  expect(tab).toHaveAttribute('aria-controls', panel.id);
  expect(panel).toHaveAttribute('aria-labelledby', tab.id);
}

describe('Needs-you folder tabs', () => {
  it('moves focus and selection with ArrowRight/ArrowLeft and wraps over visible folders', () => {
    inbox();
    const all = screen.getByTestId('desk-inbox-folder-all');
    const decisions = screen.getByTestId('desk-inbox-folder-decision');
    const other = screen.getByTestId('desk-inbox-folder-other');
    expect(screen.queryByTestId('desk-inbox-folder-review')).not.toBeInTheDocument();
    all.focus();
    expectSelected(all);
    fireEvent.keyDown(all, { key: 'ArrowRight' });
    expectSelected(decisions);
    expect(screen.getByTestId('desk-inbox-list')).toHaveTextContent('Subject 0');
    expect(screen.getByTestId('desk-inbox-list')).not.toHaveTextContent('Subject 1');
    fireEvent.keyDown(decisions, { key: 'ArrowLeft' });
    expectSelected(all);
    fireEvent.keyDown(all, { key: 'ArrowLeft' });
    expectSelected(other);
    fireEvent.keyDown(other, { key: 'ArrowRight' });
    expectSelected(all);
  });

  it('selects the first/last folder with Home/End and leaves unrelated keys alone', () => {
    inbox();
    const all = screen.getByTestId('desk-inbox-folder-all');
    const other = screen.getByTestId('desk-inbox-folder-other');
    all.focus();
    fireEvent.keyDown(all, { key: 'End' });
    expectSelected(other);
    fireEvent.keyDown(other, { key: 'Home' });
    expectSelected(all);
    fireEvent.keyDown(all, { key: 'ArrowDown' });
    expectSelected(all);
  });

  it('also pairs and labels the panel while the inbox is reading', () => {
    render(<DeskInbox rows={[]} runs={[]} navigate={vi.fn()} now={0} settled="loading" agentName={(s) => s} />);
    const all = screen.getByTestId('desk-inbox-folder-all');
    all.focus();
    expectSelected(all);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'true');
  });
});
