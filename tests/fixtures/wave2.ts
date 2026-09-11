/**
 * Recorded wire shapes for the wave-2 consumers (studio#251 / #246 / #248) —
 * `wicked-crew-api-types` 0.32.0, privacy-scrubbed (paths under `/w2/…`).
 *
 *  - `RepoEntry.findings[]` (wicked-core#406 via crew#517): the messages are the
 *    engine's own sentences from `wicked-core/src/repo.rs` `code_graph_db_and_findings`
 *    — the in-tree graph beside a LIVE graph, the in-tree graph with NO live graph
 *    (the re-onboard remedy), and the unresolvable root.
 *  - `DiagnosticsGovernance` (crew#495 / F-022): the shapes `governance-health.ts`
 *    folds — healthy, dead-lettered (the F-022 signal; the message carries the
 *    `wicked-crew governance replay …` recipe), no store, and the legacy HOME outbox.
 *  - `ChatScope` (crew#502 / F-067): a project scope with a bound graph, a repo scope
 *    with no graph and the daemon's reason, an explicit `none`, and a project scope
 *    with a dangling member.
 */
import type {
  ChatOpenResponse,
  ChatScope,
  DiagnosticsGovernance,
  RepoEntry,
} from '../../src/api/types.js';

// ── #251 — repo records ────────────────────────────────────────────────────────

const STATE_HOME = '/w2/state/repo-graphs';

export const REPO_CLEAN: RepoEntry = {
  id: 'billing', name: 'billing', root_path: '/w2/repos/billing', default_branch: 'main',
  registered_at: 1_757_500_000, code_graph_db: `${STATE_HOME}/billing-3f2a/estate.db`, findings: [],
};

/** An older daemon: no `findings` key at all (the field is optional in the TYPE only for this). */
export const REPO_PREDATES_FINDINGS: RepoEntry = {
  id: 'legacy', name: 'legacy', root_path: '/w2/repos/legacy', default_branch: 'main', registered_at: 1_757_400_000,
};

export const REPO_INTREE_LIVE: RepoEntry = {
  id: 'studio-api', name: 'studio-api', root_path: '/w2/repos/studio-api', default_branch: 'main',
  registered_at: 1_757_510_000, code_graph_db: `${STATE_HOME}/studio-api-9c1e/estate.db`,
  findings: [{
    code: 'in_tree_code_graph_ignored',
    message:
      '/w2/repos/studio-api/.codegraph exists in the checkout — a code graph an older wicked-core indexed IN the ' +
      `working tree. It is ignored (the live graph is ${STATE_HOME}/studio-api-9c1e/estate.db; never inside the ` +
      'repository). Delete `.codegraph/` from the checkout — and `git rm --cached` it if the repository tracks it — to ' +
      'clear this finding (core#406).',
    path: '/w2/repos/studio-api/.codegraph',
  }],
};

export const REPO_INTREE_NO_LIVE: RepoEntry = {
  id: 'wicked-studio', name: 'wicked-studio', root_path: '/w2/repos/wicked-studio', default_branch: 'main',
  registered_at: 1_757_520_000, code_graph_db: `${STATE_HOME}/wicked-studio-77ab/estate.db`,
  findings: [{
    code: 'in_tree_code_graph_ignored',
    message:
      '/w2/repos/wicked-studio/.codegraph exists in the checkout — a code graph an older wicked-core indexed IN the ' +
      'working tree. It is ignored (no graph has been indexed under the state home yet — re-run onboarding ' +
      `(POST /repos/wicked-studio/onboard) to build ${STATE_HOME}/wicked-studio-77ab/estate.db; never inside the ` +
      'repository). Delete `.codegraph/` from the checkout — and `git rm --cached` it if the repository tracks it — to ' +
      'clear this finding (core#406).',
    path: '/w2/repos/wicked-studio/.codegraph',
  }],
};

