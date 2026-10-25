import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { chipWords, WIRE_KINDS, type ScopeChip } from '../../board/chatScopes.js';

/**
 * "What the chat can see" (DES-SYSTEM-CHAT §6): toggle chips over the composer, plus + Add, a search
 * over every repo, run, project and document the app holds. Clicking a default chip turns it on or
 * off; clicking an added chip removes it. Once the chat is open its read roots are fixed, so the
 * Project / Repo / All repos chips lock (their hover says why); the context chips keep working — what
 * they choose rides the next message.
 */

export interface ScopeCandidate {
  key: string;
  kind: 'project' | 'repo' | 'run' | 'doc';
  label: string;
  ref: string;
  projectId?: string;
  /** A second line: a run's status, a doc's project. */
  detail?: string;
}

const KIND_WORD: Record<ScopeCandidate['kind'], string> = { project: 'Project', repo: 'Repo', run: 'Run', doc: 'Doc' };

export function ChatScopeChips({ chips, onClick, onAdd, candidates, onSearchOpen, locked }: {
  chips: readonly ScopeChip[];
  onClick: (key: string) => void;
  onAdd: (c: ScopeCandidate) => void;
  /** Everything + Add can offer (the caller's stores — no request rides a keystroke). */
  candidates: readonly ScopeCandidate[];
  /** + Add opened: the caller may load what it lists (one cheap read). */
  onSearchOpen?: () => void;
  /** The chat is open: the read-root chips are fixed. */
  locked: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    // preventScroll: the popover must never scroll the window's clipped body sideways to reach it.
    inputRef.current?.focus({ preventScroll: true });
    const away = (e: MouseEvent): void => { if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const results = useMemo(() => {
    const taken = new Set(chips.map((c) => c.key));
    const needle = q.trim().toLowerCase();
    return candidates
      .filter((c) => !taken.has(c.key) && !(locked && (c.kind === 'project' || c.kind === 'repo')))
      .filter((c) => needle === '' || c.label.toLowerCase().includes(needle) || c.ref.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [candidates, chips, q, locked]);

  return (
    <div data-testid="chat-scope" role="group" aria-label="What the chat can see" className="wk-chatscope">
      <span className="wk-chatscope-label">What the chat can see</span>
      {chips.map((c) => {
        const fixed = locked && WIRE_KINDS.has(c.kind);
        return (
          <button
            key={c.key}
            type="button"
            data-testid="chat-scope-chip"
            data-key={c.key}
            data-kind={c.kind}
            aria-pressed={c.on}
            disabled={fixed}
            title={fixed
              ? `${chipWords(c)} — set when this chat opened; start a new chat to change it`
              : c.added === true ? `${chipWords(c)} — click to remove` : `${chipWords(c)} — click to turn ${c.on ? 'off' : 'on'}`}
            onClick={() => onClick(c.key)}
            className={`wk-chatscope-chip${c.on ? ' wk-chatscope-chip--on' : ''}`}
          >
            {c.kind === 'project' || c.kind === 'repo' || c.kind === 'run' || c.kind === 'doc'
              ? <><span className="wk-chatscope-kind">{KIND_WORD[c.kind]}</span> {c.label}</>
              : c.label}
            {c.added === true && <span aria-hidden className="wk-chatscope-x">×</span>}
          </button>
        );
      })}
      <div ref={boxRef} className="wk-chatscope-add">
        <button
          type="button"
          data-testid="chat-scope-add"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="wk-chatscope-chip wk-chatscope-chip--add"
          onClick={() => { setOpen((v) => !v); if (!open) onSearchOpen?.(); }}
        >
          <Plus size={12} aria-hidden /> Add
        </button>
        {open && (
          <div data-testid="chat-scope-search" className="wk-chatscope-pop">
            <input
              ref={inputRef}
              data-testid="chat-scope-query"
              className="wk-field wk-chatscope-q"
              aria-label="Find a repo, run, project or doc"
              placeholder="Find a repo, run, project or doc…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
                if (e.key === 'Enter' && results[0] !== undefined) { e.preventDefault(); onAdd(results[0]); setQ(''); setOpen(false); }
              }}
            />
            <ul role="listbox" aria-label="Matches" className="wk-chatscope-list">
              {results.length === 0 && <li className="wk-chatscope-none">{q.trim() === '' ? 'Nothing more to add.' : 'No match.'}</li>}
              {results.map((c) => (
                <li key={c.key} role="option" aria-selected={false}>
                  <button
                    type="button"
                    data-testid="chat-scope-result"
                    data-key={c.key}
                    className="wk-chatscope-result"
                    onClick={() => { onAdd(c); setQ(''); setOpen(false); }}
                  >
                    <span className="wk-chatscope-kind">{KIND_WORD[c.kind]}</span>
                    <span className="wk-chatscope-result-name">{c.label}</span>
                    {c.detail !== undefined && <span className="wk-chatscope-result-detail">{c.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
