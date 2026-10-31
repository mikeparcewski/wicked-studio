import { useEffect, useMemo, useState } from 'react';
import { Code2, FolderGit2, TerminalSquare, UserRound } from 'lucide-react';
import { api, apiFetch } from '../../api/client.js';
import type { Ask, AskAnswer } from '../../api/ask.js';
import { getSetupKnown, putPersona, type SetupKnown } from '../../api/learn.js';
import type { RepoEntry } from '../../api/types.js';
import { recordLine } from '../../board/askModel.js';
import {
  firstNameOf, firstRunOpen, nextSetupAsk, PERSONA_PRESETS, previewAnswer, repoStyleProblem, SETUP_ASKS, shareWords, siteOfEmail,
  STARTER_RULES, starterRule, type SetupAnswer, type SetupAskKey,
} from '../../board/learnHub.js';
import type { AgentRow } from '../../board/agentsModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { usePhone } from '../../hooks/usePhone.js';
import { useFirstRun } from '../../store/firstRun.js';
import { useProvenanceStore } from '../../store/provenance.js';
import { AskCard, AskRecord } from '../ask/AskCard.js';
import { learnPath } from '../learn/LearnHub.js';
import { langMeta } from '../LanguageBar.js';

/**
 * FIRST RUN (program DES-LEARN §4; the operator-approved mockup learn-and-panels state d): Home's first guided
 * experience. First what studio already knows, read and never asked (repositories registered and found nearby,
 * the git identity, the agents and their sign-ins, the languages); then six asks, one at a time, each filling a
 * row of "Your setup" and starting the matching write. "Ignore setup" collapses it to one line with Undo and
 * persists (`studio.firstRun.ignoredAt`); ignored, it never returns to Home and Learn picks it up. On a phone the
 * ask being answered rises as a bottom sheet.
 */
