import { getVersions, HeadMovedError, interactiveDocUrl, postEvent, postFork, type VersionEntry } from '../api/interactive.js';
import { notUndoneLine } from '../board/artifactMorph.js';
import { FEEDBACK_EVENT } from '../interactive/feedbackBatch.js';
import type { AdapterResult, ArtifactRef, HostAdapter } from './host.js';
import type { VersionKind } from './model.js';
import type { WireItem } from './ops.js';

/** After a write: how often, and how long, the manifest is re-read for the edit's own version. */
const POLL_MS = 400;
const POLL_FOR_MS = 20_000;

/**
 * The `interactive-doc` adapter (DES-EDITOR-PLUGINS-001 §4, EP-P2): the host's one road from a plugin's
 * generic requests to crew's interactive proxy for a page. A plugin never learns the mount or an id's
 * URL; it reads `{type:'html'}` content and writes ops the host has already checked.
 *
 *  - read: the version HTML as served (`GET /d/:doc/doc/:v`), versions: the manifest.
 *  - write: ONE `feedback.submitted` with the deterministic items (one batch = one version), then the
 *    manifest is polled for the edit's own version — a deterministic version branched off `base` — as
 *    S8's PageEditor did: `stale` when the head moved by someone else's hand instead, `unavailable`
 *    when nothing landed in the window.
 *  - undo / fork: `POST /api/fork` — undo forks the version BEFORE the change with `expect_head` (C5),
 *    so a helper's version landed in between answers `head_moved` and nothing is buried.
 */
export class InteractiveDocAdapter implements HostAdapter {
  head = 0;
  private entries: VersionEntry[] = [];
  /** The base each version this adapter wrote branched from: Undo's fork target. */
  readonly writes = new Map<number, number>();

  private readonly pollForMs: number;

  constructor(
    private readonly projectId: string,
    private readonly docId: string,
    private readonly title: string,
    private readonly kind: string = 'page',
    private readonly onHead?: (head: number) => void,
    opts: { pollForMs?: number } = {},
  ) {
    this.pollForMs = opts.pollForMs ?? POLL_FOR_MS;
  }

  artifact(): ArtifactRef {
    return { kind: this.kind, title: this.title, version: this.head, head: this.head, readonly: false, lockedParts: [] };
  }

  private moveHead(head: number): void {
    if (head === this.head) return;
    this.head = head;
    this.onHead?.(head);
  }

  /** Re-read the manifest. When the head moved, says to what and how (as the plugin is told). */
  async refresh(): Promise<{ head: number; kind: VersionKind } | null> {
    const m = await getVersions(this.projectId, this.docId);
    this.entries = m.versions;
    if (m.head === this.head) return null;
    const was = this.head;
    this.moveHead(m.head);
    const e = m.versions.find((v) => v.version === m.head);
    const kind: VersionKind = e === undefined ? 'generated'
      : e.feedback_file !== null ? 'deterministic'
        : was !== 0 && e.parent !== null && e.parent !== was ? 'fork' : 'generated';
    return { head: m.head, kind };
  }

  async read(version?: number): Promise<AdapterResult<{ version: number; content: { type: 'html'; html: string } }>> {
    if (this.head === 0) await this.refresh().catch(() => null);
    const v = version ?? this.head;
    if (v === 0) return { error: 'unavailable', message: 'the page has no version yet' };
    const res = await fetch(interactiveDocUrl(this.projectId, this.docId, v));
    if (!res.ok) return { error: res.status === 404 ? 'bad_request' : 'unavailable', message: `the page could not be read (${res.status})` };
    return { version: v, content: { type: 'html', html: await res.text() } };
  }

  async versions(): Promise<AdapterResult<{ versions: { version: number; parent: number | null; createdAt: string }[]; head: number }>> {
    const m = await getVersions(this.projectId, this.docId);
    this.entries = m.versions;
    this.moveHead(m.head);
    return { versions: m.versions.map((v) => ({ version: v.version, parent: v.parent, createdAt: v.created_at })), head: m.head };
  }

  /** The version THIS edit made: a deterministic version branched off `base` — the lowest such one.
   *  `{other}` when the head moved without one, `null` when nothing landed in the window. */
  private async waitForLanded(base: number): Promise<{ version: number } | { other: number } | null> {
    const until = Date.now() + this.pollForMs;
    let moved: number | null = null;
    while (Date.now() < until) {
      try {
        const m = await getVersions(this.projectId, this.docId);
        this.entries = m.versions;
        const mine = m.versions
          .filter((v) => v.version > base && v.parent === base && v.feedback_file !== null)
          .map((v) => v.version)
          .sort((a, b) => a - b)[0];
        if (mine !== undefined) return { version: mine };
        if (m.head > base) moved = m.head;
      } catch { /* re-read on the next tick */ }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return moved === null ? null : { other: moved };
  }

  async write(base: number, items: WireItem[]): Promise<AdapterResult<{ version: number }>> {
    await postEvent(this.projectId, {
      event_type: FEEDBACK_EVENT,
      payload: { document_id: this.docId, version: base, author: 'studio', items },
    });
    const landed = await this.waitForLanded(base);
    if (landed === null) return { error: 'unavailable', message: 'The change was sent, but no new version appeared.' };
    if ('other' in landed) {
      this.moveHead(landed.other);
      return { error: 'stale', message: `The page changed (version ${landed.other}), but not by your edit — it may have been stale.`, head: landed.other };
    }
    this.writes.set(landed.version, base);
    this.moveHead(landed.version);
    return { version: landed.version };
  }

  async undo(version: number): Promise<AdapterResult<{ undone: true }>> {
    const parent = this.writes.get(version) ?? this.entries.find((v) => v.version === version)?.parent ?? null;
    if (parent === null) return { error: 'refused', message: 'nothing to undo' };
    try {
      const r = await postFork(this.projectId, this.docId, parent, undefined, version);
      this.moveHead(r.version);
      return { undone: true };
    } catch (e: unknown) {
      if (e instanceof HeadMovedError) {
        this.moveHead(e.head);
        return { error: 'head_moved', message: notUndoneLine(e.head), head: e.head };
      }
      return { error: 'unavailable', message: `Could not undo: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async fork(from: number): Promise<AdapterResult<{ version: number }>> {
    try {
      const r = await postFork(this.projectId, this.docId, from);
      this.moveHead(r.version);
      return { version: r.version };
    } catch (e: unknown) {
      return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) };
    }
  }
}
