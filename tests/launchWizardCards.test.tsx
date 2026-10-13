/**
 * The New job cards (operator 2026-10-12): the wizard's first step is a grid of cards — one per kind
 * of job it offers (the catalog's order, then Draft epics), each with a decorative drawing, its name
 * and its one-line purpose. Arrow keys move across the grid; a pick lands on that job's first step.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDef } from '../src/api/types.js';
import { LaunchWizard } from '../src/components/launch/LaunchWizard.js';
import { openLaunchWizard, resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { clearCachedWorkflows, setCachedWorkflows } from '../src/store/workflowCache.js';
import { workflowPurpose } from '../src/board/workflowPurpose.js';

const def = (id: string, phases: string[], extra: Partial<WorkflowDef> = {}): WorkflowDef =>
  ({ id, phases: phases.map((p) => ({ id: p, executes_code: true })), ...extra }) as unknown as WorkflowDef;
const WF = [
  def('bug', ['triage', 'reproduce', 'fix', 'verify']),
  def('chat', ['explore'], { is_system: true } as Partial<WorkflowDef>),
  def('feature', ['clarify', 'design', 'build']),
  def('qe-author-tests', ['recon', 'author', 'verify', 'review']),
  def('acme-release', ['tag', 'publish']),
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))));
  resetPlanCatalog();
  clearCachedWorkflows();
  setCachedWorkflows(WF);
  resetLaunchWizard();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const cardIds = (): string[] =>
  within(screen.getByTestId('launch-wizard-cards')).getAllByRole('button').map((b) => b.dataset.testid!.replace('launch-wizard-workflow-', ''));

describe('the New job cards', () => {
  it('one card per kind of job, in the catalog order, then Draft epics; no system workflow', () => {
    render(<LaunchWizard />);
    act(() => openLaunchWizard({}));
    expect(cardIds()).toEqual(['bug', 'feature', 'qe-author-tests', 'acme-release', 'draft-epics']);
  });

  it('each card has a decorative drawing, its name and its purpose; an unknown workflow gets the neutral drawing and its phases', () => {
    render(<LaunchWizard />);
    act(() => openLaunchWizard({}));
    const bug = screen.getByTestId('launch-wizard-workflow-bug');
    expect(bug).toHaveTextContent('Bug');
    expect(bug).toHaveTextContent(workflowPurpose('bug', ''));
    expect(bug.dataset.art).toBe('bug');
    const svg = bug.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelector('image, use[href^="http"]')).toBeNull();
    expect(screen.getByTestId('launch-wizard-workflow-qe-author-tests')).toHaveTextContent('Write tests');
    const custom = screen.getByTestId('launch-wizard-workflow-acme-release');
    expect(custom.dataset.art).toBe('fallback');
    expect(custom).toHaveTextContent('Acme release');
    expect(custom).toHaveTextContent('2 phases: tag → publish');
    expect(screen.getByTestId('launch-wizard-workflow-draft-epics').dataset.art).toBe('draft-epics');
    // The accessible name is the words, not the drawing.
    expect(bug.textContent).toBe(`Bug${workflowPurpose('bug', '')}`);
  });

  it('every card lands on its job’s first step (DEST)', () => {
    render(<LaunchWizard />);
    for (const [id, step, title] of [
      ['bug', 'what', 'New job: Bug'], ['feature', 'what', 'New job: Feature'], ['qe-author-tests', 'what', 'New job: Write tests'],
      ['acme-release', 'what', 'New job: Acme release'], ['draft-epics', 'requirements', 'New job: Draft epics'],
    ] as const) {
      act(() => resetLaunchWizard());
      act(() => openLaunchWizard({}));
      fireEvent.click(screen.getByTestId(`launch-wizard-workflow-${id}`));
      expect(screen.getByTestId('launch-wizard-step')).toHaveAttribute('data-step', step);
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(title);
      expect(useLaunchWizard.getState().draft?.workflowId).toBe(id);
    }
  });

  it('arrow keys move across the grid as laid out; Home and End go to the ends', () => {
    // jsdom lays nothing out: place the cards 2 across.
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      const sib = this.parentElement === null ? [] : [...this.parentElement.children];
      return Math.floor(sib.indexOf(this) / 2) * 100;
    });
    try {
      render(<LaunchWizard />);
      act(() => openLaunchWizard({}));
      const grid = screen.getByTestId('launch-wizard-cards');
      const focused = (): string | undefined => (document.activeElement as HTMLElement | null)?.dataset.testid?.replace('launch-wizard-workflow-', '');
      expect(focused()).toBe('bug');
      fireEvent.keyDown(grid, { key: 'ArrowRight' });
      expect(focused()).toBe('feature');
      fireEvent.keyDown(grid, { key: 'ArrowDown' });
      expect(focused()).toBe('acme-release');
      fireEvent.keyDown(grid, { key: 'ArrowLeft' });
      expect(focused()).toBe('qe-author-tests');
      fireEvent.keyDown(grid, { key: 'ArrowUp' });
      expect(focused()).toBe('bug');
      // codex r1: Up from the top row stays put (never a sideways move).
      fireEvent.keyDown(grid, { key: 'ArrowRight' });
      fireEvent.keyDown(grid, { key: 'ArrowUp' });
      expect(focused()).toBe('feature');
      // Down into the shorter last row lands on its last card; Down from the bottom row stays.
      fireEvent.keyDown(grid, { key: 'ArrowDown' });
      fireEvent.keyDown(grid, { key: 'ArrowDown' });
      expect(focused()).toBe('draft-epics');
      fireEvent.keyDown(grid, { key: 'ArrowLeft' });
      expect(focused()).toBe('acme-release');
      fireEvent.keyDown(grid, { key: 'ArrowRight' });
      fireEvent.keyDown(grid, { key: 'End' });
      expect(focused()).toBe('draft-epics');
      fireEvent.keyDown(grid, { key: 'ArrowDown' });
      expect(focused()).toBe('draft-epics');
      fireEvent.keyDown(grid, { key: 'Home' });
      expect(focused()).toBe('bug');
    } finally {
      spy.mockRestore();
    }
  });

  it('Change job comes back to the grid with the picked card focused and pressed', () => {
    render(<LaunchWizard />);
    act(() => openLaunchWizard({ workflowId: 'feature' }));
    fireEvent.click(screen.getByTestId('launch-wizard-change'));
    const feature = screen.getByTestId('launch-wizard-workflow-feature');
    expect(feature).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(feature);
  });

  it('a card the user moved to keeps its focus when more of the catalog arrives (codex r1)', () => {
    clearCachedWorkflows();
    render(<LaunchWizard />);
    act(() => openLaunchWizard({}));
    // Only Draft epics until the catalog is read; the wizard focuses it.
    expect(cardIds()).toEqual(['draft-epics']);
    act(() => setCachedWorkflows(WF));
    // The catalog arrived while focus was where the wizard put it: focus moves to the first card.
    expect((document.activeElement as HTMLElement).dataset.testid).toBe('launch-wizard-workflow-bug');
    act(() => screen.getByTestId('launch-wizard-workflow-feature').focus());
    act(() => setCachedWorkflows([...WF, def('acme-docs', ['write'])]));
    expect(cardIds()).toContain('acme-docs');
    expect((document.activeElement as HTMLElement).dataset.testid).toBe('launch-wizard-workflow-feature');
  });
});
