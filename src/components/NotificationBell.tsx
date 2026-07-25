import { useEffect, useRef, useState } from 'react';
import { useNotificationStore } from '../store/notifications.js';
import type { NotifKind } from '../store/notifications.js';

interface Props {
  navigate: (path: string) => void;
  /** When true the sidebar is collapsed — render icon-only (no label). */
  collapsed?: boolean;
}

// ── Design tokens (matching LeftSidebar's `S` palette) ──────────────────────

const S = {
  bg:        '#1c4053',
  ink:       '#e6edf3',
  muted:     'rgba(230,237,243,0.55)',
  faint:     'rgba(230,237,243,0.3)',
  hover:     'rgba(0,0,0,0.2)',
  accent:    '#ffda19',
  accentInk: '#0d1117',
  link:      '#79c0ff',
  danger:    '#f85149',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function kindLabel(kind: NotifKind): string {
  switch (kind) {
    case 'gate':            return 'Awaiting review';
    case 'run_failed':      return 'Run failed';
    case 'steer_requested': return 'Steer requested';
    default:                return 'Notification';
  }
}

function kindColor(kind: NotifKind): string {
  switch (kind) {
    case 'gate':            return S.accent;
    case 'run_failed':      return S.danger;
    case 'steer_requested': return S.link;
    default:                return S.muted;
  }
}

function formatTs(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function IconBell(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationBell({ navigate, collapsed = false }: Props): React.ReactElement {
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead      = useNotificationStore((s) => s.markRead);
  const markAllRead   = useNotificationStore((s) => s.markAllRead);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  function handleNotifClick(id: string, runId: string): void {
    markRead(id);
    setOpen(false);
    navigate(`/runs/${encodeURIComponent(runId)}`);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell trigger */}
      <button
        type="button"
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
            : 'Notifications'
        }
        aria-expanded={open}
        aria-haspopup="true"
        title="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center rounded transition-opacity hover:opacity-70"
        style={{
          gap: collapsed ? 0 : '6px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          width: collapsed ? '28px' : 'auto',
          height: '28px',
          color: unreadCount > 0 ? S.accent : S.faint,
          background: 'transparent',
          padding: collapsed ? 0 : '0 6px 0 4px',
        }}
      >
        <IconBell />
        {!collapsed && (
          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: S.faint }}>
            Notifications
          </span>
        )}
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-[9px] font-bold"
            style={{
              minWidth: '14px',
              height: '14px',
              padding: '0 2px',
              background: S.accent,
              color: S.accentInk,
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 200,
            background: '#1b222e',
            border: '1px solid rgba(230,237,243,0.12)',
            borderRadius: '10px',
            minWidth: '280px',
            maxWidth: '320px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px 8px',
              borderBottom: '1px solid rgba(230,237,243,0.08)',
            }}
          >
            <span
              style={{
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'rgba(230,237,243,0.4)',
                fontFamily: 'monospace',
              }}
            >
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  color: S.link,
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          {notifications.length === 0 ? (
            <p
              style={{
                padding: '16px 14px',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: S.faint,
                margin: 0,
              }}
            >
              No notifications
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleNotifClick(n.id, n.runId)}
                    className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#79c0ff]"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: n.read ? 'transparent' : 'rgba(255,218,25,0.04)',
                      border: 'none',
                      borderBottom: '1px solid rgba(230,237,243,0.06)',
                      padding: '10px 14px',
                      cursor: 'pointer',
                      display: 'block',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = S.hover;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = n.read
                        ? 'transparent'
                        : 'rgba(255,218,25,0.04)';
                    }}
                  >
                    {/* Kind label + timestamp */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '3px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          fontFamily: 'monospace',
                          color: kindColor(n.kind),
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {!n.read && (
                          <span
                            style={{
                              width: '5px',
                              height: '5px',
                              borderRadius: '50%',
                              background: kindColor(n.kind),
                              display: 'inline-block',
                              flexShrink: 0,
                            }}
                          />
                        )}
                        {kindLabel(n.kind)}
                      </span>
                      <span
                        style={{
                          fontSize: '9px',
                          fontFamily: 'monospace',
                          color: 'rgba(230,237,243,0.3)',
                          whiteSpace: 'nowrap',
                          marginLeft: '8px',
                        }}
                      >
                        {formatTs(n.ts)}
                      </span>
                    </div>
                    {/* Message */}
                    <p
                      style={{
                        fontSize: '11px',
                        color: 'rgba(230,237,243,0.65)',
                        margin: '0 0 3px',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {n.message}
                    </p>
                    {/* Run id + link */}
                    <span
                      style={{
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        color: S.link,
                      }}
                    >
                      {n.runId.slice(0, 8)} → Review
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