export function FirstRun({ navigate, agents, hasRoster, onDone }: {
  navigate: Navigate;
  agents: readonly AgentRow[];
  hasRoster: boolean;
  /** The last ask was answered: Home takes over (its ask box is the next step). */
  onDone?: () => void;
}): React.ReactElement | null {
  const fr = useFirstRun((s) => s.state);
  const read = useFirstRun((s) => s.read);
  const saveFailed = useFirstRun((s) => s.saveFailed);
  const phone = usePhone();
  const [known, setKnown] = useState<SetupKnown | null | 'failed'>(null);
  const [repos, setRepos] = useState<RepoEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [flash, setFlash] = useState<SetupAskKey | null>(null);
  // Ignored here, the one line with Undo shows until the page is left; ignored before, nothing shows.
  const [justIgnored, setJustIgnored] = useState(false);

  useEffect(() => { if (read === 'idle') void useFirstRun.getState().load(); }, [read]);
  useEffect(() => {
    getSetupKnown().then((x) => setKnown(normalizeKnown(x)), () => setKnown('failed'));
    api.listRepos().then((r) => setRepos(Array.isArray(r?.repos) ? r.repos : []), () => setRepos([]));
  }, []);

  const k = known !== null && known !== 'failed' ? known : null;
  const ready = agents.filter((a) => a.usable);
  const signedOut = agents.filter((a) => !a.usable && a.issues[0]?.code === 'signed_out' && !a.optIn);
  const site = siteOfEmail(k?.git?.email);
  const person = k?.git?.name ?? null;
  const first = firstNameOf(person);
  const answers = fr.answers ?? {};
  const next = nextSetupAsk(fr);

  const asks = useMemo(() => buildAsks({ repos: repos ?? [], nearby: k?.nearby ?? [], signedOut, ready: ready.length, total: agents.length, site }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repos, k, agents.length, ready.length, signedOut.length, site]);

  const ignored = fr.ignoredAt !== undefined;
  if (read !== 'ok' || (ignored ? !justIgnored : !firstRunOpen(fr))) return null;

  const record = (key: SetupAskKey, a: SetupAnswer): Promise<boolean> => {
    setFlash(key);
    return useFirstRun.getState().answer(key, a);
  };

  const answer = async (key: SetupAskKey, ask: Ask, a: AskAnswer): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFail(null);
    const raw = recordLine(ask, a);
    const line = /:\s*$/u.test(raw) ? `${raw.trimEnd()} none` : raw;
    const picked = a.options ?? [];
    const opt = ask.options?.find((o) => o.id === a.option);
    try {
      if (key === 'repos') {
        const add = (k?.nearby ?? []).filter((n) => picked.includes(`near:${n.path}`));
        for (const n of add) await apiFetch('/repos', { method: 'POST', body: JSON.stringify({ name: n.name, rootPath: n.path }) });
        const n = picked.length;
        await record(key, { line, done: n > 0, words: n === 0 ? 'none chosen' : ask.options!.filter((o) => picked.includes(o.id)).map((o) => o.label).join(', ') });
      } else if (key === 'agents') {
        const yes = a.option === 'yes';
        const who = signedOut[0];
        await record(key, { line, done: yes, words: yes && who !== undefined ? `${who.name}: ${who.login ?? 'sign in on Agents'}; I’ll notice` : `${ready.length} of ${agents.length} ready · later` });
        if (yes && who !== undefined && who.login === null) navigate('/agents?setup=1');
      } else if (key === 'style') {
        if (a.option?.startsWith('repo:') === true) {
          const repo = (repos ?? []).find((r) => r.id === a.option!.slice('repo:'.length));
          if (repo !== undefined) {
            const { runId } = await api.launchRun({ problem: repoStyleProblem(repo.name), repoRef: repo.id, workflow: 'capture-learnings' });
            useProvenanceStore.getState().markLaunchedHere(runId);
            await apiFetch('/settings', { method: 'PUT', body: JSON.stringify({ 'studio.learn.style': { jobs: [{ runId, kind: 'repo', sources: [repo.name] }], startedAt: Date.now() } }) });
          }
        }
        await record(key, { line, done: a.option !== 'later', words: a.option === 'later' ? 'later · Learn keeps a reminder' : opt?.label ?? '' });
        if (a.option === 'pick') navigate(learnPath('style'));
      } else if (key === 'rules') {
        for (const s of STARTER_RULES.filter((x) => picked.includes(x.id))) await api.upsertConformanceRule(starterRule(s));
        if (picked.length > 0) void useFirstRun.getState().markLearnUsed();
        await record(key, { line, done: picked.length > 0, words: picked.length === 0 ? 'none picked' : `${picked.length} picked` });
      } else if (key === 'persona') {
        const preset = PERSONA_PRESETS.find((p) => p.id === a.option);
        if (preset !== undefined) {
          await putPersona('user', { ...preset.persona });
          void useFirstRun.getState().markLearnUsed();
        }
        await record(key, { line, done: true, words: `${preset?.label ?? ''} · fine-tune it in Learn` });
      } else {
        const yes = a.option === 'yes';
        await useFirstRun.getState().answer(key, { line, done: yes, words: yes ? `${site ?? 'your site'}: preview in Learn → Brand` : 'studio’s colours' }, true);
        setFlash(key);
        if (yes) navigate(`${learnPath('brand')}${site !== null ? `&url=${encodeURIComponent(`https://${site}`)}` : ''}`);
        else onDone?.();
      }
    } catch (e) {
      setFail(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setIgnored = (on: boolean): void => { setJustIgnored(on); void useFirstRun.getState().ignore(on); };

  const rowWords: Record<SetupAskKey, string> = {
    repos: answers.repos?.words ?? (repos === null ? '…' : repos.length > 0 ? `${repos.length} registered` : 'not chosen yet'),
    agents: answers.agents?.words ?? (hasRoster ? `${ready.length} of ${agents.length} ready` : '…'),
    style: answers.style?.words ?? 'not chosen yet',
    rules: answers.rules?.words ?? 'none picked',
    persona: answers.persona?.words ?? 'not chosen yet',
    brand: answers.brand?.words ?? 'studio’s colours',
  };
  const ROW_LABEL: Record<SetupAskKey, string> = { repos: 'Repositories', agents: 'Agents', style: 'Style sources', rules: 'Rules', persona: 'Personality', brand: 'Brand' };

  if (ignored) {
    return (
      <div className="wk-fr-grid wk-fr-grid--one" data-testid="first-run">
        <p className="wk-fr-hidden" data-testid="first-run-hidden" role="status">
          Setup hidden. It won’t come back here; Learn in the sidebar picks it up where you left it.
          <button type="button" className="wk-link" data-testid="first-run-undo" onClick={() => setIgnored(false)}>Undo</button>
        </p>
      </div>
    );
  }

  // The asks are built from what was read: wait for the repositories, the facts and the roster, so an ask never
  // opens with its options (or its preselection) missing.
  const readsIn = repos !== null && known !== null && hasRoster;
  const live = next === null || !readsIn ? null : asks[next];
  return (
    <div className="wk-fr-grid" data-testid="first-run">
      <div>
        <div className="wk-fr-hello">
          <div>
            <h1>{first !== null ? `Welcome, ${first}` : 'Welcome to studio'}</h1>
            <p>Here is what studio already knows, and a few things to ask. Each answer sets something up.</p>
          </div>
          <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="first-run-ignore" onClick={() => setIgnored(true)}>Ignore setup</button>
        </div>
        <div className="wk-fr-flow" data-testid="first-run-flow">
          <p className="wk-fr-msg"><b>studio</b> · {first !== null ? `Hi ${first}. ` : ''}Before asking anything, here is what I could already see on this computer.</p>
          <p className="wk-fr-section">What we already know</p>
          <Known known={known} repos={repos} agents={agents} hasRoster={hasRoster} ready={ready.length} />
          <p className="wk-fr-section">What we’d like to know</p>
          {SETUP_ASKS.map((key) => {
            const a = answers[key];
            if (a !== undefined) return <AskRecord key={key} line={a.line} testId={`first-run-record-${key}`} />;
            if (key !== next) return null;
            if (live === null) return <p key={key} className="wk-learn-quiet" data-testid="first-run-reading" role="status">Reading what’s on this computer…</p>;
            return (
              <div key={key} className={phone ? 'wk-fr-live' : undefined} data-testid="first-run-live">
                <div className={key === 'repos' ? 'wk-ask-rows' : undefined}>
                  <AskCard key={(live.options ?? []).map((o) => o.id).join('|')} ask={live} tag="Setup" busy={busy} onAnswer={(x) => void answer(key, live, x)} testIds={{ root: `first-run-ask-${key}` }} />
                </div>
              </div>
            );
          })}
          {fail !== null && <p className="wk-learn-quiet wk-learn-bad" role="alert" data-testid="first-run-error">{fail}</p>}
          {saveFailed && <p className="wk-learn-quiet wk-learn-bad" role="alert" data-testid="first-run-save-failed">That answer wasn’t saved. Answer it again.</p>}
        </div>
      </div>
      <aside className="wk-fr-setup" aria-label="Your setup" data-testid="first-run-setup">
        <h2>Your setup</h2>
        <p>Fills in as you answer. Change any of it later in Learn and Agents.</p>
        <ul className="wk-fr-rows">
          {SETUP_ASKS.map((key) => (
            <li key={key} className="wk-fr-row" data-k={key} data-testid="first-run-row" data-done={answers[key] === undefined ? undefined : answers[key]!.done ? 'true' : 'skip'}
              data-flash={flash === key ? 'true' : undefined}>
              <i aria-hidden /><span>{ROW_LABEL[key]}<small data-testid="first-run-row-words">{rowWords[key]}</small></span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function Known({ known, repos, agents, hasRoster, ready }: {
  known: SetupKnown | null | 'failed'; repos: RepoEntry[] | null; agents: readonly AgentRow[]; hasRoster: boolean; ready: number;
}): React.ReactElement {
  const k = known !== null && known !== 'failed' ? known : null;
  const nearby = k?.nearby.length ?? 0;
  const names = (repos ?? []).map((r) => r.name);
  const notReady = agents.filter((a) => !a.usable && !a.optIn);
  return (
    <div className="wk-fr-known" data-testid="first-run-known">
      <div className="wk-fr-k" data-testid="known-repos">
        <span className="wk-fr-k-ic"><FolderGit2 size={16} aria-hidden /></span>
        <span><b>{repos === null ? 'Repositories…' : `${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}`}{nearby > 0 ? ` · ${nearby} nearby` : ''}</b>
          <span>{names.length > 0 ? names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '') : 'None registered yet'}{nearby > 0 ? `; not registered: ${k!.nearby.slice(0, 3).map((n) => n.name).join(', ')}${nearby > 3 ? '…' : ''}` : ''}</span></span>
      </div>
      <div className="wk-fr-k" data-testid="known-git">
        <span className="wk-fr-k-ic"><UserRound size={16} aria-hidden /></span>
        <span><b>{k?.git?.name ?? (known === null ? 'Git identity…' : 'No git identity')}</b>
          <span>{k?.git !== null && k?.git !== undefined ? `git identity${k.git.email !== null ? ` · ${k.git.email}` : ''}` : known === 'failed' ? 'Couldn’t read it from this computer' : 'Commits would carry no name yet'}</span></span>
      </div>
      <div className="wk-fr-k" data-testid="known-agents">
        <span className="wk-fr-k-ic"><TerminalSquare size={16} aria-hidden /></span>
        <span><b>{hasRoster ? `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'} found` : 'Agents…'}</b>
          <span>{hasRoster ? [`${ready} ready`, ...notReady.slice(0, 2).map((a) => `${a.name} ${a.issues[0]?.code === 'signed_out' ? 'not signed in' : 'needs a look'}`)].join(' · ') : 'Reading the roster'}</span></span>
      </div>
      <div className="wk-fr-k" data-testid="known-languages">
        <span className="wk-fr-k-ic"><Code2 size={16} aria-hidden /></span>
        <span><b>{k === null ? (known === 'failed' ? 'Languages unknown' : 'Languages…') : k.languages.length === 0 ? 'No code read yet' : k.languages.slice(0, 3).map((l) => l.name).join(', ')}</b>
          <span>{k !== null && k.languages.length > 0 ? `${shareWords(k.languages)} of ${k.filesCounted.toLocaleString()} source files` : 'From the registered repositories'}</span>
          {k !== null && k.languages.length > 0 && (
            <span className="wk-fr-langs" aria-hidden>
              {k.languages.map((l) => <i key={l.name} style={{ width: `${l.share * 100}%`, background: langMeta(l.name).color }} />)}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** A read of `GET /setup/known` with every list present (an older or partial answer reads as nothing known). */
function normalizeKnown(x: Partial<SetupKnown> | null | undefined): SetupKnown {
  const git = x?.git ?? null;
  return {
    git: git !== null && typeof git === 'object' ? { name: typeof git.name === 'string' ? git.name : null, email: typeof git.email === 'string' ? git.email : null } : null,
    languages: Array.isArray(x?.languages) ? x.languages : [],
    filesCounted: typeof x?.filesCounted === 'number' ? x.filesCounted : 0,
    nearby: Array.isArray(x?.nearby) ? x.nearby : [],
  };
}

/** The six asks, from what was read. */
function buildAsks({ repos, nearby, signedOut, ready, total, site }: {
  repos: readonly RepoEntry[]; nearby: readonly { name: string; path: string }[]; signedOut: readonly AgentRow[]; ready: number; total: number; site: string | null;
}): Record<SetupAskKey, Ask> {
  const from = (n: number): Ask['from'] => ({ kind: 'studio', id: 'setup', label: `Setup · ${n} of 6` });
  const base = { host: 'learn' as const, answeredBy: 'person' as const };
  const who = signedOut[0];
  const top = repos[0];
  const preset = PERSONA_PRESETS[0]!;
  return {
    repos: {
      ...base, id: 'setup-repos', from: from(1), kind: 'pick', prompt: 'Which repositories should studio work in?',
      detail: nearby.length > 0 ? 'A new one is registered and read once (an onboarding job).' : repos.length > 0 ? 'These are registered already. Add more on Repositories.' : 'None found yet. Add one on Repositories.',
      multi: { min: 0, max: repos.length + nearby.length }, default: repos.map((r) => `reg:${r.id}`),
      options: [
        ...repos.map((r) => ({ id: `reg:${r.id}`, token: r.id, label: r.name, meta: 'registered' })),
        ...nearby.map((n) => ({ id: `near:${n.path}`, token: n.path, label: n.name, meta: 'found nearby · not registered' })),
      ],
      record: 'You picked: {labels}',
    },
    agents: {
      ...base, id: 'setup-agents', from: from(2), kind: 'confirm',
      prompt: who !== undefined ? `Sign ${who.name} in now? Jobs need a second agent to check the work.` : total > 0 ? `${ready} of ${total} agents are ready. Keep going?` : 'No agent found yet. Set one up on Agents?',
      options: who !== undefined
        ? [{ id: 'yes', token: 'yes', label: 'Yes, sign it in', consequence: who.login !== null ? `Run “${who.login}” in a terminal; this card updates when the sign-in lands.` : 'Opens Agents with its sign-in steps.' }, { id: 'no', token: 'no', label: 'Later' }]
        : [{ id: 'yes', token: 'yes', label: total > 0 ? 'Keep going' : 'Open Agents' }, { id: 'no', token: 'no', label: 'Later' }],
      record: who !== undefined ? `${who.name}: {label}` : 'Agents: {label}',
    },
    style: {
      ...base, id: 'setup-style', from: from(3), kind: 'choose', prompt: 'Where should I learn how your team works?',
      default: top !== undefined ? `repo:${top.id}` : 'pick',
      options: [
        ...(top !== undefined ? [{ id: `repo:${top.id}`, token: top.id, label: `Your ${top.name} repository`, sub: 'its history and code', recommended: true, consequence: `Starts a learning job on ${top.name} now: how the team names things, tests, sizes changes and writes commits. Its suggestions wait for you in Learn → Style.` }] : []),
        { id: 'pick', token: 'pick', label: 'I’ll pick files', sub: 'docs, PDFs, links', consequence: 'Opens Learn → Style with an empty source list for you to fill.' },
        { id: 'later', token: 'later', label: 'Later', sub: 'Learn keeps a reminder', consequence: 'Nothing is read now. Learn → Style is where to start it.' },
      ],
      record: 'Style: {label}',
    },
    rules: {
      ...base, id: 'setup-rules', from: from(4), kind: 'pick', prompt: 'Which of these do you care about?',
      detail: 'Each one is a rule helpers are held to. Pick any; you can change them in Learn → Rules.',
      multi: { min: 0, max: 5 }, default: ['learn-small-prs', 'learn-tests-with-fixes'],
      options: STARTER_RULES.slice(0, 5).map((s) => ({ id: s.id, token: s.id, label: s.title })),
      record: 'Rules: {labels}',
    },
    persona: {
      ...base, id: 'setup-persona', from: from(5), kind: 'choose', prompt: 'How should your orchestrator talk to you?', default: preset.id,
      options: PERSONA_PRESETS.map((p, i) => ({
        id: p.id, token: p.id, label: p.label, sub: p.sub, ...(i === 0 ? { recommended: true } : {}),
        consequence: `It would say: “${previewAnswer(p.persona, 0, null).filter((b) => b.kind === 'p').map((b) => (b as { text: string }).text).join(' ')}”`,
      })),
      record: 'Personality: {label} · fine-tune it in Learn',
    },
    brand: {
      ...base, id: 'setup-brand', from: from(6), kind: 'confirm',
      prompt: site !== null ? `Use ${site}’s colours for studio?` : 'Use your brand’s colours for studio?',
      options: [
        { id: 'yes', token: 'yes', label: 'Yes, try them', consequence: `Opens Learn → Brand${site !== null ? ` reading ${site}` : ''}: the whole page previews them before you apply.` },
        { id: 'no', token: 'no', label: 'Keep studio’s' },
      ],
      record: 'Brand: {label}',
    },
  };
}
