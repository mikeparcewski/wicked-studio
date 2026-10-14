import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorHost } from '../../editors/host.js';
import {
  PANEL_RIBBON_BELOW_PX, RUN_TAB, hostTabsFor, joinGroup, relay, sameTab, useHostChrome, useHostPanel,
  type HostPanelProps, type HostTabContext, type OptionsGroup, type PanelTab,
} from '../../editors/hostApi.js';
import { readThemeTokens } from '../../editors/theme.js';
import type { Control, OptionsTab } from '../../editors/surfaces.js';

/**
 * THE HOST PANEL (run page option B; DES-EDITOR-PLUGIN-CONTRACT-001 §7.2; HOST-API §5): one right panel, 400 css px.
 * Run is the host's base tab; a card's Options adds that plugin's tabs (dot-marked) and the host tabs its adapter
 * earns (Review, Versions, Checks). One plugin group at a time; × removes it. Below 1200 css px it is a one-line
 * ribbon that opens the panel over the page.
 */

function useNarrow(): boolean {
  const q = `(max-width: ${PANEL_RIBBON_BELOW_PX - 1}px)`;
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const m = matchMedia(q);
    const on = (): void => setNarrow(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [q]);
  return narrow;
}

export function HostPanel({ runTab, ribbon }: HostPanelProps): React.ReactElement {
  const { group, tab, folded, setTab, closeGroup, setFolded } = useHostPanel();
  const narrow = useNarrow();
  const [overlay, setOverlay] = useState(false);
  // A newly opened group shows the panel, also on a narrow screen.
  useEffect(() => { if (group !== null) setOverlay(true); }, [group]);

  if (narrow && !overlay) {
    return (
      <button type="button" data-testid="host-panel-ribbon" className="wk-hpanel-ribbon" onClick={() => setOverlay(true)}>
        {ribbon}
      </button>
    );
  }
  if (!narrow && folded) {
    return (
      <button type="button" data-testid="host-panel-ribbon" data-folded="true" className="wk-hpanel-ribbon wk-hpanel-ribbon--side" onClick={() => setFolded(false)} aria-label="Show the panel">
        {ribbon}
      </button>
    );
  }
  return (
    <aside data-testid="host-panel" data-narrow={narrow ? 'true' : 'false'} aria-label="Run and options" className={`wk-hpanel${narrow ? ' wk-hpanel--overlay' : ''}`}>
      <div className="wk-hpanel-head">
        <span className="wk-hpanel-heading">{group === null ? 'Run' : `${group.editor.title} options`}</span>
        <span className="wk-hpanel-gap" />
        {group !== null && (
          <button type="button" data-testid="host-panel-close" aria-label={`Close ${group.editor.title} options`} className="wk-host-btn" onClick={closeGroup}>×</button>
        )}
        <button type="button" data-testid="host-panel-fold" aria-label="Hide the panel" className="wk-host-btn"
          onClick={() => { if (narrow) setOverlay(false); else setFolded(true); }}>⟩</button>
      </div>
      <PanelTabs group={group} tab={tab} setTab={setTab} />
      <div className="wk-hpanel-body">
        <div hidden={tab.owner !== 'run'} data-testid="host-panel-run">{runTab}</div>
        {group !== null && <GroupBody key={group.key} group={group} tab={tab} />}
      </div>
    </aside>
  );
}

function PanelTabs({ group, tab, setTab }: { group: OptionsGroup | null; tab: PanelTab; setTab: (t: PanelTab) => void }): React.ReactElement {
  const items: { tab: PanelTab; label: string; owner: string; id: string }[] = [{ tab: RUN_TAB, label: 'Run', owner: 'run', id: 'run' }];
  if (group !== null) {
    for (const t of group.surfaces.options?.tabs ?? []) items.push({ tab: { owner: 'plugin', id: t.id }, label: t.label, owner: 'plugin', id: t.id });
    for (const h of hostTabsFor(group.adapter)) items.push({ tab: { owner: 'host', id: h.id }, label: h.label, owner: 'host', id: h.id });
  }
  return (
    <div role="tablist" aria-label="Panel" className="wk-hpanel-tabs">
      {items.map((it) => {
        const on = sameTab(it.tab, tab);
        return (
          <button key={`${it.owner}:${it.id}`} type="button" role="tab" aria-selected={on} data-testid="host-panel-tab" data-tab={it.id} data-group={it.owner}
            className={`wk-hpanel-tab${on ? ' wk-hpanel-tab--on' : ''}`} onClick={() => setTab(it.tab)}>
            {it.owner === 'plugin' && <span aria-hidden className="wk-hpanel-dot" />}{it.label}
          </button>
        );
      })}
    </div>
  );
}