export const REPO_ROOT_UNRESOLVABLE: RepoEntry = {
  id: 'orphan', name: 'orphan', root_path: '/w2/repos/orphan', default_branch: 'main',
  registered_at: 1_757_530_000, code_graph_db: '',
  findings: [{
    code: 'code_graph_root_unresolvable',
    message:
      'no repo-graph root resolves for this daemon (no WICKED_ESTATE_REPO_GRAPH_ROOT override, no state home, ' +
      'no HOME / USERPROFILE): the repo has no code graph until one does',
    path: null,
  }],
};

// ── #246 — diagnostics.governance ─────────────────────────────────────────────

const GOV_STORE = '/w2/state/core.db.governance/governance.db';
const GOV_OUTBOX = '/w2/state/core.db.governance/emit-outbox.ndjson';
const LEGACY_OUTBOX = '/w2/home/.something-wicked/wicked-apps/emit-outbox.ndjson';

export const GOVERNANCE_HEALTHY: DiagnosticsGovernance = {
  store: { path: GOV_STORE, source: 'core-db-sidecar' },
  records: { total: 412, sinceBoot: 37 },
  deadletters: {
    path: GOV_OUTBOX, count: 0, byType: {}, byReason: {}, timestamped: 0, untimestamped: 0,
    oldestTs: null, newestTs: null, truncated: false, legacyOutbox: null,
  },
  findings: [],
};

/** The F-022 signal: every governance event dead-lettered; the finding names the replay. */
export const GOVERNANCE_DEADLETTERS: DiagnosticsGovernance = {
  store: { path: GOV_STORE, source: 'flag' },
  records: { total: 0, sinceBoot: 0 },
  deadletters: {
    path: GOV_OUTBOX, count: 128,
    byType: { 'wicked.crew.governance.conformance_recorded': 96, 'wicked.crew.governance.decision_recorded': 32 },
    byReason: { 'no shared store (WICKED_ESTATE_DB unset)': 128 },
    timestamped: 120, untimestamped: 8, oldestTs: Date.UTC(2026, 8, 10, 16), newestTs: Date.UTC(2026, 8, 10, 18),
    truncated: true, legacyOutbox: null,
  },
  findings: [{
    kind: 'governance.deadletter', severity: 'error',
    message:
      `128 governance event(s) dead-lettered to ${GOV_OUTBOX} (at least — the fold stopped at its size cap), newest ` +
      '2026-09-10T18:00:00.000Z — the store refused or was unset when they were emitted (no shared store ' +
      `(WICKED_ESTATE_DB unset)); replay them with wicked-crew governance replay ${GOV_OUTBOX} --governance-db ${GOV_STORE}`,
  }],
};

/** A boot that resolved NO store — must never read as "Governed". */
export const GOVERNANCE_NO_STORE: DiagnosticsGovernance = {
  store: null,
  records: { total: null, sinceBoot: null },
  deadletters: {
    path: null, count: 0, byType: {}, byReason: {}, timestamped: 0, untimestamped: 0,
    oldestTs: null, newestTs: null, truncated: false, legacyOutbox: null,
  },
  findings: [{
    kind: 'governance.store', severity: 'error',
    message:
      'this daemon resolved no governance store — WICKED_ESTATE_DB is not exported to the engine, so every governance ' +
      'event (conformance claims, phase transitions, rule lifecycle) dead-letters instead of landing; boot through ' +
      '`wicked-crew serve` (which resolves <core db>.governance/governance.db) or pass --governance-db; inspect any ' +
      'outbox meanwhile with wicked-crew governance replay <outbox.ndjson> --dry-run',
  }],
};

