import { useEffect, useMemo, useRef, useState } from 'react';
import { removeEditor, setEditorEnabled, type EditorView } from '../../api/editors.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { mcpInspectPath } from '../../api/mcpInspect.js';
import { CORE_ORDER, type PanelDecl } from '../../board/runPluginPanels.js';
import { RUN_PLUGINS, permissionWords, topicWords, type RunPlugin } from '../../plugins/runPlugins.js';
import { firstPartyLooks } from '../../plugins/firstParty.js';
import { NO_VISUALS, parseVisuals, previewFor, type PluginVisuals } from '../../plugins/visuals.js';
import { useAppearanceStore } from '../../theming/appearance.js';
import { EmptyState, PageFrame, Skeleton, StateBanner } from '../ui/index.js';
import { OpenDocumentList } from './OpenDocumentList.js';
import { PluginLivePreview } from './PluginLivePreview.js';
import { kindsInWords, openHref, permissionsInWords, startCreateEditorPlugin, useEditorList } from './EditorPluginsSettings.js';
import { allowedOf, EditorGrantSwitches, useEditorGrants } from './EditorGrantSwitches.js';

/**
 * THE PLUGINS PAGE AS CARDS (program DES-LEARN §2; operator 2026-10-30: "Settings > Plugins as cards with visuals").
 *
 * Every plugin is a card: a preview (the plugin's own LIVE frame on sample events when it offers one, its preview image,
 * or a miniature of what it draws), its icon on its colour, its title and tag, one line, and where it shows. A filter
 * picks All · Job details · Editors · You installed. A card opens its DETAILS: the preview, the On switch (an editor's,
 * human-only on crew), the events it was granted in plain words with each topic, what it may do and never does, where
 * it shows (a run plugin's panel slot), and its manifest. An editor you installed has Remove (crew's human-only
 * `DELETE /editors/:id`); a built-in one can only be switched off. Nothing here is "coming": every card is a plugin
 * this studio has (operator 2026-11-06: what the product shows as coming is built, not promised).
 */

export type PluginFilter = 'all' | 'job' | 'editor' | 'mine';
export type MiniKind = 'phase' | 'insights' | 'deck' | 'document' | 'page' | 'video' | 'list';

export interface PluginCardModel {
  key: string;
  kind: 'run' | 'editor';
  id: string;
  title: string;
  version: string | null;
  source: 'built-in' | 'installed';
  enabled: boolean;
  line: string;
  where: string[];
  visuals: PluginVisuals;
  mini: MiniKind;
  run?: RunPlugin;
  editor?: EditorView;
}

/** The miniature drawn for a plugin with no preview image: what it opens, by its kinds. */
export function miniOf(kinds: readonly string[]): MiniKind {
  if (kinds.includes('run-insights')) return 'insights';
  if (kinds.includes('deck')) return 'deck';
  if (kinds.includes('document')) return 'document';
  if (kinds.includes('page')) return 'page';
  if (kinds.includes('demo-video') || kinds.includes('walkthrough')) return 'video';
  return 'list';
}

/** An editor's look: the wire's (crew's registry, api-types 0.157.0) wins field by field; a built-in editor falls back
 *  to studio's own copy, so a crew that predates the fields still shows its icon and line. */
export function editorLooks(e: EditorView): { line: string; visuals: PluginVisuals } {
  const wire = e as EditorView & { description?: unknown; visuals?: unknown };
  const own = parseVisuals(wire.visuals);
  const fallback = e.first_party ? firstPartyLooks(e.id) : { description: null, visuals: NO_VISUALS };
  const line = typeof wire.description === 'string' && wire.description.trim() !== '' ? wire.description.trim().slice(0, 160)
    : fallback.description ?? `Opens ${kindsInWords(e.kinds)}.`;
  return {
    line,
    visuals: { icon: own.icon ?? fallback.visuals.icon, color: own.color ?? fallback.visuals.color, preview: own.preview ?? fallback.visuals.preview, live: false },
  };
}

