import { apiFetch } from '../api/client.js';
import { isRouteUnsupported } from '../api/errors.js';
import { PERMISSIONS, type AnchorRef, type PermissionId } from './protocol.js';

/**
 * The editor host's small models (DES-EDITOR-PLUGINS-001 §5.1, §5.5, §5.7, §6; EP-P1). Pure, except
 * `fetchGrants`, the one read of crew's decided grant set.
 */

// ── §5.1 an artifact's kind ─────────────────────────────────────────────────────────────────

export type ArtifactKind = string;
export const KIND_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;

/** Host rule, in order: the recorded kind; the create style; the manifest kind; a demo run or a
 *  walkthrough step. `null` = no editor (a retired demo doc: read-only "Demos moved to Demo mode"). */
export function resolveKind(input: {
  artifactKind?: string | null;
  createStyle?: string | null;
  manifestKind?: 'doc' | 'demo' | null;
  demoRun?: boolean;
  walkthroughStep?: boolean;
}): ArtifactKind | null {
  if (typeof input.artifactKind === 'string' && KIND_PATTERN.test(input.artifactKind)) return input.artifactKind;
  if (typeof input.createStyle === 'string' && input.createStyle !== '') {
    if (input.createStyle === 'ppt') return 'deck';
    if (input.createStyle === 'doc' || input.createStyle === 'brochure') return 'document';
    return 'page';
  }
  if (input.manifestKind === 'demo') return null;
  if (input.manifestKind === 'doc') return 'page';
  if (input.demoRun === true) return 'demo-video';
  if (input.walkthroughStep === true) return 'walkthrough';
  return 'page';
}

// ── §5.5 artifact.changed.by ────────────────────────────────────────────────────────────────

export type VersionKind = 'deterministic' | 'structural' | 'generated' | 'fork' | 'demo' | 'theme';

/** Who wrote a new version, as the plugin is told: its own write, an agent, or anyone else. `demo`
 *  versions (the retired demo docs) are never forwarded: `null`. */
export function changedBy(version: number, kind: VersionKind, ownVersions: ReadonlySet<number>): 'this-editor' | 'agent' | 'other' | null {
  if (kind === 'demo') return null;
  if (ownVersions.has(version)) return 'this-editor';
  if (kind === 'generated' || kind === 'structural' || kind === 'theme') return 'agent';
  return 'other';
}

// ── §5.7 the chip: host-written labels ──────────────────────────────────────────────────────

export interface Chip { anchor: AnchorRef; label: string }

/** A plugin points with ids only; the host drops unknown anchors and writes every label itself (a
 *  plugin's own words never reach a chip, or the helpers). */
export function chipsFor(anchors: readonly AnchorRef[], known: (a: AnchorRef) => string | null): Chip[] {
  const out: Chip[] = [];
  for (const a of anchors) {
    const label = known(a);
    if (label !== null) out.push({ anchor: a.kind === 'time' ? { kind: 'time', atSec: a.atSec } : { kind: a.kind, id: a.id }, label });
  }
  return out;
}

/** The label the host writes for an element anchor: "the <tag-ish words>" from the host inventory. */
export function elementLabel(text: string | undefined, id: string): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t !== '') return `“${t.length > 40 ? `${t.slice(0, 39)}…` : t}”`;
  return `the ${id.replace(/[-_]+/g, ' ')}`;
}

// ── §6 grants ───────────────────────────────────────────────────────────────────────────────

/** The first-party default set (§6.1 column 4): every permission except `network.media`, which only
 *  `wicked-page` holds by default. */
export function builtinDefaults(editorId: string): PermissionId[] {
  return PERMISSIONS.filter((p) => p !== 'network.media' || editorId === 'wicked-page');
}

/** One decided grant as crew answers it (api-types `EditorGrant`, EP-C1): the permission, the engine's
 *  decision with the steering rules behind it, and the ledger token an operator's "allow" would add. */
export interface DecidedGrant { permission: string; decision: 'allow' | 'ask' | 'deny'; ruleIds?: string[]; token?: string }

/** The granted set out of crew's answer: only an `allow` grants; `ask` waits for the operator (Settings →
 *  Editors) and `deny` dominates. The EP-P1 fixture's bare list of permission ids is read as allowed. */
export function grantedOf(raw: unknown): { grants: PermissionId[]; asking: PermissionId[] } {
  // Every decision for a permission is read before any is honoured: one deny anywhere in the list
  // outweighs every allow (and silences an ask) for it — whichever order crew listed them (codex r1).
  const decided = new Map<PermissionId, 'allow' | 'ask' | 'deny'>();
  const worse = (a: 'allow' | 'ask' | 'deny' | undefined, b: 'allow' | 'ask' | 'deny'): 'allow' | 'ask' | 'deny' => {
    const rank = { allow: 0, ask: 1, deny: 2 } as const;
    return a === undefined || rank[b] > rank[a] ? b : a;
  };
  if (!Array.isArray(raw)) return { grants: [], asking: [] };
  for (const g of raw) {
    if (typeof g === 'string') { if (PERMISSIONS.includes(g as PermissionId)) decided.set(g as PermissionId, worse(decided.get(g as PermissionId), 'allow')); continue; }
    if (typeof g !== 'object' || g === null) continue;
    const d = g as Partial<DecidedGrant>;
    if (typeof d.permission !== 'string' || !PERMISSIONS.includes(d.permission as PermissionId)) continue;
    if (d.decision !== 'allow' && d.decision !== 'ask' && d.decision !== 'deny') continue;
    const p = d.permission as PermissionId;
    decided.set(p, worse(decided.get(p), d.decision));
  }
  const grants: PermissionId[] = [];
  const asking: PermissionId[] = [];
  for (const [p, d] of decided) { if (d === 'allow') grants.push(p); else if (d === 'ask') asking.push(p); }
  return { grants, asking };
}

/** `GET /api/v1/editors/:id/grants?project=` (crew EP-C1): the engine's decided set (deny dominates).
 *  A daemon without the route grants a built-in editor its default set and a third-party editor
 *  NOTHING (fail closed). Any other failure grants nothing and says why. */
export async function fetchGrants(editorId: string, version: string, sha: string, projectId: string | null): Promise<{ grants: PermissionId[]; note: string | null }> {
  const q = new URLSearchParams({ version, sha });
  if (projectId !== null) q.set('project', projectId);
  try {
    const r = await apiFetch<{ grants?: unknown }>(`/editors/${encodeURIComponent(editorId)}/grants?${q.toString()}`);
    const { grants, asking } = grantedOf(r.grants);
    return { grants, note: asking.length === 0 ? null : `This editor asks for ${asking.join(', ')} — allow it under Settings → Editors.` };
  } catch (e) {
    if (isRouteUnsupported(e)) {
      return editorId.startsWith('wicked-')
        ? { grants: builtinDefaults(editorId), note: 'This daemon has no editor grants yet: built-in defaults apply.' }
        : { grants: [], note: 'This daemon has no editor grants yet: a third-party editor gets none.' };
    }
    return { grants: [], note: `Could not read this editor's permissions (${e instanceof Error ? e.message : String(e)}).` };
  }
}

/** The bundle route (crew EP-C1): one hashed, self-contained HTML file served with its CSP. */
export function bundleUrl(apiBase: string, editorId: string, version: string, sha: string): string {
  return `${apiBase}/editors/${encodeURIComponent(editorId)}/${encodeURIComponent(version)}/entry?sha=${encodeURIComponent(sha)}`;
}
