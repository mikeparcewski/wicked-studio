// Exports as thread artifacts — DES-MERGE-001 §4.4, §2.5, §3.3, §6.4 slice 15.
//
// Two kinds of claim, matching the two things this wire is responsible for: the REQUEST
// SHAPE it sends (format × version, because a download is a thing you keep and "the
// latest" is not a version), and what lands in the TRANSCRIPT either way — the artifact
// when the service renders it, and the service's own install command when it cannot.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPORT_FORMATS, exportFilename, exportHint, exportSubject, runExport,
} from '../src/interactive/exportWire.js';
import { isFiller } from '../src/store/narration.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';

const postExport = vi.fn();

/** The real class, mirrored ONCE and shared with the mocked module: `exportHint` narrows
 *  on it, so a test that constructed a different class would pass for the wrong reason. */
const { ServiceHintError } = vi.hoisted(() => ({
  // Mirrors the real (status, wire, hint) ApiError shape (slice X2): the message
  // is the EC33 translated sentence, exactly what the layer would mint.
  ServiceHintError: class ServiceHintError extends Error {
    readonly hint: string;
    readonly status: number;
    readonly wire: string;
    constructor(status: number, wire: string, hint: string) {
      super(`the daemon refused this — ${wire}`);
      this.name = 'ServiceHintError';
      this.status = status;
      this.wire = wire;
      this.hint = hint;
    }
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  postExport: (...a: unknown[]) => postExport(...a),
  ServiceHintError,
}));

const PROJECT = 'proj-abc';
const DOC = 'launch-deck';
const KEY = threadKey(PROJECT, DOC);

/** §4.4's own words: missing python-pptx is a clean 400 with an install hint. */
const PPTX_HINT = 'pip install python-pptx (PPTX export needs it; HTML and PDF do not)';

function messages(): DocMsg[] {
  return useDocThreadStore.getState().messages[KEY] ?? [];
}

function reply(file: string): Record<string, string> {
  return { format: 'pdf', path: `/exports/${file}`, file, download: `/d/${DOC}/download/${file}` };
}

beforeEach(() => {
  useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {} });
  postExport.mockResolvedValue(reply('launch-deck_v3.pdf'));
});
afterEach(() => { vi.clearAllMocks(); });

// ── 1. Request shapes: format × version ──────────────────────────────────────

describe('the export request names both the format and the version (§4.4, §4.2)', () => {
  it('AC: every format is offered, and each posts its own format at the routed version', async () => {
    expect([...EXPORT_FORMATS]).toEqual(['html', 'pdf', 'pptx']);

    for (const format of EXPORT_FORMATS) {
      await runExport({ projectId: PROJECT, docId: DOC, version: 3, format });
    }

    expect(postExport.mock.calls).toEqual([
      [PROJECT, DOC, 3, 'html'],
      [PROJECT, DOC, 3, 'pdf'],
      [PROJECT, DOC, 3, 'pptx'],
    ]);
  });

  it('exports the version it was given, not the head — a rewound doc exports what is shown', async () => {
    await runExport({ projectId: PROJECT, docId: DOC, version: 1, format: 'pdf' });
    await runExport({ projectId: PROJECT, docId: DOC, version: 17, format: 'pdf' });

    expect(postExport.mock.calls.map((c) => c[2])).toEqual([1, 17]);
  });
});

// ── 2. Filename derivation (§4.4: doc-slug names, never `export_v17.*`) ──────

describe('filename derivation', () => {
  it('AC: `<doc-slug>_v<N>.<ext>` for every format', () => {
    expect(exportFilename('roadmap', 3, 'pdf')).toBe('roadmap_v3.pdf');
    expect(exportFilename('roadmap', 3, 'html')).toBe('roadmap_v3.html');
    expect(exportFilename('agent-harness', 17, 'pptx')).toBe('agent-harness_v17.pptx');
  });

  it('takes the SERVICE’s filename verbatim where it answered with one', () => {
    expect(exportFilename('roadmap', 3, 'pdf', 'roadmap-final_v3.pdf')).toBe('roadmap-final_v3.pdf');
    // Blank is not an answer — the service said nothing, so the derivation stands.
    expect(exportFilename('roadmap', 3, 'pdf', '   ')).toBe('roadmap_v3.pdf');
    expect(exportFilename('roadmap', 3, 'pdf', null)).toBe('roadmap_v3.pdf');
  });

  it('slugifies a name that never went through the registry, and never emits a bare `_v3`', () => {
    expect(exportFilename('Q3 Review Deck!', 3, 'pdf')).toBe('q3-review-deck_v3.pdf');
    expect(exportFilename('!!!', 3, 'pdf')).toBe('document_v3.pdf');
  });
});

