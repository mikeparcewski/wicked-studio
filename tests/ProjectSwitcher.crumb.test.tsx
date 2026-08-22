import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '../src/api/types.js';
import { ProjectSwitcher } from '../src/components/ProjectSwitcher.js';

/**
 * The crumb variant + the keyboard repair (DES-FEEDBACK-002 §4, slice J):
 * `variant="crumb"` is the context header's dress — same behavior, breadcrumb
 * typography, NO Unfiled row (a pivot between projects, not a binding field),
 * the current project checked, an optional real-link dashboard row. The
 * keyboard repair benefits EVERY call site: arrows move real DOM focus among
 * the rows (EC22), Escape closes and restores the trigger.
 */

afterEach(cleanup);

function proj(id: string, name: string): Project {
  return {
    id, name, description: null, status: 'active',
    scope: `project:${id}`, created_at: 1, updated_at: 1,
  };
}

const PROJECTS = [proj('p1', 'api-migration'), proj('p2', 'q3-review-deck'), proj('default', 'Unfiled')];

function renderCrumb(over: Partial<Parameters<typeof ProjectSwitcher>[0]> = {}) {
  const onSelect = vi.fn();
  const onGo = vi.fn();
  const utils = render(
    <ProjectSwitcher
      variant="crumb"
      triggerTestId="project-name"
      current={PROJECTS[0] as Project}
      projects={PROJECTS}
      onSelect={onSelect}
      dashboard={{ href: '/p/p1', onGo }}
      {...over}
    />,
  );
  return { onSelect, onGo, ...utils };
}

describe('variant="crumb" (§4.2)', () => {
  it('the trigger wears the crumb testid and the CRUMB type spec; clicking opens the list', () => {
    renderCrumb();
    const trigger = screen.getByTestId('project-name');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.style.fontSize).toBe('var(--text-sm)');
    expect(trigger.style.fontWeight).toBe('var(--weight-medium)');
    expect(trigger.style.color).toBe('var(--ink-muted)');
    expect(trigger.textContent).toContain('api-migration');
    fireEvent.click(trigger);
    expect(screen.getByTestId('project-switcher-list')).toBeInTheDocument();
  });

  it('renders NO Unfiled row — a pivot between projects, not a binding field', () => {
    renderCrumb();
    fireEvent.click(screen.getByTestId('project-name'));
    expect(screen.queryByTestId('project-switcher-unfiled')).toBeNull();
    // And no "+ New project" — onNewProject is simply not passed by the header.
    expect(screen.queryByTestId('project-switcher-add')).toBeNull();
  });

  it('the current project renders with the ✓ and aria-selected', () => {
    renderCrumb();
    fireEvent.click(screen.getByTestId('project-name'));
    const rows = screen.getAllByTestId('project-switcher-option');
    const current = rows.find((r) => r.dataset.projectId === 'p1') as HTMLElement;
    expect(current.getAttribute('aria-selected')).toBe('true');
    expect(current.textContent).toContain('✓');
    const other = rows.find((r) => r.dataset.projectId === 'p2') as HTMLElement;
    expect(other.textContent).not.toContain('✓');
  });

  it('the dashboard row is a REAL link that closes and navigates', () => {
    const { onGo } = renderCrumb();
    fireEvent.click(screen.getByTestId('project-name'));
    const row = screen.getByTestId('switcher-dashboard-row');
    expect(row.tagName).toBe('A');
    expect(row).toHaveAttribute('href', '/p/p1');
    fireEvent.click(row);
    expect(onGo).toHaveBeenCalled();
    expect(screen.queryByTestId('project-switcher-list')).toBeNull();
  });

  it('the field variant is untouched: Unfiled row present, no dashboard row unless passed', () => {
    render(
      <ProjectSwitcher current={null} projects={PROJECTS} onSelect={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('project-field'));
    expect(screen.getByTestId('project-switcher-unfiled')).toBeInTheDocument();
    expect(screen.queryByTestId('switcher-dashboard-row')).toBeNull();
  });
});

describe('the keyboard repair (§4.3, EC22 — every call site)', () => {
  it('ArrowDown walks real DOM focus down the rows; ArrowUp walks back', () => {
    renderCrumb();
    fireEvent.click(screen.getByTestId('project-name'));
    const list = screen.getByTestId('project-switcher-list');
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.wk-switcher-row'));
    expect(rows.length).toBe(3); // p1, p2, dashboard row

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);
    // Clamped at the end.
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[1]);
  });

  it('Escape closes the list and restores focus to the trigger', () => {
    renderCrumb();
    const trigger = screen.getByTestId('project-name');
    fireEvent.click(trigger);
    const list = screen.getByTestId('project-switcher-list');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.queryByTestId('project-switcher-list')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('a focused row activates on Enter (native button) — selecting a sibling pivots', () => {
    const { onSelect } = renderCrumb();
    fireEvent.click(screen.getByTestId('project-name'));
    const list = screen.getByTestId('project-switcher-list');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    // jsdom does not synthesize click from Enter on buttons — assert the row
    // is a real <button> (Enter-activatable) and click it as the activation.
    const focused = document.activeElement as HTMLElement;
    expect(focused.tagName).toBe('BUTTON');
    fireEvent.click(focused);
    expect(onSelect).toHaveBeenCalledWith('p2');
  });
});