/** Healthy store, but the pre-fix HOME outbox still holds events — a warning, not an error. */
export const GOVERNANCE_LEGACY_OUTBOX: DiagnosticsGovernance = {
  store: { path: GOV_STORE, source: 'env-estate' },
  records: { total: 12, sinceBoot: null },
  deadletters: {
    path: GOV_OUTBOX, count: 0, byType: {}, byReason: {}, timestamped: 0, untimestamped: 0,
    oldestTs: null, newestTs: null, truncated: false, legacyOutbox: { path: LEGACY_OUTBOX, bytes: 48_213 },
  },
  findings: [{
    kind: 'governance.legacy-outbox', severity: 'warning',
    message:
      `a pre-fix dead-letter outbox exists under HOME at ${LEGACY_OUTBOX} (48213 bytes) — events every earlier daemon ` +
      `on this host spooled there instead of storing; inspect it with wicked-crew governance replay ${LEGACY_OUTBOX} ` +
      `--governance-db ${GOV_STORE} --dry-run, then replay it into this daemon's store with wicked-crew governance ` +
      `replay ${LEGACY_OUTBOX} --governance-db ${GOV_STORE} (a replay appends the lines that fail to land back onto ` +
      'that same file, so this warning persists until they are repaired)',
  }],
};

// ── #248 — chat scope ─────────────────────────────────────────────────────────

const CHAT_CWD = '/w2/tmp/wicked-crew-chats/4242-9f3a1c2b/chat-1';

export const SCOPE_PROJECT: ChatScope = {
  kind: 'project', projectId: 'api-migration',
  repos: [
    { id: 'studio-api', name: 'studio-api', rootPath: '/w2/repos/studio-api' },
    { id: 'billing', name: 'billing', rootPath: '/w2/repos/billing' },
  ],
  cwd: CHAT_CWD,
  graph: { bound: true, reason: "bound to project 'api-migration's co-located code graph." },
  dangling: [],
};

export const SCOPE_REPOS_NO_GRAPH: ChatScope = {
  kind: 'repos',
  repos: [{ id: 'billing', name: 'billing', rootPath: '/w2/repos/billing' }],
  cwd: CHAT_CWD,
  graph: { bound: false, reason: "'billing' has no resolvable code graph (not indexed yet — onboard the repo); this chat gets none." },
  dangling: [],
};

export const SCOPE_NONE: ChatScope = {
  kind: 'none', repos: [], cwd: CHAT_CWD,
  graph: {
    bound: false,
    reason: 'the chat names no project and no repos, so its seats see only their own scratch root and no code graph; pass projectId or repoRefs to scope it.',
  },
  dangling: [],
};

export const SCOPE_PROJECT_DANGLING: ChatScope = {
  kind: 'project', projectId: 'auth-refactor',
  repos: [{ id: 'studio-api', name: 'studio-api', rootPath: '/w2/repos/studio-api' }],
  cwd: CHAT_CWD,
  graph: { bound: false, reason: 'the project graph has never been built. POST /api/v1/projects/auth-refactor/graph/refresh fixes it.' },
  dangling: ['old-auth-service'],
};

export function chatOpened(chatId: string, scope: ChatScope, seats: string[] = ['claude']): ChatOpenResponse {
  return { chatId, seats: seats.map((cliKey) => ({ cliKey, ok: true })), scope };
}

/** crew#502's refusals as `POST /chats` answers them — `{status, body}` for a fetch stub. */
export const CHAT_OPEN_REFUSALS = {
  missing: { status: 404, body: { error: "Repo 'ghost', 'phantom' not found", missing: ['ghost', 'phantom'] } },
  ambiguous: {
    status: 400,
    body: { error: "repoRef 'api' is ambiguous — 2 registered repos share that name ('api-1' at /w2/repos/api-1, 'api-2' at /w2/repos/api-2); name the repo by id." },
  },
  engine: {
    status: 501,
    body: {
      error:
        'the installed wicked-core-ts predates chat scope (wicked-core#410): it cannot ground a scoped chat or hold ' +
        'its read roots read-only — upgrade the engine, or open the chat without projectId/repoRefs.',
    },
  },
  overlap: {
    status: 409,
    body: {
      error:
        "repo 'scratchpad' is registered at /w2/tmp/wicked-crew-chats/scratchpad, which overlaps this daemon's chat " +
        "scratch base /w2/tmp/wicked-crew-chats; a chat's scratch root can never sit inside a repository (nor a " +
        'repository inside the scratch base) — register the repo elsewhere or set TMPDIR for the daemon.',
    },
  },
} as const;
