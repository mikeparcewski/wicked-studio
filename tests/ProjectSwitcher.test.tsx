import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '../src/api/types.js';
import { ProjectSwitcher } from '../src/components/ProjectSwitcher.js';

/**
 * The shared project switcher (DES-FEEDBACK-001 §5.2, built in slice A for
 * slice B): compact field showing the current binding (Unfiled default),
 * opening to filter + Unfiled + project list + "+ New project"; `locked`
 * (§4.3 pre-bound surfaces) renders the value and refuses to open.
 */

afterEach(cleanup);

function proj(id: string, name: string): Project {
  return {
    id, name, description: null, status: 'active',
    scope: `project:${id}`, created_at: 1, updated_at: 1,
  };
}

const PROJECTS = [proj('p1', 'api-migration'), proj('p2', 'q3-review-deck'), proj('default', 'Unfiled')];

describe('ProjectSwitcher', () => {
  it('defaults to Unfiled and opens the list on click', () => {
    render(<ProjectSwitcher current={null} projects={PROJECTS} onSelect={() => {}} />);
    const field = screen.getByTestId('project-field');
    expect(field.textContent).toContain('Unfiled');
    expect(field.dataset.locked).toBe('false');
    expect(screen.queryByTestId('project-switcher-list')).toBeNull();

    fireEvent.click(field);
    expect(screen.getByTestId('project-switcher-list')).toBeInTheDocument();
    // The synthesized default never renders as a project row (F5) — Unfiled is
    // its own dedicated entry.
    const rows = screen.getAllByTestId('project-switcher-option');
    expect(rows.map((r) => r.dataset.projectId)).toEqual(['p1', 'p2']);
    expect(screen.getByTestId('project-switcher-unfiled')).toBeInTheDocument();
  });

  it('selects a project — and Unfiled means null (no project_id in the POST)', () => {
    const onSelect = vi.fn();
    render(<ProjectSwitcher current={null} projects={PROJECTS} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('project-field'));
    fireEvent.click(screen.getAllByTestId('project-switcher-option')[1]!);
    expect(onSelect).toHaveBeenCalledWith('p2');

    fireEvent.click(screen.getByTestId('project-field'));
    fireEvent.click(screen.getByTestId('project-switcher-unfiled'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('shows the bound project name and filters the list', () => {
    render(<ProjectSwitcher current={PROJECTS[0]!} projects={PROJECTS} onSelect={() => {}} />);
    expect(screen.getByTestId('project-field').textContent).toContain('api-migration');
    fireEvent.click(screen.getByTestId('project-field'));
    fireEvent.change(screen.getByPlaceholderText('filter projects…'), { target: { value: 'q3' } });
    const rows = screen.getAllByTestId('project-switcher-option');
    expect(rows.map((r) => r.dataset.projectId)).toEqual(['p2']);
  });

  it('renders "+ New project" only when a handler is given, and calls it', () => {
    const { unmount } = render(<ProjectSwitcher current={null} projects={PROJECTS} onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId('project-field'));
    expect(screen.queryByTestId('project-switcher-add')).toBeNull();
    unmount();

    const onNewProject = vi.fn();
    render(<ProjectSwitcher current={null} projects={PROJECTS} onSelect={() => {}} onNewProject={onNewProject} />);
    fireEvent.click(screen.getByTestId('project-field'));
    fireEvent.click(screen.getByTestId('project-switcher-add'));
    expect(onNewProject).toHaveBeenCalled();
    expect(screen.queryByTestId('project-switcher-list')).toBeNull();
  });

  it('locked (§4.3): shows the binding with data-locked and refuses to open', () => {
    render(<ProjectSwitcher current={PROJECTS[0]!} projects={PROJECTS} onSelect={() => {}} locked />);
    const field = screen.getByTestId('project-field');
    expect(field.dataset.locked).toBe('true');
    fireEvent.click(field);
    expect(screen.queryByTestId('project-switcher-list')).toBeNull();
  });

  it('onOpen fires when the dropdown OPENS — never on mount, never on close (slice B lazy-load)', () => {
    const onOpen = vi.fn();
    render(<ProjectSwitcher current={null} projects={PROJECTS} onSelect={() => {}} onOpen={onOpen} />);
    expect(onOpen, 'mount must not open').not.toHaveBeenCalled();

    const field = screen.getByTestId('project-field');
    fireEvent.click(field); // open
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(field); // close
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(field); // re-open
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('locked never fires onOpen (slice B: a pre-bound field costs no fetch)', () => {
    const onOpen = vi.fn();
    render(<ProjectSwitcher current={PROJECTS[0]!} projects={PROJECTS} onSelect={() => {}} locked onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('project-field'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('dropUp opens the list above the field (bottom-docked composers)', () => {
    render(<ProjectSwitcher current={null} projects={PROJECTS} onSelect={() => {}} dropUp />);
    fireEvent.click(screen.getByTestId('project-field'));
    const list = screen.getByTestId('project-switcher-list');
    expect(list.className).toContain('bottom-full');
    expect(list.className).not.toContain('top-full');
  });
});
