// Export from the two surfaces the design puts it on — DES-MERGE-001 §4.4, §1.4, §6.4
// slice 15: per-version on Document mode's version strip, and as a quick action on the
// board card's doc tile. The wire underneath is REAL in these cases (only `postExport`
// is stubbed), because the claim being made is that pressing a control on either surface
// produces the same request and the same transcript.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectCard } from '../src/components/ProjectCard.js';
import { VersionStrip } from '../src/components/VersionStrip.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';

const postExport = vi.fn();
const postFork = vi.fn();

const { ServiceHintError } = vi.hoisted(() => ({
  ServiceHintError: class ServiceHintError extends Error {
    readonly hint: string;
    constructor(message: string, hint: string) {
      super(message);
      this.name = 'ServiceHintError';
      this.hint = hint;
    }
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  postExport: (...a: unknown[]) => postExport(...a),
  postFork: (...a: unknown[]) => postFork(...a),
  ServiceHintError,
}));

const PROJECT = 'proj-abc';
const DOC = 'roadmap';
const PPTX_HINT = 'pip install python-pptx and export again';

const MANIFEST = {
  head: 3,
  versions: [1, 2, 3].map((version) => ({
    version, parent: version - 1 || null, feedback_file: null,
    html_file: `v${version}.html`, created_at: `2026-08-1${version}T11:30:00Z`,
  })),
};

function reply(file: string, format = 'pdf'): Record<string, string> {
  return { format, path: `/exports/${file}`, file, download: `/d/${DOC}/download/${file}` };
}

function messages(docId = DOC): DocMsg[] {
  return useDocThreadStore.getState().messages[threadKey(PROJECT, docId)] ?? [];
}

function strip(selected = 3): void {
  render(
    <VersionStrip
      projectId={PROJECT}
      docId={DOC}
      manifest={MANIFEST}
      selected={selected}
      navigate={() => {}}
      onForked={() => {}}
    />,
  );
}

/** One board card carrying one document — §1.4's card, at the tile that owns the export. */
function card(): void {
  const item = {
    project: {
      id: PROJECT, name: 'Wicked', description: null, status: 'active',
      scope: `project:${PROJECT}`, created_at: 1, updated_at: 1,
    },
    repo: null,
    runs: [],
    docs: [{ name: DOC, kind: 'doc' as const, head: 3, versions: 3, updated_at: '2026-08-18T11:30:00Z' }],
    attention: 'drafts' as const,
  } as unknown as BoardProject;
  render(<ProjectCard item={item} navigate={() => {}} />);
}

/** Press one format button inside the menu on screen. */
async function press(format: string, scope?: HTMLElement): Promise<void> {
  const root = scope ?? screen.getByTestId('export-menu');
  const button = within(root).getAllByTestId('export-format')
    .find((b) => b.getAttribute('data-format') === format);
  await userEvent.setup().click(button as HTMLElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocThreadStore.setState({ messages: {}, genState: {}, anchor: {}, landed: {} });
  postExport.mockResolvedValue(reply('roadmap_v3.pdf'));
});
afterEach(cleanup);

describe('the version strip exports the SELECTED version (§4.4, §4.2)', () => {
  it('AC: all three formats are offered, per version', () => {
    strip();
    const menu = screen.getByTestId('export-menu');
    expect(menu).toHaveAttribute('data-version', '3');
    expect(within(menu).getAllByTestId('export-format').map((b) => b.getAttribute('data-format')))
      .toEqual(['html', 'pdf', 'pptx']);
  });

  it('exports the version the strip has selected, not the manifest head', async () => {
    strip(1);
    await press('pdf');
    await waitFor(() => expect(postExport).toHaveBeenCalledWith(PROJECT, DOC, 1, 'pdf'));
  });

  it('the artifact lands in the thread as a download — the strip itself reports nothing', async () => {
    strip();
    await press('html');
    postExport.mockResolvedValue(reply('roadmap_v3.html', 'html'));

    await waitFor(() => expect(messages().some((m) => m.kind === 'agent')).toBe(true));
    expect(screen.queryByTestId('export-hint')).toBeNull();
  });
});

describe('the board card exports without opening the document (§1.4, §4.4)', () => {
  it('AC: the doc tile offers export at that document’s head version', async () => {
    card();
    const menu = within(screen.getByTestId('doc-tile')).getByTestId('export-menu');
    expect(menu).toHaveAttribute('data-doc-id', DOC);
    expect(menu).toHaveAttribute('data-version', '3');

    await press('pdf', menu);
    await waitFor(() => expect(postExport).toHaveBeenCalledWith(PROJECT, DOC, 3, 'pdf'));
    // The transcript is still where it lands, even though no thread is on screen (§2.5).
    await waitFor(() => expect(messages()[1]).toMatchObject({ kind: 'agent', author: 'export' }));
  });

  it('AC: a refusal names its fix ON THE CARD, with the control that retries it adjacent', async () => {
    postExport.mockRejectedValue(new ServiceHintError('API 400: no python-pptx', PPTX_HINT));
    card();
    const menu = within(screen.getByTestId('doc-tile')).getByTestId('export-menu');

    await press('pptx', menu);

    await waitFor(() => expect(within(menu).getByTestId('export-hint')).toHaveTextContent(PPTX_HINT));
    // §3.3: the control is in the same block, so the retry is one press away.
    expect(within(menu).getAllByTestId('export-format')).toHaveLength(3);
    expect(within(menu).getAllByTestId('export-format')[2]).toBeEnabled();
  });
});
