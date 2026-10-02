import { useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { ChatCitations } from '../../api/chat-wire.js';
import { basedOnLine, passageCandidates, passageHasLine, passageWindow, sourcesOf, type PassageLine, type SourceRef } from '../../board/sources.js';

/**
 * SOURCES (DES-STUDIO-REBUILD-001 §3 scenes 33/34, slice S6b): "Based on 3 sources" under a helper's
 * reply, one chip per place the daemon confirmed. Hover a chip for where it is; click it for the
 * passage, the cited line highlighted, with the way back. Render only: `board/sources.ts`.
 *
 * The passage is read through the run's contained file route (`GET /runs/:id/files`) from the
 * session's runs, newest first. When none can read it, it says so and names the place; it never
 * shows a file it did not read.
 */
type Passage =
  | { key: string; state: 'loading' }
  | { key: string; state: 'shown'; lines: PassageLine[]; path: string; truncated: boolean }
  | { key: string; state: 'unreadable'; why: string };

export function SourceChips({ citations, runs }: {
  citations: ChatCitations | undefined;
  /** The session's runs with a worktree, newest first: where a passage can be read from. */
  runs: readonly { id: string; workdir: string | null }[];
}): React.ReactElement | null {
  const sources = sourcesOf(citations);
  const [open, setOpenState] = useState<Passage | null>(null);
  // Only the newest request may land: a slow read never reopens a passage after Back, or
  // overwrites the chip clicked after it (codex).
  const req = useRef(0);
  const setOpen = (p: Passage | null): void => { req.current += 1; setOpenState(p); };
  const line = basedOnLine(sources.length);
  if (line === null) return null;

  const openSource = async (s: SourceRef): Promise<void> => {
    if (open?.key === s.key) { setOpen(null); return; }
    setOpen({ key: s.key, state: 'loading' });
    const mine = req.current;
    const land = (p: Passage): void => { if (req.current === mine) setOpenState(p); };
    let why = 'no run of this session has a copy of the code to read it from';
    let first = true; // the reason said is the first refusal: the path as cited, not a fallback's
    for (const r of runs) {
      for (const path of passageCandidates(s.path, r.workdir)) {
        try {
          const f = await api.getRunFile(r.id, path);
          if (f.binary) { if (first) why = 'it is a binary file'; first = false; continue; }
          if (!passageHasLine(f.content, s.line)) {
            if (first) why = f.truncated ? `line ${s.line} is past the part of the file the daemon serves (512 KB)` : `the file has no line ${s.line} any more`;
            first = false;
            continue;
          }
          land({ key: s.key, state: 'shown', lines: passageWindow(f.content, s.line), path: s.key, truncated: f.truncated });
          return;
        } catch (e) {
          if (first) why = e instanceof Error ? e.message : String(e);
          first = false;
        }
      }
    }
    land({ key: s.key, state: 'unreadable', why });
  };

  return (
    <div data-testid="session-sources" className="wk-sources">
      <span className="wk-sources-line">{line}:</span>
      {sources.map((s) => (
        <button
          key={s.key}
          type="button"
          data-testid="session-source"
          data-source={s.key}
          aria-expanded={open?.key === s.key}
          title={s.hover}
          onClick={() => { void openSource(s); }}
          className="wk-source-chip"
        >
          {s.label}
        </button>
      ))}
      {open !== null && (
        <div data-testid="session-passage" data-source={open.key} data-state={open.state} className="wk-passage">
          <p className="wk-passage-head">
            <span>{open.key}</span>
            <button type="button" data-testid="session-passage-back" onClick={() => setOpen(null)} className="wk-since-toggle">Back to the reply</button>
          </p>
          {open.state === 'loading' && <p className="wk-session-grey">Reading it…</p>}
          {open.state === 'unreadable' && (
            <p data-testid="session-passage-unreadable" className="wk-session-grey">Studio can’t open this here: {open.why}.</p>
          )}
          {open.state === 'shown' && (
            <pre className="wk-passage-text">
              {open.lines.map((l) => (
                <span key={l.n} data-hit={l.hit ? 'true' : undefined} className={l.hit ? 'wk-passage-hit' : undefined}>
                  <span aria-hidden className="wk-passage-n">{l.n}</span>
                  {l.hit && <span className="sr-only">Cited line {l.n}: </span>}
                  {l.text}{'\n'}
                </span>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
