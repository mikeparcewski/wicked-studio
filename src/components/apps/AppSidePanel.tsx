import { useEffect, useRef, useState } from 'react';
import { ChevronsLeft, ChevronsRight, MessageCircle, SlidersHorizontal } from 'lucide-react';

/**
 * THE APP'S SIDE PANEL (operator 2026-11-04: "chat/properties should be in same panel just tabs in the panel with chat
 * as default. That panel should be collapsable by user"): one panel beside the app with two tabs, Chat (the default
 * when an app opens) and Properties. Selecting a component switches it to Properties (and opens it); Chat keeps its
 * thread and draft while hidden (both stay mounted). The person can collapse it to a thin rail of the two tab icons;
 * the collapsed state is remembered across sessions (as the sidebar's is), expanded by default. While collapsed, a
 * running turn shows a busy dot on the Chat icon and a turn that ended since the chat was last seen an unread dot.
 * On a phone the same panel is a bottom sheet the person can minimise to its tab bar.
 *
 * Keyboard: a real tablist (arrows and Home/End move between tabs, roving tabindex); the collapse control carries
 * `aria-expanded`; switching to Chat leaves the focus in its composer.
 */

export type PanelTab = 'chat' | 'properties';
const COLLAPSED_KEY = 'wicked.apps.panel.collapsed';

export function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
}
function writeCollapsed(v: boolean): void {
  try { localStorage.setItem(COLLAPSED_KEY, v ? 'true' : 'false'); } catch { /* not kept */ }
}

const SEEN_KEY = (slug: string): string => `wicked.apps.chat.seen.${slug}`;
/** What the person last saw of the app's chat (the newest ended turn's mark), across sessions. */
export function readSeen(slug: string): string {
  try { return localStorage.getItem(SEEN_KEY(slug)) ?? ''; } catch { return ''; }
}
export function writeSeen(slug: string, mark: string): void {
  try { localStorage.setItem(SEEN_KEY(slug), mark); } catch { /* not kept */ }
}

const TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [{ id: 'chat', label: 'Chat' }, { id: 'properties', label: 'Properties' }];

export function AppSidePanel({ slug, tab, setTab, collapsed, setCollapsed, busy, unread, chat, properties, dock, phone }: {
  slug: string;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  /** A turn is running on the app. */
  busy: boolean;
  /** A turn ended since the chat was last seen. */
  unread: boolean;
  chat: React.ReactNode;
  properties: React.ReactNode;
  /** The "Needs you" dock (an action card, a link question): above the tabs. */
  dock: React.ReactNode;
  phone: boolean;
}): React.ReactElement {
  const tabRefs = useRef<Record<PanelTab, HTMLButtonElement | null>>({ chat: null, properties: null });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [focusNext, setFocusNext] = useState<PanelTab | null>(null);
  // After a switch to Chat the focus goes to its composer (the person came to type), else to the tab.
  useEffect(() => {
    if (focusNext === null || collapsed) return;
    if (focusNext === 'chat') panelRef.current?.querySelector<HTMLTextAreaElement>('[data-testid="app-composer-input"]')?.focus();
    else tabRefs.current[focusNext]?.focus();
    setFocusNext(null);
  }, [focusNext, collapsed, tab]);
  const open = (t: PanelTab, focus = true): void => {
    setTab(t);
    if (collapsed) { setCollapsed(false); writeCollapsed(false); }
    if (focus) setFocusNext(t);
  };
  const collapse = (v: boolean): void => { setCollapsed(v); writeCollapsed(v); };
  const dot = (t: PanelTab): React.ReactNode => (t === 'chat' && busy ? <span className="wk-apppanel-dot wk-apppanel-dot--busy" data-testid="app-panel-busy" aria-label="a change is being made" />
    : t === 'chat' && unread ? <span className="wk-apppanel-dot wk-apppanel-dot--unread" data-testid="app-panel-unread" aria-label="new in the chat" /> : null);
  const onKey = (e: React.KeyboardEvent, i: number): void => {
    const n = TABS.length;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const t = TABS[to]!.id;
    setTab(t);
    tabRefs.current[t]?.focus();
  };
  if (collapsed) {
    return (
      <aside className={`wk-apppanel wk-apppanel--collapsed${phone ? ' wk-apppanel--sheet' : ''}`} data-testid="app-panel" data-collapsed="true" data-tab={tab} aria-label="Chat and properties">
        <button type="button" className="wk-apppanel-rail-btn wk-apppanel-toggle" data-testid="app-panel-toggle" aria-expanded={false} aria-controls={`app-panel-body-${slug}`}
          title="Open the panel" aria-label="Open the panel" onClick={() => open(tab, false)}>
          <ChevronsLeft size={16} aria-hidden className={phone ? 'wk-apppanel-rot' : undefined} />
        </button>
        {TABS.map((t) => (
          <button key={t.id} type="button" className="wk-apppanel-rail-btn" data-testid={`app-panel-rail-${t.id}`} aria-label={`Open ${t.label}`} title={t.label} onClick={() => open(t.id)}>
            {t.id === 'chat' ? <MessageCircle size={18} aria-hidden /> : <SlidersHorizontal size={18} aria-hidden />}
            {phone && <span className="wk-apppanel-rail-label">{t.label}</span>}
            {dot(t.id)}
          </button>
        ))}
      </aside>
    );
  }
  return (
    <aside className={`wk-apppanel${phone ? ' wk-apppanel--sheet' : ''}`} data-testid="app-panel" data-collapsed="false" data-tab={tab} aria-label="Chat and properties">
      {dock}
      <div className="wk-apppanel-head">
        <div className="wk-apppanel-tabs" role="tablist" aria-label="Chat and properties">
          {TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} type="button" role="tab" id={`app-tab-${slug}-${t.id}`} aria-selected={tab === t.id}
              aria-controls={`app-tabpanel-${slug}-${t.id}`} tabIndex={tab === t.id ? 0 : -1} data-testid={`app-panel-tab-${t.id}`}
              className={`wk-apppanel-tab${tab === t.id ? ' is-on' : ''}`} onClick={() => { setTab(t.id); setFocusNext(t.id); }} onKeyDown={(e) => onKey(e, i)}>
              {t.label}{tab !== t.id && dot(t.id)}
            </button>
          ))}
        </div>
        <button type="button" className="wk-apppanel-toggle" data-testid="app-panel-toggle" aria-expanded aria-controls={`app-panel-body-${slug}`}
          title={phone ? 'Minimise' : 'Collapse the panel'} aria-label={phone ? 'Minimise the panel' : 'Collapse the panel'} onClick={() => collapse(true)}>
          <ChevronsRight size={16} aria-hidden className={phone ? 'wk-apppanel-rot' : undefined} />
        </button>
      </div>
      <div className="wk-apppanel-body" id={`app-panel-body-${slug}`} ref={panelRef}>
        <div role="tabpanel" id={`app-tabpanel-${slug}-chat`} aria-labelledby={`app-tab-${slug}-chat`} hidden={tab !== 'chat'} className="wk-apppanel-pane" data-testid="app-panel-chat">{chat}</div>
        <div role="tabpanel" id={`app-tabpanel-${slug}-properties`} aria-labelledby={`app-tab-${slug}-properties`} hidden={tab !== 'properties'} className="wk-apppanel-pane wk-apppanel-pane--props" data-testid="app-panel-properties">{properties}</div>
      </div>
    </aside>
  );
}
