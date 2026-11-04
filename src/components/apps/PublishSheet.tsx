import { useEffect, useMemo, useRef, useState } from 'react';
import { apiBase } from '../../api/client.js';
import type { AppDetail } from '../../api/types.js';
import { type PublishBody, type PublishFinding, type PublishTarget, publishedExtrasOf, secretEnvName, siteOriginProblem, startPublish } from '../../api/appsPublish.js';
import { publishedOf } from '../../editors/apps/appsDirectory.js';
import { useModalEscape } from '../Modal.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';
import { CopyRow } from './ShareSheet.js';

/**
 * PUBLISH (DES-APPS-001 §9.3, mockup state D; lane K6). One governed run publishes the version on screen: the publish
 * check (can't be waived), QE acceptance on fixture data (can't be skipped), then the person approves the list. Its
 * result is a container image the deployer runs at the address typed here: that address is the SHARE LINK (operator
 * 2026-11-03). When the run ends, the sheet shows the link, the iframe snippet (public apps) and the Teams package.
 */

export interface PublishSheetProps {
  detail: AppDetail;
  /** Re-read the app (crew's record carries `published` once the run produced it). */
  reload: () => Promise<AppDetail>;
  onClose: () => void;
  /** Open a run's page. */
  openRun?: (runId: string) => void;
  /** Poll interval while the run works (tests shorten it). */
  pollMs?: number;
}

type Phase = { kind: 'form' } | { kind: 'starting' } | { kind: 'running'; runId: string } | { kind: 'done'; detail: AppDetail };

const list = (s: string): string[] => s.split(/[\s,]+/).map((x) => x.trim()).filter((x) => x !== '');

