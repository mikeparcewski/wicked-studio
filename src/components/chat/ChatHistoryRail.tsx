import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import type { ChatHistoryEntry } from '../../api/chatHistory-wire.js';

/**
 * PAST CHATS (DES-SYSTEM-CHAT §4): the system chat's own history, inside its window, from crew's
 * `GET /chats` history page (`capabilities.chatList`). Each entry says its title, the page it started
 * on and its age; clicking one reopens it with its messages (an ended one read-only).
 */

/** "just now", "5 min", "3 h", "2 d" — an entry's age from its last message. */
export function ageWords(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function ChatHistoryRail({ currentId, onOpen, onClose }: {
  /** The chat on screen (marked, and clicking it does nothing). */
  currentId: string | null;
  onOpen: (entry: ChatHistoryEntry) => void;
  /** Hide the rail (in a narrow window it lies over the chat, header included). */
  onClose: () => void;
}): React.ReactElement {
  const [items, setItems] = useState<ChatHistoryEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((from: string | null) => {
    setLoading(true);
    api.listChatHistory({ limit: 20, cursor: from })
      .then((page) => {
        setItems((cur) => [...(from === null ? [] : cur ?? []), ...(page.items ?? [])]);
        setCursor(page.nextCursor ?? null);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(null); }, [load]);

  return (
    <nav data-testid="chat-history" aria-label="Past chats" className="wk-chathist">
      <div className="wk-chathist-headrow">
        <p className="wk-chathist-head">Past chats</p>
        <button type="button" data-testid="chat-history-close" className="wk-chatwin-btn" aria-label="Hide past chats" title="Hide past chats" onClick={onClose}>×</button>
      </div>
      {error !== null && <p data-testid="chat-history-error" role="status" className="wk-chathist-note">Could not load past chats: {error}</p>}
      {items !== null && items.length === 0 && error === null && <p className="wk-chathist-note">No past chats yet.</p>}
      {items === null && error === null && <p className="wk-chathist-note">Loading…</p>}
      <ul className="wk-chathist-list">
        {(items ?? []).map((c) => (
          <li key={c.id}>
            <button
              type="button"
              data-testid="chat-history-entry"
              data-chat-id={c.id}
              data-status={c.status}
              aria-current={c.id === currentId ? 'true' : undefined}
              title={`${c.title}${c.startedOn !== null ? ` · started on ${c.startedOn.label}` : ''}`}
              className="wk-chathist-entry"
              onClick={() => { if (c.id !== currentId) onOpen(c); }}
            >
              <span className="wk-chathist-title">{c.title}</span>
              <span className="wk-chathist-meta">
                {c.startedOn !== null ? `${c.startedOn.label} · ` : ''}{ageWords(c.updatedAt)}{c.status === 'closed' ? ' · ended' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {cursor !== null && (
        <button type="button" data-testid="chat-history-more" className="wk-chathist-more" disabled={loading} onClick={() => load(cursor)}>
          {loading ? 'Loading…' : 'Show older'}
        </button>
      )}
    </nav>
  );
}
