import { useRef, useState } from 'react';
import { apiFetch } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import type { AppAudienceRule, AppDetail, AppPublishBody } from '../../api/types.js';
import { useModalEscape } from '../Modal.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';

type Concern = 'site' | 'identity' | 'audience' | 'embed' | 'publish';
/** `allow`: the ranges crew's identity finding names as the ones that would let it reach the issuer (studio#1296). */
interface Finding { concern: Concern; message: string; allow?: string[] }

/**
 * A CIDR range as the field takes it (`10.1.2.3/32`, `fd00::/8`): an IPv4 address with a prefix of 0-32, or an IPv6
 * address (as a URL host reads it) with 0-128. Crew checks that it is loopback or private (`validateAllowRanges`).
 */
export function isCidr(range: string): boolean {
  const m = /^([^/\s]{2,45})\/(\d{1,3})$/u.exec(range);
  if (m === null) return false;
  const [, addr, bits] = m as unknown as [string, string, string];
  const prefix = Number(bits);
  if (/^\d{1,3}(\.\d{1,3}){3}$/u.test(addr)) return prefix <= 32 && addr.split('.').every((o) => Number(o) <= 255 && (o === '0' || !o.startsWith('0')));
  if (!addr.includes(':') || !/^[0-9A-Fa-f:.]+$/u.test(addr)) return false;
  try { new URL(`http://[${addr}]/`); } catch { return false; }
  return prefix <= 128;
}

/**
 * (studio#1296, crew#1457) The ranges crew's identity finding suggests for an issuer on a private network: it ends
 * "…allows its range (identity.allowRanges, e.g. 10.1.2.3/32)" (crew `apps/publish/run.ts` discoveryRefusal). Crew
 * sends the finding as words only, so the ranges are read from them; none when the words name none.
 */
export function suggestedRanges(message: string): string[] {
  const m = /identity\.allowRanges, e\.g\. ([^)]{1,400})\)/u.exec(message);
  if (m === null) return [];
  const ranges = m[1]!.split(/,\s*/u).map((r) => r.trim());
  return ranges.length > 0 && ranges.every(isCidr) ? ranges.slice(0, 100) : [];
}

/** The site's origin grammar is also crew's: HTTPS, or HTTP on the two loopback hosts. */
export function publishOrigin(value: string, embed = false): string | null {
  try {
    const u = new URL(value.trim());
    if (u.username !== '' || u.password !== '' || u.pathname !== '/' || u.search !== '' || u.hash !== '') return null;
    return u.protocol === 'https:' || (!embed && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) ? u.origin : null;
  } catch { return null; }
}

function concernOf(code: string): Concern {
  if (/embed/u.test(code)) return 'embed';
  if (/issuer|identity|client|tenant|discovery/u.test(code)) return 'identity';
  if (/audience|public|group|role|domain/u.test(code)) return 'audience';
  return /site|origin/u.test(code) ? 'site' : 'publish';
}

