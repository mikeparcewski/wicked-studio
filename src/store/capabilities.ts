import { create } from 'zustand';

/**
 * The daemon's `GET /health.capabilities` the session surfaces read (S6a): read once at startup.
 * `runChatId` (C1, api-types 0.71.0) — runs carry `chat_id`, so a chat and its runs are one
 * session. Absent, or a failed read, is `false`: every run is its own session (§7).
 */
interface CapabilitiesStore {
  loaded: boolean;
  runChatId: boolean;
  /** `walkthroughRoots` (WT-W1, api-types 0.74.0) — repo-bound runs get an evidence root, so a
   *  walkthrough step can record; absent, the walkthrough artifact is not offered. */
  walkthroughRoots: boolean;
  /** `askPath` (DES-ASK-TEAM-CHAT-001 §5.1, api-types 0.92.0) — an ask starts a team path: one primary
   *  helper answers, a reviewer watches, help requests are rows on the bus. Absent or false (an older
   *  daemon): every helper answers at once and the thread says so (§8 F13). */
  askPath: boolean;
  /** `chatIdOnLaunch` (crew#619, api-types 0.39.0) — a launch may name the chat it was promoted from
   *  (`POST /runs {chatId}`), so the run lands in that chat's session. Absent or false (an older
   *  daemon): studio sends no key and a launch from a chat opens its own `run:<id>` session (S19a). */
  chatIdOnLaunch: boolean;
  /** `deliverGate` (F-E2E-030; crew 0.7.33 / core-ts 0.7.24) — a delivering launch's push is gated
   *  by a human by default, and an unattended posture may opt out with `deliverGate: 'auto'`. Absent
   *  or false (an older daemon): studio sends no key so the older launch schema never rejects it. */
  deliverGate: boolean;
  /** `reducedAssurance` (wicked-core#850) — a launch may opt into reduced assurance
   *  (`POST /runs {reducedAssurance: true}`). Absent or false (an older daemon): the opt-in is not
   *  offered and the key is never sent. */
  reducedAssurance: boolean;
  /** `launchPrimary` (crew#1077, api-types 0.128.0) — a launch may name the seat that leads it
   *  (`POST /runs {primary}`). Absent or false (an older daemon): the Lead agent picker is not
   *  offered and the key is never sent (its strict schema 400s on it). */
  launchPrimary: boolean;
  /** `chatList` (DES-SYSTEM-CHAT, crew) — `GET /chats` lists the user's past system chats and a chat
   *  can be closed without losing its history. Absent or false (an older daemon): the system chat's
   *  past-chats rail is hidden behind a one-line note. */
  chatList: boolean;
  /** `chatAttachments` (DES-SYSTEM-CHAT, crew) — `POST /chats/:id/attachments` carries files the seat
   *  can read. Absent or false: the system chat offers no upload (the same one-line note). */
  chatAttachments: boolean;
  /** `chatWorkflows` (crew#1157, api-types 0.141.0) — the read-only workflows `POST /chats {workflow}`
   *  runs on this daemon (`analyze`). Absent, empty or a failed read: Understand's Ask opens a plain chat. */
  chatWorkflows: string[];
  /** `powerMode` (program DES-POWER-MODE, api-types 0.149.0) — the engine runs power mode: the run header's switch and
   *  rigor chip, the thread's intake card, checkpoints and hand-off card, Settings' "Power mode for new jobs" and the
   *  New job switch. Absent or false (an older daemon): none of it is shown and `power` is never sent. */
  powerMode: boolean;
  /** `voice` (crew voice mode, DES-VOICE §2a): the daemon serves `/voice/*`. The mic sits beside every composer's Send
   *  only then (not ready → it opens setup; ready → voice mode). Absent or false: no mic. */
  voice: boolean;
  /** `chatArtifacts.context` (DES-CHAT-ARTIFACTS-001 §14, api-types 0.169.0): a chat message may carry `context` (the
   *  open artifact, the page summary) and `POST /chats` may carry `seedFromArtifact`. Absent or false (an older daemon,
   *  whose message body is strict): neither is ever sent, and the page summary rides in the text as before. */
  chatContext: boolean;
  /** `chatArtifacts.proposals` (DES-CHAT-ARTIFACTS-001 §4, api-types 0.170.0): a chat's `proposal` records draw as
   *  proposal cards answered with `POST /chats/:id/proposals/:pid`. Absent or false: none is drawn. */
  chatProposals: boolean;
  /** `chatArtifacts.stub`: the daemon runs the chat-artifacts test configuration (Go starts nothing); the card says so. */
  chatArtifactsStub: boolean;
  /** `chatArtifacts.stubOps` (api-types 0.171.0, A3): the kinds still stubbed under the test configuration; `null` = the
   *  daemon did not say (with `stub`, every kind is). */
  chatArtifactsStubOps: string[] | null;
  /** `apps.uploads` (DES-APPS-001 K1, api-types 0.175.0): crew serves Apps data sources — the `/sources/*` routes and
   *  `POST /apps/uploads`, registered together (crew `registerSourceRoutes`). The sidebar's Data sources entry shows only
   *  then; `/sources` still answers by address and says this crew doesn't support data sources yet. */
  dataSources: boolean;
  /** `planGateNote` (crew#1139, api-types 0.188.0) — a plan approval carries the person's note (`amend` beside
   *  `approve: true` at a plan gate), landing on the plan's first creator step. Absent or false (an older engine
   *  refuses the note): the plan card offers no note and the approve never carries `amend` (studio#992). */
  planGateNote: boolean;
  /** `chatJobProposals` (DES-CATALOG-002 §4.6, api-types 0.192.0): a chat's `job` proposals (and v2 `create` ones) are
   *  drawn as wicked's passage, revised through `POST /chats/:id/proposals`, and a run they launched answers its plan
   *  gate with `ord` + `planRev`. Absent or false (an older daemon): today's flow, nothing of it is sent. */
  chatJobProposals: boolean;
  /** `reshapeRun` (api-types 0.192.0): `POST /runs/:id/reshape` is served (a plan offer's Start again). */
  reshapeRun: boolean;
  /** `trackerLinks` (DES-PM-001 PM-1, api-types 0.187.0): crew serves the tracker-links routes and project-management
   *  sources (Jira, GitHub Issues). Absent or false (an older crew): no PM sheet, no Linked trackers card, no tracker set
   *  on a job, no "From an issue" in the composer and no `projectId` on the linked-issues preview. */
  trackerLinks: boolean;
  load: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useCapabilities = create<CapabilitiesStore>((set, get) => ({
  loaded: false,
  runChatId: false,
  walkthroughRoots: false,
  askPath: false,
  chatIdOnLaunch: false,
  deliverGate: false,
  reducedAssurance: false,
  launchPrimary: false,
  chatList: false,
  chatAttachments: false,
  chatWorkflows: [],
  powerMode: false,
  voice: false,
  chatContext: false,
  chatProposals: false,
  chatArtifactsStub: false,
  chatArtifactsStubOps: null,
  dataSources: false,
  planGateNote: false,
  chatJobProposals: false,
  reshapeRun: false,
  trackerLinks: false,
  load: () => {
    if (get().loaded) return Promise.resolve();
    // The HTTP client is reached lazily: the stores that read a capability (gates, the ask thread)
    // import this module, and a store must not pull the client into every importer's module graph.
    inflight ??= import('../api/client.js').then(({ api }) => api.getHealth())
      .then((h) => {
        const caps = ((h as unknown as { capabilities?: Record<string, unknown> }).capabilities) ?? {};
        set({ loaded: true, runChatId: caps['runChatId'] === true, walkthroughRoots: caps['walkthroughRoots'] === true, askPath: caps['askPath'] === true, chatIdOnLaunch: caps['chatIdOnLaunch'] === true, deliverGate: caps['deliverGate'] === true, reducedAssurance: caps['reducedAssurance'] === true, launchPrimary: caps['launchPrimary'] === true, chatList: caps['chatList'] === true, chatAttachments: caps['chatAttachments'] === true, chatWorkflows: Array.isArray(caps['chatWorkflows']) ? (caps['chatWorkflows'] as unknown[]).filter((w): w is string => typeof w === 'string') : [], powerMode: caps['powerMode'] === true, voice: caps['voice'] === true, chatContext: (caps['chatArtifacts'] as { context?: unknown } | undefined)?.context === true, chatProposals: (caps['chatArtifacts'] as { proposals?: unknown } | undefined)?.proposals === true, chatArtifactsStub: (caps['chatArtifacts'] as { stub?: unknown } | undefined)?.stub === true, chatArtifactsStubOps: stubOpsOf(caps['chatArtifacts']), dataSources: (caps['apps'] as { uploads?: unknown } | undefined)?.uploads === true, trackerLinks: caps['trackerLinks'] === true, planGateNote: caps['planGateNote'] === true, chatJobProposals: caps['chatJobProposals'] === true, reshapeRun: caps['reshapeRun'] === true });
      })
      .catch(() => { set({ loaded: true, runChatId: false, walkthroughRoots: false, askPath: false, chatIdOnLaunch: false, deliverGate: false, reducedAssurance: false, launchPrimary: false, chatList: false, chatAttachments: false, chatWorkflows: [], powerMode: false, voice: false, chatContext: false, chatProposals: false, chatArtifactsStub: false, chatArtifactsStubOps: null, dataSources: false, trackerLinks: false, planGateNote: false, chatJobProposals: false, reshapeRun: false }); })
      .finally(() => { inflight = null; });
    return inflight;
  },
}));

/** `chatArtifacts.stubOps` as a list of kind names, or `null` when absent or malformed. */
function stubOpsOf(raw: unknown): string[] | null {
  const ops = (raw as { stubOps?: unknown } | undefined)?.stubOps;
  return Array.isArray(ops) ? ops.filter((k): k is string => typeof k === 'string') : null;
}

/** Whether Go on a proposal of this kind is the test configuration's stub (it starts nothing). */
export function proposalIsStub(stub: boolean, stubOps: readonly string[] | null, kind: string): boolean {
  return stub && (stubOps === null || stubOps.includes(kind));
}
