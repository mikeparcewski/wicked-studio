import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The new-project flow (DES-FEEDBACK-001 §1.3, slice A): the 360×280 overlay
 * off QUICK's Project action. Name is slug-validated CLIENT-side (the daemon's
 * z-schema accepts any 1–120 chars — verified against crew projects/routes.ts —
 * so the regex is the UX gate, "no silent 400"); Create POSTs {name,
 * description?} and navigates into the chosen start mode; Escape/✕/Cancel close.
 */

const createProject = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: { createProject: (body: unknown) => createProject(body) },
}));

const { NewProjectModal, PROJECT_NAME_RE, startPath } = await import('../src/components/NewProjectModal.js');

beforeEach(() => {
  createProject.mockReset();
  createProject.mockResolvedValue({ project: { id: 'proj_1', name: 'api migration' } });
});
afterEach(cleanup);

describe('PROJECT_NAME_RE (§1.3 slug rule)', () => {
  it('accepts lowercase slugs with spaces, dashes, underscores (max 64)', () => {
    for (const ok of ['a', 'api migration', 'q3-deck', 'x_1', 'a'.repeat(64)]) {
      expect(PROJECT_NAME_RE.test(ok)).toBe(true);
    }
  });
  it('rejects uppercase, leading separators, empties and overlong names', () => {
    for (const bad of ['', 'API', '-lead', ' lead', 'ümlaut', 'a'.repeat(65)]) {
      expect(PROJECT_NAME_RE.test(bad)).toBe(false);
    }
  });
});

describe('startPath', () => {
  it('maps the start modes onto their shells; Empty lands on the project page', () => {
    expect(startPath('p1', 'build')).toBe('/p/p1/build');
    expect(startPath('p1', 'chat')).toBe('/p/p1/chat');
    expect(startPath('p1', 'document')).toBe('/p/p1/document');
    expect(startPath('p1', 'empty')).toBe('/projects/p1');
  });
});

describe('NewProjectModal', () => {
  it('renders the §1.3 anatomy: name, start radio (Build default), description, actions', () => {
    render(<NewProjectModal navigate={() => {}} onClose={() => {}} />);
    const modal = screen.getByTestId('new-project-modal');
    expect(modal.style.width).toBe('360px');
    expect(modal.style.borderRadius).toBe('var(--radius-xl)');
    expect(modal.style.boxShadow).toBe('var(--shadow-overlay)');
    expect(screen.getByTestId('new-project-name')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Build' })).toBeChecked();
    for (const label of ['Empty', 'Chat', 'Document']) {
      expect(screen.getByRole('radio', { name: label })).not.toBeChecked();
    }
    expect(screen.getByTestId('new-project-description')).toBeInTheDocument();
    expect(screen.getByTestId('new-project-create')).toBeDisabled();
  });

  it('gates Create on the client-side slug rule — the UX gate, no silent 400', () => {
    render(<NewProjectModal navigate={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'Not A Slug!' } });
    expect(screen.getByTestId('new-project-name-invalid')).toBeInTheDocument();
    expect(screen.getByTestId('new-project-create')).toBeDisabled();
    fireEvent.click(screen.getByTestId('new-project-create'));
    expect(createProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'api migration' } });
    expect(screen.queryByTestId('new-project-name-invalid')).toBeNull();
    expect(screen.getByTestId('new-project-create')).toBeEnabled();
  });

  it('Create POSTs {name, description?} and navigates into the chosen mode', async () => {
    const navigate = vi.fn();
    const onClose = vi.fn();
    render(<NewProjectModal navigate={navigate} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'api migration' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Chat' }));
    fireEvent.click(screen.getByTestId('new-project-create'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/p/proj_1/chat'));
    // The wire shape is crew's CreateProjectBody: description omitted when blank.
    expect(createProject).toHaveBeenCalledWith({ name: 'api migration' });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the trimmed description only when one was typed', async () => {
    const navigate = vi.fn();
    render(<NewProjectModal navigate={navigate} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'q3-deck' } });
    fireEvent.change(screen.getByTestId('new-project-description'), { target: { value: '  the deck  ' } });
    fireEvent.click(screen.getByTestId('new-project-create'));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(createProject).toHaveBeenCalledWith({ name: 'q3-deck', description: 'the deck' });
  });

  it('surfaces the API error (409 name collision) instead of closing', async () => {
    createProject.mockRejectedValue(new Error('API 409: name collides with an active project'));
    const onClose = vi.fn();
    render(<NewProjectModal navigate={() => {}} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'api migration' } });
    fireEvent.click(screen.getByTestId('new-project-create'));
    await screen.findByTestId('new-project-error');
    expect(screen.getByTestId('new-project-error').textContent).toContain('409');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape, on ✕ and on Cancel', () => {
    for (const close of [
      () => fireEvent.keyDown(document, { key: 'Escape' }),
      () => fireEvent.click(screen.getByTestId('new-project-close')),
      () => fireEvent.click(screen.getByTestId('new-project-cancel')),
    ]) {
      const onClose = vi.fn();
      const { unmount } = render(<NewProjectModal navigate={() => {}} onClose={onClose} />);
      close();
      expect(onClose).toHaveBeenCalledTimes(1);
      unmount();
    }
  });
});
