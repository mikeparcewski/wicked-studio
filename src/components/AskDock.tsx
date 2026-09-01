import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { getDiagnostics, isDiagnosticsUnsupported } from '../api/diagnostics.js';
import type { RepoEntry, SessionView } from '../api/types.js';
import { useLiveChatsStore } from '../store/liveChats.js';
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

export function AskDock({ runs, pathname, onClose }: {
  runs: SessionView[];
  pathname: string;
  /** Collapsing the dock closes Ask entirely — the rail button/shortcut reopen it. */
  onClose: () => void;
}): React.ReactElement {
  const [diag, setDiag] = useState<DiagnosticsState>({ kind: 'loading' });
  const [repos, setRepos] = useState<RepoEntry[]>(() => getCachedRepos() ?? []);
  const projects = useProjectsStore((s) => s.projects);
  const liveChats = useLiveChatsStore((s) => s.sessions);

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

  /** The live chat session this dock opened — later sends reuse its warm seats. */
  const chatIdRef = useRef<string | null>(null);
  /** True once the context pack rode a message — it seeds the FIRST send only. */
  const seededRef = useRef(false);

  const verbs: AssistVerbs = useMemo(
    () => ({
      send: async (text) => {
        let id = chatIdRef.current;
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
          // The session is live — make it findable on the rail (the J4 live row).
          useLiveChatsStore.getState().upsert(id, ready);
        }
        const message = seededRef.current ? text : `${text}\n\n---\n${buildContextPack(packInputs.current)}`;
        await api.sendChatMessage(id, message);
        seededRef.current = true;
        return { chatId: id };
      },
    }),
    [],
  );

  const prompts = useMemo(
    () =>
      askPrompts({
        runs,
        projects: [...projects].sort((a, b) => b.updated_at - a.updated_at),
        repos,
      }),
    [runs, projects, repos],
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
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    />
  );
}