/** One group's body: its ONE options instance (mounted for the group's life, shown on a plugin tab), its controls
 *  tabs, and its host tabs. */
function GroupBody({ group, tab }: { group: OptionsGroup; tab: PanelTab }): React.ReactElement {
  const hostRef = useRef<EditorHost | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [torn, setTorn] = useState<string | null>(null);
  const v2 = group.protocol >= 2;
  const pluginTab = tab.owner === 'plugin' ? group.surfaces.options?.tabs.find((t) => t.id === tab.id) ?? null : null;
  const hostTab = tab.owner === 'host' ? hostTabsFor(group.adapter).find((h) => h.id === tab.id) ?? null : null;
  const showFrame = v2 && pluginTab?.render === 'plugin';
  const firstPluginTab = group.surfaces.options?.tabs.find((t) => t.render === 'plugin')?.id;
  const [, setShownTick] = useState(0);

  return (
    <>
      {v2 && (
        <OptionsInstance group={group} hostRef={hostRef} visible={showFrame} initialTab={pluginTab?.render === 'plugin' ? pluginTab.id : firstPluginTab}
          onValues={(t, v) => setValues((s) => ({ ...s, [t]: v }))} onTorn={setTorn} onShown={() => setShownTick((n) => n + 1)} />
      )}
      {showFrame && pluginTab !== null && <PluginTabSwitch hostRef={hostRef} tab={pluginTab.id} />}
      {torn !== null && showFrame && <p data-testid="host-panel-torn" className="wk-artifact-hint">This part didn’t start · {torn}</p>}
      {pluginTab !== null && pluginTab.render === 'controls' && v2 && (
        <ControlsTab tab={pluginTab} confirmed={values[pluginTab.id] ?? {}} change={(id, value) => hostRef.current?.changeOption(pluginTab.id, id, value) ?? Promise.resolve(false)} />
      )}
      {pluginTab !== null && !v2 && (
        <div data-testid="host-panel-v1" className="wk-hpanel-v1">
          <p>This editor opens full screen.</p>
          {group.surfaces.full !== null && (
            <button type="button" className="wk-host-btn" onClick={() => useHostChrome.getState().enterFull(group.binding.artifactKey)}>⤢ Full screen</button>
          )}
        </div>
      )}
      {hostTab !== null && (
        <div data-testid="host-panel-hosttab" data-tab={hostTab.id}>
          {hostTab.render(hostCtx(group, hostRef))}
        </div>
      )}
    </>
  );
}

function hostCtx(group: OptionsGroup, hostRef: React.MutableRefObject<EditorHost | null>): HostTabContext {
  return {
    binding: group.binding,
    adapter: group.adapter,
    shown: group.adapter.artifact().head,
    pointAt: async (wid) => (await hostRef.current?.pointAt(wid)) ?? false,
    changed: (head, kind) => {
      hostRef.current?.artifactChanged(head, kind);
      relay(group.key, 'options', { type: 'changed', head, kind });
    },
  };
}

function PluginTabSwitch({ hostRef, tab }: { hostRef: React.MutableRefObject<EditorHost | null>; tab: string }): null {
  useEffect(() => { hostRef.current?.setTab(tab); }, [hostRef, tab]);
  return null;
}

function OptionsInstance({ group, hostRef, visible, initialTab, onValues, onTorn, onShown }: {
  group: OptionsGroup;
  hostRef: React.MutableRefObject<EditorHost | null>;
  visible: boolean;
  initialTab: string | undefined;
  onValues: (tab: string, values: Record<string, unknown>) => void;
  onTorn: (reason: string) => void;
  onShown: () => void;
}): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  const cb = useRef({ onValues, onTorn, onShown });
  cb.current = { onValues, onTorn, onShown };
  const tab0 = useMemo(() => initialTab, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (box.current === null) return undefined;
    const e = group.editor;
    const host = new EditorHost({
      container: box.current,
      src: group.src,
      editor: e.id,
      version: e.version,
      name: e.title,
      title: `${e.title} options: ${group.binding.title}`,
      size: 'pane',
      surface: 'options',
      ...(tab0 !== undefined ? { tab: tab0 } : {}),
      grants: group.grants,
      theme: readThemeTokens(),
      prefs: { reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, techDetails: false, locale: navigator.language },
      firstParty: e.first_party,
      adapter: group.adapter,
      declared: (e as typeof e & { surfaces?: unknown }).surfaces,
      sizes: e.sizes,
      ui: {
        chips: () => undefined,
        draft: () => undefined,
        typed: () => undefined,
        key: (k) => { if (k === 'Escape') useHostPanel.getState().setTab(RUN_TAB); },
        morph: (to) => { if (to === 'full') useHostChrome.getState().enterFull(group.binding.artifactKey); },
        status: () => undefined,
        notes: () => undefined,
        thread: () => undefined,
        shown: () => cb.current.onShown(),
        fullscreen: async () => { useHostChrome.getState().enterFull(group.binding.artifactKey); return true; },
        torn: (r) => cb.current.onTorn(r),
        log: () => undefined,
        optionsValues: (t, v) => cb.current.onValues(t, v),
        selected: (anchors) => relay(group.key, 'options', { type: 'selection', anchors }),
      },
    });
    hostRef.current = host;
    host.mount();
    const leave = joinGroup(group.key, 'options', (ev) => {
      if (ev.type === 'selection') host.relaySelection(ev.anchors);
      else host.artifactChanged(ev.head, ev.kind);
    });
    return () => { leave(); host.teardown('The options were closed'); if (hostRef.current === host) hostRef.current = null; };
  }, [group, hostRef, tab0]);
  return <div ref={box} data-testid="host-panel-frame" hidden={!visible} className="wk-hpanel-frame" />;
}

