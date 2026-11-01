import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPersonas, getSetupKnown, isLearnRouteAbsent, PERSONA_HABITS, putPersona, removePersonaOverride,
  type Persona, type PersonaInput, type PersonaResponse, type PersonaScope,
} from '../../api/learn.js';
import { readErrorKind } from '../../api/errors.js';
import {
  clampDial, DEFAULT_PERSONA, DIAL_WORDS, HABIT_WORDS, PERSONA_COLOURS, PREVIEW_QUESTIONS, previewAnswer, type PreviewBlock,
} from '../../board/learnHub.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useFirstRun } from '../../store/firstRun.js';
import { useProjectsStore } from '../../store/projects.js';
import { Skeleton, StateBanner } from '../ui/index.js';
import { learnPath } from './LearnHub.js';

/**
 * Personality (DES-LEARN §3.3): how the orchestrator talks to the person. One for the person, applied
 * everywhere; a project may override it (started as a copy). The preview re-answers as a dial moves. A
 * personality changes tone only: rules, gates, reviews and QE stay as they are (crew says so to the seat).
 */
export function PersonaTab({ navigate, project }: { navigate: Navigate; project: string | null }): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects).filter((p) => p.id !== 'default');
  const loadProjects = useProjectsStore((s) => s.load);
  useEffect(() => { if (projects.length === 0) void loadProjects?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setData] = useState<PersonaResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [absent, setAbsent] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const scope: PersonaScope = project !== null ? `project:${project}` : 'user';
  const projectName = project === null ? null : projects.find((p) => p.id === project)?.name ?? project;

  // Every save or removal that LANDS bumps this: a read that began before it answers with older state and is dropped,
  // so it never overwrites what the write put in (codex + agy r3 on #937); a write that failed invalidates nothing.
  const writes = useRef(0);
  const load = (): void => {
    setError(null);
    const at = writes.current;
    getPersonas().then(
      // A write landed meanwhile: this answer is older than it, so it is not used, and the read is made again (it may
      // be the one that tells another scope's inherited personality; codex r5 on #937).
      (d) => { if (writes.current === at) setData(d); else load(); },
      // Likewise a read that failed after a write landed is made again; only a current read's failure is shown.
      (e: unknown) => { if (writes.current !== at) { load(); return; } if (isLearnRouteAbsent(e)) setAbsent(true); else setError(e); },
    );
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- the first read, once
  useEffect(() => { getSetupKnown().then((k) => setPerson(k.git?.name ?? null), () => setPerson(null)); }, []);

  const saved = data === null ? null : project !== null ? data.projects[project] ?? null : data.user;
  const base: PersonaInput = saved ?? (project !== null ? data?.user ?? DEFAULT_PERSONA : DEFAULT_PERSONA);
  const [draft, setDraft] = useState<PersonaInput | null>(null);
  // A new scope starts the form from what that scope holds.
  useEffect(() => { setDraft(null); }, [scope]);
  // A save or a removal finishes after the person may have moved on: it answers on the scope it was made on only.
  const scopeNow = useRef(scope);
  scopeNow.current = scope;
  // A note answers the last save or removal; a different scope starts without one.
  useEffect(() => { setNote(null); }, [scope]);
  const form = draft ?? base;
  // A draft back at what the scope holds is no draft: the form follows the saved personality again. Not while a save or
  // removal is out, though: then that value is the person's answer to it (codex r4 on #937).
  const set = (patch: Partial<PersonaInput>): void => {
    const next = { ...inputOf(form), ...patch };
    setDraft(!busy && sameInput(next, base) ? null : next);
  };
  const [q, setQ] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  const answer = useMemo(() => previewAnswer(form, q, person), [form, q, person]);
  const initial = (form.name.trim().charAt(0) || '?').toUpperCase();
  const dirty = draft !== null && !sameInput(draft, base);

  /**
   * Save, and settle the form from the saved answer itself: the form clears only if it still holds what was sent, so
   * input typed while the save was out stays, still unsaved (codex + agy on #937: a refresh reverted newer input, and
   * an older refresh could settle a later save).
   */
  const save = async (): Promise<void> => {
    if (busy || form.name.trim() === '') return;
    const at = scope;
    const sent = inputOf(form);
    setBusy(true);
    setNote(null);
    try {
      const r = await putPersona(at, { ...sent, name: sent.name.trim() });
      writes.current += 1;
      setData((d) => withSaved(d, at, r.persona, r.voice));
      void useFirstRun.getState().markLearnUsed();
      if (scopeNow.current !== at) return;
      setDraft((cur) => (cur !== null && (sameInput(cur, sent) || sameInput(cur, r.persona)) ? null : cur));
      setNote({ tone: 'ok', text: `Saved as version ${r.persona.version}. The next chat uses it.` });
    } catch (e) {
      if (scopeNow.current === at) setNote({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const removeOverride = async (): Promise<void> => {
    if (project === null || busy) return;
    const id = project;
    const at = scope;
    const before = draft;
    setBusy(true);
    try {
      await removePersonaOverride(id);
      writes.current += 1;
      setData((d) => withoutOverride(d, id));
      // The project now inherits the person's personality as the daemon holds it now (another tab may have saved it):
      // read it again (codex r2 on #937); a kept draft is never touched by that read.
      load();
      if (scopeNow.current !== at) return;
      // The form clears unless the person changed it while the removal was out.
      setDraft((cur) => (cur === null || (before !== null && sameInput(cur, before)) ? null : cur));
      setNote({ tone: 'ok', text: `${projectName ?? 'This project'} uses yours again.` });
    } catch (e) {
      if (scopeNow.current === at) setNote({ tone: 'fail', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (absent) {
    return <p className="wk-learn-quiet" data-testid="persona-unsupported">This crew can’t keep a personality yet: it needs wicked-crew with the personality routes (api 0.160 or later).</p>;
  }
  if (error !== null) return <StateBanner kind={readErrorKind(error)} what="your personality" error={error instanceof Error ? error.message : String(error)} onRetry={load} data-testid="persona-error" />;
  if (data === null) return <Skeleton rows={4} data-testid="persona-loading" />;

  const status = note?.text ?? (saved !== null
    ? `Version ${saved.version} is in use${project !== null ? ` in ${projectName ?? 'this project'}` : ''}.`
    : project !== null ? `${projectName ?? 'This project'} uses yours. Saving here makes an override, started as a copy of yours.` : 'Not saved yet: chats use their default voice.');

  return (
    <div data-testid="persona-tab">
      <div className="wk-learn-scope" role="group" aria-label="Which personality">
        <span className="wk-learn-quiet">Applies to</span>
        <span className="wk-learn-seg" data-testid="persona-scope">
          <button type="button" aria-pressed={project === null} data-testid="persona-scope-me" onClick={() => navigate(learnPath('personality'))}>You, everywhere</button>
          <select aria-label="A project’s override" data-testid="persona-scope-project" value={project ?? ''}
            onChange={(e) => navigate(learnPath('personality', e.target.value === '' ? null : e.target.value))}>
            <option value="">A project (override)…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{`Project: ${p.name}${data.projects[p.id] !== undefined ? ' (overrides yours)' : ''}`}</option>)}
          </select>
        </span>
        <span className="wk-learn-quiet" data-testid="persona-scope-note">
          {project === null ? 'Projects without their own use this one.' : saved !== null ? `Overrides yours in ${projectName} only.` : `Starts as a copy of yours.`}
        </span>
      </div>
      <div className="wk-learn-persona">
        <div className="wk-learn-pform">
          <div className="wk-learn-name">
            <span className="wk-learn-av" aria-hidden style={{ background: form.colour, color: 'white' }}>{initial}</span>
            <input type="text" value={form.name} maxLength={40} aria-label="Your orchestrator’s name" data-testid="persona-name"
              onChange={(e) => set({ name: e.target.value.replace(/[\r\n]/gu, ' ') })} />
            <span className="wk-learn-swatches" role="group" aria-label="Colour">
              {PERSONA_COLOURS.map((c) => (
                <button key={c.hex} type="button" style={{ background: c.hex }} aria-label={c.name} aria-pressed={form.colour === c.hex}
                  data-testid="persona-colour" onClick={() => set({ colour: c.hex })} />
              ))}
            </span>
          </div>
          {(Object.keys(DIAL_WORDS) as (keyof PersonaInput['dials'])[]).map((k) => (
            <div key={k} className="wk-learn-dial">
              <label className="wk-learn-dial-l" htmlFor={`persona-dial-${k}`}>{DIAL_WORDS[k].label}</label>
              <span>{DIAL_WORDS[k].left}</span>
              <input id={`persona-dial-${k}`} type="range" min={0} max={2} step={1} value={form.dials[k]} data-testid={`persona-dial-${k}`}
                aria-valuetext={form.dials[k] === 0 ? DIAL_WORDS[k].left : form.dials[k] === 2 ? DIAL_WORDS[k].right : 'In between'}
                onChange={(e) => set({ dials: { ...form.dials, [k]: clampDial(Number(e.target.value)) } })} />
              <span>{DIAL_WORDS[k].right}</span>
            </div>
          ))}
          <div>
            <span className="wk-learn-dial-l wk-learn-block">Habits</span>
            <div className="wk-learn-checks" role="group" aria-label="Habits">
              {PERSONA_HABITS.map((h) => {
                const on = form.habits.includes(h);
                return (
                  <button key={h} type="button" className="wk-learn-chk" aria-pressed={on} data-testid="persona-habit" data-habit={h}
                    onClick={() => set({ habits: on ? form.habits.filter((x) => x !== h) : [...form.habits, h] })}>{HABIT_WORDS[h]}</button>
                );
              })}
            </div>
          </div>
          <div className="wk-learn-row">
            <button type="button" className="wk-btn wk-btn--primary" data-testid="persona-save" disabled={busy || form.name.trim() === '' || (!dirty && saved !== null)} onClick={() => void save()}>
              {busy ? 'Saving…' : project !== null && saved === null ? 'Save as this project’s' : 'Save personality'}
            </button>
            {project !== null && saved !== null && (
              <button type="button" className="wk-btn wk-btn--quiet" data-testid="persona-remove-override" disabled={busy} onClick={() => void removeOverride()}>Use mine here instead</button>
            )}
            <span className={`wk-learn-quiet${note?.tone === 'fail' ? ' wk-learn-bad' : ''}`} data-testid="persona-status" role="status">{status}</span>
          </div>
          <p className="wk-learn-guard">A personality changes how it talks, never what it may do: rules, gates, reviews and QE stay as they are.</p>
        </div>
        <div className="wk-learn-preview" aria-live="polite" data-testid="persona-preview">
          <h3>How <span data-testid="persona-preview-name">{form.name.trim() || 'your orchestrator'}</span> would answer</h3>
          <div className="wk-learn-prompts" role="group" aria-label="Sample question">
            {PREVIEW_QUESTIONS.map((text, i) => (
              <button key={text} type="button" className="wk-chat-chip" aria-pressed={q === i} data-testid="persona-question" onClick={() => setQ(i as 0 | 1 | 2)}>{text.replace(/ What now\?$/u, '').replace(/\.$/u, '')}</button>
            ))}
          </div>
          <div className="wk-learn-you">{PREVIEW_QUESTIONS[q]}</div>
          <div className="wk-learn-it">
            <span className="wk-learn-av wk-learn-av--sm" aria-hidden style={{ background: form.colour, color: 'white' }}>{initial}</span>
            <div className="wk-learn-answer" data-testid="persona-answer">{answer.map((b, i) => <PreviewPart key={`${q}-${i}`} b={b} />)}</div>
          </div>
          {(saved !== null || (project !== null && data.user !== null)) && (
            <details className="wk-learn-told" data-testid="persona-told">
              <summary>What your orchestrator is told</summary>
              <pre>{project !== null ? data.voice.projects[project] ?? data.voice.user ?? '' : data.voice.user ?? ''}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewPart({ b }: { b: PreviewBlock }): React.ReactElement {
  if (b.kind === 'steps') return <ol>{b.items.map((t) => <li key={t}>{t}</li>)}</ol>;
  if (b.kind === 'table') {
    return (
      <table>
        <thead><tr>{b.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{b.rows.map((r) => <tr key={r.join('|')}>{r.map((c) => <td key={c}>{c}</td>)}</tr>)}</tbody>
      </table>
    );
  }
  if (b.kind === 'quiet') return <p className="wk-learn-quiet">{b.text}</p>;
  return <p>{b.text}{b.cite !== undefined && <> (<code className="wk-learn-cite">{b.cite}</code>)</>}</p>;
}

/** A personality's editable fields only: a saved one also carries its version and time, which are never input. */
function inputOf(p: PersonaInput): PersonaInput {
  return { name: p.name, colour: p.colour, dials: { ...p.dials }, habits: [...p.habits], ...(p.notes !== undefined ? { notes: p.notes } : {}) };
}

function sameInput(a: PersonaInput, b: PersonaInput): boolean {
  return JSON.stringify(inputOf(a)) === JSON.stringify(inputOf(b));
}

/** The read with a save's answer in it (the PUT answers with the saved personality and its voice). */
function withSaved(d: PersonaResponse | null, at: PersonaScope, persona: Persona, voice: string): PersonaResponse | null {
  if (d === null) return d;
  if (at === 'user') return { ...d, user: persona, voice: { ...d.voice, user: voice } };
  const id = at.slice('project:'.length);
  return { ...d, projects: { ...d.projects, [id]: persona }, voice: { ...d.voice, projects: { ...d.voice.projects, [id]: voice } } };
}

/** The read without a project's override. */
function withoutOverride(d: PersonaResponse | null, id: string): PersonaResponse | null {
  if (d === null) return d;
  const projects = Object.fromEntries(Object.entries(d.projects).filter(([k]) => k !== id));
  const voices = Object.fromEntries(Object.entries(d.voice.projects).filter(([k]) => k !== id));
  return { ...d, projects, voice: { ...d.voice, projects: voices } };
}