/** "Job details · one per phase": where a run plugin's sections show. */
export function panelWhere(panels: readonly PanelDecl[]): string[] {
  if (panels.length === 0) return ['Job details'];
  return ['Job details', ...panels.map((p) => (p.instances === 'per-phase' ? 'one per phase' : 'one section'))];
}

/** Every card on the page, in the page's order: run plugins, then editors (built-in first). */
export function cardsOf(runPlugins: readonly RunPlugin[], editors: readonly EditorView[] | null): PluginCardModel[] {
  const runs: PluginCardModel[] = runPlugins.map((p) => ({
    key: `run:${p.id}`, kind: 'run', id: p.id, title: p.title, version: p.version, source: 'built-in', enabled: true,
    line: p.description !== '' ? p.description : 'Shows a section in each job’s details.',
    where: panelWhere(p.panels), visuals: p.visuals, mini: 'phase', run: p,
  }));
  const eds: PluginCardModel[] = (editors ?? []).map((e) => {
    const looks = editorLooks(e);
    return {
      key: `editor:${e.id}`, kind: 'editor', id: e.id, title: e.title, version: e.version, source: e.first_party ? 'built-in' : 'installed',
      enabled: e.enabled, line: looks.line, where: ['Editor', `Opens ${kindsInWords(e.kinds)}`], visuals: looks.visuals, mini: miniOf(e.kinds), editor: e,
    };
  });
  return [...runs, ...eds];
}

export function filterCards(cards: readonly PluginCardModel[], f: PluginFilter): PluginCardModel[] {
  switch (f) {
    case 'all': return [...cards];
    case 'job': return cards.filter((c) => c.kind === 'run');
    case 'editor': return cards.filter((c) => c.kind === 'editor');
    case 'mine': return cards.filter((c) => c.source === 'installed');
  }
}

const FILTERS: Array<{ id: PluginFilter; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'job', label: 'Job details' }, { id: 'editor', label: 'Editors' }, { id: 'mine', label: 'You installed' },
];

const SOURCE_WORDS: Record<PluginCardModel['source'], string> = { 'built-in': 'Built in', installed: 'You installed' };

/** The app runtime's kind: its card's door is the Apps page, where apps are made and opened. */
const APP_KIND = 'app';

function useThemeGround(): 'light' | 'dark' {
  const theme = useAppearanceStore((s) => s.appearance.theme);
  return /light/.test(theme) ? 'light' : 'dark';
}

