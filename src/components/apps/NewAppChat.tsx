import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../api/types.js';
import { createByChat } from '../../editors/apps/appTurns.js';
import { dataSeedsWhen, knowledgeSeeds, mixSeeds } from '../../editors/apps/knowledgeSeeds.js';
import { readSuggestionGrounds, type SuggestionGrounds } from '../../editors/apps/suggestionGrounds.js';
import { useProjectsStore } from '../../store/projects.js';
import type { ComposerSuggestion } from '../session/Composer.js';
import { stashDraft } from './AppChat.js';
import { appPath } from './AppCard.js';
import { AppComposer } from './AppComposer.js';

/**
 * "Make a new app" by chat (DES-APPS-001 §6.2, moved out of the Apps page so Report's Build sheet shares it,
 * DES-REPORT-DASHBOARDS-001 §2): the person says what they want; crew adds the app and the message is its first turn.
 * One app only: `createByChat` makes it once (its slug-collision retry included), and an app made whose first message
 * was not sent keeps the message as that app's draft (`stashDraft`), never a second app.
 *
 * Where it is used decides the rest:
 *  - the Apps page: K5 as it was (the app opens on its turn);
 *  - a project's Report: the project is LOCKED (`lock`);
 *  - Insight → Report: only stored, active projects are offered (never `default`, never archived), and nothing is
 *    sent until one is chosen (`eligibleOnly`);
 *  - `onMade` takes over once an app exists (Report adds it to the shown list first, then opens it).
 */

const NOT_A_HOME = (p: Project): boolean => p.id === 'default' || p.status !== 'active';