// ── 3. What lands in the thread when it works (§2.5, §3.3) ──────────────────

describe('a completed export is an ordinary downloadable message (§2.5, §4.4)', () => {
  it('AC: the in-flight line is INFORMATIVE — it names the document, version and format', async () => {
    const subject = exportSubject(DOC, 3, 'pdf');
    expect(subject).toContain(DOC);
    expect(subject).toContain('v3');
    expect(subject).toContain('PDF');
    // §3.3's banned shape: this is never a bare `Working…`, in any casing.
    expect(isFiller(subject)).toBe(false);

    await runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pdf' });
    expect(messages()[0]).toMatchObject({ kind: 'narration', text: subject });
  });

  it('the in-flight line lands BEFORE the reply — progress, not a report after the fact', async () => {
    let release = (): void => {};
    postExport.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve(reply('launch-deck_v3.pdf'));
    }));

    const running = runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pdf' });
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ kind: 'narration' });

    release();
    await running;
    expect(messages()).toHaveLength(2);
  });

  it('the artifact is authored by the SERVICE and carries its download and filename', async () => {
    const outcome = await runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pdf' });

    expect(outcome).toMatchObject({ ok: true, file: 'launch-deck_v3.pdf' });
    expect(messages()[1]).toMatchObject({
      kind: 'agent', author: 'export',
      text: 'PDF export ready — launch-deck_v3.pdf',
      href: `/d/${DOC}/download/launch-deck_v3.pdf`,
      file: 'launch-deck_v3.pdf',
    });
  });

  it('the bus echo of the same export does not double the download', async () => {
    await runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pdf' });
    useDocThreadStore.getState().ingest({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.export.generated',
        payload: {
          project_id: PROJECT, document_id: DOC, format: 'pdf',
          file: 'launch-deck_v3.pdf', download: `/d/${DOC}/download/launch-deck_v3.pdf`,
        },
      },
    } as never);

    expect(messages().filter((m) => m.kind === 'agent')).toHaveLength(1);
  });
});

// ── 4. The one failure §4.4 names: PPTX without python-pptx ─────────────────

describe('a PPTX export with python-pptx absent is ACTIONABLE, not a crash (§4.4, §3.3)', () => {
  beforeEach(() => {
    postExport.mockRejectedValue(new ServiceHintError(400, 'pptx export unavailable', PPTX_HINT));
  });

  it('AC: the service’s 400 becomes a message naming the install command VERBATIM', async () => {
    const outcome = await runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pptx' });

    expect(outcome).toEqual({ ok: false, hint: PPTX_HINT });
    expect(messages()[1]).toMatchObject({ kind: 'actionable', hint: PPTX_HINT });
  });

  it('AC: the document is left usable — the failure says so, and offers the retry', async () => {
    await runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'pptx' });

    const msg = messages()[1];
    expect(msg).toMatchObject({ retry: { format: 'pptx', version: 3 } });
    expect(msg?.kind === 'actionable' && msg.text).toContain('still editable');
    // Nothing downloadable was invented, and the export never threw at the caller.
    expect(messages().some((m) => m.kind === 'agent')).toBe(false);
  });

  it('HTML never depends on the optional dependency the PPTX renderer needs (§4.4)', async () => {
    postExport.mockResolvedValue(reply('launch-deck_v3.html'));
    const outcome = await runExport({ projectId: PROJECT, docId: DOC, version: 3, format: 'html' });

    expect(outcome.ok).toBe(true);
    expect(messages().some((m) => m.kind === 'actionable')).toBe(false);
  });

  it('a refusal that named no command still names what failed — never a silent one', async () => {
    postExport.mockRejectedValue(new Error('API 500: renderer crashed'));
    await runExport({ projectId: PROJECT, docId: DOC, version: 2, format: 'pdf' });

    expect(messages()[1]).toMatchObject({ kind: 'actionable', hint: 'API 500: renderer crashed' });
    expect(exportHint(new ServiceHintError(400, 'nope', PPTX_HINT))).toBe(PPTX_HINT);
  });
});