/** The plugin's icon on its colour; its initial when it has none. */
function PluginIcon({ card, size = 36 }: { card: PluginCardModel; size?: number }): React.ReactElement {
  return (
    <span aria-hidden data-testid="plugin-tile-icon" className="wk-plugcard-icon" style={{ width: size, height: size, ...(card.visuals.color !== null ? { background: card.visuals.color } : {}) }}>
      {card.visuals.icon !== null ? <img src={card.visuals.icon} alt="" width={Math.round(size / 2)} height={Math.round(size / 2)} /> : <span>{card.title.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

/** A CSS miniature of what a plugin draws (no image, no frame): the card's preview when it has nothing better. */
function Mini({ kind }: { kind: MiniKind }): React.ReactElement {
  switch (kind) {
    case 'phase': return <div className="wk-mini wk-mini-tiles"><span className="wk-mini-now" /><i className="wk-mini-t" /><i className="wk-mini-t" data-tone="ok" /><i className="wk-mini-t" data-tone="fail" /><i className="wk-mini-t" /></div>;
    case 'insights': return <div className="wk-mini wk-mini-bars">{[38, 62, 48, 82, 30, 66].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>;
    case 'deck': return <div className="wk-mini wk-mini-slide"><div className="wk-mini-strip"><i /><i /><i /><i /></div><div className="wk-mini-big" /></div>;
    case 'document': return <div className="wk-mini"><div className="wk-mini-doc"><i /><i /><i className="hl" /><i /><i style={{ width: '62%' }} /></div></div>;
    case 'page': return <div className="wk-mini"><div className="wk-mini-page"><b /><span /></div></div>;
    case 'video': return <div className="wk-mini"><div className="wk-mini-video"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg></div></div>;
    case 'list': return <div className="wk-mini wk-mini-list"><i /><i /><i /></div>;
  }
}

/** The card's (or the details') preview: live, an image, or the miniature. */
function Preview({ card, place }: { card: PluginCardModel; place: 'card' | 'details' }): React.ReactElement {
  const ground = useThemeGround();
  const image = previewFor(card.visuals, ground);
  const live = card.run !== undefined && card.visuals.live;
  const tag = live ? (place === 'details' ? 'Live · sample events' : 'Live preview') : 'Preview';
  return (
    <div className="wk-plugcard-prev" data-testid={place === 'card' ? 'plugin-tile-preview' : 'plugin-details-preview'} data-preview={live ? 'live' : image !== null ? 'image' : 'mini'}
      // The miniature is drawn in the plugin's own colour mixed with the theme's surfaces, so it reads on either ground.
      style={card.visuals.color !== null ? ({ '--plug': card.visuals.color } as React.CSSProperties) : undefined}>
      {live ? <PluginLivePreview plugin={card.run!} scale={place === 'card' ? 0.5 : 0.62} testId={place === 'card' ? 'plugin-tile-live' : 'plugin-details-live'} />
        : image !== null ? <img src={image} alt="" className="wk-plugcard-img" />
          : <Mini kind={card.mini} />}
      {tag !== null && <span className="wk-plugcard-prev-tag" data-live={live ? 'true' : 'false'}>{tag}</span>}
    </div>
  );
}

function PluginTile({ card, selected, onPick }: { card: PluginCardModel; selected: boolean; onPick: () => void }): React.ReactElement {
  const body = (
    <>
      <Preview card={card} place="card" />
      <span className="wk-plugcard-body">
        <PluginIcon card={card} />
        <span className="wk-plugcard-words">
          <span className="wk-plugcard-title">
            <span data-testid="plugin-tile-title">{card.title}</span>
            <span data-testid="plugin-tile-source" className="wk-tag">{SOURCE_WORDS[card.source]}</span>
            {!card.enabled && <span data-testid="plugin-tile-off" className="wk-tag">Off</span>}
          </span>
          <span data-testid="plugin-tile-line" className="wk-plugcard-line">{card.line}</span>
          {card.where.length > 0 && <span className="wk-plugcard-where" data-testid="plugin-tile-where">{card.where.map((w) => <span key={w}>{w}</span>)}</span>}
        </span>
      </span>
    </>
  );
  return (
    <button type="button" data-testid="plugin-tile" data-plugin={card.id} data-kind={card.kind} aria-pressed={selected} onClick={onPick}
      aria-label={`${card.title}: ${card.line} Show its details`} className={`wk-plugcard${card.enabled ? '' : ' wk-plugcard--off'}`}>
      {body}
    </button>
  );
}

/** A run plugin's panel slot, in words: "Job details · after Now, before Plan and steps · one per phase · the running phase open". */
export function slotWords(p: PanelDecl): string {
  if (p.slot === 'voice-dashboard') return `Voice mode's dashboard · a widget (order ${p.order})`;
  const before = (Object.entries(CORE_ORDER) as Array<[string, number]>).find(([, o]) => o >= p.order)?.[0] ?? null;
  const NAMES: Record<string, string> = { plan: 'Plan and steps', changes: 'Changes and delivery', checks: 'Checks and evidence', agents: 'Agents and spend', record: 'Record' };
  const place = before !== null && before !== 'now' ? `after Now, before ${NAMES[before] ?? before}` : 'after every core section';
  const open = p.defaultOpen === 'current' ? (p.instances === 'per-phase' ? 'the running phase open, the rest folded' : 'open while the job runs')
    : p.defaultOpen === 'always' ? 'open' : p.defaultOpen === 'while-live' ? 'open while the job runs' : 'folded';
  return `Job details · ${place} (order ${p.order}) · ${p.instances === 'per-phase' ? 'one section per phase' : 'one section'} · ${open}`;
}

function manifestOf(card: PluginCardModel): string {
  if (card.run !== undefined) {
    const p = card.run;
    return JSON.stringify({ id: p.id, version: p.version, protocol: p.protocol, observe: p.observe.map((o) => o.topic), permissions: p.permissions.map((x) => x.id), panels: p.panels, visuals: { icon: p.visuals.icon !== null, color: p.visuals.color, live: p.visuals.live } }, null, 2);
  }
  const e = card.editor!;
  return JSON.stringify({ id: e.id, version: e.version, protocol: e.protocol, kinds: e.kinds, sizes: e.sizes, permissions: e.permissions.map((x) => x.id), source: e.source, sha256: `${e.sha256.slice(0, 12)}…` }, null, 2);
}

const CHECK = <svg aria-hidden viewBox="0 0 16 16" width="14" height="14"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const CROSS = <svg aria-hidden viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;

const DOCUMENT_KINDS: readonly string[] = ['page', 'document', 'deck'];

/**
 * Remove, in two presses: "Remove" asks, "Remove <title>" does it. A built-in editor has none (crew refuses it, 409).
 * The state is kept PER EDITOR (xreview r1): a removal still in flight, or its refusal, belongs to the editor it was
 * pressed on, never to whichever card is open when crew answers.
 */
type RemoveState = { state: 'idle' } | { state: 'asking' } | { state: 'removing' } | { state: 'failed'; error: string };
const IDLE: RemoveState = { state: 'idle' };

/** Whether `card` is an editor this person installed (the only kind Remove is offered for, or ever sent for). */
export function removableCard(card: Pick<PluginCardModel, 'source' | 'editor'> | null): boolean {
  return card?.editor !== undefined && !card.editor.first_party && card.source === 'installed';
}

function PluginDetails({ card, onClose, onSwitch, switching, switchError, navigate, remove, onRemove, onRemoveAsk, focusGrant }: {
  card: PluginCardModel; onClose: () => void; onSwitch: (on: boolean) => void; switching: boolean; switchError: string | null; navigate: (p: string) => void;
  remove: RemoveState; onRemove: () => void; onRemoveAsk: (asking: boolean) => void;
  /** F37: the permission a host note's "Allow it in Plugins" pointed at (its switch takes the keyboard). */
  focusGrant: string | null;
}): React.ReactElement {
  const close = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); }, [card.key]);
  const e = card.editor;
  const grants = useEditorGrants(e);
  // "May do" ticks only what crew decided it may do (F37, codex r1): a permission still asking (or denied) is under
  // "Asks for"; while crew's answer is unknown, an installed editor is ticked for nothing.
  const allowed = e !== undefined ? allowedOf(e, grants.load) : null;
  const mayDo = e !== undefined && allowed !== null ? e.permissions.filter((p) => allowed.has(p.id)) : null;
  // An empty decided set is "nothing yet", not the manifest's "Asks for nothing" (codex r2).
  const words = mayDo === null ? null : mayDo.length === 0 ? { can: 'Nothing yet: it does only what you allow.', internet: null } : permissionsInWords(mayDo);
  const opensDocuments = e !== undefined && e.enabled && e.first_party && e.kinds.some((k) => DOCUMENT_KINDS.includes(k));
  // The app runtime's door is the Apps page (DES-APPS-001: an app is made and opened there), in place of a sample.
  const appsDoor = e !== undefined && e.enabled && e.first_party && e.kinds.includes(APP_KIND);
  const door = e !== undefined ? openHref(e) : null;
  const removable = removableCard(card);
  return (
    <aside data-testid="plugin-details" data-plugin={card.id} aria-label={`${card.title}: details`} className="wk-plugdetail"
      onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose(); } }}>
      <div className="wk-plugdetail-head">
        <PluginIcon card={card} size={40} />
        <div className="wk-plugdetail-name">
          <h2 data-testid="plugin-details-title">{card.title}</h2>
          <p>{card.id}{card.version !== null ? ` · ${card.version}` : ''} · {SOURCE_WORDS[card.source]}</p>
        </div>
        <button type="button" ref={close} data-testid="plugin-details-close" className="wk-runplugin-btn" aria-label={`Close the details of ${card.title}`} onClick={onClose}>
          <svg aria-hidden viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
      <Preview card={card} place="details" />
      <p className="wk-plugdetail-line">{card.line}</p>

      {/* On / off: an editor's switch is crew's (human-only); a built-in run plugin ships with studio and has none. */}
      <div className="wk-plugdetail-switch" data-testid="plugin-details-switch-row">
        {e !== undefined ? (
          <>
            <span><b>{e.enabled ? 'On' : 'Off'}</b><br /><span className="wk-plugdetail-muted">Off takes effect where it opens next. Only you can change this.</span></span>
            <button type="button" role="switch" aria-checked={e.enabled} data-testid="plugin-details-switch" disabled={switching || remove.state === 'removing'}
              aria-label={`${card.title} is ${e.enabled ? 'on' : 'off'}`} className="wk-switch" onClick={() => onSwitch(!e.enabled)}>
              <span aria-hidden className="wk-switch-track"><span className="wk-switch-thumb" /></span>
            </button>
          </>
        ) : (
          <span><b>On</b><br /><span className="wk-plugdetail-muted">Built in: it ships with studio and is on in every job.</span></span>
        )}
      </div>
      {switchError !== null && <p role="alert" data-testid="plugin-details-switch-error" className="wk-plugdetail-bad">Not changed: {switchError}</p>}

      {e !== undefined && <EditorGrantSwitches key={`${e.id}@${e.version}#${e.sha256}`} editor={e} title={card.title} grants={grants} focus={focusGrant} />}

      {card.run !== undefined && card.run.panels.length > 0 && (
        <section className="wk-plugdetail-sec" data-testid="plugin-details-slot">
          <h3>Shows in</h3>
          <ul className="wk-plugdetail-grants">{card.run.panels.map((p) => <li key={p.id}>{CHECK}<span>{slotWords(p)}<br /><code>{p.slot}</code></span></li>)}</ul>
        </section>
      )}
      {e !== undefined && (
        <section className="wk-plugdetail-sec" data-testid="plugin-details-slot">
          <h3>Shows in</h3>
          <ul className="wk-plugdetail-grants"><li>{CHECK}<span>Opens {kindsInWords(e.kinds)} · {e.sizes.map((s) => (s === 'inline' ? 'in the conversation' : s === 'pane' ? 'beside it' : 'full screen')).join(', ')}</span></li></ul>
        </section>
      )}

      {card.run !== undefined && (
        <section className="wk-plugdetail-sec" data-testid="plugin-details-hears">
          <h3>Hears (events it was granted)</h3>
          <ul className="wk-plugdetail-grants">
            {card.run.observe.map((o) => <li key={o.topic} data-topic={o.topic}>{CHECK}<span>{topicWords(o.topic)}<br /><code>{o.topic}</code></span></li>)}
          </ul>
        </section>
      )}

      <section className="wk-plugdetail-sec" data-testid="plugin-details-may">
        <h3>May do</h3>
        <ul className="wk-plugdetail-grants">
          {card.run?.permissions.map((g) => <li key={g.id} data-permission={g.id}>{CHECK}<span>It {permissionWords(g.id)} <code>{g.id}</code></span></li>)}
          {e !== undefined && words !== null && <li>{CHECK}<span data-testid="editor-plugin-permissions">{words.can}</span></li>}
          {e !== undefined && words === null && <li>{CHECK}<span data-testid="editor-plugin-permissions">{grants.load.state === 'changed' ? 'Updated since this page was read: reload it to see what it may do.' : grants.load.state === 'error' ? 'Not known: what it may do could not be read.' : 'Reading what it may do from studio’s service…'}</span></li>}
          {words?.internet != null && <li data-testid="editor-plugin-internet">{CHECK}<span>{words.internet}</span></li>}
          <li className="wk-plugdetail-never">{CROSS}<span>{card.run !== undefined ? 'Never answers a decision, lowers rigor or skips a review; only you send a step anything.' : 'Never starts an agent, answers a decision or sends your work anywhere.'}</span></li>
        </ul>
      </section>

      {appsDoor && (
        <section className="wk-plugdetail-sec" data-testid="plugin-details-apps" data-editor={e.id}>
          <h3>Use it</h3>
          <p className="wk-plugdetail-muted">Apps and dashboards over your APIs and databases are made and opened on the Apps page.</p>
          <p style={{ marginTop: 8 }}>
            <a href="/apps" data-testid="plugin-open-apps" className="wk-btn wk-btn--secondary wk-btn--sm" aria-label={`Open Apps: ${e.title}`}
              onClick={(ev) => { ev.preventDefault(); navigate('/apps'); }}>Open Apps</a>
          </p>
        </section>
      )}

      {e !== undefined && !appsDoor && (opensDocuments || (e.enabled && door !== null)) && (
        <section className="wk-plugdetail-sec" data-testid="editor-plugin-row" data-editor={e.id}>
          <h3>Use it</h3>
          {opensDocuments && <OpenDocumentList kinds={e.kinds} navigate={navigate} />}
          {opensDocuments && !e.kinds.includes('document') && !e.kinds.includes('deck') && (
            <p data-testid="editor-plugin-elsewhere" className="wk-plugin-docs-note">Written documents open in studio’s own editor for now; decks open in Slides.</p>
          )}
          {door !== null && (
            <p style={{ marginTop: 8 }}>
              <a href={door.href} data-testid="editor-plugin-open" className={`wk-btn ${opensDocuments ? 'wk-btn--quiet' : 'wk-btn--secondary'} wk-btn--sm`} aria-label={`${door.text}: ${e.title}`} onClick={(ev) => { ev.preventDefault(); navigate(door.href); }}>{door.text}</a>
            </p>
          )}
        </section>
      )}

      <section className="wk-plugdetail-sec">
        <h3>Manifest</h3>
        <pre data-testid="plugin-details-manifest" className="wk-plugdetail-manifest">{manifestOf(card)}</pre>
      </section>

      {removable && (
        <section className="wk-plugdetail-sec" data-testid="plugin-details-remove">
          <h3>Remove</h3>
          {remove.state !== 'idle' ? (
            <>
              <p className="wk-plugdetail-muted" data-testid="plugin-remove-confirm-line">Remove {card.title}? It is uninstalled and its install grant is withdrawn. Documents it opened stay; another editor, or studio’s own, opens them.</p>
              <p style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button type="button" data-testid="plugin-remove-confirm" className="wk-btn wk-btn--danger wk-btn--sm" disabled={remove.state === 'removing' || switching} onClick={onRemove}>
                  {remove.state === 'removing' ? 'Removing…' : `Remove ${card.title}`}
                </button>
                <button type="button" data-testid="plugin-remove-cancel" className="wk-btn wk-btn--quiet wk-btn--sm" disabled={remove.state === 'removing'} onClick={() => onRemoveAsk(false)}>Keep it</button>
              </p>
            </>
          ) : (
            <>
              <p className="wk-plugdetail-muted">Uninstall it. Only you can do this.</p>
              <p style={{ marginTop: 8 }}>
                <button type="button" data-testid="plugin-remove" className="wk-btn wk-btn--secondary wk-btn--sm" disabled={switching} onClick={() => onRemoveAsk(true)}>Remove</button>
              </p>
            </>
          )}
          {remove.state === 'failed' && <p role="alert" data-testid="plugin-remove-error" className="wk-plugdetail-bad">Not removed: {remove.error}</p>}
        </section>
      )}
    </aside>
  );
}

