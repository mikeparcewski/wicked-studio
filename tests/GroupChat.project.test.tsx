import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';

/**
 * DES-FEEDBACK-001 slice B (§5.1/§5.2/§4.3) — the Chat create flow's project
 * binding, under the standing §2.4 constraint (zero requests on mount):
 *   - the standalone new-thread flow renders a ProjectSwitcher defaulting to
 *     Unfiled; the OPEN body carries no `projectId` key;
 *   - the project list loads on the dropdown's first OPEN (a user action),
 *     never on mount;
 *   - a selected project rides `projectId` on the open body;
 *   - inside the project shell (`projectId` prop) there is no switcher — the
 *     context IS the project — and the open body is bound silently.
 */

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();
const sendChatMessage = vi.fn();
const listProjects = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
  },
  wsBase: () => 'ws://localhost',
}));

vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: () => undefined,
}));

const ROSTER = [
  { key: 'claude', enabled_for_council: true },
  { key: 'codex', enabled_for_council: true },
];

const PROJECTS = [
  { id: 'q3-review-deck', name: 'q3-review-deck', description: null, status: 'active', scope: 'project:q3-review-deck', created_at: 1, updated_at: 9 },
  { id: 'api-migration', name: 'api-migration', description: null, status: 'active', scope: 'project:api-migration', created_at: 1, updated_at: 5 },
  { id: 'default', name: 'Unfiled', description: null, status: 'active', scope: '', created_at: 1, updated_at: 99 },
];

beforeEach(() => {
  openChat.mockReset();
  getChat.mockReset();
  closeChat.mockReset();
  getRoster.mockReset();
  sendChatMessage.mockReset();
  listProjects.mockReset();
  getRoster.mockResolvedValue({ roster: ROSTER });
  listProjects.mockResolvedValue({ projects: PROJECTS });
  openChat.mockImplementation((body: { chatId: string; clis?: string[] }) =>
    Promise.resolve({
      chatId: body.chatId,
      seats: (body.clis ?? ROSTER.map((s) => s.key)).map((cliKey) => ({ cliKey, ok: true })),
    }),
  );
  sendChatMessage.mockResolvedValue({ seats: [] });
  sessionStorage.clear();
});

describe('GroupChat — create-flow project binding (slice B)', () => {
  it('renders the Unfiled field, fetches nothing on mount, and opens the chat WITHOUT projectId', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    const field = screen.getByTestId('project-field');
    expect(field.textContent).toContain('Unfiled');
    // §2.4 preserved: the field's list is NOT fetched on mount.
    expect(listProjects).not.toHaveBeenCalled();
    expect(openChat).not.toHaveBeenCalled();
    expect(getRoster).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox'), 'hello there');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const body = openChat.mock.calls[0]![0] as Record<string, unknown>;
    expect('projectId' in body, 'Unfiled = no projectId key at all').toBe(false);
  });

  it('loads projects on first open, and the selection binds the chat at creation', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    await user.click(screen.getByTestId('project-field'));
    expect(listProjects).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getAllByTestId('project-switcher-option').length).toBe(2));
    // §5.2: "+ New project" rides the dropdown here too.
    expect(screen.getByTestId('project-switcher-add')).toBeInTheDocument();
    await user.click(screen.getAllByTestId('project-switcher-option')[0]!);
    expect(screen.getByTestId('project-field').textContent).toContain('q3-review-deck');

    await user.type(screen.getByRole('textbox'), 'file me properly');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]![0] as { projectId?: string }).projectId).toBe('q3-review-deck');

    // Once the chat exists the create-flow field is gone — binding is at creation.
    await waitFor(() => expect(screen.queryByTestId('chat-project-row')).toBeNull());
  });

  it('project shell (§4.3): no switcher UI, the open body is bound silently, still zero mount requests', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} projectId="api-migration" />);

    expect(screen.queryByTestId('project-field')).toBeNull();
    expect(listProjects).not.toHaveBeenCalled();
    expect(openChat).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox'), 'shell-bound thread');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]![0] as { projectId?: string }).projectId).toBe('api-migration');
  });
});
