import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The new-project flow (DES-FEEDBACK-001 §1.3, slice A): the 360×280 overlay
 * off QUICK's Project action. Name is slug-validated CLIENT-side (the daemon's
 * z-schema accepts any 1–120 chars — verified against crew projects/routes.ts —
 * so the regex is the UX gate, "no silent 400"); Create POSTs {name,
 * description?} and navigates into the chosen start mode; Escape/✕/Cancel close.
 */

const createProject = vi.fn();
const attachProjectMember = vi.fn();
const listRepos = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: { createProject: (body: unknown) => createProject(body), attachProjectMember: (...args: unknown[]) => attachProjectMember(...args), listRepos: () => listRepos() },
}));

const { NewProjectModal } = await import('../src/components/NewProjectModal.js');
const { projectNameProblem } = await import('../src/board/projectName.js');

beforeEach(() => {
  createProject.mockReset();
  createProject.mockResolvedValue({ project: { id: 'proj_1', name: 'api migration' } });
  attachProjectMember.mockReset().mockResolvedValue({ member: { id: 'm1' } });
  listRepos.mockReset().mockResolvedValue({ repos: [{ id: 'repo-1', name: 'Studio API' }] });
});
afterEach(cleanup);

describe('one project-name rule, the daemon\'s (studio#463)', () => {
  it('accepts every name the daemon and the Projects page accept — capitals, punctuation, 1–120 chars', () => {
    for (const ok of ['a', 'api migration', 'Team offsite 2', 'Recipe cards', 'Q3: the deck!', 'ümlaut', 'a'.repeat(120), '  padded  ']) {
      expect(projectNameProblem(ok)).toBeNull();
    }
  });
  it('refuses only an empty or overlong name, and says why', () => {
    expect(projectNameProblem('')).toBe('A project needs a name.');
    expect(projectNameProblem('   ')).toBe('A project needs a name.');
    expect(projectNameProblem('a'.repeat(121))).toBe('Keep the name to 120 characters.');
  });
  it('the modal creates "Team offsite 2" as typed (trimmed)', async () => {
    const navigate = vi.fn();
    render(<NewProjectModal navigate={navigate} onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: ' Team offsite 2 ' } });
    expect(screen.queryByTestId('new-project-name-invalid')).toBeNull();
    expect(screen.getByTestId('new-project-create')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('new-project-create'));
    await waitFor(() => expect(createProject).toHaveBeenCalledWith({ name: 'Team offsite 2' }));
  });
});

describe('Desk project door', () => {
  it('hides Start with and lands on scoped Sessions after creation and repository attachment', async () => {
    const navigate = vi.fn();
    render(<NewProjectModal deskMode navigate={navigate} onClose={() => undefined} />);
    expect(screen.queryByTestId('new-project-start')).toBeNull();
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'api migration' } });
    const repo = await screen.findByTestId('new-project-repo');
    fireEvent.change(repo, { target: { value: 'repo-1' } });
    fireEvent.click(screen.getByTestId('new-project-create'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/everything?tab=sessions&project=proj_1'));
    expect(createProject).toHaveBeenCalledWith({ name: 'api migration' });
    expect(attachProjectMember).toHaveBeenCalledWith('proj_1', { kind: 'crew.repo', ref: 'repo-1', attachedBy: 'studio' });
  });

  it('retries attachment without creating a duplicate project', async () => {
    attachProjectMember.mockRejectedValueOnce(new Error('attach refused'));
    render(<NewProjectModal deskMode navigate={() => undefined} onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'api migration' } });
    fireEvent.change(await screen.findByTestId('new-project-repo'), { target: { value: 'repo-1' } });
    fireEvent.click(screen.getByTestId('new-project-create'));
    const retry = await screen.findByTestId('new-project-attach-retry');
    expect(screen.getByTestId('new-project-error').textContent).toBe("The project was created, but the repository couldn't be attached.");
    expect(screen.getByTestId('new-project-error-detail')).toHaveTextContent('attach refused');
    expect(retry).toHaveTextContent('Retry attaching the repository');
    fireEvent.click(retry);
    await waitFor(() => expect(attachProjectMember).toHaveBeenCalledTimes(2));
    expect(createProject).toHaveBeenCalledTimes(1);
  });
});

describe('NewProjectModal', () => {
  it('renders the §1.3 anatomy: name, description, actions — no Start with (S16a-4f)', () => {
    render(<NewProjectModal navigate={() => {}} onClose={() => {}} />);
    const modal = screen.getByTestId('new-project-modal');
    // jsdom serialises min() oddly; the 360 px cap and the phone fit are what matter.
    expect(modal.style.width).toContain('360px');
    expect(modal.style.width).toContain('calc(100vw - 32px)');
    expect(modal.style.borderRadius).toBe('var(--radius-xl)');
    expect(modal.style.boxShadow).toBe('var(--shadow-overlay)');
    expect(screen.getByTestId('new-project-name')).toBeInTheDocument();
    expect(screen.queryByTestId('new-project-start')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByTestId('new-project-description')).toBeInTheDocument();
    expect(screen.getByTestId('new-project-create')).toBeDisabled();
  });

  it('uses the primary button style for Create project', () => {
    render(<NewProjectModal navigate={() => {}} onClose={() => {}} />);
    const create = screen.getByTestId('new-project-create');
    expect(create).toHaveClass('wk-btn', 'wk-btn--primary');
    expect(create).toHaveAttribute('type', 'submit');
    expect(create).toHaveTextContent(/^Create project$/);
  });

  it('submits once when Enter is pressed in the name field', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<NewProjectModal navigate={navigate} onClose={() => {}} />);
    await user.type(screen.getByTestId('new-project-name'), 'Team offsite{Enter}');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/everything?tab=sessions&project=proj_1'));
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith({ name: 'Team offsite' });
  });

  it('gates Create on the daemon\'s rule only — a blank name is refused, capitals and punctuation are not (studio#463)', () => {
    render(<NewProjectModal navigate={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: '   ' } });
    expect(screen.getByTestId('new-project-name-invalid')).toHaveTextContent('A project needs a name.');
    expect(screen.getByTestId('new-project-create')).toBeDisabled();
    fireEvent.click(screen.getByTestId('new-project-create'));
    expect(createProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'Not A Slug!' } });
    expect(screen.queryByTestId('new-project-name-invalid')).toBeNull();
    expect(screen.getByTestId('new-project-create')).toBeEnabled();
  });

  it('Create POSTs {name, description?} and lands on the project\'s Sessions (S16a-4f)', async () => {
    const navigate = vi.fn();
    const onClose = vi.fn();
    render(<NewProjectModal navigate={navigate} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'api migration' } });
    fireEvent.click(screen.getByTestId('new-project-create'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/everything?tab=sessions&project=proj_1'));
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

  it('shows a plain creation error with the raw API message only in technical details', async () => {
    const raw = 'API 409: name collides with an active project';
    createProject.mockRejectedValue(new Error(raw));
    const onClose = vi.fn();
    render(<NewProjectModal navigate={() => {}} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'api migration' } });
    fireEvent.click(screen.getByTestId('new-project-create'));
    const error = await screen.findByTestId('new-project-error');
    expect(error.textContent).toBe("Couldn't create the project.");
    expect(error).not.toHaveTextContent(raw);
    expect(error).toHaveClass('wk-field-note', 'wk-field-note--bad');
    const detail = screen.getByTestId('new-project-error-detail');
    expect(detail).toHaveTextContent(raw);
    expect(detail.tagName).toBe('DETAILS');
    expect(detail).not.toHaveAttribute('open');
    expect(error.nextElementSibling).toBe(detail);
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