/**
 * THE PLUGINS PAGE (`/plugins`): the cards, the filter, and one card's details. "Create a plugin" opens the launch
 * wizard on the editor-plugin workflow; the editor test page and the MCP inspector stay one click away.
 */
/** F37: `?editor=<id>&allow=<permission>` (a host note's "Allow it in Plugins") opens that editor's details at that switch. */
export function deepLinkOf(search: string | undefined): { editor: string; allow: string | null } | null {
  const q = new URLSearchParams(search ?? '');
  const editor = q.get('editor');
  return editor === null || editor === '' ? null : { editor, allow: q.get('allow') };
}

export function PluginsPage({ navigate, search }: { navigate: (p: string) => void; search?: string }): React.ReactElement {
  const { load, retry, retrying } = useEditorList();
  const link = useMemo(() => deepLinkOf(search), [search]);
  const [switched, setSwitched] = useState<Record<string, boolean>>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const editors = useMemo(() => (load.state === 'ready'
    ? load.editors.filter((e) => !removed.has(e.id)).map((e) => (Object.hasOwn(switched, e.id) ? { ...e, enabled: switched[e.id]! } : e))
    : null), [load, switched, removed]);
  const cards = useMemo(() => cardsOf(RUN_PLUGINS, editors), [editors]);
  const [filter, setFilter] = useState<PluginFilter>('all');
  const [picked, setPicked] = useState<string | null>(null);
  // The card open NOW, read when crew answers a removal (its callback closes over an older render).
  const pickedRef = useRef<string | null>(null);
  pickedRef.current = picked;
  const [switching, setSwitching] = useState(false);
  // A switch's refusal belongs to the editor it was pressed on (xreview r1).
  const [switchError, setSwitchError] = useState<{ id: string; error: string } | null>(null);
  const [removes, setRemoves] = useState<Record<string, RemoveState>>({});
  // Where the keyboard goes once React has committed a Remove step (never a node that is about to go).
  const [focusNext, setFocusNext] = useState<{ to: 'remove' | 'confirm' | 'grid'; gone: string | null } | null>(null);
  // The deep link opens its editor once the list has it (once per link: closing the details is not undone).
  const linked = useRef<string | null>(null);
  useEffect(() => {
    // Leaving the link forgets it (codex r1): arriving on it again opens the details again.
    if (link === null) { linked.current = null; return; }
    if (load.state !== 'ready') return;
    const key = `editor:${link.editor}`;
    if (linked.current === `${search ?? ''}`) return;
    if (!cards.some((c) => c.key === key)) return;
    linked.current = `${search ?? ''}`;
    setPicked(key);
  }, [link, load.state, cards, search]);
  const shown = filterCards(cards, filter);
  const card = picked !== null ? cards.find((c) => c.key === picked) ?? null : null;
  const removeOf = (id: string | undefined): RemoveState => (id !== undefined ? removes[id] ?? IDLE : IDLE);
  const setRemoveOf = (id: string, r: RemoveState): void => setRemoves((m) => {
    const next = { ...m };
    if (r.state === 'idle') delete next[id]; else next[id] = r;
    return next;
  });
  /** Leaving a card drops its unanswered question and its old refusal; a removal in flight keeps going. */
  const settleOpen = (): void => setRemoves((m) => Object.fromEntries(Object.entries(m).filter(([, r]) => r.state === 'removing')));
  const pick = (key: string): void => { setSwitchError(null); settleOpen(); setPicked((k) => (k === key ? null : key)); };
  const closeDetails = (): void => {
    const was = picked;
    settleOpen();
    setPicked(null);
    // The keyboard goes back to the card it came from.
    if (was !== null) queueMicrotask(() => document.querySelector<HTMLElement>(`[data-testid="plugin-tile"][data-plugin="${was.split(':')[1]}"]`)?.focus());
  };
  const onSwitch = (on: boolean): void => {
    const e = card?.editor;
    if (e === undefined) return;
    setSwitching(true);
    setSwitchError(null);
    setEditorEnabled(e.id, on)
      .then((v) => setSwitched((s) => ({ ...s, [e.id]: typeof v?.enabled === 'boolean' ? v.enabled : on })))
      .catch((err: unknown) => setSwitchError({ id: e.id, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => setSwitching(false));
  };
  const onRemove = (): void => {
    const e = card?.editor;
    // Sent only for an editor you installed, never twice at once, never while its switch is being changed.
    if (e === undefined || !removableCard(card) || removeOf(e.id).state === 'removing' || switching) return;
    const id = e.id;
    const key = `editor:${id}`;
    setRemoveOf(id, { state: 'removing' });
    removeEditor(id)
      .then(() => {
        setRemoved((s) => new Set([...s, id]));
        setRemoveOf(id, IDLE);
        // Close the details only if they still show this editor; another card the person opened stays open.
        if (pickedRef.current === key) {
          setPicked(null);
          setFocusNext({ to: 'grid', gone: id });
        }
      })
      .catch((err: unknown) => {
        setRemoveOf(id, { state: 'failed', error: err instanceof Error ? err.message : String(err) });
        if (pickedRef.current === key) setFocusNext({ to: 'confirm', gone: null });
      });
  };
  const onRemoveAsk = (asking: boolean): void => {
    const id = card?.editor?.id;
    if (id === undefined) return;
    setRemoveOf(id, asking ? { state: 'asking' } : IDLE);
    setFocusNext({ to: asking ? 'confirm' : 'remove', gone: null });
  };
  useEffect(() => {
    if (focusNext === null) return;
    const q = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
    const el = focusNext.to === 'remove' ? q('[data-testid="plugin-remove"]')
      : focusNext.to === 'confirm' ? q('[data-testid="plugin-remove-confirm"]')
        : q(`[data-testid="plugin-tile"]:not([data-plugin="${focusNext.gone ?? ''}"])`) ?? q('[data-testid="plugins-filter"] [aria-checked="true"]');
    el?.focus();
    setFocusNext(null);
  }, [focusNext]);
  const count = (f: PluginFilter): number => filterCards(cards, f).length;
  return (
    <PageFrame
      data-testid="plugins-page"
      title={PAGE_NAMES.plugins}
      intro="What extends studio: sections in a job’s details, editors for what studio makes. Each does only what its card lists."
      actions={<>
        <a href="/editors/dev" className="wk-btn wk-btn--secondary" data-testid="editor-plugins-devhost" onClick={(ev) => { ev.preventDefault(); navigate('/editors/dev'); }}>
          Open the editor test page
        </a>
        <a href={mcpInspectPath()} className="wk-btn wk-btn--secondary" data-testid="editor-plugins-mcp-inspect" onClick={(ev) => { ev.preventDefault(); navigate(mcpInspectPath()); }}>
          Open the MCP inspector
        </a>
        <button type="button" className="wk-btn wk-btn--primary" data-testid="editor-plugins-create" onClick={() => startCreateEditorPlugin()}>
          Create a plugin
        </button>
      </>}
    >
      <div className="wk-plugpage-filters">
        <div role="radiogroup" aria-label="Show" className="wk-segmented" data-testid="plugins-filter">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} data-filter={f.id} className="wk-segmented-option"
              onClick={() => setFilter(f.id)}>{f.label} · {count(f.id)}</button>
          ))}
        </div>
        <span className="wk-plugdetail-muted">Previews are live where the plugin offers one: it replays its own sample events in a sandbox.</span>
      </div>
      {load.state === 'error' && <StateBanner kind="error" what="the editor plugins" error={load.error} onRetry={retry} retrying={retrying} data-testid="editor-plugins-error" />}
      {load.state === 'unsupported' && <p data-testid="editor-plugins-unsupported" className="wk-plugdetail-muted">This version of studio’s service lists no editor plugins; update it to see them here.</p>}
      <div className="wk-plugpage-layout" data-detail={card !== null ? 'true' : 'false'}>
        <div data-testid="plugins-grid" className="wk-plugpage-grid" aria-label="Plugins" role="list">
          {shown.map((c) => <div role="listitem" key={c.key} className="wk-plugpage-cell"><PluginTile card={c} selected={c.key === picked} onPick={() => pick(c.key)} /></div>)}
          {load.state === 'loading' && filter !== 'job' && <div role="listitem" className="wk-plugpage-cell"><Skeleton rows={3} data-testid="editor-plugins-loading" /></div>}
        </div>
        {filter === 'mine' && shown.length === 0 && load.state === 'ready' && (
          <EmptyState data-testid="editor-plugins-empty" title="Nothing installed by you yet." body="Create one, and it shows here once its job passes studio’s checks and you approve the install." />
        )}
        {card !== null && <PluginDetails card={card} onClose={closeDetails} onSwitch={onSwitch} switching={switching}
          switchError={switchError !== null && switchError.id === card.editor?.id ? switchError.error : null} navigate={navigate}
          remove={removeOf(card.editor?.id)} onRemove={onRemove} onRemoveAsk={onRemoveAsk}
          focusGrant={link !== null && card.editor?.id === link.editor ? link.allow : null} />}
      </div>
    </PageFrame>
  );
}
