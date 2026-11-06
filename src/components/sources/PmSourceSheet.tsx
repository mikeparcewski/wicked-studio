import { useEffect, useId, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { ApiError } from '../../api/errors.js';
import { sourcesApi, type McpPreviewResponse, type McpServer, type McpServerConfigBody } from '../../api/sources.js';
import { agentAccessOf, type SourceAgentAccess } from '../../api/sourceAgents.js';
import {
  sourceTrackersOf,
  systemName,
  trackerLinksListOf,
  trackerRefusal,
  trackersApi,
  trackerTitle,
  type PmSystem,
  type SourceTracker,
  type TrackerLink,
} from '../../api/trackers.js';
import { useProjectsStore } from '../../store/projects.js';
import { useModalEscape } from '../Modal.js';
import { TrackerBadge } from '../trackers/TrackerParts.js';
import { AgentAccess } from './AgentAccess.js';
import { SecretField, type SecretHandle } from './SecretField.js';
import { elsewhereWords, refusalWords, rekeyFailure, rekeyPending, rekeySource, secretRefKind, secretShapeProblem, takeRekeyOutcome } from './rekey.js';
import { keychainRef, NAME_RE } from './sourceModel.js';
import { useDialogFocus } from './useDialogFocus.js';

/**
 * THE PROJECT-MANAGEMENT SOURCE SHEETS: "Add Jira" and "Add GitHub Issues" (DES-PM-001 §2, §3.1; mockup screens 1a/1b).
 *
 * COORD DEFAULT (2026-11-04): DES-PM-001 has registration on the generated A2UI connection surface (DES-GENUI-001),
 * which is not built yet. These two sheets are hand-built from studio's own parts so PM-1 ships; the generated surface
 * replaces them in a later wave (the same preview and save, the same switches).
 *
 * What it does: the vendor's own MCP server and a token, kept in the keychain (the token is typed once into an
 * uncontrolled field, sent only with the preview, and never shown again); the advice on restricting the token; Test,
 * which connects and lists the tools crew found, each reviewed for agents ("Reviewed": bound to the linked trackers;
 * "Not for agents": crew can't bind it; "Asks you": a write, only through an action the deliver gate asks you about);
 * Save, which registers exactly what the test saw; then Test connection on the saved source, which shows the sites or
 * repositories the token reaches (a live read, no issue read); and the Agents switches.
 */
export type PmSheetTarget = { mode: 'new'; system: 'jira' | 'github' } | { mode: 'saved'; server: McpServer };

const SERVERS: Record<'jira' | 'github', string> = {
  jira: 'https://mcp.atlassian.com/v2/mcp',
  github: 'https://api.githubcopilot.com/mcp/',
};

/** What crew found for one tool, as the review list says it. */
export interface ToolReview {
  name: string;
  kind: 'issues' | 'account' | 'reads' | 'writes';
  verdict: 'reviewed' | 'not_for_agents' | 'asks' | 'review_again' | 'unknown';
  note: string;
  /** A saved write tool: whether the person granted it at the save (`McpTool.enabled`). */
  granted?: boolean;
}

/** The binding notes the mockup names for the tools crew binds (DES-PM-001 §3.1); others get the general line. */
const BOUND_NOTES: Record<string, string> = {
  searchJiraIssuesUsingJql: 'crew sets the site (cloudId) and adds your linked projects to the JQL; it keeps items whose key is linked, and recounts the totals.',
  getJiraIssue: 'The issue key’s project must be linked.',
  listJiraIssueComments: 'The issue key’s project must be linked. Comments limited to a role or group, and internal notes, are left out.',
  atlassianUserInfo: 'Account details: the token owner’s account id, nothing else.',
  getAccessibleAtlassianResources: 'Account details: only the sites of the trackers you link.',
  list_issues: 'The repository (owner/repo) must be linked.',
  issue_read: 'The repository must be linked.',
  search_issues: 'crew adds repo: for the linked repositories; foreign items are dropped and the total recounted.',
};
const UNBOUND_NOTES: Record<string, string> = {
  getVisibleJiraProjects: 'No project argument: it lists the whole site.',
  // An older crew holds no binding for it: then it is not the agents'.
  getAccessibleAtlassianResources: 'It lists every site the token reaches.',
  search_repositories: 'No repository argument: it lists everything the token sees.',
};

/**
 * One tool's review, from crew's own answer: its class and its binding (`binding` on a saved tool is
 * `{policy, schemaHash, inForce} | null`, on a preview tool `{policy} | null`). A write always asks; a read is for agents
 * only while crew holds a binding for it (and, saved, while that binding is in force).
 */
/** A note for a tool crew names, looked up by the tool's OWN key only (a hostile name like `__proto__` finds nothing). */
const noteFor = (notes: Record<string, string>, name: string): string | undefined => (Object.hasOwn(notes, name) ? notes[name] : undefined);
const CLASSES: ReadonlySet<string> = new Set(['read', 'write', 'destructive']);

export function toolReview(tool: { name: string; class: string; binding?: unknown }, saved = false): ToolReview {
  // A class this studio can't read claims nothing either way.
  if (!CLASSES.has(tool.class)) return { name: tool.name, kind: 'reads', verdict: 'unknown', note: 'crew named a kind of tool this studio can’t read, so it claims nothing about it.' };
  if (tool.class === 'write' || tool.class === 'destructive') {
    const enabled = (tool as { enabled?: unknown }).enabled;
    return { name: tool.name, kind: 'writes', verdict: 'asks', note: 'A write: it happens only through an action the deliver gate asks you about.', ...(saved && typeof enabled === 'boolean' ? { granted: enabled } : {}) };
  }
  const b = tool.binding;
  if (b === null) return { name: tool.name, kind: 'reads', verdict: 'not_for_agents', note: noteFor(UNBOUND_NOTES, tool.name) ?? 'crew can’t limit it to the trackers you link, so no agent gets it.' };
  // A binding studio can't read whole, or none sent at all, claims nothing either way.
  const unknown: ToolReview = { name: tool.name, kind: 'reads', verdict: 'unknown', note: 'crew’s review of this tool could not be read, so studio claims nothing about it.' };
  if (typeof b !== 'object' || typeof (b as { policy?: unknown }).policy !== 'string') return unknown;
  const inForce = (b as { inForce?: unknown }).inForce;
  if (saved && inForce === false) {
    return { name: tool.name, kind: 'issues', verdict: 'review_again', note: 'Its schema or crew’s binding changed since it was reviewed: agents can’t use it until you save this source again.' };
  }
  // A saved tool is reviewed only while its binding is in force.
  if (saved && inForce !== true) return unknown;
  return { name: tool.name, kind: ACCOUNT_TOOLS.has(tool.name) ? 'account' : 'issues', verdict: 'reviewed', note: noteFor(BOUND_NOTES, tool.name) ?? 'Bound to the trackers you link: crew names the site and project, and drops anything else from an answer.' };
}

/** The account-metadata tools crew binds (no issue rows): labelled `account` rather than `issues`. */
const ACCOUNT_TOOLS: ReadonlySet<string> = new Set(['atlassianUserInfo', 'getAccessibleAtlassianResources']);

/** One group of the tool list: a one-line reason, then its tools (each with its own row, or as a list of names). */
export interface ToolGroup {
  key: 'agents' | 'writes' | 'again' | 'unscoped' | 'confluence' | 'graph' | 'product' | 'code';
  title: string;
  reason: string;
  /** Each tool gets its own row (its note, a write's grant); otherwise the group lists the names only. */
  rows: boolean;
  tools: ToolReview[];
}

/** Atlassian's generic tools: they run any operation, on any project, so no binding can limit them. */
const GENERIC: ReadonlySet<string> = new Set(['discover', 'search', 'fetch', 'execute', 'executeRead', 'executeWrite', 'executeDestructive']);

/**
 * The tool list in groups, each with the one line that says why (instead of one long "Not for agents" list). A tool
 * crew binds is always the agents'; the rest are grouped by why no agent gets them. Tools of another product are
 * "not part of trackers" whatever their kind (a Confluence write is not a tracker write the deliver gate offers).
 */
export function toolGroupsOf(system: 'jira' | 'github', reviews: readonly ToolReview[]): ToolGroup[] {
  const where = system === 'jira' ? 'Jira projects' : 'repositories';
  const groups: ToolGroup[] = [
    { key: 'agents', title: 'Agents can use', reason: `Limited to the ${where} you link: crew names the ${system === 'jira' ? 'site and project' : 'repository'}, and drops anything else from an answer.`, rows: true, tools: [] },
    { key: 'writes', title: 'Writes', reason: 'You confirm each one at delivery: an agent never sends one itself.', rows: true, tools: [] },
    { key: 'again', title: 'Check again', reason: 'Its review changed since the save, or could not be read, so no agent gets it for now: save this source again.', rows: false, tools: [] },
    { key: 'unscoped', title: 'Not for agents', reason: `Can’t be limited to your linked ${where}.`, rows: false, tools: [] },
    { key: 'confluence', title: 'Not for agents', reason: 'Not part of trackers (Confluence).', rows: false, tools: [] },
    { key: 'graph', title: 'Not for agents', reason: 'Not part of trackers (Teamwork Graph, people and Loom).', rows: false, tools: [] },
    { key: 'product', title: 'Not for agents', reason: 'Not part of trackers (other Atlassian products).', rows: false, tools: [] },
    { key: 'code', title: 'Not for agents', reason: 'Not part of trackers (code, pull requests and the rest of GitHub).', rows: false, tools: [] },
  ];
  const put = (k: ToolGroup['key'], t: ToolReview): void => { groups.find((g) => g.key === k)!.tools.push(t); };
  // crew's review state first (bound, changed, unreadable); then a tool of another product or a generic one, whatever its
  // kind; then the tracker's writes; the rest can't be limited. A name only says WHY a tool is not the agents'.
  for (const t of reviews) {
    if (t.verdict === 'reviewed') put('agents', t);
    else if (t.verdict === 'review_again' || t.verdict === 'unknown') put('again', t);
    else if (system === 'jira' && /confluence/i.test(t.name)) put('confluence', t);
    else if (system === 'jira' && /graph|loom|people|collaborators|workactivity|workportfolio/i.test(t.name)) put('graph', t);
    else if (system === 'jira' && /compass|bitbucket/i.test(t.name)) put('product', t);
    else if (system === 'jira' && GENERIC.has(t.name)) put('unscoped', t);
    else if (system === 'github' && !/issue/i.test(t.name) && t.name !== 'get_me' && t.name !== 'search_repositories') put('code', t);
    else if (t.verdict === 'asks') put('writes', t);
    else put('unscoped', t);
  }
  return groups.filter((g) => g.tools.length > 0);
}

/** What the sheet may say about the saved source when its test failed: no more than crew's answer supports. */
export function savedWords(crew: { code: string | null; cause: string | null } | null, refKind: 'own' | 'env' | 'other' | 'none' = 'own'): string {
  if (crew?.code === 'source_not_found') return 'crew no longer has this source: it was removed since this page was read.';
  if (crew?.cause === 'secret_missing') {
    return refKind === 'env' || refKind === 'other' ? `The source is saved, but crew can’t read its token. ${elsewhereWords(refKind, 'token')}`
      : 'The source is saved, but crew can’t read its token: type it again above and choose Save token.';
  }
  return 'The source is saved. This test, which reads what the token reaches, failed; nothing else changed.';
}

/** crew's code and cause, each shown only when it is a code word, once when they are the same. */
export function codeWords(crew: { code: string | null; cause: string | null }): string | null {
  const parts = [crew.code, crew.cause].filter((x, i, a): x is string => x !== null && a.indexOf(x) === i);
  return parts.length === 0 ? null : parts.join(': ');
}

/** crew's own words for a refused read of what a saved source reaches: its sentence, its code and the cause it names. */
export function reachFailureOf(e: unknown): { said: string; code: string | null; cause: string | null } | null {
  if (!(e instanceof ApiError)) return null;
  const b = e.body as { error?: unknown; code?: unknown; cause?: unknown } | undefined;
  const whole = typeof b?.error === 'string' && b.error.trim() !== '' ? b.error.trim() : null;
  const said = whole === null ? null : whole.length <= 1_200 ? whole : `${whole.slice(0, 1_200)}… (cut at 1200 characters)`;
  if (said === null) return null;
  const tok = (v: unknown): string | null => (typeof v === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(v) ? v : null);
  return { said, code: tok(b?.code), cause: tok(b?.cause) };
}

/** Every tool crew listed, reviewed, or `null` when the list is not crew's whole list (one unreadable entry included). */
export function toolReviewsOf(tools: unknown, saved: boolean): ToolReview[] | null {
  if (!Array.isArray(tools)) return null;
  const out: ToolReview[] = [];
  for (const t of tools as unknown[]) {
    if (typeof t !== 'object' || t === null || typeof (t as { name?: unknown }).name !== 'string' || typeof (t as { class?: unknown }).class !== 'string') return null;
    out.push(toolReview(t as { name: string; class: string; binding?: unknown }, saved));
  }
  return out;
}

const VERDICT_WORDS: Record<ToolReview['verdict'], string> = { reviewed: 'Reviewed', not_for_agents: 'Not for agents', asks: 'Asks you', review_again: 'Review again', unknown: 'Not known' };
const VERDICT_TONE: Record<ToolReview['verdict'], string> = { reviewed: 'ok', not_for_agents: 'warn', asks: 'gate', review_again: 'warn', unknown: 'muted' };

/** The Basic credential Atlassian's server takes for an API token: base64 of `email:token` (UTF-8). */
export function jiraBasic(email: string, token: string): string {
  const bytes = new TextEncoder().encode(`${email}:${token}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The registration crew previews: the vendor's MCP server over HTTP, marked as a PM system, its token as a header. */
export function pmConfigBody(system: 'jira' | 'github', name: string, url: string, hasSecret: boolean): McpServerConfigBody {
  const n = name.trim();
  return {
    name: n,
    kind: 'mcp-http',
    url: url.trim(),
    auth: hasSecret ? { ref: keychainRef(n), header: 'Authorization', prefix: system === 'jira' ? 'Basic ' : 'Bearer ' } : null,
    pm: { system },
  } as McpServerConfigBody;
}

/** What Test connection on a saved PM source read: the sites (or the host) its token reaches, and how many projects. */
export type Reach = { tenants: Array<{ tenant: string; label: string; count: number }>; more: boolean };

export function reachOf(trackers: readonly SourceTracker[], next: string | null): Reach {
  const by = new Map<string, { tenant: string; label: string; count: number }>();
  for (const t of trackers) {
    const cur = by.get(t.tenant) ?? { tenant: t.tenant, label: t.tenantLabel ?? t.tenant, count: 0 };
    cur.count += 1;
    by.set(t.tenant, cur);
  }
  return { tenants: [...by.values()], more: next !== null };
}

/** The Test box's lines for a reach, in the mockup's words. */
export function reachLines(system: PmSystem, r: Reach): string[] {
  // One page was read: with more pages, the counts are a floor ("at least").
  const least = r.more ? 'at least ' : '';
  if (system === 'jira') {
    if (r.tenants.length === 0) return ['This token reaches no Jira project.'];
    const sites = r.tenants.map((t) => t.label);
    const [first, ...rest] = r.tenants;
    return [
      r.tenants.length === 1 ? `This token reaches 1 site${r.more ? ' or more' : ''}: ${sites[0]}.` : `This token reaches ${least}${r.tenants.length} sites: ${sites.join(', ')}. Each tracker you link names its site.`,
      `${r.more ? 'At least ' : ''}${first!.count} project${first!.count === 1 ? '' : 's'} visible on ${first!.label}${rest.map((t) => `, ${t.count} on ${t.label}`).join('')}.`,
    ];
  }
  const n = r.tenants.reduce((a, t) => a + t.count, 0);
  return [n === 0 ? 'This token reaches no repository.' : `This token reaches ${least}${n} repositor${n === 1 ? 'y' : 'ies'}${r.tenants.length === 1 ? ` on ${r.tenants[0]!.label}` : ''}.`];
}

const words = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A preview studio can hold and save from: crew's hash, and a tool list it can read whole. */
export function previewReadable(p: unknown): p is McpPreviewResponse {
  const o = p as { previewHash?: unknown; tools?: unknown } | null;
  return typeof o === 'object' && o !== null && typeof o.previewHash === 'string' && o.previewHash !== '' && toolReviewsOf(o.tools, false) !== null;
}

/** " to atlassian-mcp-server 2.0.3" when crew named the server whole, else nothing. */
function serverInfoWords(p: McpPreviewResponse): string {
  const i = (p as { serverInfo?: unknown }).serverInfo as { name?: unknown; version?: unknown } | null | undefined;
  return typeof i === 'object' && i !== null && typeof i.name === 'string' && typeof i.version === 'string' ? ` to ${i.name} ${i.version}` : '';
}
const codeOf = (e: unknown): string | null => {
  const c = e instanceof ApiError ? (e.body as { code?: unknown } | undefined)?.code : undefined;
  return typeof c === 'string' ? c : null;
};

export function PmSourceSheet({ target, existing, servers, agentsUnverified, onReread, onSaved, onRekeyed, onAgents, onClose }: {
  target: PmSheetTarget;
  existing: readonly string[];
  /** The page's latest read of the registry: a sheet opened as new follows its saved source there. */
  servers?: readonly McpServer[];
  agentsUnverified?: ReadonlySet<string>;
  onReread?: () => void;
  onSaved: (server: McpServer) => void;
  /**
   * crew wrote the source's token again (its `authState` is `set`): nothing else about the source changed. A page that
   * passes `servers` merges it there too, since the sheet shows the page's record before its own.
   */
  onRekeyed?: (name: string) => void;
  onAgents?: (name: string, agents: SourceAgentAccess) => void;
  onClose: () => void;
}): React.ReactElement {
  const titleId = useId();
  const emailRef = useRef<HTMLInputElement | null>(null);
  /** The sheet is on the page: a write that settles after it closed runs no test here (a reopened sheet reads crew). */
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /** What the last re-key did, for the status line (a rotation is Set before and after: this is what changes). */
  const [rekeyStatus, setRekeyStatus] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  useModalEscape(onClose);
  useDialogFocus(box);
  const [saved, setSaved] = useState<McpServer | null>(target.mode === 'saved' ? target.server : null);
  const followed = saved !== null ? servers?.find((s) => s.name === saved.name) ?? null : null;
  // The page's latest read, else this sheet's own record (a saved target starts as it; a re-key or the Agents switches
  // update it).
  const shownServer = followed ?? saved;
  const system: 'jira' | 'github' = target.mode === 'new' ? target.system : ((shownServer as { pm?: { system?: string } } | null)?.pm?.system === 'jira' ? 'jira' : 'github');
  const [name, setName] = useState(target.mode === 'saved' ? target.server.name : system === 'jira' ? 'jira' : 'github');
  const [url, setUrl] = useState(target.mode === 'saved' ? target.server.url ?? '' : SERVERS[system]);
  const [email, setEmail] = useState('');
  const secret = useRef<SecretHandle | null>(null);
  const [hasSecret, setHasSecret] = useState(false);
  const [secretEdits, setSecretEdits] = useState(0);
  /** The typed token went with a preview and the field let go of it: it is sent once per test, so a new test needs it typed again. */
  const [tokenSent, setTokenSent] = useState(false);
  /** The write tools the person grants at the save (crew's G1 `enabledWrites`): only a granted write can be asked for at the deliver gate. */
  const [grants, setGrants] = useState<{ key: string; names: ReadonlySet<string> }>({ key: '', names: new Set() });
  const [held, setHeld] = useState<{ key: string; preview: McpPreviewResponse } | null>(null);
  const [busy, setBusy] = useState<null | 'test' | 'save' | 'reach' | 'rekey'>(null);
  /** A saved source whose token is set: the person opened "Replace token" (a missing token's field is always open). */
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reach, setReach] = useState<{ ok: true; r: Reach; at: string } | { ok: false; words: string; crew?: { said: string; code: string | null; cause: string | null } | null } | null>(null);
  const seq = useRef(0);
  const reachGen = useRef(0);
  const inFlight = useRef(false);
  const projects = useProjectsStore((s) => s.projects);

  const isNew = saved === null && target.mode === 'new';
  const key = JSON.stringify([pmConfigBody(system, name, url, hasSecret || tokenSent), system === 'jira' ? email.trim() : '', secretEdits]);
  const preview = held !== null && held.key === key ? held.preview : null;
  const blocker = !isNew ? null
    : !NAME_RE.test(name.trim()) ? 'Name: 1-63 of a-z 0-9 _ -, starting with a letter or digit'
      : name.trim() === 'crew' ? '"crew" is the built-in source; choose another name'
        : !/^https:\/\/\S+$/.test(url.trim()) ? 'Server is an https URL'
          : system === 'jira' && !/^\S+@\S+$/.test(email.trim()) ? 'Account email is needed'
            : !hasSecret ? (tokenSent ? 'Type the token again to test again: it is sent once per test' : system === 'jira' ? 'API token is needed' : 'Personal access token is needed') : null;

  const test = async (): Promise<void> => {
    if (blocker !== null) return;
    const mine = ++seq.current;
    const asked = key;
    setBusy('test');
    setError(null);
    setHeld(null);
    const token = secret.current?.read() ?? '';
    // Sent once: the field lets go of the token as it goes (a retest needs it typed again; Save uses this preview).
    secret.current?.clear();
    setHasSecret(false);
    setTokenSent(true);
    try {
      const p = await sourcesApi.preview(pmConfigBody(system, name, url, true), system === 'jira' ? jiraBasic(email.trim(), token) : token);
      if (mine !== seq.current) return;
      // Held only when it is crew's whole preview: a hash to save, and every tool readable.
      if (!previewReadable(p)) { setError('crew answered the test in a form this studio can’t read, so nothing can be saved from it: update studio or crew.'); return; }
      setHeld({ key: asked, preview: p });
    } catch (e) {
      if (mine === seq.current) setError(codeOf(e) === 'pm_source_human_only' ? 'Only a person signed in to studio can register a project-management tool. Nothing was saved.' : words(e));
    } finally {
      if (mine === seq.current) setBusy(null);
    }
  };

  const readReach = async (sourceName: string): Promise<void> => {
    const mine = ++reachGen.current;
    setBusy('reach');
    setReach(null);
    try {
      // A token write still out goes first: the test reads what the token crew ends up with.
      // (Only then: with none out, the test starts in this same tick.)
      const out = rekeyPending(sourceName);
      if (out !== null) { await out.catch(() => undefined); if (mine !== reachGen.current) return; }
      const r = sourceTrackersOf(await trackersApi.sourceTrackers(sourceName), sourceName);
      if (mine !== reachGen.current) return;
      setReach(r === null ? { ok: false, words: 'crew’s answer could not be read: update studio or crew.' } : { ok: true, r: reachOf(r.trackers, r.next), at: new Date().toISOString() });
    } catch (e) {
      if (mine === reachGen.current) {
        const crew = reachFailureOf(e);
        setReach({ ok: false, words: trackerRefusal(e, 'read'), crew });
        // crew can't read the token: the field to type it again opens, and the page reads crew's state again.
        if (crew?.cause === 'secret_missing') { if (canRekey) setReplacing(true); onReread?.(); }
      }
    } finally {
      if (mine === reachGen.current) setBusy(null);
    }
  };

  const save = async (): Promise<void> => {
    if (preview === null || inFlight.current) return;
    inFlight.current = true;
    setBusy('save');
    setError(null);
    try {
      const granted = grants.key === key ? [...grants.names] : [];
      const s = await sourcesApi.save(preview.previewHash, undefined, granted).catch((e: unknown) => {
        if (codeOf(e) === 'preview_stale' || codeOf(e) === 'preview_required') setHeld(null);
        throw e;
      });
      // crew wrote the token to the keychain with the save: the field lets go of it now.
      setSaved(s);
      onSaved(s);
      inFlight.current = false;
      // Save registered the held preview (the field let go of the token when the test sent it). Then: which sites or
      // repositories the saved token reaches, a live read, no issue read.
      await readReach(s.name);
    } catch (e) {
      setError(codeOf(e) === 'pm_source_human_only' || codeOf(e) === 'write_grant_human_only' ? 'Only a person signed in to studio can register a project-management tool or grant its writes. Nothing was saved.' : words(e));
      setBusy(null);
    } finally {
      inFlight.current = false;
    }
  };

  /**
   * RE-KEY a saved source: the token typed again goes to crew's keychain write (`PUT /mcp/servers/:name/secret`), the
   * one request that carries it (Jira's as the same Basic credential the preview sends), and nothing else is sent: the
   * registry row (its links, agent access and tools) stays as it is, and only its `authState` is updated here. Then the
   * field lets go of it, and Test connection reads what the new token reaches. Only a source whose token is its own
   * keychain entry can take one (crew#719).
   */
  const savedAuth = !isNew ? (shownServer?.authState ?? 'none') : null;
  const refKind = secretRefKind(shownServer);
  const canRekey = !isNew && savedAuth !== 'none' && refKind === 'own';
  const rekeyOpen = canRekey && (savedAuth === 'missing' || replacing);
  const rekeyBlocker = !rekeyOpen ? null
    : system === 'jira' && !/^\S+@\S+$/.test(email.trim()) ? 'Account email is needed'
      : !hasSecret ? (system === 'jira' ? 'Type the API token' : 'Type the personal access token') : null;
  // A write sent by a sheet that closed: this one says how it ended (now, or when it settles), takes a saved token's
  // state into its record and the page's, and reads crew again. While it is out, this sheet writes nothing.
  const savedName = !isNew ? shownServer?.name ?? null : null;
  useEffect(() => {
    if (savedName === null) return;
    let live = true;
    const say = (o: 'saved' | 'refused' | 'unknown' | null): void => {
      if (o === null) return;
      if (o === 'saved') {
        setSaved((cur) => (cur !== null && cur.name === savedName ? ({ ...cur, authState: 'set' } as McpServer) : cur));
        onRekeyed?.(savedName);
        setRekeyStatus('The token typed before this sheet was opened again was saved to your keychain.');
      } else {
        setError(o === 'refused' ? 'The token typed before this sheet was opened again was not saved: type it again.'
          : 'studio could not confirm the token typed before this sheet was opened again was saved: Test connection shows whether it works.');
      }
      onReread?.();
    };
    const out = rekeyPending(savedName);
    if (out === null) { say(takeRekeyOutcome(savedName)); return; }
    // The busy state is the write's only while nothing else holds it (a test the sheet opened on waits for the write).
    setBusy((b) => b ?? 'rekey');
    const settle = (): void => {
      if (!live) return;
      setBusy((b) => (b === 'rekey' ? null : b));
      say(takeRekeyOutcome(savedName));
    };
    out.then(settle, settle);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the source the sheet opened on
  }, [savedName]);
  const rekey = async (): Promise<void> => {
    if (shownServer === null || !rekeyOpen || rekeyBlocker !== null || busy !== null || inFlight.current || rekeyPending(shownServer.name) !== null) return;
    const sourceName = shownServer.name;
    const token = secret.current?.read() ?? '';
    if (token === '') return;
    const value = system === 'jira' ? jiraBasic(email.trim(), token) : token;
    // crew's own rule for the value it is sent, said at the field rather than as a refused request.
    const shape = secretShapeProblem(value, 'token');
    if (shape !== null) { setError(shape); return; }
    inFlight.current = true;
    // Any test still out is older than this write: its answer lands nowhere.
    ++reachGen.current;
    setBusy('rekey');
    setError(null);
    setReach(null);
    setRekeyStatus('');
    const letGo = (): void => {
      secret.current?.clear();
      setHasSecret(false);
      setEmail('');
    };
    try {
      await rekeySource(sourceName, value);
      // crew wrote it: the field lets go of it, and of the account email that went with it.
      letGo();
      setReplacing(false);
      // Only the token's state changed: the latest record of THIS source takes it (crew's next list read confirms it).
      setSaved((cur) => (cur !== null && cur.name === sourceName ? ({ ...cur, authState: 'set' } as McpServer) : cur));
      onRekeyed?.(sourceName);
      inFlight.current = false;
      // Closed meanwhile: the outcome is left for the next sheet to say, and no test runs here.
      if (!alive.current) return;
      takeRekeyOutcome(sourceName);
      setRekeyStatus('Token saved to your keychain.');
      await readReach(sourceName);
    } catch (e) {
      if (!alive.current) return;
      takeRekeyOutcome(sourceName);
      const f = rekeyFailure(e);
      if (f.kind === 'unknown') {
        // No answer that proves nothing was written: crew may have written it. The field lets go of it either way, and
        // the page reads crew's state again; Test connection says whether the token works.
        letGo();
        onReread?.();
        setError('studio could not confirm the token was saved. crew may have written it: Test connection shows whether it works; type it again if not.');
      } else {
        setError(refusalWords(f, 'token'));
      }
      setBusy(null);
    } finally {
      inFlight.current = false;
    }
  };
  useEffect(() => {
    // The field opening (Replace, or crew finding the token missing at a test) takes the focus: on Jira the account
    // email, which comes first; on GitHub the token field.
    if (!replacing) return;
    if (system === 'jira') emailRef.current?.focus();
    else box.current?.querySelector<HTMLInputElement>('[data-testid="pm-secret"]')?.focus();
  }, [replacing, system]);

  const tools: ToolReview[] | null = shownServer !== null && !isNew ? toolReviewsOf((shownServer as { tools?: unknown }).tools, true)
    : preview !== null ? toolReviewsOf((preview as { tools?: unknown }).tools, false) : [];
  const agentAccess = !isNew && shownServer !== null ? agentAccessOf(shownServer as { agents?: unknown }) : null;
  const unverified = shownServer !== null && agentsUnverified?.has(shownServer.name) === true;
  const links: TrackerLink[] | null = !isNew && shownServer !== null ? trackerLinksListOf((shownServer as unknown as { trackers?: unknown }).trackers) : [];
  const projectName = (id: string): string => projects.find((p) => p.id === id)?.name ?? id;
  const replaces = isNew && existing.includes(name.trim());
  const title = isNew ? `Add ${systemName(system)}` : shownServer?.name ?? systemName(system);
  const frozen = busy === 'save';
  const tokenNote = tokenSent ? 'Sent once, with this test. Save keeps it in your keychain; type it again only to test again.' : 'Kept in your keychain. Never shown again, never in a file, a log or an agent’s context.';
  const savedNote = !isNew && savedAuth !== 'none' && (refKind === 'env' || refKind === 'other') ? elsewhereWords(refKind, 'token') : tokenNote;
  const secretField = (label: string): React.ReactElement => (
    <SecretField ref={secret} label={label} data-testid="pm-secret" note={isNew ? tokenNote : savedNote}
      savedState={savedAuth} disabled={busy !== null}
      rekey={!canRekey ? null : {
        open: replacing,
        onOpen: (open) => { setReplacing(open); setError(null); setRekeyStatus(''); if (!open) setEmail(''); },
        replace: 'Replace token',
        submit: () => void rekey(),
        focusOnOpen: system !== 'jira',
        note: system === 'jira'
          ? 'Type the account email and a new API token. Only the token changes: the links, agent access and tools stay as they are.'
          : 'Type a new token. Only the token changes: the links, agent access and tools stay as they are.',
      }}
      onEdit={(has) => { setHasSecret(has); setTokenSent(false); setSecretEdits((n) => n + 1); setError(null); }} />
  );

  return (
    <div className="wk-src-scrim" data-testid="pm-sheet-scrim">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="wk-src-sheet wk-pm-sheet" data-testid="pm-sheet" data-system={system} data-mode={isNew ? 'new' : 'saved'}>
        <header className="wk-src-sheet-head">
          <TrackerBadge system={system} />
          <h2 id={titleId} className="wk-src-title" data-testid="pm-sheet-title">{title}</h2>
          <span className="wk-tag">Project management</span>
          <button type="button" aria-label="Close" className="wk-btn wk-btn--quiet wk-btn--icon" data-testid="pm-sheet-close" onClick={onClose}><X size={16} aria-hidden /></button>
        </header>
        <div className="wk-src-sheet-main">
          <div className="wk-src-grid">
            <div className="wk-src-col" data-testid="pm-sheet-form">
              <p className="wk-pm-lede">
                {system === 'jira'
                  ? 'crew talks to Jira through Atlassian’s own MCP server. Agents read issues only from the Jira projects you link to a project or a repository.'
                  : 'crew talks to GitHub through GitHub’s own MCP server. Agents read issues only from the repositories you link as trackers.'}
              </p>
              <div className="wk-src-pair wk-pm-pair">
                <label className="wk-src-field"><span className="wk-src-label">Name</span>
                  <input data-testid="pm-name" className="wk-field wk-src-input" spellCheck={false} disabled={!isNew || frozen} value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
                  {replaces && <span className="wk-src-note wk-src-tone-warn" data-testid="pm-replaces">A source named {name.trim()} exists: saving replaces it.</span>}
                </label>
                <label className="wk-src-field"><span className="wk-src-label">Server</span>
                  <input data-testid="pm-url" className="wk-field wk-src-input wk-src-mono" spellCheck={false} disabled={!isNew || frozen} value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} />
                </label>
              </div>
              {system === 'jira' ? (
                // New: email and token side by side. Saved: the token under its state, with the email above it while it is
                // typed again (one wrapper either way, so the field keeps its place and its focus handling).
                <div className={isNew ? 'wk-src-pair' : 'wk-src-stack'}>
                  {(isNew || rekeyOpen) && (
                    <label className="wk-src-field"><span className="wk-src-label">Account email</span>
                      <input ref={emailRef} data-testid="pm-email" type="email" autoComplete="off" className="wk-field wk-src-input" spellCheck={false} disabled={isNew ? frozen : busy !== null} value={email} placeholder="crew-bot@example.com"
                        onChange={(e) => { setEmail(e.target.value); setError(null); }}
                        onKeyDown={isNew ? undefined : (e) => { if (e.key === 'Enter') { e.preventDefault(); void rekey(); } }} />
                    </label>
                  )}
                  {secretField('API token')}
                </div>
              ) : secretField('Personal access token')}
              {rekeyOpen && (
                <div className="wk-src-rekey" data-testid="pm-rekey">
                  <button type="button" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="pm-rekey-save" disabled={rekeyBlocker !== null || busy !== null} title={rekeyBlocker ?? undefined} onClick={() => void rekey()}>
                    {busy === 'rekey' ? 'Saving…' : 'Save token'}
                  </button>
                  <span className="wk-src-note" data-testid="pm-rekey-note">{rekeyBlocker ?? 'Writes it to your keychain, then tests the connection.'}</span>
                </div>
              )}
              {canRekey && <span role="status" className="wk-src-note wk-src-tone-ok" data-testid="pm-rekey-status">{rekeyStatus}</span>}
              {system === 'jira' ? (
                <div className="wk-pm-guide" data-tone="warn" data-testid="pm-token-advice">
                  <b>Jira API tokens can’t be limited to projects.</b> crew limits every call to the Jira projects you link: it sets the site, adds your linked projects to every search, and drops anything else from an answer before an agent sees it.
                </div>
              ) : (
                <div className="wk-pm-guide" data-tone="ok" data-testid="pm-token-advice">
                  <b>Use a fine-grained token</b> limited to the repositories you’ll link, with Issues: read (and write, if agents should comment). crew still limits every call to the linked repositories.
                </div>
              )}
              <div className="wk-src-box" data-testid="pm-test">
                <div className="wk-src-box-head">
                  {isNew ? (
                    <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="pm-test-run" disabled={blocker !== null || busy !== null} title={blocker ?? undefined} onClick={() => void test()}>
                      {busy === 'test' ? 'Testing…' : held !== null ? 'Test again' : 'Test connection'}
                    </button>
                  ) : (
                    <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="pm-test-reach" disabled={busy !== null} onClick={() => { if (shownServer !== null) void readReach(shownServer.name); }}>
                      {busy === 'reach' ? 'Testing…' : 'Test connection'}
                    </button>
                  )}
                  {((isNew && preview !== null) || (!isNew && reach?.ok === true)) && <span className="wk-tag wk-tag--ok" data-testid="pm-test-ok"><Check size={12} aria-hidden />Connected</span>}
                  {!isNew && reach?.ok === false && <span className="wk-tag wk-tag--fail" data-testid="pm-test-fail">Test failed</span>}
                  <span className="wk-src-cap">reads no issues</span>
                </div>
                {isNew && preview === null && busy !== 'test' && <p className="wk-src-note">{blocker ?? 'Test connects to the server with your token and lists its tools. It reads no issues.'}</p>}
                {isNew && preview !== null && (
                  <ul className="wk-pm-lines" data-testid="pm-test-lines">
                    <li>Connected{serverInfoWords(preview)}: {tools?.length ?? 0} tool{tools?.length === 1 ? '' : 's'}, each listed with its review.</li>
                    <li>Save it, and crew reads which {system === 'jira' ? 'sites' : 'repositories'} this token reaches.</li>
                  </ul>
                )}
                {!isNew && reach === null && busy !== 'reach' && <p className="wk-src-note" data-testid="pm-test-note">Test connection reads which {system === 'jira' ? 'sites and projects' : 'repositories'} the saved token reaches. It reads no issues.</p>}
                {!isNew && reach?.ok === true && <ul className="wk-pm-lines" data-testid="pm-test-reach-lines">{reachLines(system, reach.r).map((l) => <li key={l}>{l}</li>)}</ul>}
                {!isNew && reach?.ok === false && (
                  <div data-testid="pm-test-reach-error">
                    <p className="wk-src-note" data-testid="pm-test-saved">{savedWords(reach.crew ?? null, refKind)}</p>
                    {reach.crew != null ? (
                      <p className="wk-src-note wk-src-tone-fail" data-testid="pm-test-crew-said">
                        crew said: “{reach.crew.said}”{codeWords(reach.crew) !== null && <> <code data-testid="pm-test-crew-code">{codeWords(reach.crew)}</code></>}
                      </p>
                    ) : <p className="wk-src-note wk-src-tone-fail">{reach.words}</p>}
                  </div>
                )}
              </div>
              {links === null && <p className="wk-src-note wk-src-tone-fail" data-testid="pm-links-unreadable">crew’s list of this source’s linked trackers could not be read, so none is shown.</p>}
              {links !== null && links.length > 0 && (
                <div className="wk-src-box" data-testid="pm-links">
                  <p className="wk-src-strong">Linked trackers</p>
                  <ul className="wk-src-plain">
                    {links.map((l) => <li key={l.id} className="wk-src-note">{trackerTitle(l)}: linked to {l.target.kind === 'project' ? `project ${projectName(l.target.id)}` : `repository ${l.target.id}`}</li>)}
                  </ul>
                  <p className="wk-src-note">Link and remove trackers on a project’s Repositories tab or on a repository’s page.</p>
                </div>
              )}
            </div>
            <div className="wk-src-col" data-testid="pm-sheet-tools">
              <div className="wk-src-field">
                <span className="wk-src-label">Tools, reviewed before agents can use them</span>
                <span className="wk-src-note">Each tool is bound to the trackers a project links: which argument names the {system === 'jira' ? 'site and project' : 'repository'}, and which field says where an answer came from.</span>
              </div>
              {tools === null ? <p className="wk-src-note wk-src-tone-fail" data-testid="pm-tools-unreadable">crew’s list of this source’s tools could not be read, so no review is shown.</p> : tools.length === 0 ? <p className="wk-src-note" data-testid="pm-tools-empty">{isNew ? 'Test the connection, and each tool crew finds is listed here with its review.' : 'crew listed no tools for this source.'}</p> : (
                <div className="wk-pm-groups" data-testid="pm-tools">
                  {toolGroupsOf(system, tools).map((grp) => (
                    <section key={grp.key} className="wk-pm-group" data-testid="pm-tool-group" data-group={grp.key} aria-labelledby={`${titleId}-${grp.key}`}>
                      <h3 className="wk-src-note wk-pm-group-head" id={`${titleId}-${grp.key}`} data-testid="pm-tool-group-head"><span className="wk-src-strong">{grp.title}</span>{grp.rows ? '' : ` (${grp.tools.length})`}: {grp.reason}</h3>
                      {grp.rows ? (
                        <ul className="wk-pm-tools">
                          {grp.tools.map((t) => (
                              <li key={t.name} className="wk-pm-tool" data-testid="pm-tool" data-tool={t.name} data-verdict={t.verdict}>
                                <div className="wk-pm-tool-head">
                                  <code>{t.name}</code><span className="wk-tag wk-pm-kind">{t.kind}</span><span className="wk-src-sp" />
                                  <span className={`wk-tag wk-tag--${VERDICT_TONE[t.verdict]}`} data-testid="pm-tool-verdict">{VERDICT_WORDS[t.verdict]}</span>
                                </div>
                                <p className="wk-src-note">{t.note}</p>
                                {t.verdict === 'asks' && isNew && preview !== null && (
                                  <label className="wk-src-check-row" data-testid="pm-tool-grant">
                                    <input type="checkbox" checked={grants.key === key && grants.names.has(t.name)} disabled={busy !== null}
                                      onChange={(e) => {
                                        const on = e.target.checked;
                                        setGrants((g) => { const names = new Set(g.key === key ? g.names : []); if (on) names.add(t.name); else names.delete(t.name); return { key, names }; });
                                      }} />
                                    <span className="wk-src-note">Grant it: the deliver gate may then ask you to use it (a comment, a move). Not granted, no action can use it.</span>
                                  </label>
                                )}
                                {t.verdict === 'asks' && !isNew && <p className="wk-src-cap" data-testid="pm-tool-granted">{t.granted === true ? 'Granted at the save.' : t.granted === false ? 'Not granted: save the source again to grant it.' : ''}</p>}
                              </li>
                          ))}
                        </ul>
                      ) : (
                        <ul className="wk-pm-tool-names" data-testid="pm-tool-names">
                          {grp.tools.map((t) => (
                            <li key={t.name} className="wk-pm-tool-name" data-testid="pm-tool-chip" data-tool={t.name} data-verdict={t.verdict}>
                              <code>{t.name}</code>
                              {/* A write's grant is shown wherever the write is listed: a grant kept from a save stays visible. */}
                              {t.kind === 'writes' && t.granted === true && <span className="wk-pm-granted" data-testid="pm-tool-chip-granted"> · granted</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
              )}
              {!isNew && shownServer !== null && agentAccess !== null && (
                <AgentAccess
                  source={shownServer.name}
                  dialect="pm"
                  agents={agentAccess}
                  unverified={unverified}
                  {...(onReread !== undefined ? { onReread } : {})}
                  data-testid="pm-agent-controls"
                  onChanged={(agents) => {
                    const n = shownServer.name;
                    setSaved((cur) => (cur !== null && cur.name === n ? ({ ...cur, agents } as McpServer) : cur));
                    onAgents?.(n, agents);
                  }}
                />
              )}
              {isNew && <p className="wk-src-note" data-testid="pm-agents-after-save">The Agents switches come with the saved source: agents can see its structure once you choose their projects, and read issues only once you turn that on.</p>}
            </div>
          </div>
        </div>
        <footer className="wk-src-sheet-foot">
          {error !== null ? <p role="alert" className="wk-src-note wk-src-tone-fail wk-src-foot-msg" data-testid="pm-sheet-error">{error}</p>
            : <span className="wk-src-cap wk-src-foot-msg" data-testid="pm-sheet-foot">{isNew ? (preview !== null ? 'Saving keeps the token in your keychain.' : blocker ?? 'Test it first: Save registers exactly what the test saw.') : 'Saved. Link its trackers on a project or a repository.'}</span>}
          {isNew ? (
            <>
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="pm-cancel" onClick={onClose}>Cancel</button>
              <button type="button" className="wk-btn wk-btn--primary" data-testid="pm-save" disabled={preview === null || busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            </>
          ) : <button type="button" className="wk-btn wk-btn--primary" data-testid="pm-done" onClick={onClose}>Done</button>}
        </footer>
      </div>
    </div>
  );
}
