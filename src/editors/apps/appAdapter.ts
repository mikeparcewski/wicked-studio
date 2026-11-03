import type { AdapterResult, ArtifactRef, HostAdapter } from '../host.js';
import type { ActionCard, ActionOutcome, AppDataPort, PreparedAction } from './appData.js';
import type { AppSession } from './appSession.js';

/**
 * The app adapter (DES-APPS-001 §7.1; slice K4): the editor host's view of one app, over its {@link AppSession}.
 *
 * It answers the protocol's artifact reads — `artifact.read` is the WORKING spec (the head with the edit burst on top),
 * so the runtime always draws what the host will land — and leaves the page editor's writes (`version.write`,
 * `version.undo`, `version.fork`) unsupported: an app changes only through the host's spec ops and crew's history.
 */

export type AppMode = 'edit' | 'preview';

/** What an app host gives the editor host beside the adapter. Absent on every other artifact. */
export interface AppHostPort {
  session: AppSession;
  data: AppDataPort;
  /** Whether the HOST page is itself framed. Decided by the host page, never by the plugin, and never relaxed. */
  framed(): boolean;
  /** Edit or Preview, as the host's own toggle says. Nothing writes to a source in Edit. */
  mode(): AppMode;
  /** Whether a spec op is still Edit's: in Edit, or just left it (a field committed as the person clicks Preview).
   *  Absent = `mode() === 'edit'`. Actions never use this: they need Preview, strictly. */
  editing?(): boolean;
  /** "Viewing as": who the app is shown to (the host's words). */
  viewer(): string;
  /** The page's URL parameters for this app's `url.<name>` bindings (said once, in `host.hello`). */
  url?(): Record<string, string>;
  /** A dashboard tile (the Apps page): read-only; `rows` false = the runtime sends no query at all. */
  tile?: { rows: boolean };
  /** The host draws the card OUTSIDE the frame; resolves true only on the person's own Run there. */
  confirm(prepared: PreparedAction): Promise<boolean>;
  /** The host shows the full URL and opens it only on the person's own click. */
  openLink(url: string): Promise<boolean>;
  /** An action ended (succeeded, failed or not known): the host says so in its own chrome. */
  outcome?(outcome: ActionOutcome, card: ActionCard): void;
}

const unsupported = <T,>(what: string): AdapterResult<T> => ({ error: 'unsupported', message: `${what}: an app changes through its own edits and history` });

export class AppAdapter implements HostAdapter {
  constructor(private readonly session: AppSession, private readonly title: string) {}

  artifact(): ArtifactRef {
    const head = this.session.head;
    return { kind: 'app', title: this.session.detail?.name ?? this.title, version: head, head, readonly: this.session.readonly, lockedParts: [] };
  }

  async read(version?: number): Promise<AdapterResult<{ version: number; content: Record<string, unknown> }>> {
    const d = this.session.detail;
    const spec = this.session.spec;
    if (d === null || spec === null) return { error: 'unavailable', message: 'the app is not loaded yet' };
    if (version !== undefined && version !== d.head.version) return { error: 'stale', message: `only the head (v${d.head.version}) is shown`, head: d.head.version };
    return { version: d.head.version, content: { type: 'app', spec, pending: this.session.pending, readonly: this.session.readonly, receipt: d.head.receipt } };
  }

  async versions(): Promise<AdapterResult<{ versions: { version: number; parent: number | null; createdAt: string }[]; head: number }>> {
    const d = this.session.detail;
    if (d === null) return { error: 'unavailable', message: 'the app is not loaded yet' };
    return { versions: d.versions.map((v) => ({ version: v.version, parent: v.base, createdAt: new Date(v.at).toISOString() })), head: d.head.version };
  }

  // Parameterless: an app never takes these (TypeScript accepts fewer parameters than the interface names).
  async write(): Promise<AdapterResult<{ version: number }>> { return unsupported('version.write'); }
  async undo(): Promise<AdapterResult<{ undone: true }>> { return unsupported('version.undo'); }
  async fork(): Promise<AdapterResult<{ version: number }>> { return unsupported('version.fork'); }
}