export function PublishSheet({ detail, reload, onClose, openRun, pollMs = 4000 }: PublishSheetProps): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  useModalEscape(onClose);
  useDialogFocus(true, box, { modal: true });
  const spec = detail.spec;
  const sources = useMemo(() => {
    const m = new Map<string, { kind: 'sql' | 'other'; uses: string[] }>();
    for (const q of spec.queries) m.set(q.source, { kind: q.kind === 'sql' ? 'sql' : 'other', uses: [...(m.get(q.source)?.uses ?? []), q.id] });
    for (const a of spec.actions) m.set(a.source, { kind: a.kind === 'row-write' ? 'sql' : (m.get(a.source)?.kind ?? 'other'), uses: [...(m.get(a.source)?.uses ?? []), a.id] });
    return m;
  }, [spec]);
  const crewUses = sources.get('crew')?.uses ?? [];
  const hasActions = spec.actions.length > 0;
  const allPublic = spec.queries.length > 0 && spec.queries.every((q) => q.public === true);
  const canBePublic = !hasActions && allPublic;
  const last = publishedOf(detail);

  const [origin, setOrigin] = useState('');
  const [who, setWho] = useState<'signin' | 'public'>('signin');
  const [profile, setProfile] = useState<'oidc' | 'entra'>('oidc');
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [rule, setRule] = useState<'groups' | 'domains' | 'roles'>('groups');
  const [values, setValues] = useState('');
  const [embed, setEmbed] = useState(false);
  const [teams, setTeams] = useState(false);
  const [embedOrigins, setEmbedOrigins] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [refusal, setRefusal] = useState<{ message: string; findings: PublishFinding[] } | null>(null);

  // Entra judges app roles or group ids; generic OIDC group values or email domains.
  useEffect(() => {
    if (profile === 'entra' && rule === 'domains') setRule('roles');
    if (profile === 'oidc' && rule === 'roles') setRule('groups');
    if (profile !== 'entra') setTeams(false);
  }, [profile, rule]);
  useEffect(() => {
    if (who === 'signin') setEmbed(false);
  }, [who]);

  // While the run works, read the app until crew records THIS run's publish.
  useEffect(() => {
    if (phase.kind !== 'running') return undefined;
    let stopped = false;
    const t = setInterval(() => {
      void reload()
        .then((d) => {
          if (!stopped && publishedExtrasOf(d)?.runId === phase.runId) setPhase({ kind: 'done', detail: d });
        })
        .catch(() => undefined);
    }, pollMs);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [phase, reload, pollMs]);

  const originProblem = origin.trim() === '' ? null : siteOriginProblem(origin);
  const problems: string[] = [];
  if (origin.trim() === '') problems.push('Type the site address (the share link)');
  else if (originProblem !== null) problems.push(originProblem);
  if (crewUses.length > 0) problems.push(`The site cannot read the crew source: remove ${crewUses.join(', ')} first`);
  if (who === 'signin') {
    if (!issuer.trim().startsWith('https://')) problems.push('The issuer is an https:// address');
    if (clientId.trim() === '') problems.push('Type the client id');
    if (profile === 'entra' && !/^[0-9a-f-]{36}$/i.test(tenantId.trim())) problems.push('Type the tenant id');
    if (list(values).length === 0) problems.push(rule === 'domains' ? 'Name at least one email domain' : rule === 'roles' ? 'Name at least one app role' : 'Name at least one group');
  }
  if (embed && list(embedOrigins).length === 0) problems.push('Name the pages that may frame it');

  const body = (): PublishBody => {
    const targets: PublishTarget[] = ['site', ...(embed ? (['embed'] as const) : []), ...(teams ? (['teams'] as const) : [])];
    const vals = list(values);
    const audience: PublishBody['audience'] = who === 'public' ? { kind: 'public' }
      : profile === 'entra' ? (rule === 'groups' ? { kind: 'entra-groups', groups: vals } : { kind: 'entra-roles', roles: vals })
        : rule === 'domains' ? { kind: 'oidc-email-domain', domains: vals } : { kind: 'oidc-groups', groups: vals };
    const iss = profile === 'entra' && issuer.trim() === '' ? `https://login.microsoftonline.com/${tenantId.trim()}/v2.0` : issuer.trim();
    return {
      base: detail.head.version,
      targets,
      site: { origin: origin.trim().replace(/\/$/, '') },
      identity: who === 'public' ? null : { profile, issuer: iss, clientId: clientId.trim(), ...(profile === 'entra' ? { tenantId: tenantId.trim() } : {}) },
      audience,
      ...(embed ? { embedOrigins: list(embedOrigins) } : {}),
    };
  };

  const start = async (): Promise<void> => {
    setRefusal(null);
    setPhase({ kind: 'starting' });
    const r = await startPublish(detail.slug, body());
    if (r.ok) setPhase({ kind: 'running', runId: r.runId });
    else {
      setRefusal({ message: r.message, findings: r.findings });
      setPhase({ kind: 'form' });
    }
  };

  const envNames = [...sources.entries()].filter(([n]) => n !== 'crew').map(([n, s]) => secretEnvName(n, s.kind));
  const framedBy = embed ? (list(embedOrigins).join(', ') || 'the pages you name') : teams ? 'teams.microsoft.com and *.teams.microsoft.com only' : 'nobody';

  const result = phase.kind === 'done' ? { published: publishedOf(phase.detail), extras: publishedExtrasOf(phase.detail) } : null;

  return (
    <div className="wk-share-scrim" data-testid="apps-publish-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="wk-share wk-publish" role="dialog" aria-modal="true" aria-labelledby="wk-publish-title" data-testid="apps-publish" data-phase={phase.kind}>
        <header className="wk-share-head">
          <h2 id="wk-publish-title" className="wk-share-title">Publish {detail.name} <span className="wk-apps-pill">v{detail.head.version}</span></h2>
          <span className="wk-publish-since">{last !== null ? `Last published: v${last.version}` : 'Not published yet'}</span>
          <button type="button" className="wk-btn wk-btn--link" data-testid="apps-publish-close" onClick={onClose} aria-label="Close">Close</button>
        </header>

        {result !== null && result.published !== null ? (
          <div className="wk-publish-done" data-testid="apps-publish-done">
            <p className="wk-share-lead">Published v{result.published.version}. Run the image at the address below; that link is what you share.</p>
            <CopyRow label="Share link" value={result.published.shareUrl} testId="apps-publish-link" />
            <p className="wk-share-meta"><span className="wk-share-k">Who can open it</span> {result.published.audience}</p>
            {result.published.snippet !== null && <CopyRow label="Embed in a page" value={result.published.snippet} testId="apps-publish-embed" multiline />}
            {result.extras?.teamsUrl != null && (
              <p className="wk-share-meta"><span className="wk-share-k">Teams</span> <a className="wk-link" data-testid="apps-publish-teams" href={`${apiBase()}${result.extras.teamsUrl.replace(/^\/api\/v1/, '')}`} download>Download the Teams app package</a></p>
            )}
            {result.extras?.image != null && (
              <CopyRow label="Run it (the image is local; nothing was pushed)" testId="apps-publish-run"
                value={`docker run -p 8080:${result.extras.port}${result.extras.env.map((e) => ` -e ${e}=…`).join('')}${result.extras.volume !== null ? ` -v <volume>:${result.extras.volume}` : ''} ${result.extras.image.tag}`} />
            )}
          </div>
        ) : phase.kind === 'running' ? (
          <div className="wk-publish-running" data-testid="apps-publish-running" aria-live="polite">
            <p className="wk-share-lead">Publishing v{detail.head.version}: the check, then QE acceptance, then it waits for you to approve the list.</p>
            <p className="wk-share-body">The run asks for your approval on its gate. When it finishes, the share link appears here and in Share.</p>
            {openRun !== undefined && <p><button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="apps-publish-open-run" onClick={() => openRun(phase.runId)}>Open the run</button></p>}
          </div>
        ) : (
          <div className="wk-publish-grid">
            <div className="wk-publish-col">
              <h3 className="wk-publish-sech">Where it runs</h3>
              <label className="wk-publish-target wk-publish-target--on"><input type="checkbox" checked disabled /> <span><strong>In studio</strong><span className="wk-share-note">A page for people on this crew. Data through crew.</span></span></label>
              <label className="wk-publish-target wk-publish-target--on"><input type="checkbox" checked disabled /> <span><strong>Standalone site</strong><span className="wk-share-note">A container image you run anywhere. It runs the queries itself with the secrets you pass.</span></span></label>
              <label className="wk-publish-target"><input type="checkbox" data-testid="apps-publish-embed-on" checked={embed} disabled={who !== 'public'} onChange={(e) => setEmbed(e.target.checked)} /> <span><strong>Embed</strong><span className="wk-share-note">{who === 'public' ? 'An iframe on the pages you name, read-only.' : 'Public apps only: an iframe can’t sign in. Use the Teams tab or the link.'}</span></span></label>
              <label className="wk-publish-target"><input type="checkbox" data-testid="apps-publish-teams-on" checked={teams} disabled={who !== 'signin' || profile !== 'entra'} onChange={(e) => setTeams(e.target.checked)} /> <span><strong>Microsoft Teams tab</strong><span className="wk-share-note">Signed in through Teams (Entra). Read-only: an action opens the site.</span></span></label>
              {embed && <label className="wk-publish-field"><span className="wk-share-label">Pages that may frame it</span><input className="wk-share-field" data-testid="apps-publish-embed-origins" value={embedOrigins} onChange={(e) => setEmbedOrigins(e.target.value)} placeholder="https://intranet.example.com" /></label>}
              <label className="wk-publish-field"><span className="wk-share-label">Site address (the share link)</span>
                <input className="wk-share-field" data-testid="apps-publish-origin" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="https://escalations.example.com" aria-invalid={originProblem !== null} />
                <span className="wk-share-note">Where your deployer runs the image. People open this address.</span>
              </label>

              <h3 className="wk-publish-sech">Who can open it</h3>
              <label className="wk-publish-radio"><input type="radio" name="wk-publish-who" data-testid="apps-publish-signin" checked={who === 'signin'} onChange={() => setWho('signin')} /> People who sign in</label>
              {who === 'signin' && (
                <div className="wk-publish-signin">
                  <span className="wk-seg" role="group" aria-label="Sign-in">
                    <button type="button" className={`wk-seg-btn${profile === 'oidc' ? ' wk-seg-btn--on' : ''}`} aria-pressed={profile === 'oidc'} data-testid="apps-publish-oidc" onClick={() => setProfile('oidc')}>OpenID Connect</button>
                    <button type="button" className={`wk-seg-btn${profile === 'entra' ? ' wk-seg-btn--on' : ''}`} aria-pressed={profile === 'entra'} data-testid="apps-publish-entra" onClick={() => setProfile('entra')}>Entra ID</button>
                  </span>
                  {profile === 'entra' && <label className="wk-publish-field"><span className="wk-share-label">Tenant id</span><input className="wk-share-field" data-testid="apps-publish-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} /></label>}
                  <label className="wk-publish-field"><span className="wk-share-label">Issuer</span><input className="wk-share-field" data-testid="apps-publish-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder={profile === 'entra' ? 'https://login.microsoftonline.com/<tenant id>/v2.0' : 'https://login.example.com'} /></label>
                  <label className="wk-publish-field"><span className="wk-share-label">Client id</span><input className="wk-share-field" data-testid="apps-publish-client" value={clientId} onChange={(e) => setClientId(e.target.value)} /></label>
                  <label className="wk-publish-field"><span className="wk-share-label">Who of them</span>
                    <select className="wk-share-field" data-testid="apps-publish-rule" value={rule} onChange={(e) => setRule(e.target.value as typeof rule)}>
                      {profile === 'oidc' ? <><option value="groups">In a group</option><option value="domains">With a verified email domain</option></> : <><option value="roles">With an app role</option><option value="groups">In an Entra group (object id)</option></>}
                    </select>
                    <input className="wk-share-field" data-testid="apps-publish-values" value={values} onChange={(e) => setValues(e.target.value)} placeholder={rule === 'domains' ? 'example.com' : rule === 'roles' ? 'Apps.Viewer' : 'support-ops'} />
                  </label>
                </div>
              )}
              <label className="wk-publish-radio"><input type="radio" name="wk-publish-who" data-testid="apps-publish-public" checked={who === 'public'} disabled={!canBePublic} onChange={() => setWho('public')} /> Anyone with the link, read-only
                {!canBePublic && <span className="wk-share-note"> · {hasActions ? `not possible: this app has ${spec.actions.length} action${spec.actions.length === 1 ? '' : 's'}` : 'not possible: every query must be public'}</span>}
              </label>
            </div>

            <div className="wk-publish-col">
              <h3 className="wk-publish-sech">What you are approving</h3>
              <dl className="wk-publish-kv">
                <dt>Sources</dt><dd data-testid="apps-publish-sources">{sources.size === 0 ? 'none' : [...sources.keys()].join(', ')}</dd>
                <dt>Queries</dt><dd>{spec.queries.length}, {spec.queries.filter((q) => q.public === true).length} public</dd>
                <dt>Actions</dt><dd>{hasActions ? spec.actions.map((a) => `${a.id} (${a.kind === 'row-write' ? `row write on ${a.table}` : 'API action'}), on the site only`).join('; ') : 'none'}</dd>
                <dt>Secrets</dt><dd className="wk-publish-mono">{envNames.length === 0 ? 'none' : envNames.join('\n')}</dd>
                <dt>Framed by</dt><dd>{framedBy}</dd>
              </dl>
              <h3 className="wk-publish-sech">What happens</h3>
              <ol className="wk-publish-steps">
                <li>Publish check: policies, grants, audience, blocked sources (can’t be waived)</li>
                <li>QE acceptance on fixture data (can’t be skipped)</li>
                <li>You approve this list on the run’s gate</li>
              </ol>
              <p className="wk-share-note">Then you get the image, and the iframe snippet or the Teams package when chosen. Nothing is pushed anywhere.</p>
              {refusal !== null && (
                <div className="wk-publish-refusal" role="alert" data-testid="apps-publish-refusal">
                  <p className="wk-share-lead">{refusal.findings.length > 0 ? 'The publish check refused it:' : refusal.message}</p>
                  {refusal.findings.length > 0 && <ul>{refusal.findings.map((f, i) => <li key={i} data-testid="apps-publish-finding">{f.message}</li>)}</ul>}
                </div>
              )}
            </div>
          </div>
        )}

        <footer className="wk-publish-foot">
          <span className="wk-share-note">Publishing is a governed run. You can keep editing; the run publishes v{detail.head.version}.</span>
          {phase.kind === 'form' || phase.kind === 'starting' ? (
            <>
              <button type="button" className="wk-btn wk-btn--secondary" data-testid="apps-publish-cancel" onClick={onClose}>Cancel</button>
              <button type="button" className="wk-btn wk-btn--primary" data-testid="apps-publish-start" disabled={problems.length > 0 || phase.kind === 'starting'} title={problems[0]} onClick={() => void start()}>
                {phase.kind === 'starting' ? 'Starting…' : 'Start publish'}
              </button>
            </>
          ) : (
            <button type="button" className="wk-btn wk-btn--secondary" data-testid="apps-publish-done-close" onClick={onClose}>Close</button>
          )}
        </footer>
        {phase.kind === 'form' && problems.length > 0 && <p className="wk-share-note" data-testid="apps-publish-problem">{problems[0]}</p>}
      </div>
    </div>
  );
}
