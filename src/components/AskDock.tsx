import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import type { RepoEntry, SessionView } from '../api/types.js';
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
  contextPackSummary,
  sectionLabel,
  type DiagnosticsState,
} from './askContext.js';
import { AssistDock, type AssistVerbs } from './AssistDock.js';
import { defaultSelection } from './GroupChat.js';

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
 */

export function AskDock({ runs, pathname, onClose, navigate }: {
  runs: SessionView[];
  pathname: string;
  /** Collapsing the dock closes Ask entirely — the launcher bubble/shortcut reopen it. */
  onClose: () => void;
  /** The promote door (studio#323 R3): "Open in full chat" routes to `/chat/:id`. */
  navigate?: (path: string) => void;
}): React.ReactElement {
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
  const [resumed] = useState(() => readAskSession());
  /** The live chat session this dock opened — later sends reuse its warm seats. */
  const chatIdRef = useRef<string | null>(resumed?.chatId ?? null);
  /** True once the context pack LANDED with a message — it seeds the first successful
   *  send only. A resumed session carries its persisted flag: a first send that failed
   *  leaves it unseeded, so the pack still rides the next question. */
  const seededRef = useRef(resumed?.seeded === true);
  /** The session's first question — its /chats handle, re-persisted with the flag. */
  const titleRef = useRef(resumed?.title ?? '');

  const verbs: AssistVerbs = useMemo(
    () => ({
      send: async (text) => {
        let id = chatIdRef.current;
        if (id !== null && resumed !== null && id === resumed.chatId) {
          const message = seededRef.current ? text : `${text}\n\n---\n${buildContextPack(packInputs.current)}`;
          try {
            await api.sendChatMessage(id, message);
            if (!seededRef.current) {
              seededRef.current = true;
              writeAskSession({ chatId: id, title: titleRef.current, seeded: true });
            }
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
          const clis = defaultSelection(roster);
          id = crypto.randomUUID();
          const body: { chatId: string; clis?: string[] } = { chatId: id };
          if (clis.length > 0) body.clis = clis;
          const { seats } = await api.openChat(body);
          const ready = seats.filter((s) => s.ok).map((s) => s.cliKey);
          if (ready.length === 0) {
            const detail =
              seats.length > 0
                ? seats.map((s) => `${s.cliKey}: ${s.error ?? 'failed'}`).join('; ')
                : 'the daemon warmed no seats';
            throw new Error(`No agent seat came up — ${detail}`);
          }
          chatIdRef.current = id;
          // Persist for the tab — a close/reopen (or reload) resumes THIS session.
          titleRef.current = text;
          writeAskSession({ chatId: id, title: text, seeded: false });
          // The session is live — make it findable on the rail (the J4 live row) and on
          // /chats, labelled with where it came from and what was asked (studio#323 R2).
          useLiveChatsStore.getState().upsert(id, ready, { origin: 'ask', title: text });
        }
        const message = seededRef.current ? text : `${text}\n\n---\n${buildContextPack(packInputs.current)}`;
        await api.sendChatMessage(id, message);
        if (!seededRef.current) {
          seededRef.current = true;
          writeAskSession({ chatId: id, title: titleRef.current, seeded: true });
        }
        return { chatId: id };
      },
    }),
    [resumed],
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
        contextLabel: `here: ${sectionLabel(pathname)}`,
        placeholder: 'Ask about projects, repos, runs — or this studio itself…',
        hint:
          'Your question opens a governed chat session — the agents carry the estate/garden ' +
          'tooling that reads the code graph, the stores, and the run record, so they can answer ' +
          'about your projects AND diagnose the app itself. ' +
          contextPackSummary(diag),
        prompts,
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
        }
      }}
      fill
      onExpandChat={
        navigate === undefined
          ? undefined
          : (chatId) => {
              navigate(`/chat/${encodeURIComponent(chatId)}`);
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
