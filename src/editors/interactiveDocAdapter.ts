import { getVersions, HeadMovedError, interactiveDocUrl, postEvent, postFork, type VersionEntry } from '../api/interactive.js';
import { notUndoneLine } from '../board/artifactMorph.js';
import { FEEDBACK_EVENT } from '../interactive/feedbackBatch.js';
import type { AdapterResult, ArtifactRef, HostAdapter, MovedOn } from './host.js';
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

  /**
   * The head moved to a version the reply itself does not make the plugin's current one: said as
   * `moved` (head + how it came to be), which the host announces as `artifact.changed` after the reply —
   * or alone, when the reply already timed out (a write's landing window is 20 s, the reply's 10 s;
   * codex r3). Judged against the head as it stood before the move.
   */
  private movedTo(head: number): MovedOn {
    const was = this.head;
    this.moveHead(head);
    return { head, kind: this.kindOf(head, was) };
  }

  /** Re-read the manifest. When the head moved, says to what and how (as the plugin is told). */
  async refresh(): Promise<{ head: number; kind: VersionKind } | null> {
    const m = await getVersions(this.projectId, this.docId);
    this.entries = m.versions;
    if (m.head === this.head) return null;
    const was = this.head;
    this.moveHead(m.head);
    return { head: m.head, kind: this.kindOf(m.head, was) };
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

  /**
   * The version THIS edit made. The bridge records no correlation id on a feedback-made version (the
   * real bridge drops `source_message_id`; the fixture mirrors it), so the only signal is the shape: a
   * deterministic version branched off `base`. It is claimed only when it is NEW since the post (a
   * version another tab made before it is never ours — codex r1) and ALONE: two new deterministic
   * children of the base in the window cannot be told apart, and then neither is claimed. `{other}`
   * when the head moved without one, `null` when nothing landed in the window; the manifest's head is
   * returned beside the match, because a later version may already be the head.
   */
  private async waitForLanded(base: number, before: ReadonlySet<number>): Promise<{ version: number; head: number } | { ambiguous: number[]; head: number } | { other: number } | null> {
    const until = Date.now() + this.pollForMs;
    let moved: number | null = null;
    while (Date.now() < until) {
      try {
        const m = await getVersions(this.projectId, this.docId);
        this.entries = m.versions;
        const fresh = m.versions
          .filter((v) => v.parent === base && v.feedback_file !== null && !before.has(v.version))
          .map((v) => v.version)
          .sort((a, b) => a - b);
        if (fresh.length === 1) return { version: fresh[0]!, head: m.head };
        if (fresh.length > 1) return { ambiguous: fresh, head: m.head };
        if (m.head > base) moved = m.head;
      } catch { /* re-read on the next tick */ }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return moved === null ? null : { other: moved };
  }

  async write(base: number, items: WireItem[]): Promise<AdapterResult<{ version: number }>> {
    // What exists before the post: a version already there can never be the one this post makes. The
    // read is fail-CLOSED — without it, a child another tab made meanwhile could be claimed (codex r2)
    // — and a head already past the base means the edit is stale before it is sent.
    let before: Set<number>;
    try {
      const m = await getVersions(this.projectId, this.docId);
      this.entries = m.versions;
      if (m.head !== base) {
        const moved = this.movedTo(m.head);
        return { error: 'head_moved', message: `The page changed (version ${m.head}) before your edit was sent; nothing was changed.`, head: m.head, moved };
      }
      before = new Set(m.versions.map((v) => v.version));
    } catch {
      return { error: 'unavailable', message: 'The page could not be read before sending, so nothing was changed.' };
    }
    await postEvent(this.projectId, {
      event_type: FEEDBACK_EVENT,
      payload: { document_id: this.docId, version: base, author: 'studio', items },
    });
    const landed = await this.waitForLanded(base, before);
    if (landed === null) return { error: 'unavailable', message: 'The change was sent, but no new version appeared.' };
    if ('other' in landed) {
      const moved = this.movedTo(landed.other);
      return { error: 'stale', message: `The page changed (version ${landed.other}) while your edit was on its way; it was not seen land as its own version — see the versions.`, head: landed.other, moved };
    }
    this.moveHead(landed.head);
    // The head moved on past what the plugin will be told: the host announces it after the reply.
    // (how the head came to be is judged against the version just before it: this edit's own, or the base)
    const mine = 'version' in landed ? landed.version : base;
    const moved = landed.head !== mine ? { head: landed.head, kind: this.kindOf(landed.head, mine) } : undefined;
    if ('ambiguous' in landed) {
      return { error: 'unavailable', message: `Two edits landed from version ${base} at once (versions ${landed.ambiguous.join(' and ')}); which is yours cannot be told, so nothing here offers to undo it.`, head: landed.head, ...(moved !== undefined ? { moved } : {}) };
    }
    this.writes.set(landed.version, base);
    return { version: landed.version, ...(moved !== undefined ? { moved } : {}) };
  }

  /** How a version came to be, as the plugin is told (`artifact.changed.kind`), from the manifest. */
  private kindOf(version: number, was: number): VersionKind {
    const e = this.entries.find((v) => v.version === version);
    return e === undefined ? 'generated'
      : e.feedback_file !== null ? 'deterministic'
        : was !== 0 && e.parent !== null && e.parent !== was ? 'fork' : 'generated';
  }

  async undo(version: number): Promise<AdapterResult<{ undone: true }>> {
    const parent = this.writes.get(version) ?? this.entries.find((v) => v.version === version)?.parent ?? null;
    if (parent === null) return { error: 'refused', message: 'nothing to undo' };
    try {
      const r = await postFork(this.projectId, this.docId, parent, undefined, version);
      this.moveHead(r.version);
      return { undone: true, moved: { head: r.version, kind: 'fork' } };
    } catch (e: unknown) {
      if (e instanceof HeadMovedError) {
        // The manifest is re-read so `moved` can say HOW the head came to be (a helper's version, a fork);
        // when it cannot be read, the head the server named stands and its kind is unknown ('generated').
        let head = e.head;
        try {
          const m = await getVersions(this.projectId, this.docId);
          this.entries = m.versions;
          head = Math.max(head, m.head);
        } catch { /* the server's head stands */ }
        const moved = this.movedTo(head);
        return { error: 'head_moved', message: notUndoneLine(head), head, moved };
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
