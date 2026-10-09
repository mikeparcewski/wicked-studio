import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import type { ChatOpenBody, ChatScope, RepoEntry, SessionView } from '../api/types.js';
import { needsYouRows } from '../board/needsYou.js';
import { useFailureClocks } from '../store/failureClocks.js';
import { forgetAskSession, readAskSession, writeAskSession } from '../store/askSession.js';
import { useGateStore } from '../store/gates.js';
import { useLiveChatsStore } from '../store/liveChats.js';
import { useMembershipStore } from '../store/membership.js';
import { useProjectsStore } from '../store/projects.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';
import { getCachedRoster, setCachedRoster } from '../store/rosterCache.js';
import {
  askPrompts,
  buildContextPack,
  PACK_JOIN,
  contextPackSummary,
  sectionLabel,
  type DiagnosticsState,
} from './askContext.js';
import { AssistDock, type AssistVerbs } from './AssistDock.js';
import { CaptureDrop } from './CaptureDrop.js';
import {
  askScopeIsScoped,
  askScopeOpenFields,
  ChatScopeSelect,
  defaultAskScope,
  describeResolvedScope,
  type AskScopeChoice,
} from './ChatScopeSelect.js';
import { defaultSelection, describeChatOpenRefusal } from './GroupChat.js';
import { apiStatus, apiWire } from '../api/errors.js';
import { ambientProjectId } from '../hooks/ambientProject.js';
import { peekTypedSeed, takeTypedSeed } from '../hooks/useTypeToComposer.js';
import { useAskThreadStore } from '../store/askThread.js';
import { useCapabilities } from '../store/capabilities.js';

/**
 * ASK — the app-wide binding of the ASSIST DOCK (DES-ASSIST-DOCK §5: "the dock becomes
 * 'ask for work from anywhere'"), opened from the rail's Ask button or Ctrl/⌘+Shift+A.
 *
 * A question launches a governed CHAT SESSION over the GroupChat seat machinery
 * (`POST /chats` warms the chat-capable roster, `POST /chats/:id/messages` fans the
 * question out) — the seats carry the estate/garden tooling that can actually look at
 * the databases, the code graph, and the run record. The FIRST message rides with the
 * context pack (`buildContextPack`): the current route/section, counts from the runs
 * fold the app already holds, and `GET /api/v1/diagnostics` CITED when the daemon
 * serves it — when it does not (older crews), the pack says so honestly.
 *
 * Opening the dock fires READS only (diagnostics + the session repo/project caches, to
 * seed honest quick prompts). NOTHING launches until the user sends — the quick-prompt
 * chips prefill the composer, never submit it.
 *
 * ASK-S1 (DES-ASK-TEAM-CHAT-001 §5.1): under `capabilities.askPath` the same two calls start a
 * TEAM PATH — `POST /chats` records the eligible seats (no seat is warmed), the first message
 * launches the run and later ones continue it; the 202 names the turn and the run. The dock
 * deposits each turn in the ask-thread store so the session thread shows the question at once,
 * passes the one seat the operator named (`primary`) when they named one, and says in plain words
 * when the PA is still answering (409 `turn_in_flight`) — the draft is kept.
 */

/** The persisted scope rides only when the daemon stated one (a missing key reads as not stated). */
function scopeField(scope: ChatScope | null): { scope?: ChatScope } {
  return scope !== null ? { scope } : {};
}

/** ASK-S1: the 202's turn (and, on a path, its run and answer step) lands in the ask-thread store, so
 *  the session thread shows the operator's words at once — what they typed, never the context pack. */
function deposit(chatId: string, typed: string, res: { turnId?: string; runId?: string; stepId?: string }): void {
  useAskThreadStore.getState().sent(chatId, {
    turnId: res.turnId ?? `local:${Date.now()}`, text: typed,
    ...(res.runId !== undefined ? { runId: res.runId } : {}),
    ...(res.stepId !== undefined ? { stepId: res.stepId } : {}),
  });
}

