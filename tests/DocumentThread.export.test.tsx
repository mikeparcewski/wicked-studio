// Exports IN the transcript — DES-MERGE-001 §4.4, §2.5, §3.3, §6.4 slice 15.
//
// §4.4's merged-UI change is a rendering claim as much as a wire one: a completed export
// is an ordinary message that happens to carry a download, and a refused one is an
// ACTIONABLE message that carries the fix and the control that runs it. Both are asserted
// here against the real thread, because the transcript is where a user goes looking for
// an artifact they asked for an hour ago.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentThread } from '../src/components/DocumentThread.js';
import { runExport } from '../src/interactive/exportWire.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';

const postExport = vi.fn();

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
  createDoc: vi.fn(),
  postFork: vi.fn(),
  postEvent: vi.fn(),
  getVersions: vi.fn(),
  injectDocMessage: vi.fn(),
  postExport: (...a: unknown[]) => postExport(...a),
  ServiceHintError,
  interactiveUrl: (p: string, path: string) => `/api/v1/projects/${p}/interactive${path}`,
}));

const PROJECT = 'proj-abc';
const DOC = 'launch-deck';
const KEY = threadKey(PROJECT, DOC);
const PPTX_HINT = 'pip install python-pptx (PPTX export needs it; HTML and PDF do not)';

function mount(): void {
  render(
    <DocumentThread projectId={PROJECT} docId={DOC} selectedVersion={3} navigate={() => {}} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocThreadStore.setState({ messages: {}, genState: {}, anchor: {}, landed: {} });
});
afterEach(cleanup);

describe('a completed export renders as a download (§4.4, §2.5)', () => {
  it('AC: the link is served THROUGH the proxy and saves under `<doc-slug>_v<N>.<ext>`', async () => {
    postExport.mockResolvedValue({
      format: 'pdf', path: '/exports/launch-deck_v3.pdf', file: 'launch-deck_v3.pdf',
      download: '/d/launch-deck/download/launch-deck_v3.pdf',
    });
    await runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pdf' });
    mount();

    const link = screen.getByTestId('doc-artifact-download');
    expect(link).toHaveAttribute(
      'href', `/api/v1/projects/${PROJECT}/interactive/d/launch-deck/download/launch-deck_v3.pdf`,
    );
    expect(link).toHaveAttribute('download', 'launch-deck_v3.pdf');
    // The line above it says which format and which file, in the service's name (§2.5).
    expect(screen.getByTestId('doc-agent')).toHaveTextContent('PDF export ready — launch-deck_v3.pdf');
    expect(screen.getByTestId('doc-agent')).toHaveTextContent('export');
  });

  it('the in-flight line is on screen while it renders, naming its subject (§3.3)', async () => {
    postExport.mockImplementation(() => new Promise(() => {}));  // never settles
    void runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pdf' });
    mount();

    const narration = screen.getByTestId('doc-narration');
    expect(narration).toHaveTextContent('Exporting “launch-deck” v3 as PDF');
    expect(narration).not.toHaveTextContent(/^Working…?$/);
  });
});

describe('PPTX with python-pptx absent (§4.4, §3.3)', () => {
  beforeEach(() => {
    postExport.mockRejectedValue(new ServiceHintError('API 400: pptx export unavailable', PPTX_HINT));
  });

  it('AC: the install command is rendered VERBATIM and the doc stays interactive', async () => {
    await runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pptx' });
    mount();

    expect(screen.getByTestId('doc-actionable-hint')).toHaveTextContent(PPTX_HINT);
    expect(screen.getByTestId('doc-actionable')).toHaveTextContent('still editable');
    // "The doc stays usable": the composer is live, so the next ask still lands.
    expect(screen.getByTestId('doc-composer')).toBeEnabled();
    expect(screen.getByTestId('thread')).toHaveAttribute('data-composer-state', 'terminal');
    expect(screen.queryByTestId('doc-artifact-download')).toBeNull();
  });

  it('AC: the retry beside it re-runs the SAME format at the SAME version', async () => {
    await runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pptx' });
    mount();
    postExport.mockResolvedValue({
      format: 'pptx', path: '/exports/launch-deck_v3.pptx', file: 'launch-deck_v3.pptx',
      download: '/d/launch-deck/download/launch-deck_v3.pptx',
    });

    await userEvent.setup().click(screen.getByTestId('doc-actionable-retry'));

    await waitFor(() => expect(postExport).toHaveBeenLastCalledWith(PROJECT, DOC, 3, 'pptx'));
    await waitFor(() => expect(screen.getByTestId('doc-artifact-download'))
      .toHaveAttribute('download', 'launch-deck_v3.pptx'));
    // The failure stays in the transcript: it is what happened, and it is why the retry exists.
    expect(useDocThreadStore.getState().messages[KEY]?.filter((m) => m.kind === 'actionable'))
      .toHaveLength(1);
  });
});
