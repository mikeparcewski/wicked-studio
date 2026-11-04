import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SlashMenu } from '../src/components/session/SlashMenu.js';
import type { AtItem } from '../src/components/session/SlashMenu.js';
import type { SlashItem } from '../src/board/planDraft.js';
import { catalogRows } from '../src/board/slashCatalog.js';
import { catalogFromWire } from '../src/board/workflowCatalog.js';

afterEach(() => { document.body.innerHTML = ''; });

function occ(s: string, sub: string): number {
  return s.split(sub).length - 1;
}

// slash-catalog: a "Start work" row is a catalog entry, named by its title, its outcome on the line.
const wf = catalogRows(catalogFromWire({
  categories: [{ id: 'create', title: 'Create' }],
  entries: [{ id: 'feature', category: 'create', title: 'Build a feature', outcome: 'A pull request with the change', status: 'available', launch: { kind: 'run', workflow: 'feature' } }],
}), '', 0);

const slash: SlashItem[] = [
  { command: { cmd: 'test', word: 'Test', line: 'checks and their results', catalog: 'test', refuse: null }, refused: null },
];

const slashRefused: SlashItem[] = [
  { command: { cmd: 'test', word: 'Test', line: 'checks and their results', catalog: 'test', refuse: null }, refused: 'No test step in this engine.' },
];

const ats: AtItem[] = [
  { kind: 'project', id: 'proj-1', label: 'my-project', line: 'the main project' },
];

describe('SlashMenu compact row layout', () => {
  // ── workflow rows ──────────────────────────────────────────────────────────────
  it('workflow row: the catalog title appears exactly once in textContent', () => {
    render(<SlashMenu menuKey="desk" trigger="/" startCommands wf={wf} slash={[]} ats={[]} active={0} catalogState="ready" anyWorkflows onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-cmd="workflow-feature"]')!;
    expect(occ(row.textContent ?? '', 'Build a feature')).toBe(1);
    expect(row.querySelector('b')?.textContent).toBe('Build a feature');
  });

  it('workflow row: description is in its own element with the line text', () => {
    render(<SlashMenu menuKey="desk" trigger="/" startCommands wf={wf} slash={[]} ats={[]} active={0} catalogState="ready" anyWorkflows onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-cmd="workflow-feature"]')!;
    const desc = row.querySelector('small');
    expect(desc?.textContent).toBe('A pull request with the change');
  });

  it('workflow row: title carries the line', () => {
    render(<SlashMenu menuKey="desk" trigger="/" startCommands wf={wf} slash={[]} ats={[]} active={0} catalogState="ready" anyWorkflows onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-cmd="workflow-feature"]') as HTMLButtonElement;
    expect(row.title).toBe('A pull request with the change');
  });

  // ── add-step rows ─────────────────────────────────────────────────────────────
  it('add-step row: cmd appears exactly once in textContent (not duplicated as word)', () => {
    render(<SlashMenu menuKey="desk" trigger="/" startCommands={false} wf={[]} slash={slash} ats={[]} active={0} catalogState="ready" anyWorkflows={false} onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-cmd="test"]')!;
    expect(occ((row.textContent ?? '').toLowerCase(), 'test')).toBe(1);
  });

  it('add-step row: description is in its own element', () => {
    render(<SlashMenu menuKey="desk" trigger="/" startCommands={false} wf={[]} slash={slash} ats={[]} active={0} catalogState="ready" anyWorkflows={false} onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-cmd="test"]')!;
    expect(row.querySelector('small')?.textContent).toBe('checks and their results');
  });

  it('add-step row: title carries the line', () => {
    render(<SlashMenu menuKey="desk" trigger="/" startCommands={false} wf={[]} slash={slash} ats={[]} active={0} catalogState="ready" anyWorkflows={false} onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-cmd="test"]') as HTMLButtonElement;
    expect(row.title).toBe('checks and their results');
  });

  it('refused add-step row: title carries the refusal reason', () => {
    render(<SlashMenu menuKey="desk" trigger="/" startCommands={false} wf={[]} slash={slashRefused} ats={[]} active={0} catalogState="ready" anyWorkflows={false} onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-cmd="test"]') as HTMLButtonElement;
    expect(row.title).toBe('No test step in this engine.');
    expect(row.querySelector('small')?.textContent).toBe('No test step in this engine.');
  });

  // ── @ rows ────────────────────────────────────────────────────────────────────
  it('@ row: label appears exactly once in textContent', () => {
    render(<SlashMenu menuKey="desk" trigger="@" startCommands={false} wf={[]} slash={[]} ats={ats} active={0} catalogState="ready" anyWorkflows={false} onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-kind="project"]')!;
    expect(occ((row.textContent ?? '').toLowerCase(), 'my-project')).toBe(1);
  });

  it('@ row: description is in its own element', () => {
    render(<SlashMenu menuKey="desk" trigger="@" startCommands={false} wf={[]} slash={[]} ats={ats} active={0} catalogState="ready" anyWorkflows={false} onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-kind="project"]')!;
    expect(row.querySelector('small')?.textContent).toBe('the main project');
  });

  it('@ row: title carries the line', () => {
    render(<SlashMenu menuKey="desk" trigger="@" startCommands={false} wf={[]} slash={[]} ats={ats} active={0} catalogState="ready" anyWorkflows={false} onPickWorkflow={() => {}} />);
    const row = document.querySelector('[data-kind="project"]') as HTMLButtonElement;
    expect(row.title).toBe('the main project');
  });
});