/** §8 F6: a message while the PA is answering is refused 409 `turn_in_flight` — said in plain words;
 *  the dock keeps the draft. Anything else is rethrown as it came. */
function stillAnswering(chatId: string): (e: unknown) => never {
  return (e: unknown) => {
    if (apiStatus(e) === 409 && /turn_in_flight|in flight|still answering/i.test(apiWire(e) ?? '')) {
      const pa = useAskThreadStore.getState().paByChat[chatId] ?? 'The helper';
      throw new Error(`${pa} is still answering — wait for the reply; your message was not sent.`);
    }
    throw e;
  };
}

export function AskDock({ runs, pathname, onClose, navigate, sendText, onHandoffTaken, sendProjectId, sendFresh = false, sendPrimary, sendChatId }: {
  runs: SessionView[];
  pathname: string;
  /** Collapsing the dock closes Ask entirely — the launcher bubble/shortcut reopen it. */
  onClose: () => void;
  /** The promote door (studio#323 R3): "Open in full chat" routes to `/chat/:id`. */
  navigate?: (path: string) => void;
  /** A message the operator already SENT from another composer (the Desk's, skin `desk`): the
   *  dock opens with it and sends it as the operator's own question. Absent ⇒ nothing is sent. */
  sendText?: string;
  /** Called once the dock has taken `sendText` (it is in the dock's own state and being sent):
   *  the caller drops it, so nothing can hand it over a second time. */
  onHandoffTaken?: () => void;
  /** S7: the project an `@project` chip named — the handed-over message's chat is scoped to it. */
  sendProjectId?: string;
  /** S7: the handed-over message starts a NEW session (an `@project` after the first send), never
   *  the one this dock would resume. */
  sendFresh?: boolean;
  /** ASK-S1: the helper the operator named with `@` to answer — the path's `primary` (chosen) when
   *  this send opens a new chat on a daemon with `capabilities.askPath`. */
  sendPrimary?: string;
  /** S16a-4e: the handoff is a reply into THIS chat (the chat session on screen): the dock resumes
   *  it (and stores it as its session) instead of its own stored chat. */
  sendChatId?: string;
}): React.ReactElement {
  // The letters that opened the dock (type-to-composer, §5.6 rule 4): read on mount, cleared
  // in an effect (a StrictMode double initializer must not read an already-emptied seed).
  const [typedSeed] = useState(peekTypedSeed);
  useEffect(() => { takeTypedSeed(); }, []);
  // A Desk handoff is read once, at mount, like the seed: later props never re-send it.
  const [handoff] = useState(() => sendText);
  const tookRef = useRef(onHandoffTaken);
  useEffect(() => { if (handoff !== undefined) tookRef.current?.(); }, [handoff]);
  const [diag, setDiag] = useState<DiagnosticsState>({ kind: 'loading' });
  const [repos, setRepos] = useState<RepoEntry[]>(() => getCachedRepos() ?? []);
  const projects = useProjectsStore((s) => s.projects);
  const liveChats = useLiveChatsStore((s) => s.sessions);
  // The needs-you fold's inputs, from the stores the app already holds (all
  // written elsewhere — the gate stream, the board model's mirrors): zero
  // requests ride on reading them here.
  const gates = useGateStore((s) => s.gates);
  const failedAt = useFailureClocks((s) => s.failedAtByRun);
  const attachedAt = useMembershipStore((s) => s.attachedAtByRun);
  const projectIds = useMembershipStore((s) => s.projectIdByRun);

  // The diagnostics read — presence-gated: absence is an ANSWER (older crew), never an error.
  useEffect(() => {
    let cancelled = false;
    getDiagnostics()
      .then((d) => {
        if (!cancelled) setDiag({ kind: 'present', diagnostics: d });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (isDiagnosticsUnsupported(e)) setDiag({ kind: 'unsupported' });
        else setDiag({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Prompt seeds: the session repo cache (one GET per session, shared with the palette/rail)
  // and the projects store (loaded here only if nothing has loaded it yet). Opening Ask is
  // the user gesture that pays for these reads.
  useEffect(() => {
    fetchReposCached()
      .then((rs) => setRepos([...rs].sort((a, b) => b.registered_at - a.registered_at)))
      .catch(() => {
        /* prompt seed only — the chip is omitted, never fabricated */
      });
    if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load();
  }, []);

  // The send verb closes over LIVE state via refs — the pack is assembled AT SEND TIME,
  // so it cites what the app knows at that moment (not at mount).
  const packInputs = useRef({ pathname, runs, liveChatCount: 0, diagnostics: diag as DiagnosticsState });
  packInputs.current = {
    pathname,
    runs,
    liveChatCount: Object.keys(liveChats).length,
    diagnostics: diag,
  };

  /** The session this dock RESUMES (studio#323 R3): the dock unmounts on close, so the
   *  id lives in sessionStorage — reopening Ask rejoins it instead of minting a second
   *  session and orphaning the first. Read once per mount. */
  // A fresh handoff (S7) forgets the stored session first, so its message opens a new one. A
  // handoff naming a project is always fresh: an open chat's scope cannot change, so the project
  // is honoured by a chat opened in it (before the composer's first send that IS its chat).
  const [resumed] = useState(() => {
    if (sendText !== undefined && (sendFresh || sendProjectId !== undefined)) {
      forgetAskSession();
      return null;
    }
    if (sendText !== undefined && sendChatId !== undefined) {
      const stored = readAskSession();
      if (stored !== null && stored.chatId === sendChatId) return stored;
      // The chat on screen, opened elsewhere: its context pack rode its own first send.
      const session = { chatId: sendChatId, title: '', seeded: true, scope: null };
      writeAskSession(session);
      return session;
    }
    return readAskSession();
  });
  /** The live chat session this dock opened — later sends reuse its warm seats. */
  const chatIdRef = useRef<string | null>(resumed?.chatId ?? null);
  /** True once the context pack LANDED with a message — it seeds the first successful
   *  send only. A resumed session carries its persisted flag: a first send that failed
   *  leaves it unseeded, so the pack still rides the next question. */
  const seededRef = useRef(resumed?.seeded === true);
  /** The session's first question — its /chats handle, re-persisted with the flag. */
  const titleRef = useRef(resumed?.title ?? '');

  // studio#323 R4 — the chat's scope, chosen before the first send: the route's project, else
  // everything, until the user picks. Once open, the header states what the daemon RESOLVED —
  // persisted with the session, so a reopened dock never offers a scope select for a chat that is
  // already open (a resumed session from before the field reads "not stated", never a choice).
  // Ask stays mounted across navigation (codex round 3 on #327): an UNTOUCHED choice is derived
  // from the CURRENT route each render; only a manual pick is state, and it survives navigation.
  // `ambientProjectId` is the one project-from-route rule (`/p/default` = Unfiled = none).
  const [manualScope, setManualScope] = useState<AskScopeChoice | null>(() =>
    (sendProjectId !== undefined ? `project:${sendProjectId}` : null));
  const scopeChoice: AskScopeChoice = manualScope ?? defaultAskScope(ambientProjectId(pathname));
  const scopeChoiceRef = useRef(scopeChoice);
  scopeChoiceRef.current = scopeChoice;
  /** `undefined` = no chat open yet (the select shows); `null` = open, scope not stated. */
  const [openedScope, setOpenedScope] = useState<ChatScope | null | undefined>(() =>
    resumed === null ? undefined : (resumed.scope ?? null));
  const scopeRef = useRef<ChatScope | null>(resumed?.scope ?? null);

  // ASK-S1 (Amendment 6 decision 5: studio renders ONE thread): on the chat's own session page the
  // session thread shows every turn as it happens, so once a send is accepted the dock steps aside
  // instead of showing the conversation a second time beside it. Anywhere else (the Desk, a page with
  // no thread) the dock stays — it is where the reply shows.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stepAside = useCallback((chatId: string) => {
    if (!useCapabilities.getState().askPath) return;
    const m = /^\/s\/([^/]+)/.exec(pathnameRef.current);
    if (m !== null && decodeURIComponent(m[1]!) === chatId) onCloseRef.current();
  }, []);

  const verbs: AssistVerbs = useMemo(
    () => ({
      send: async (text) => {
        let id = chatIdRef.current;
        if (id !== null && resumed !== null && id === resumed.chatId) {
          const message = seededRef.current ? text : `${text}${PACK_JOIN}${buildContextPack(packInputs.current)}`;
          try {
            deposit(id, text, await api.sendChatMessage(id, message).catch(stillAnswering(id)));
            if (!seededRef.current) {
              seededRef.current = true;
              writeAskSession({ chatId: id, title: titleRef.current, seeded: true, ...scopeField(scopeRef.current) });
            }
            stepAside(id);
            return { chatId: id };
          } catch (sendErr) {
            // A failed send is NOT proof the session is gone — a 5xx or a network blip
            // against a still-warm chat must not orphan it. Ask the daemon, as GroupChat's
            // rejoin does: ONLY an empty seat list (a 200) means reclaimed. Anything else —
            // warm seats, or a probe that itself fails ("do not know") — keeps the id and
            // surfaces the send's own error.
            const gone = await api
              .getChat(id)
              .then((detail) => detail.seats.length === 0)
              .catch(() => false);
            if (!gone) throw sendErr;
            // Reclaimed (idle reaper, pool cap, a daemon restart) — forget it and open a
            // fresh session for this question below.
            forgetAskSession(id);
            chatIdRef.current = null;
            seededRef.current = false;
            id = null;
            // The fresh session below opens with the scope chosen now (the one on record stands
            // for the reclaimed chat only).
          }
        }
        if (id === null) {
          // The chat-capable roster (EC44's derivation, reused verbatim) — cached when any
          // surface already fetched it; one GET /roster otherwise.
          let roster = getCachedRoster();
          if (roster === null) {
            const { roster: fetched } = await api.getRoster();
            setCachedRoster(fetched);
            roster = fetched;
          }
          const choice = scopeChoiceRef.current;
          const clis = defaultSelection(roster, askScopeIsScoped(choice));
          id = crypto.randomUUID();
          const body: ChatOpenBody = { chatId: id, ...askScopeOpenFields(choice, ambientProjectId(packInputs.current.pathname)) };
          if (clis.length > 0) body.clis = clis;
          // ASK-S1: the helper named with `@` answers (`selection: chosen`); unnamed, the engine picks at random.
          if (sendPrimary !== undefined && useCapabilities.getState().askPath && (clis.length === 0 || clis.includes(sendPrimary))) body.primary = sendPrimary;
          // A refused open reads as GroupChat's does (codex on #327): a pre-0.39.0 daemon's
          // "unknown field `scopeKind`" names the upgrade, never the raw wire.
          const { seats, scope } = await api.openChat(body).catch((e: unknown) => {
            throw new Error(describeChatOpenRefusal(apiStatus(e), apiWire(e), e instanceof Error ? e.message : String(e)));
          });
          const ready = seats.filter((s) => s.ok).map((s) => s.cliKey);
          if (ready.length === 0) {
            const detail =
              seats.length > 0
                ? seats.map((s) => `${s.cliKey}: ${s.error ?? 'failed'}`).join('; ')
                : useCapabilities.getState().askPath ? 'no signed-in helper is eligible to answer' : 'the daemon warmed no seats';
            throw new Error(`${useCapabilities.getState().askPath ? 'No helper can answer' : 'No agent seat came up'} — ${detail}`);
          }
          chatIdRef.current = id;
          scopeRef.current = scope ?? null;
          setOpenedScope(scope ?? null);
          // Persist for the tab — a close/reopen (or reload) resumes THIS session.
          titleRef.current = text;
          writeAskSession({ chatId: id, title: text, seeded: false, ...scopeField(scopeRef.current) });
          // The session is live — make it findable on the rail (the J4 live row) and on
          // /chats, labelled with where it came from and what was asked (studio#323 R2).
          useLiveChatsStore.getState().upsert(id, ready, { origin: 'ask', title: text });
        }
        const message = seededRef.current ? text : `${text}${PACK_JOIN}${buildContextPack(packInputs.current)}`;
        deposit(id, text, await api.sendChatMessage(id, message).catch(stillAnswering(id)));
        if (!seededRef.current) {
          seededRef.current = true;
          writeAskSession({ chatId: id, title: titleRef.current, seeded: true, ...scopeField(scopeRef.current) });
        }
        stepAside(id);
        return { chatId: id };
      },
    }),
    [resumed, sendPrimary, stepAside],
  );

  const prompts = useMemo(
    () =>
      askPrompts({
        runs,
        // THE home-queue fold (needsYouRows — DES-HOME-COMMAND-CENTER §3), so
        // the failed-run chip seeds the SAME newest failed run the queue shows
        // (E1) — never a second recency derivation. Chats/campaigns ride empty
        // here: absence adds no rows, and the failed-run pick reads none of
        // them. `now` feeds only the (absent) stalled-chat rows — the fold
        // stays effectively pure in this memo's deps.
        needRows: needsYouRows({
          runs,
          gates,
          failedAt,
          attachedAt,
          projectIds,
          chats: [],
          repos,
          campaigns: [],
          now: Date.now(),
        }),
        projects: [...projects].sort((a, b) => b.updated_at - a.updated_at),
        repos,
      }),
    [runs, gates, failedAt, attachedAt, projectIds, projects, repos],
  );

  return (
    <AssistDock
      context={{
        surface: 'ask',
        title: 'Ask',
        contextLabel:
          openedScope === undefined
            ? `here: ${sectionLabel(pathname)}`
            : `here: ${sectionLabel(pathname)} · ${describeResolvedScope(openedScope)}`,
        placeholder: 'Ask about projects, repos, runs — or this studio itself…',
        hint:
          'Your question opens a governed chat session — the agents carry the estate/garden ' +
          'tooling that reads the code graph, the stores, and the run record, so they can answer ' +
          'about your projects AND diagnose the app itself. ' +
          contextPackSummary(diag),
        prompts,
        controls:
          openedScope === undefined ? (
            <>
              <ChatScopeSelect value={scopeChoice} onChange={setManualScope} projects={projects} repos={repos} />
              {/* Behaviour 8: or drop notes / a photo instead — the proposals land in Home's Needs You. */}
              <CaptureDrop
                runs={runs}
                pathname={pathname}
                inline
                onReview={navigate === undefined ? undefined : () => { navigate('/'); onClose(); }}
              />
            </>
          ) : undefined,
      }}
      verbs={verbs}
      resumeChatId={resumed?.chatId ?? null}
      onResumeGone={(chatId) => {
        // studio#328: the daemon reclaimed it — forget the stored id so no reopen
        // repeats the dead session, and the next send opens a fresh one.
        forgetAskSession(chatId);
        useLiveChatsStore.getState().remove(chatId);
        if (chatIdRef.current === chatId) {
          chatIdRef.current = null;
          seededRef.current = false;
          // No chat is open any more: the next send opens a fresh one, so the scope is a choice again.
          scopeRef.current = null;
          setOpenedScope(undefined);
        }
      }}
      fill
      typeTarget="ask"
      initialText={handoff ?? typedSeed}
      sendOnOpen={handoff !== undefined && handoff.trim() !== ''}
      onExpandChat={
        navigate === undefined
          ? undefined
          : (chatId) => {
              // ASK-S1 (codex #8): under the capability the chat IS a path and its thread is the session;
              // the legacy fan-out surface (`/chat/:id`) would draw a pending bubble per eligible seat.
              // S16a-4e: a chat is its session — the promote door is always `/s/<id>`.
              navigate(`/s/${encodeURIComponent(chatId)}`);
              onClose();
            }
      }
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    />
  );
}
