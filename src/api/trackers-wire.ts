/**
 * Project-management trackers (DES-PM-001 rev 4, PM-1): the wire of `GET`/`POST`/`DELETE /tracker-links`,
 * `GET /sources/:name/trackers`, `GET /tracker-links/issues`, and the `pm` fields a PM source carries in
 * `GET /mcp/servers` and the preview.
 *
 * A NARROW mirror of the contract block in `wicked-crew-api-types` 0.187.0 (only the fields studio reads) while
 * studio's pin lags it: it is not published yet, so `src/api/trackers.ts` reads every answer defensively and never
 * trusts these shapes to hold.
 *
 * TODO(api-types >= 0.187.0): once studio pins `wicked-crew-api-types` 0.187.0 or later, these become re-exports
 * from the package, and this mirror goes.
 */

/** (0.187.0) A project-management system. PM-1 registers `github` and `jira`; `gitlab` and `ado` are wave PM-2. */
export type PmSystem = 'github' | 'jira' | 'gitlab' | 'ado';

/** (0.187.0) What a tracker link points at: a studio project or a registered repo. */
export type TrackerLinkTarget = { kind: 'project'; id: string } | { kind: 'repo'; id: string };

/** (0.187.0) One link of one tracker. A tracker is (source, tenant, key). */
export interface TrackerLink {
  /** `tl_<hash16>` */
  id: string;
  /** `trk_<hash16>` */
  trackerId: string;
  /** The PM source's registry name. */
  source: string;
  sourceId: string;
  system: PmSystem;
  /** Jira: the site's `cloudId`; GitHub: the host. */
  tenant: string;
  /** The tenant as a person reads it (a Jira site's host); absent when not known. */
  tenantLabel?: string;
  /** Jira: the project key; GitHub: `owner/repo`. */
  key: string;
  /** Vendor text, at most 120 characters: rendered as text. */
  label: string;
  target: TrackerLinkTarget;
  linkedAt: string;
  linkedBy: string;
  /** Whether estate holds the link yet (Understand follows when it lands; access follows the registry at once). */
  projection: 'current' | 'pending' | 'failed';
}

/** (0.187.0) `POST /tracker-links` (human-only). */
export interface CreateTrackerLinkBody {
  source: string;
  tenant: string;
  key: string;
  target: TrackerLinkTarget;
}

/** (0.187.0) A link that reaches a project through one of its repos. */
export type TrackerLinkViaRepo = TrackerLink & { viaRepo: string };

/** (0.187.0) `GET /tracker-links?project=&repo=` (human-only). */
export interface TrackerLinksResponse {
  target: { project?: string; repo?: string };
  links: TrackerLink[];
  viaRepos: TrackerLinkViaRepo[];
  projects: Array<{ id: string; name: string }>;
  agents: Array<{ source: string; see: boolean; query: boolean }>;
}

/** (0.187.0) One project a PM source lists now. */
export interface SourceTracker {
  tenant: string;
  tenantLabel?: string;
  key: string;
  label: string;
  links: TrackerLink[];
}

/** (0.187.0) `GET /sources/:name/trackers?q=&cursor=&tenant=` (human-only): one page, live. */
export interface SourceTrackersResponse {
  name: string;
  trackers: SourceTracker[];
  next: string | null;
}

/** (0.187.0) `McpServerConfigBody.pm` / `McpServer.pm`: the server is a PM system's own MCP server. */
export interface McpPmMarker {
  system: PmSystem;
}

/** (0.187.0) A saved PM tool's resource binding (`McpTool.binding`); `null` = unbound, so unavailable to agents. */
export interface McpToolBinding {
  policy: string;
  schemaHash: string;
  inForce: boolean;
}

/** One open issue of one tracker of a job's tracker set, as the composer's "From an issue" lists it. */
export interface TrackerIssue {
  /** As the tracker names it: `BILL-142`, `owner/repo#212`. */
  key: string;
  /** Vendor text: rendered as text. */
  title: string;
  /** The tracker's own state name (`In progress`, `open`). */
  state: string | null;
}

/** `GET /tracker-links/issues?project=&repo=&q=` (human-only): the open issues of that pair's tracker set, by tracker. */
export interface TrackerIssuesResponse {
  trackers: Array<{
    trackerId: string;
    source: string;
    system: PmSystem;
    key: string;
    label: string;
    tenantLabel?: string;
    /** The tenant (a Jira site's cloudId), when crew sends it: names one of two sites behind one source. */
    tenant?: string;
    /** How the tracker is in the set: linked to the project, or through a named repo. */
    via: { kind: 'project' } | { kind: 'repo'; id: string };
    issues: TrackerIssue[];
    /** Why its issues could not be listed (the vendor unreachable, query off): a code. */
    error?: string;
  }>;
}