export function NewAppChat({
  navigate, framed, projectOfApps = null, composerKey = 'apps:new', heading = true, lock = null, eligibleOnly = false,
  suggestions: given, onProject, onSend, onFailed, onMade, before = null, blocked = null, placeholder = 'Describe the app you want…', ariaLabel = 'Describe the app you want', testId = 'apps-new-chat',
}: {
  navigate: (p: string) => void;
  framed: boolean;
  /** (Apps page) The project the listed apps are in: the default choice. */
  projectOfApps?: string | null;
  composerKey?: string;
  /** The Apps page's own heading and line (the Build sheet has its own). */
  heading?: boolean;
  /** A project's Report: the app goes in this project, and no other is offered. */
  lock?: string | null;
  /** Insight → Report: only stored, active projects; one must be chosen before anything is sent. */
  eligibleOnly?: boolean;
  /** The suggestions, given by the caller (the Build sheet's seeds); else the Apps page's. */
  suggestions?: readonly string[];
  /** The chosen project changed (the Build sheet reads its sources again). */
  onProject?: (id: string | null) => void;
  /** Right before crew is asked to make the app (Report notes whether its cap was full at that moment). */
  onSend?: () => void;
  /** crew made no app (its words): the caller that keeps the operation outside this component hears it. */
  onFailed?: (note: string) => void;
  /** Once crew has made the app: `sent` says whether its first message went too. Without it, the app opens. */
  onMade?: (made: { slug: string; sent: boolean; projectId: string }) => Promise<void> | void;
  /** Another instance's send is in flight (Report's Build kept outside its sheet): the box is read-only, saying so. */
  blocked?: string | null;
  /** A line shown above the box before anything is sent (Report: the full-cap notice). */
  before?: React.ReactNode;
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
}): React.ReactElement {
  const all = useProjectsStore((s) => s.projects);
  const projectsLoading = useProjectsStore((s) => s.loading);
  const projectsError = useProjectsStore((s) => s.error);
  useEffect(() => { if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load(); }, []);
  const projects = eligibleOnly || lock !== null ? all.filter((p) => !NOT_A_HOME(p)) : all;
  const [text, setText] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = lock !== null ? lock
    : eligibleOnly ? (project !== null && projects.some((p) => p.id === project) ? project : projects.length === 1 ? projects[0]!.id : null)
      : project ?? projectOfApps ?? projects[0]?.id ?? null;
  useEffect(() => { onProject?.(chosen); }, [chosen, onProject]);
  // (DES-KNOWLEDGE-DATA-001 §9.1, Apps page) What the chosen project knows: an app can be built on it, and the suggestions
  // say so. Read per project; an answer for a project no longer chosen is dropped. A caller with its own seeds reads it.
  const [grounds, setGrounds] = useState<SuggestionGrounds | null>(null);
  useEffect(() => {
    setGrounds(null);
    if (given !== undefined || chosen === null || framed) return;
    let live = true;
    void readSuggestionGrounds(chosen).then((g) => { if (live) setGrounds(g); });
    return () => { live = false; };
  }, [chosen, framed, given]);
  // Only an answer for THIS project counts; data suggestions name only sources its summary lists as built on and an
  // app query can read (`dataSourcesFor`).
  const current = grounds !== null && grounds.projectId === chosen ? grounds : null;
  const dataSources = current?.data ?? [];
  const s0 = dataSources[0];
  const data = (s0 !== undefined
    ? [`A dashboard of open tickets by region from ${s0}`, `KPIs for the main numbers in ${s0}, with a table of the latest rows`]
    : ['A dashboard of my main numbers with a table of the latest rows'])
    .concat(dataSources.length > 1 ? [`Compare a number from ${dataSources[0]} with one from ${dataSources[1]} side by side`] : []);
  const knowledge = knowledgeSeeds(current?.summary ?? null);
  const labels = given ?? mixSeeds(knowledge, dataSeedsWhen(data, current?.readable ?? null));
  // A suggestion is made for the project chosen when it was picked: left as it was, it goes when the project changes
  // (it may name a source the new project cannot read); words the person typed or edited stay (ak-fix review: codex r3).
  const picked = useRef<{ label: string; project: string | null } | null>(null);
  useEffect(() => {
    const p = picked.current;
    if (p === null || p.project === chosen) return;
    picked.current = null;
    setText((t) => (t === p.label ? '' : t));
  }, [chosen]);
  const suggestions: ComposerSuggestion[] = labels.slice(0, given === undefined && knowledge.length > 0 ? 4 : 3).map((label, i) => ({
    id: `new-app-${i}`, label, onPick: () => { picked.current = { label, project: chosen }; setText(label); },
  }));
  /** True when the message was taken (an app was made and its first turn started, or it waits in that app's chat). */
  const send = async (words: string): Promise<boolean> => {
    if (words === '' || busy || framed || blocked !== null) return false;
    if (chosen === null) {
      setNote(projectsLoading ? 'Reading your projects: send it again in a moment.'
        : projectsError !== null ? `Your projects could not be read (${projectsError}): send it again in a moment.`
          : eligibleOnly && projects.length > 1 ? 'Choose the project it belongs to first.'
            : 'Make a project first: an app belongs to a project.');
      return false;
    }
    setBusy(true);
    setNote('Making the app and sending your message…');
    onSend?.();
    let r: Awaited<ReturnType<typeof createByChat>>;
    try {
      r = await createByChat(words, chosen);
    } catch (e) {
      // createByChat answers its refusals; anything it throws still ends this send (never a Build stuck "making").
      r = { ok: false, code: 'unavailable', message: e instanceof Error ? e.message : String(e) };
    }
    if (r.ok || r.slug !== undefined) {
      // The app was made but its first message was not sent: it waits in that app's own chat, never a second app.
      if (!r.ok) stashDraft(r.slug!, words);
      const slug = r.slug!;
      if (onMade !== undefined) {
        setNote(null);
        await onMade({ slug, sent: r.ok, projectId: chosen });
      } else navigate(appPath(slug));
      setBusy(false);
      return true;
    }
    setBusy(false);
    setNote(`Not made (${r.code}): ${r.message}`);
    onFailed?.(`Not made (${r.code}): ${r.message}`);
    return false;
  };
  const noHome = (eligibleOnly || lock !== null) && !projectsLoading && projectsError === null && projects.length === 0 && lock === null;
  const lockedName = lock !== null ? all.find((p) => p.id === lock)?.name ?? null : null;
  return (
    <section className="wk-newapp" data-testid={testId} aria-label="Make a new app">
      {heading && (
        <div className="wk-newapp-head">
          <h2 className="wk-newapp-title">Make a new app</h2>
          <span className="wk-newapp-sub">Say what it should show: your data sources, or what this project knows (its documents, memories, steering rules and data shapes). An agent builds it, another reviews it, and it opens here.</span>
        </div>
      )}
      {before}
      <AppComposer composerKey={composerKey} text={text} setText={setText} onSubmit={(t) => send(t)} placeholder={placeholder} ariaLabel={ariaLabel}
        suggestions={busy || blocked !== null ? [] : suggestions} busy={busy} testId="apps-new-composer"
        readOnly={framed ? 'This page is inside another page, so no app can be made here: open studio on its own.' : busy ? null : blocked} />
      <p className="wk-newapp-foot">
        {lock !== null && <span className="wk-newapp-project" data-testid="apps-new-project-locked">In project {lockedName ?? lock}</span>}
        {lock === null && projects.length > 1 && (
          <label className="wk-newapp-project">In project{' '}
            <select data-testid="apps-new-project" value={chosen ?? ''} onChange={(e) => setProject(e.target.value === '' ? null : e.target.value)} disabled={framed}>
              {eligibleOnly && chosen === null && <option value="">Choose a project</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {lock === null && projects.length === 1 && <span className="wk-newapp-project" data-testid="apps-new-project-one">In project {projects[0]!.name}</span>}
        {noHome && (
          <span className="wk-newapp-note" data-testid="apps-new-noproject">
            Make a project first: an app belongs to a project.{' '}
            <a href="/projects" className="wk-link" data-testid="apps-new-projects-link" onClick={(e) => { e.preventDefault(); navigate('/projects'); }}>Projects</a>
          </span>
        )}
        {note !== null && <span className="wk-newapp-note" data-testid="apps-new-note" role="status">{note}</span>}
      </p>
    </section>
  );
}