function refusal(e: unknown): Finding[] {
  if (!(e instanceof ApiError)) return [{ concern: 'publish', message: 'Publish could not start. Check the connection to crew and try again.' }];
  const body = e.body as { code?: unknown; findings?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code : e.wire;
  const words: Record<string, string> = {
    stale_base: 'The app has a newer version. Close this sheet and open Publish again to use it.',
    not_accepted: 'This version has not been accepted. Wait for its check and review before publishing.',
    busy: 'A turn or publish is already running for this app. Wait for it to finish.',
    teams_not_offered: 'Microsoft Teams publishing is not offered. Use the standalone site or a public embed.',
  };
  if (words[code] !== undefined) return [{ concern: 'publish', message: words[code] }];
  if (code === 'publish_refused' && Array.isArray(body?.findings)) {
    const findings: Finding[] = body.findings.flatMap((f: unknown) => {
      if (typeof f !== 'object' || f === null) return [];
      const item = f as { code?: unknown; message?: unknown };
      if (typeof item.message !== 'string') return [];
      const concern = concernOf(typeof item.code === 'string' ? item.code : '');
      const allow = concern === 'identity' ? suggestedRanges(item.message) : [];
      return [{ concern, message: item.message, ...(allow.length > 0 ? { allow } : {}) }];
    });
    if (findings.length > 0) return findings;
  }
  return [{ concern: 'publish', message: e.message }];
}

export function PublishSheet({ detail, onClose, onStarted }: {
  detail: AppDetail; onClose: () => void; onStarted: (runId: string) => void;
}): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  const [site, setSite] = useState('http://localhost:8080');
  const [audience, setAudience] = useState<'signed-in' | 'public'>('signed-in');
  const [rule, setRule] = useState<Exclude<AppAudienceRule['kind'], 'public'>>('oidc-groups');
  const [issuer, setIssuer] = useState('');
  const [client, setClient] = useState('');
  const [tenant, setTenant] = useState('');
  // (studio#1296) An issuer on a private network (a Dex fixture, an internal identity provider): the ranges crew may
  // reach it at. Off unless the person turns it on.
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [ranges, setRanges] = useState('');
  const [members, setMembers] = useState('');
  const [embed, setEmbed] = useState(false);
  const [origins, setOrigins] = useState('');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [starting, setStarting] = useState(false);
  const close = (): void => { if (!starting) onClose(); };
  useModalEscape(close);
  useDialogFocus(true, box, { modal: true });
  const publicWhy = detail.spec.actions.length > 0 ? 'This app has an action. Public apps can only read data and have no actions.'
    : detail.spec.queries.some((q) => q.public !== true) ? 'Every query must be marked public before anyone with the link can open this app.' : null;
  const allowRanges = (r: readonly string[]): void => { setAllowPrivate(true); setRanges(r.join(', ')); };
  const errors = (concern: Concern): React.ReactNode => findings.some((f) => f.concern === concern)
    ? <ul className="wk-share-note" role="alert">{findings.filter((f) => f.concern === concern).map((f, i) => (
      <li key={i}>{f.message}{f.allow !== undefined && audience === 'signed-in' && <>{' '}<button type="button" className="wk-btn wk-btn--link" data-testid="publish-allow-suggested" onClick={() => allowRanges(f.allow!)}>Allow {f.allow.join(', ')}</button></>}</li>
    ))}</ul> : null;
  const start = async (): Promise<void> => {
    if (starting) return;
    const origin = publishOrigin(site);
    const list = (text: string): string[] => text.split(/[,\n]/u).map((s) => s.trim()).filter(Boolean);
    const values = list(members);
    const framedBy = list(origins).map((o) => publishOrigin(o, true));
    const allowed = allowPrivate ? list(ranges) : [];
    const invalid: Finding[] = [];
    if (origin === null) invalid.push({ concern: 'site', message: 'Use an HTTPS origin, or HTTP for localhost or 127.0.0.1, with no path, query or credentials.' });
    if (audience === 'public' && publicWhy !== null) invalid.push({ concern: 'audience', message: publicWhy });
    if (audience === 'signed-in') {
      try { if (new URL(issuer.trim()).protocol !== 'https:') throw new Error(); }
      catch { invalid.push({ concern: 'identity', message: 'Enter an HTTPS issuer URL.' }); }
      if (client.trim() === '') invalid.push({ concern: 'identity', message: 'Enter the client id for this site.' });
      if (rule.startsWith('entra-') && tenant.trim() === '') invalid.push({ concern: 'identity', message: 'Enter the Entra tenant id.' });
      if (values.length === 0) invalid.push({ concern: 'audience', message: 'Enter at least one group, email domain or role that may open the site.' });
      if (allowPrivate && (allowed.length === 0 || allowed.length > 100 || allowed.some((r) => !isCidr(r)))) invalid.push({ concern: 'identity', message: 'Enter the private-network ranges as CIDR, such as 10.1.2.3/32 (at most 100), or turn off the private-network issuer.' });
    }
    if (audience === 'public' && embed && (framedBy.length === 0 || framedBy.some((o) => o === null))) invalid.push({ concern: 'embed', message: 'Enter an HTTPS origin for every page that may embed this app, with no path.' });
    setFindings(invalid);
    if (invalid.length > 0 || origin === null) return;
    const audienceRule: AppAudienceRule = audience === 'public' ? { kind: 'public' }
      : rule === 'oidc-email-domain' ? { kind: rule, domains: values }
        : rule === 'entra-roles' ? { kind: rule, roles: values } : { kind: rule, groups: values };
    const body: AppPublishBody = {
      base: detail.head.version, targets: ['studio', 'site', ...(audience === 'public' && embed ? ['embed' as const] : [])],
      site: { origin }, audience: audienceRule,
      identity: audience === 'public' ? null : { profile: rule.startsWith('entra-') ? 'entra' : 'oidc', issuer: issuer.trim(), clientId: client.trim(), ...(rule.startsWith('entra-') ? { tenantId: tenant.trim() } : {}), ...(allowed.length > 0 ? { allowRanges: allowed } : {}) },
      ...(audience === 'public' && embed ? { embedOrigins: framedBy as string[] } : {}),
    };
    setStarting(true);
    try {
      // The 202 response is newer than some installed api-types packages.
      const answer = await apiFetch<unknown>(`/apps/${encodeURIComponent(detail.slug)}/publish`, { method: 'POST', body: JSON.stringify(body) });
      const runId = typeof answer === 'object' && answer !== null ? (answer as { runId?: unknown }).runId : null;
      if (typeof runId !== 'string' || runId.trim() === '') {
        setFindings([{ concern: 'publish', message: 'Crew did not return a publish run. Check the app’s jobs before trying again.' }]);
      } else onStarted(runId);
    } catch (e) { setFindings(refusal(e)); }
    finally { setStarting(false); }
  };
  const sources = [...new Set([...detail.spec.queries, ...detail.spec.actions].map((q) => q.source))];
  return (
    <div className="wk-share-scrim" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={box} className="wk-share wk-publish" role="dialog" aria-modal="true" aria-labelledby="wk-publish-title" data-testid="apps-publish">
        <header className="wk-share-head"><h2 id="wk-publish-title" className="wk-share-title">Publish {detail.name} · v{detail.head.version}</h2><button type="button" className="wk-btn wk-btn--link" onClick={close} disabled={starting}>Close</button></header>
        {detail.published != null && <p className="wk-share-note">Since v{detail.published.version} (last published): {detail.head.version - detail.published.version} versions</p>}
        <form onSubmit={(e) => { e.preventDefault(); void start(); }}>
          <div className="wk-publish-columns">
            <section className="wk-share-row">
              <h3 className="wk-share-label">Where it runs</h3>
              <p className="wk-share-body"><strong>In studio</strong> · A page for people on this crew. Data through crew.</p>
              <p className="wk-share-body"><strong>Standalone site</strong> · A container image you run anywhere. It runs the queries itself with the secrets you pass.</p>
              <label className="wk-share-label" htmlFor="publish-site">Site address</label><input className="wk-share-field" id="publish-site" value={site} onChange={(e) => setSite(e.target.value)} />{errors('site')}
              <h3 className="wk-share-label">Who can open it</h3>
              <label><input type="radio" name="audience" checked={audience === 'signed-in'} onChange={() => setAudience('signed-in')} /> People who sign in</label>
              <label><input type="radio" name="audience" checked={audience === 'public'} disabled={publicWhy !== null} aria-describedby={publicWhy !== null ? 'publish-public-why' : undefined} onChange={() => setAudience('public')} /> Public · Anyone with the link, read-only</label>
              {publicWhy !== null && <p id="publish-public-why" className="wk-share-note">{publicWhy}</p>}
              {audience === 'signed-in' && <>
                <label className="wk-share-label" htmlFor="publish-rule">Audience rule</label><select className="wk-share-field" id="publish-rule" value={rule} onChange={(e) => setRule(e.target.value as typeof rule)}><option value="oidc-groups">OIDC groups</option><option value="oidc-email-domain">OIDC email domains</option><option value="entra-roles">Entra roles</option><option value="entra-groups">Entra groups</option></select>
                <label className="wk-share-label" htmlFor="publish-members">{rule === 'oidc-email-domain' ? 'Email domains' : rule === 'entra-roles' ? 'Roles' : 'Groups'} (comma separated)</label><input className="wk-share-field" id="publish-members" value={members} onChange={(e) => setMembers(e.target.value)} />
                <label className="wk-share-label" htmlFor="publish-issuer">Issuer URL</label><input className="wk-share-field" id="publish-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
                <label className="wk-share-label" htmlFor="publish-client">Client id</label><input className="wk-share-field" id="publish-client" value={client} onChange={(e) => setClient(e.target.value)} />
                {rule.startsWith('entra-') && <><label className="wk-share-label" htmlFor="publish-tenant">Entra tenant id</label><input className="wk-share-field" id="publish-tenant" value={tenant} onChange={(e) => setTenant(e.target.value)} /></>}
                <label><input type="checkbox" data-testid="publish-allow-private" checked={allowPrivate} aria-describedby="publish-private-why" onChange={(e) => setAllowPrivate(e.target.checked)} /> Allow a private-network issuer</label>
                <p id="publish-private-why" className="wk-share-note">For internal deployments and testing, such as a Dex fixture or an internal identity provider. Crew reaches the issuer only at addresses inside these private or loopback ranges.</p>
                {allowPrivate && <><label className="wk-share-label" htmlFor="publish-ranges">Private-network ranges (CIDR, comma separated)</label><input className="wk-share-field" id="publish-ranges" placeholder="10.1.2.3/32" value={ranges} onChange={(e) => setRanges(e.target.value)} /></>}
              </>}{errors('identity')}{errors('audience')}
              <label><input type="checkbox" checked={embed && audience === 'public'} disabled={audience !== 'public'} onChange={(e) => setEmbed(e.target.checked)} /> Embed</label>
              <p className="wk-share-note">Public apps only: an iframe can’t sign in.</p>
              {audience === 'public' && embed && <><label className="wk-share-label" htmlFor="publish-origins">Embed origins (comma separated)</label><textarea className="wk-share-field" id="publish-origins" value={origins} onChange={(e) => setOrigins(e.target.value)} /></>}{errors('embed')}
            </section>
            <section className="wk-share-row">
              <h3 className="wk-share-label">What you are approving</h3>
              <p className="wk-share-body">Sources: {sources.join(', ') || 'none'}</p>
              <p className="wk-share-body">Queries: {detail.spec.queries.length}, {detail.spec.queries.filter((q) => q.public === true).length} public</p>
              <p className="wk-share-body">Actions: {detail.spec.actions.map((a) => a.id).join(', ') || 'none'}</p>
              <p className="wk-share-note">The publish check lists source reach, grants, secret environment names, embed origins and data files for your consent.</p>
              <h3 className="wk-share-label">What happens</h3>
              <ol className="wk-share-body"><li>Publish check: policies, grants, audience, blocked sources (can’t be waived)</li><li>QE acceptance on fixture data, at 1440 and 390 (can’t be skipped)</li><li>You approve this list</li></ol>
              <p className="wk-share-note">Then you get the image and, for an embed, the iframe snippet. The image is built in your own container engine. Nothing is pushed anywhere.</p>
            </section>
          </div>
          {errors('publish')}
          <p className="wk-share-note">Publishing is a governed run. You can keep editing; the run publishes v{detail.head.version}.</p>
          <footer className="wk-share-actions"><button type="button" className="wk-btn wk-btn--secondary" onClick={close} disabled={starting}>Cancel</button><button type="submit" className="wk-btn wk-btn--primary" disabled={starting}>{starting ? 'Starting publish…' : 'Start publish'}</button></footer>
        </form>
      </div>
    </div>
  );
}
