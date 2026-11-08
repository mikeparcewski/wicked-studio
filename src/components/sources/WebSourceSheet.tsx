import { useEffect, useId, useRef, useState } from 'react';
import { Globe, X } from 'lucide-react';
import { ApiError } from '../../api/errors.js';
import type { SourceAgentAccess } from '../../api/sourceAgents.js';
import { installWebSource, readWebSetup, WEB_SOURCE_NAME, type WebSourceSetup } from '../../api/webSource.js';
import { useModalEscape } from '../Modal.js';
import { AgentAccess } from './AgentAccess.js';
import { useDialogFocus } from './useDialogFocus.js';

/** What the web source does, said before anything is installed (CS9). */
export const WEB_SOURCE_DOES = [
  'Agents search the web and read public pages, for research jobs.',
  'robots.txt is obeyed. Private, local and cloud-metadata addresses are refused, checked as each connection opens.',
  'A page download is cut at 2 MB. No cookies, logins or tokens are sent.',
  'Every search and page read is recorded with its URL or query and the time.',
] as const;

const short = (h: string): string => `${h.slice(0, 12)}…${h.slice(-6)}`;
const ENGINE_NAME: Record<'docker' | 'podman' | 'nerdctl', string> = { docker: 'Docker', podman: 'Podman', nerdctl: 'Rancher Desktop' };

/**
 * THE WEB SOURCE'S SHEET (Settings → Sources → the web): what installing it puts on this computer (SearXNG's image
 * by digest, the page reader and every locked package with its hashes), BEFORE consent; the one Install button, which
 * sends the exact lock and image shown; and, once installed, the source's Agents box ("Agents can query" starts off).
 * With no container engine the sheet says so plainly and Install is not offered.
 */