type ControlState = 'confirmed' | 'pending' | 'reverted';

/** A controls tab (§5.3), host-rendered: the plugin's confirmed values, a pending state per control while a change is
 *  in flight, and a revert to the confirmed value when the plugin refuses or does not answer. */
export function ControlsTab({ tab, confirmed, change }: {
  tab: OptionsTab;
  confirmed: Record<string, unknown>;
  change: (id: string, value: unknown) => Promise<boolean>;
}): React.ReactElement {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [state, setState] = useState<Record<string, ControlState>>({});
  const set = (c: Control, value: unknown): void => {
    setDraft((d) => ({ ...d, [c.id]: value }));
    setState((s) => ({ ...s, [c.id]: 'pending' }));
    void change(c.id, value).then((applied) => {
      setDraft((d) => { const n = { ...d }; delete n[c.id]; return n; });
      setState((s) => ({ ...s, [c.id]: applied ? 'confirmed' : 'reverted' }));
    });
  };
  return (
    <div data-testid="host-controls" data-tab={tab.id} className="wk-hcontrols">
      {(tab.controls ?? []).map((c) => {
        const value = c.id in draft ? draft[c.id] : confirmed[c.id];
        const st = state[c.id] ?? 'confirmed';
        return (
          <div key={c.id} data-testid="host-control" data-control={c.id} data-type={c.type} data-state={st} className="wk-hcontrol">
            <label className="wk-hcontrol-label" htmlFor={`hc-${tab.id}-${c.id}`}>{c.label}</label>
            <ControlInput c={c} id={`hc-${tab.id}-${c.id}`} value={value} onChange={(v) => set(c, v)} />
            {st === 'reverted' && <span className="wk-hcontrol-note">Not changed</span>}
          </div>
        );
      })}
    </div>
  );
}

function ControlInput({ c, id, value, onChange }: { c: Control; id: string; value: unknown; onChange: (v: unknown) => void }): React.ReactElement {
  switch (c.type) {
    case 'toggle':
      return <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'segmented':
      return (
        <span role="radiogroup" aria-labelledby={id} className="wk-seg" id={id}>
          {(c.options ?? []).map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`wk-seg-btn${value === o.id ? ' wk-seg-btn--on' : ''}`} onClick={() => onChange(o.id)}>{o.label}</button>
          ))}
        </span>
      );
    case 'select':
      return (
        <select id={id} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className="wk-hcontrol-input">
          {typeof value !== 'string' && <option value="" disabled>Choose</option>}
          {(c.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      );
    case 'color':
      return <input id={id} type="color" value={typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="wk-hcontrol-color" />;
    case 'text':
      return <TextControl id={id} max={c.maxChars ?? 200} value={typeof value === 'string' ? value : ''} onChange={onChange} />;
    case 'range':
      return (
        <span className="wk-hcontrol-range">
          <input id={id} type="range" min={c.min} max={c.max} step={c.step} value={typeof value === 'number' ? value : c.min} onChange={(e) => onChange(Number(e.target.value))} />
          <output htmlFor={id}>{typeof value === 'number' ? value : ''}</output>
        </span>
      );
  }
}

/** Text commits on Enter or blur, not per keystroke (one `options.changed` per edit). */
function TextControl({ id, max, value, onChange }: { id: string; max: number; value: string; onChange: (v: unknown) => void }): React.ReactElement {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = (): void => { if (v !== value) onChange(v); };
  return <input id={id} type="text" maxLength={max} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} className="wk-hcontrol-input" />;
}
