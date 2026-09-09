import { useState } from 'react';
import { addSkill, parseFilesMap, replaceSkill, type SkillGuardResult } from '../api/skills.js';
import { useModalEscape } from './Modal.js';
import { SkillFindings } from './SkillFindings.js';
import type { SkillsWriter } from './skillsWriter.js';

/**
 * The files-map modal behind two verbs: ADD a user-added skill (`POST /skills`) and REPLACE a
 * skill's own files wholesale (`POST /skills/:name/replace`). v1 has no multi-file picker — the
 * operator pastes a JSON files map (`{"SKILL.md": "...", "refs/x.md": "..."}`), validated live
 * ({@link parseFilesMap}: an object of string contents, relative paths, `SKILL.md` present). The
 * write runs through the page's CAS writer; the daemon's guards answer: `blocked` keeps the modal
 * open with the findings (nothing changed); anything else closes it through `onDone`. A revision
 * conflict (409) keeps the modal MOUNTED — the name and the pasted files map are the operator's
 * work and are never dropped for a stale revision: the banner names the conflict, the catalog is
 * re-read through the writer, and the same map is retried against the revision it adopts
 * (review round 2).
 */

/** The frontmatter-name charset, echoed client-side; the daemon is the authority. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const PLACEHOLDER = '{\n  "SKILL.md": "---\\nname: my-skill\\n---\\n…"\n}';

export function SkillFilesMapModal({ mode, name, writer, onClose, onDone }: {
  mode: 'add' | 'replace';
  /** The skill being replaced; ignored in `add` mode (the operator names the new skill). */
  name: string | null;
  writer: SkillsWriter;
  onClose: () => void;
  /** Fires after the wire answered with anything but `blocked`, with the skill's name. */
  onDone: (name: string, result: SkillGuardResult) => void;
}): React.ReactElement {
  const [newName, setNewName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<SkillGuardResult | null>(null);
  /** The last write hit a revision conflict: nothing was written, the draft is kept, the catalog
   *  is (being) re-read — the operator retries the same map against the new revision. */
  const [conflict, setConflict] = useState(false);
  useModalEscape(onClose);

  const target = mode === 'add' ? newName.trim() : name ?? '';
  const nameIssue = mode === 'add' && target !== '' && !NAME_RE.test(target)
    ? 'name: letters, digits, "-" and "_" only, starting with a letter or digit'
    : null;
  const parsed = text.trim() === '' ? null : parseFilesMap(text);
  const issue = nameIssue ?? (parsed === null ? null : parsed.issue);
  const armed = !busy && target !== '' && parsed !== null && parsed.files !== null && nameIssue === null;

  const submit = async (): Promise<void> => {
    if (!armed || parsed === null || parsed.files === null) return;
    const files = parsed.files;
    setBusy(true);
    setError(null);
    setBlocked(null);
    setConflict(false);
    try {
      const result = await writer.run((rev) => (mode === 'add' ? addSkill(target, files, rev) : replaceSkill(target, files, rev)));
      if (result === null) {
        // A stale revision: the daemon wrote nothing. The name + files map stay exactly as pasted;
        // the catalog is re-read here so the retry rides the current revision.
        setConflict(true);
        await writer.reload();
        setBusy(false);
        return;
      }
      if (result.verdict === 'blocked') {
        setBlocked(result);
        setBusy(false);
        return;
      }
      onDone(target, result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const title = mode === 'add' ? 'Add a skill' : `Replace ${name ?? ''}`;
  const verb = mode === 'add' ? 'Add skill' : 'Replace files';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--scrim)' }}>
      <div
        data-testid="skills-files-modal"
        data-mode={mode}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-[36rem] max-w-[92vw] flex-col gap-3 rounded-xl p-4 shadow-2xl"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>{title}</h3>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {mode === 'add'
            ? 'A user-added skill: a new dir under the effective root, carried in the snapshot once enabled and published. Paste its files as a JSON map of relative path → content; SKILL.md is required.'
            : 'Replaces every file this skill owns with the map below — files not in the map are removed (a nested child skill keeps its own). Paste a JSON map of relative path → content; SKILL.md is required.'}
          {' '}The daemon runs its guards (name uniqueness across the whole catalog, frontmatter name = path-derived name, core protection) before anything is written.
        </p>
        {mode === 'add' && (
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Skill name
            <input
              data-testid="skills-files-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my-team-skill"
              spellCheck={false}
              aria-invalid={nameIssue !== null}
              className="rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
              style={{ background: 'var(--surface-base)', border: `1px solid ${nameIssue === null ? 'var(--surface-raised)' : 'var(--status-fail)'}`, color: 'var(--ink-high)' }}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Files map (JSON)
          <textarea
            data-testid="skills-files-map"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            aria-invalid={parsed !== null && parsed.issue !== null}
            className="min-h-[12rem] resize-y rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
        {issue !== null && (
          <p data-testid="skills-files-issue" className="text-[10px]" style={{ color: 'var(--status-fail)' }}>{issue}</p>
        )}
        {error !== null && (
          <p data-testid="skills-files-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {error}
          </p>
        )}
        {blocked !== null && <SkillFindings verb={verb} result={blocked} testId="skills-files-findings" />}
        {conflict && (
          <p
            data-testid="skills-files-conflict"
            role="alert"
            className="rounded px-2 py-1 text-[10px]"
            style={{ background: 'var(--surface-rail)', border: '1px solid var(--status-gate)', color: 'var(--ink-muted)' }}
          >
            <span className="font-semibold" style={{ color: 'var(--status-gate)' }}>The skills catalog changed under this page — nothing was written.</span>
            {' '}
            {busy
              ? 'Reloading the catalog…'
              : `Your ${mode === 'add' ? 'name and files map are' : 'files map is'} kept and the catalog was reloaded — ${verb} again to write against the current revision.`}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            data-testid="skills-files-cancel"
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-[11px]"
            style={{ color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
          >
            Cancel
          </button>
          <button
            data-testid="skills-files-save"
            type="button"
            disabled={!armed}
            onClick={() => void submit()}
            className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {busy ? (conflict ? 'Reloading…' : 'Writing…') : verb}
          </button>
        </div>
      </div>
    </div>
  );
}
