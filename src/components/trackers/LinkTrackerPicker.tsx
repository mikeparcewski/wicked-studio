import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { sourcesPath } from '../../api/sources.js';
import { sourceTrackersOf, systemName, trackerRefusal, trackersApi, type SourceTracker, type TrackerLinkTarget } from '../../api/trackers.js';
import { useModalEscape } from '../Modal.js';
import { TrackerBadge, usePmSources } from './TrackerParts.js';

/**
 * LINK A TRACKER (DES-PM-001 §3.3, mockup screen 2b): pick the tool (a registered PM source) and its site, then search
 * the projects it lists now (`GET /sources/:name/trackers`, a live read with the source's own credential, page by page),
 * and Link one to this project or repo. crew checks the project exists before it links (422 `tracker_unknown`), and
 * answers once the registry holds it; the card then reads its links again, so it shows crew's answer.
 *
 * This is the ONLY caller of `trackersApi.link` (`tests/trackersHumanOnly.test.ts`), and it links only on a click.
 */
export function LinkTrackerPicker({ target, targetName, onLinked, onClose, navigate }: {
  target: TrackerLinkTarget;
  /** The project's or repo's name, for the line that says whom the link reaches. */
  targetName: string;
  onLinked: () => Promise<void>;
  onClose: () => void;
  navigate: (path: string) => void;
}): React.ReactElement {
  useModalEscape(onClose);
  const titleId = useId();
  const { sources, error: sourcesError } = usePmSources(true);
  const [source, setSource] = useState<string | null>(null);
  const [tenant, setTenant] = useState<string | null>(null);
  const [q, setQ] = useState('');
  /** Every site this tool's first unfiltered page named (a token can reach several Jira sites). */
  const [sites, setSites] = useState<Array<{ tenant: string; label: string }>>([]);
  const [page, setPage] = useState<{ key: string; trackers: SourceTracker[]; next: string | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const gen = useRef(0);
  /** A Link that lands after this picker closed (and maybe another opened) must not close that one. */
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  /** Every site this tool's projects named so far, across pages (one page may hold one site). */
  const addSites = (trackers: readonly SourceTracker[]): void => setSites((cur) => {
    const seen = new Map(cur.map((x) => [x.tenant, x.label]));
    for (const t of trackers) if (!seen.has(t.tenant)) seen.set(t.tenant, t.tenantLabel ?? t.tenant);
    return seen.size === cur.length ? cur : [...seen].map(([tenant, label]) => ({ tenant, label }));
  });

  // The first registered tool is picked; the person can pick another.
  useEffect(() => {
    if (source === null && sources !== null && sources.length > 0) setSource(sources[0]!.name);
  }, [sources, source]);
  const picked = sources?.find((s) => s.name === source) ?? null;
  useEffect(() => { search.current?.focus(); }, [picked?.name]);

  const key = `${source ?? ''}\u0000${tenant ?? ''}\u0000${q.trim()}`;
  // Searched as the person types (300 ms after the last key); only the newest read lands.
  useEffect(() => {
    if (source === null) return undefined;
    const mine = ++gen.current;
    setReading(true);
    const timer = setTimeout(() => {
      trackersApi.sourceTrackers(source, { q: q.trim(), tenant }).then(
        (raw) => {
          if (mine !== gen.current) return;
          const r = sourceTrackersOf(raw, source);
          setReading(false);
          if (r === null) { setPage(null); setError('crew’s list of projects could not be read: update studio or crew.'); return; }
          setError(null);
          setPage({ key, trackers: r.trackers, next: r.next });
          if (tenant === null) addSites(r.trackers);
        },
        (e: unknown) => {
          if (mine !== gen.current) return;
          setReading(false);
          setPage(null);
          setError(trackerRefusal(e, 'read'));
        },
      );
    }, q === '' ? 0 : 300);
    return () => clearTimeout(timer);
    // `key` stands for source, tenant and the trimmed text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const more = async (): Promise<void> => {
    if (source === null || page === null || page.next === null) return;
    const mine = ++gen.current;
    setReading(true);
    try {
      const r = sourceTrackersOf(await trackersApi.sourceTrackers(source, { q: q.trim(), tenant, cursor: page.next }), source);
      if (mine !== gen.current) return;
      if (r === null) { setError('crew’s list of projects could not be read: update studio or crew.'); return; }
      setPage((p) => (p === null ? p : { key: p.key, trackers: [...p.trackers, ...r.trackers], next: r.next }));
      if (tenant === null) addSites(r.trackers);
    } catch (e) {
      if (mine === gen.current) setError(trackerRefusal(e, 'read'));
    } finally {
      if (mine === gen.current) setReading(false);
    }
  };

  const link = async (t: SourceTracker): Promise<void> => {
    if (source === null || linking !== null) return;
    setLinking(`${t.tenant}\u0000${t.key}`);
    setError(null);
    try {
      await trackersApi.link({ source, tenant: t.tenant, key: t.key, target });
      await onLinked();
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) setError(trackerRefusal(e, 'link'));
      // A refusal crew may not have answered whole: the card reads crew's links again either way.
      await onLinked();
    } finally {
      if (mounted.current) setLinking(null);
    }
  };

  const shown = page !== null && page.key === key ? page : null;
  // One site named only when it is the only one this tool can show (no more pages to read).
  const siteName = tenant !== null ? sites.find((s) => s.tenant === tenant)?.label ?? tenant : sites.length === 1 && shown !== null && shown.next === null ? sites[0]!.label : null;
  /** Each row names its site whenever two sites are known, or more pages may hold another. */
  const labelSites = tenant === null && (sites.length > 1 || (shown !== null && shown.next !== null));
  const linkedHere = (t: SourceTracker): boolean => t.links.some((l) => l.target.kind === target.kind && l.target.id === target.id);
  const systemWord = picked === null ? 'project' : picked.system === 'github' ? 'repository' : `${systemName(picked.system)} project`;
  const reach = target.kind === 'project' ? `Linking reaches jobs and chats in ${targetName} only.` : `Linking reaches every project ${targetName} is in, and any job that works on it.`;
  const options = useMemo(() => sources ?? [], [sources]);

  return (
    <div className="wk-trk-pop" role="dialog" aria-labelledby={titleId} data-testid="tracker-picker">
      <p id={titleId} className="wk-trk-pop-title">Link a tracker to {targetName}</p>
      {sources === null && <p className="wk-src-cap">Reading the registered tools…</p>}
      {sources !== null && options.length === 0 && (
        <p className="wk-src-note" data-testid="tracker-picker-none">
          {sourcesError !== null ? 'crew’s sources could not be read just now.' : 'No project-management tool is registered yet.'}{' '}
          <a className="wk-link" href={sourcesPath()} onClick={(e) => { e.preventDefault(); navigate(sourcesPath()); }}>Add Jira or GitHub Issues on Data sources</a>
        </p>
      )}
      {options.length > 0 && (
        <>
          <label className="wk-src-field">
            <span className="wk-src-label">Tool</span>
            <span className="wk-trk-select">
              {picked !== null && <TrackerBadge system={picked.system} small />}
              <select className="wk-field wk-src-input" data-testid="tracker-picker-source" value={source ?? ''} onChange={(e) => { setSource(e.target.value); setTenant(null); setSites([]); setPage(null); }}>
                {options.map((s) => <option key={s.name} value={s.name}>{s.name} · {systemName(s.system)}</option>)}
              </select>
            </span>
          </label>
          {sites.length > 1 && (
            <label className="wk-src-field">
              <span className="wk-src-label">Site</span>
              <select className="wk-field wk-src-input" data-testid="tracker-picker-site" value={tenant ?? ''} onChange={(e) => setTenant(e.target.value === '' ? null : e.target.value)}>
                <option value="">{shown !== null && shown.next !== null ? 'Every site (more may be listed below)' : 'Every site this token reaches'}</option>
                {sites.map((s) => <option key={s.tenant} value={s.tenant}>{s.label}</option>)}
              </select>
            </label>
          )}
          <label className="wk-src-field">
            <span className="wk-src-label">{systemWord[0]!.toUpperCase() + systemWord.slice(1)}</span>
            <span className="wk-trk-search">
              <Search size={14} aria-hidden />
              <input ref={search} type="search" className="wk-field wk-src-input" data-testid="tracker-picker-search" spellCheck={false} value={q} placeholder={picked?.system === 'github' ? 'owner/repo' : 'Key or name'} onChange={(e) => setQ(e.target.value)} />
            </span>
          </label>
          <div className="wk-trk-opts" data-testid="tracker-picker-results" aria-busy={reading}>
            {shown === null && reading && <p className="wk-src-cap">Searching…</p>}
            {shown !== null && shown.trackers.length === 0 && <p className="wk-src-note" data-testid="tracker-picker-empty">No {systemWord} matches.</p>}
            {shown?.trackers.map((t) => {
              const here = linkedHere(t);
              const busy = linking === `${t.tenant}\u0000${t.key}`;
              return (
                <div key={`${t.tenant}\u0000${t.key}`} className="wk-trk-opt" data-testid="tracker-picker-option" data-key={t.key}>
                  <b>{t.key}</b>
                  <span className="wk-trk-opt-label">{t.label}{labelSites ? <span className="wk-src-cap"> · {t.tenantLabel ?? t.tenant}</span> : null}</span>
                  <span className="wk-src-sp" />
                  <button type="button" className={`wk-btn wk-btn--sm ${here ? 'wk-btn--quiet' : 'wk-btn--secondary'}`} data-testid="tracker-picker-link" disabled={here || linking !== null} onClick={() => void link(t)}>
                    {here ? 'Linked' : busy ? 'Linking…' : 'Link'}
                  </button>
                </div>
              );
            })}
            {shown !== null && shown.next !== null && <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="tracker-picker-more" disabled={reading} onClick={() => void more()}>More</button>}
          </div>
          {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail" data-testid="tracker-picker-error">{error}</p>}
          <p className="wk-src-note">Read live{siteName !== null ? ` from ${siteName}` : ''}, searched as you type. {reach}</p>
        </>
      )}
      <div className="wk-trk-pop-foot">
        <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="tracker-picker-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