export function WebSourceSheet({ initial, onClose, onChanged, unverified = false, onReread }: {
  initial: WebSourceSetup;
  onClose: () => void;
  /** crew's state after an install or a switch change (the page's box re-renders from it). */
  onChanged: (setup: WebSourceSetup) => void;
  unverified?: boolean;
  onReread?: () => void;
}): React.ReactElement {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  useModalEscape(onClose);
  const [setup, setSetup] = useState<WebSourceSetup>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setSetup(initial), [initial]);

  const blockers = [setup.search.ready ? null : setup.search.reason, setup.python.found ? null : setup.python.reason].filter((x): x is string => x !== null);
  const reader = setup.lock.packages.find((p) => p.name === setup.reader.name);
  /** Distinct packages besides the reader (a package pinned per Python version is one package). */
  const deps = new Set(setup.lock.packages.filter((p) => p.name !== setup.reader.name).map((p) => p.name));
  const hashCount = setup.lock.packages.reduce((n, p) => n + p.sha256.length, 0);

  const install = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await installWebSource({ lock: setup.lock.sha256, image: setup.image.digest });
      if (r === 'unreadable') {
        setError('crew installed it, but its answer could not be read: close the sheet and open it again.');
        return;
      }
      setSetup(r);
      onChanged(r);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      // What crew now holds (an install may have run partly, or another one is running).
      const again = await readWebSetup().catch(() => null);
      if (again !== null && again !== 'unreadable') setSetup(again);
    } finally {
      setBusy(false);
    }
  };

  const onAgents = (agents: SourceAgentAccess): void => {
    const next = { ...setup, agents };
    setSetup(next);
    onChanged(next);
  };

  return (
    <div className="wk-src-scrim" data-testid="web-sheet-scrim">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="wk-src-sheet wk-web-sheet" data-testid="web-sheet" data-installed={setup.installed ? 'yes' : 'no'}>
        <header className="wk-src-sheet-head">
          <Globe size={18} aria-hidden />
          <h2 id={titleId} className="wk-src-title" data-testid="web-sheet-title">The web</h2>
          <span className="wk-tag">{setup.installed ? 'Installed' : 'Not installed'}</span>
          <button type="button" aria-label="Close" className="wk-btn wk-btn--quiet wk-btn--icon" data-testid="web-sheet-close" onClick={onClose}><X size={16} aria-hidden /></button>
        </header>
        <div className="wk-src-sheet-main">
          <div className="wk-src-grid">
            <div className="wk-src-col" data-testid="web-sheet-about">
              <ul className="wk-web-does" data-testid="web-does">
                {WEB_SOURCE_DOES.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <div className="wk-src-box" data-testid="web-installs">
                <div className="wk-src-box-head"><span className="wk-src-strong">{setup.installed ? 'What is installed' : 'What Install puts on this computer'}</span></div>
                <div className="wk-web-pkg" data-testid="web-pkg-search">
                  <p className="wk-src-strong">Search: SearXNG {setup.image.version}</p>
                  <p className="wk-src-cap">Image <code className="wk-src-mono" data-testid="web-image-ref">{setup.image.ref.split('@')[0]}</code>, pinned by digest <code className="wk-src-mono" title={setup.image.digest} data-testid="web-image-digest">{short(setup.image.digest)}</code></p>
                  <p className="wk-src-note" data-testid="web-license">{setup.image.note} License {setup.image.license}; source at <a href={setup.image.source} target="_blank" rel="noreferrer">github.com/searxng/searxng</a> ({setup.image.revision.slice(0, 9)}).</p>
                </div>
                <div className="wk-web-pkg" data-testid="web-pkg-reader">
                  <p className="wk-src-strong">Reading pages: {setup.reader.name} {setup.reader.version}</p>
                  <p className="wk-src-cap">License {setup.reader.license}. sha256 {reader !== undefined && reader.sha256.length > 0 ? reader.sha256.map((h) => <code key={h} className="wk-src-mono" title={h}>{short(h)} </code>) : 'not in the lock'}</p>
                  <p className="wk-src-note" data-testid="web-lock">
                    Plus {deps.size} dependencies, each pinned to one version and installed only if its file matches one of the lock’s {hashCount} sha256 hashes. Lock <code className="wk-src-mono" title={setup.lock.sha256}>{short(setup.lock.sha256)}</code>. No script is downloaded and run.
                  </p>
                  <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" aria-expanded={showAll} data-testid="web-lock-toggle" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide the packages' : 'Show every package and hash'}</button>
                  {showAll && (
                    <ul className="wk-web-lock-list" data-testid="web-lock-list">
                      {setup.lock.packages.map((p) => (
                        <li key={`${p.name}${p.version}${p.markers ?? ''}`}>
                          <span><span className="wk-src-strong">{p.name} {p.version}</span>{p.markers !== null && <span className="wk-src-cap"> (when {p.markers})</span>}</span>
                          <span className="wk-web-hashes">{p.sha256.map((h) => <code key={h} className="wk-src-mono">{h}</code>)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
            <div className="wk-src-col" data-testid="web-sheet-state">
              <div className="wk-src-box" data-testid="web-needs">
                <div className="wk-src-box-head"><span className="wk-src-strong">What it needs</span></div>
                <p className={`wk-src-note ${setup.search.ready ? '' : 'wk-src-tone-fail'}`} data-testid="web-need-engine">
                  {setup.search.ready && setup.search.engine !== null ? `A container engine: ${ENGINE_NAME[setup.search.engine]} found. SearXNG runs in it, reachable from this computer only.` : setup.search.reason}
                </p>
                <p className={`wk-src-note ${setup.python.found ? '' : 'wk-src-tone-fail'}`} data-testid="web-need-python">
                  {setup.python.found ? `Python 3.10 or newer: ${setup.python.version} found. The page reader gets its own environment under crew’s state folder.` : setup.python.reason}
                </p>
              </div>
              {setup.registered && setup.agents !== null ? (
                <AgentAccess source={WEB_SOURCE_NAME} dialect="web" agents={setup.agents} unverified={unverified} {...(onReread !== undefined ? { onReread } : {})} data-testid="web-agent-controls" onChanged={onAgents} />
              ) : (
                <p className="wk-src-note" data-testid="web-agents-after-install">Agents stay off after the install: nothing searches or reads the web until you turn on “Agents can query” here and choose the projects.</p>
              )}
            </div>
          </div>
        </div>
        <footer className="wk-src-sheet-foot">
          {error !== null ? (
            <p role="alert" className="wk-src-note wk-src-tone-fail wk-src-foot-msg" data-testid="web-sheet-error">{error}</p>
          ) : (
            <span className="wk-src-cap wk-src-foot-msg" data-testid="web-sheet-foot">
              {setup.installed ? 'Installed. Turn on “Agents can query” when a job should read the web.' : blockers.length > 0 ? blockers[0] : busy || setup.installing ? 'Installing: building the page reader and pulling the search image. This can take a few minutes.' : 'Install builds the page reader from the lock and pulls the search image, exactly as listed.'}
            </span>
          )}
          {setup.installed ? (
            <button type="button" className="wk-btn wk-btn--primary" data-testid="web-done" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="web-cancel" onClick={onClose}>Cancel</button>
              <button type="button" className="wk-btn wk-btn--primary" data-testid="web-install" disabled={blockers.length > 0 || busy || setup.installing} onClick={() => void install()}>{busy || setup.installing ? 'Installing…' : 'Install'}</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
