import { useCallback, useEffect, useState } from 'react';
import {
  listSkillFiles,
  readSkillFile,
  readSupportFile,
  writeSkillFile,
  writeSupportFile,
  type SkillFileContent,
  type SkillFileEntry,
  type SkillGuardResult,
  type SkillRow,
} from '../api/skills.js';
import { useModalEscape } from './Modal.js';
import { EnabledToggle, KindChip, ProvenanceChip, SkillFlags } from './SkillChips.js';
import { SkillConfirmModal, type SkillConfirmAction } from './SkillConfirmModal.js';
import { SkillFilesMapModal } from './SkillFilesMapModal.js';
import { SkillFindings } from './SkillFindings.js';
import type { SkillsWriter } from './skillsWriter.js';

/**
 * The skill DRAWER — opened from a catalog row (the SteeringRuleDrawer idiom, widened for an
 * editor). Two file trees under tabs: the skill's OWN files (`GET /skills/:name/files`) and the
 * root SUPPORT files every skill shares (`scripts/`, `schemas/`, `.claude-plugin/`, from the
 * manifest's support map — `GET|PUT /skills/support/*path`). A textarea editor over the selected
 * file (v1 — studio has no code editor): Save → `PUT {content, expectedRevision}` through the
 * page's CAS writer → the daemon's findings; a `blocked` verdict disables Save for that exact
 * draft until it changes; a `truncated` or `binary` read is read-only (Save never clobbers what
 * the editor cannot show). Plus the enabled switch and the dir-level verbs: Reset (from the
 * baseline; disabled for a user-added skill, which has none), Replace (a pasted files map),
 * Delete (user-added only).
 *
 * The page owns the catalog: the drawer reports every applied content write through `onChanged`
 * so the page reloads (provenance flips, hashes move, `unpublished` lights up), and a delete
 * through `onDeleted` so the page closes this drawer and says so.
 */

/** The two file trees the drawer edits. */
type SkillDrawerTab = 'skill' | 'support';

const TAB_LABEL: Record<SkillDrawerTab, string> = { skill: 'Skill files', support: 'Support files' };

export function SkillDrawer({ skill, support, writer, busy, onClose, onToggle, onChanged, onDeleted }: {
  skill: SkillRow;
  /** The root support files (from the manifest), path-sorted. */
  support: readonly SkillFileEntry[];
  writer: SkillsWriter;
  /** The page has a write in flight for this skill (or the catalog is frozen on a conflict) —
   *  the drawer's verbs wait. */
  busy: boolean;
  onClose: () => void;
  /** The page's guarded flip — it reloads the catalog and hands back the daemon's verdict
   *  (`null` on a revision conflict: the page's prompt owns that moment). */
  onToggle: (name: string, enabled: boolean) => Promise<SkillGuardResult | null>;
  /** After any applied content write (save / reset / replace) — the page reloads the catalog. */
  onChanged: () => void;
  onDeleted: (name: string, result: SkillGuardResult) => void;
}): React.ReactElement {
  const [tab, setTab] = useState<SkillDrawerTab>('skill');
  const [skillFiles, setSkillFiles] = useState<SkillFileEntry[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [file, setFile] = useState<SkillFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** The exact draft the daemon last BLOCKED — Save stays disabled until the text changes. */
  const [blockedDraft, setBlockedDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<{ verb: string; result: SkillGuardResult } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [modal, setModal] = useState<SkillConfirmAction | 'replace' | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState(false);

  const dirty = file !== null && draft !== file.content;

  // Closing with unsaved edits asks first — an Escape must never eat a draft silently.
  const requestClose = useCallback((): void => {
    if (dirty) setDiscardPrompt(true);
    else onClose();
  }, [dirty, onClose]);
  useModalEscape(requestClose);

  const loadSkillFiles = useCallback(async (): Promise<SkillFileEntry[]> => {
    setFilesError(null);
    try {
      const rows = await listSkillFiles(skill.name);
      setSkillFiles(rows);
      return rows;
    } catch (e) {
      setSkillFiles([]);
      setFilesError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, [skill.name]);

  const openFile = useCallback(async (scope: SkillDrawerTab, path: string): Promise<void> => {
    setFileLoading(true);
    setFileError(null);
    setBlockedDraft(null);
    try {
      const f = scope === 'skill' ? await readSkillFile(skill.name, path) : await readSupportFile(path);
      setFile(f);
      setDraft(f.content);
    } catch (e) {
      setFile(null);
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setFileLoading(false);
    }
  }, [skill.name]);

  // The page keys this drawer by skill name, so one mount = one skill: load the tree, open the
  // first file (SKILL.md when present — the fold puts it first).
  useEffect(() => {
    void loadSkillFiles().then((rows) => {
      const first = rows[0];
      if (first !== undefined) void openFile('skill', first.path);
    });
  }, [loadSkillFiles, openFile]);

  const files: readonly SkillFileEntry[] | null = tab === 'skill' ? skillFiles : support;

  /** Switching trees opens the other tree's first file; locked while the open file is dirty or loading. */
  const selectTab = (next: SkillDrawerTab): void => {
    if (next === tab) return;
    setTab(next);
    setLastResult(null);
    setFileError(null);
    const rows = next === 'skill' ? skillFiles ?? [] : support;
    const first = rows[0];
    if (first !== undefined) void openFile(next, first.path);
    else { setFile(null); setDraft(''); }
  };

  const readOnlyReason =
    file === null ? null
    : file.binary ? 'binary file — not editable here'
    : file.truncated ? 'this file exceeds the daemon’s read cap and is shown truncated — saving would clobber it, so it is read-only here'
    : null;

  const canSave =
    file !== null && !fileLoading && !saving && !busy && readOnlyReason === null && dirty && draft !== blockedDraft;

  const save = async (): Promise<void> => {
    if (file === null || !canSave) return;
    const target = file;
    setSaving(true);
    setActionError(null);
    try {
      const result = await writer.run((rev) => (tab === 'skill'
        ? writeSkillFile(skill.name, target.path, draft, rev)
        : writeSupportFile(target.path, draft, rev)));
      // A revision conflict: the page's prompt owns the moment; the draft is kept for after the reload.
      if (result === null) return;
      setLastResult({ verb: 'Save', result });
      if (result.verdict === 'blocked') {
        setBlockedDraft(draft);
      } else {
        setFile({ ...target, content: draft });
        setBlockedDraft(null);
        onChanged();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const flip = (): void => {
    setActionError(null);
    void onToggle(skill.name, !skill.enabled)
      .then((result) => {
        if (result !== null) setLastResult({ verb: skill.enabled ? 'Disable' : 'Enable', result });
      })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)));
  };

  /** After a dir-level write applied (reset / replace): the skill tree and the open file are
   *  reloaded — the content on screen must be the daemon's, never this drawer's memory of it. */
  const afterDirWrite = (verb: string, result: SkillGuardResult): void => {
    setModal(null);
    setLastResult({ verb, result });
    onChanged();
    const current = tab === 'skill' && file !== null ? file.path : null;
    void loadSkillFiles().then((rows) => {
      if (tab !== 'skill') return;
      const target = current !== null && rows.some((r) => r.path === current) ? current : rows[0]?.path;
      if (target !== undefined) void openFile('skill', target);
      else { setFile(null); setDraft(''); }
    });
  };

  const canReset = skill.baselineHash !== null;
  const verbsDisabled = busy || saving;
  const treeLocked = dirty || fileLoading;

  return (
    <aside
      data-testid="skills-drawer"
      data-skill={skill.name}
      role="complementary"
      aria-label={`Skill ${skill.name}`}
      className="fixed inset-y-0 right-0 z-40 flex w-[44rem] max-w-[95vw] flex-col gap-3 overflow-y-auto p-4 shadow-2xl"
      style={{ background: 'var(--surface-card)', borderLeft: '1px solid var(--surface-raised)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>{skill.name}</span>
        <KindChip kind={skill.kind} />
        <ProvenanceChip provenance={skill.provenance} />
        <SkillFlags skill={skill} />
        <button
          data-testid="skills-drawer-close"
          type="button"
          aria-label="Close skill"
          onClick={requestClose}
          className="ml-auto text-sm leading-none hover:opacity-70"
          style={{ color: 'var(--ink-dim)' }}
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
        <span data-testid="skills-drawer-dir">{skill.dir}</span>
        <span title="effective content hash">{skill.effectiveHash.slice(0, 12)}</span>
        {skill.lastPublishedHash !== null && skill.lastPublishedHash !== skill.effectiveHash && (
          <span title="the hash the current snapshot carries">published {skill.lastPublishedHash.slice(0, 12)}</span>
        )}
        {skill.editedAt !== null && <span>edited {skill.editedAt}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          <EnabledToggle
            testId="skills-drawer-toggle"
            name={skill.name}
            enabled={skill.enabled}
            busy={verbsDisabled}
            onToggle={flip}
          />
          {skill.enabled ? 'enabled' : 'disabled'}
        </label>
        <span className="flex-1" />
        <button
          data-testid="skills-reset-open"
          type="button"
          disabled={verbsDisabled || !canReset}
          title={canReset ? 'Restore every file this skill owns from the baseline (typed confirmation)' : 'a user-added skill has no baseline to reset to'}
          onClick={() => setModal('reset')}
          className="rounded px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
          style={{ color: 'var(--status-gate)', border: '1px solid var(--surface-raised)' }}
        >
          Reset…
        </button>
        <button
          data-testid="skills-replace-open"
          type="button"
          disabled={verbsDisabled}
          title="Replace every file this skill owns from a pasted files map"
          onClick={() => setModal('replace')}
          className="rounded px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
          style={{ color: 'var(--accent)', border: '1px solid var(--surface-raised)' }}
        >
          Replace…
        </button>
        {skill.provenance === 'user-added' && (
          <button
            data-testid="skills-delete-open"
            type="button"
            disabled={verbsDisabled}
            title="Remove this user-added skill from the effective root (typed confirmation)"
            onClick={() => setModal('delete')}
            className="rounded px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
            style={{ color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
          >
            Delete…
          </button>
        )}
      </div>

      {discardPrompt && (
        <div
          data-testid="skills-discard-prompt"
          role="alertdialog"
          aria-label="Unsaved changes"
          className="flex flex-wrap items-center gap-2 rounded px-3 py-2 text-[11px]"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--status-gate)', color: 'var(--ink-muted)' }}
        >
          <span>Unsaved edits to <span className="font-mono">{file?.path}</span>.</span>
          <span className="flex-1" />
          <button
            data-testid="skills-keep-editing"
            type="button"
            onClick={() => setDiscardPrompt(false)}
            className="rounded px-2 py-0.5 text-[10px]"
            style={{ color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
          >
            Keep editing
          </button>
          <button
            data-testid="skills-discard"
            type="button"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: 'var(--status-gate)', color: 'var(--surface-base)' }}
          >
            Discard and close
          </button>
        </div>
      )}

      {/* The two trees' tabs — locked while the open file is dirty (save or discard first). */}
      <div role="tablist" aria-label="File trees" className="flex items-center gap-1 text-[11px]">
        {(['skill', 'support'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            data-testid={`skills-tab-${t}`}
            aria-selected={tab === t}
            disabled={treeLocked && tab !== t}
            title={treeLocked && tab !== t ? 'save or discard your edits first' : TAB_LABEL[t]}
            onClick={() => selectTab(t)}
            className="rounded px-2 py-1 font-semibold disabled:opacity-40"
            style={{
              color: tab === t ? 'var(--ink-high)' : 'var(--ink-muted)',
              background: tab === t ? 'var(--surface-raised)' : 'transparent',
            }}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
        {tab === 'support' && (
          <span data-testid="skills-support-note" className="ml-2 text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            shared by every skill — the guards flag each edit as a warning
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* The file tree — flat, SKILL.md first; locked while the open file has unsaved edits. */}
        <nav
          data-testid="skills-file-tree"
          data-tab={tab}
          aria-label={TAB_LABEL[tab]}
          className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto rounded p-1"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
        >
          {files === null ? (
            <p data-testid="skills-files-loading" className="px-2 py-1 text-[10px]" style={{ color: 'var(--ink-dim)' }}>Loading files…</p>
          ) : tab === 'skill' && filesError !== null ? (
            <p data-testid="skills-files-error" className="px-2 py-1 text-[10px]" style={{ color: 'var(--status-fail)' }}>{filesError}</p>
          ) : files.length === 0 ? (
            <p data-testid="skills-files-empty" className="px-2 py-1 text-[10px]" style={{ color: 'var(--ink-dim)' }}>No files.</p>
          ) : (
            files.map((f) => {
              const active = file !== null && file.path === f.path;
              return (
                <button
                  key={f.path}
                  type="button"
                  data-testid="skills-file"
                  data-path={f.path}
                  aria-current={active ? 'true' : undefined}
                  disabled={treeLocked && !active}
                  title={treeLocked && !active ? 'save or discard your edits first' : f.path}
                  onClick={() => { setLastResult(null); void openFile(tab, f.path); }}
                  className="truncate rounded px-2 py-1 text-left font-mono text-[10px] disabled:opacity-40 focus:outline-none focus-visible:ring-1"
                  style={{
                    background: active ? 'var(--accent-subtle)' : 'transparent',
                    color: active ? 'var(--ink-high)' : 'var(--ink-muted)',
                  }}
                >
                  {f.path}
                </button>
              );
            })
          )}
        </nav>

        {/* The editor column. */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {fileLoading && file === null ? (
            <p data-testid="skills-file-loading" className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>Loading file…</p>
          ) : fileError !== null ? (
            <p data-testid="skills-file-error" className="rounded px-2 py-1 text-[11px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>{fileError}</p>
          ) : file === null ? (
            <p data-testid="skills-file-none" className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>Pick a file to edit.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                <span data-testid="skills-file-path" style={{ color: 'var(--ink-muted)' }}>{file.path}</span>
                <span>{file.size} B</span>
                {dirty && <span data-testid="skills-file-dirty" style={{ color: 'var(--status-gate)' }}>unsaved</span>}
              </div>
              {readOnlyReason !== null && (
                <p data-testid="skills-file-readonly" className="text-[10px]" style={{ color: 'var(--status-gate)' }}>{readOnlyReason}</p>
              )}
              <textarea
                data-testid="skills-editor"
                aria-label={`${file.path} content`}
                value={draft}
                readOnly={readOnlyReason !== null}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-[18rem] flex-1 resize-y rounded p-2 font-mono text-[11px] focus:outline-none"
                style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)', lineHeight: 1.5 }}
              />
              <div className="flex items-center gap-2">
                <button
                  data-testid="skills-save"
                  type="button"
                  disabled={!canSave}
                  title={draft === blockedDraft && blockedDraft !== null ? 'the daemon blocked this exact content — change it to try again' : 'Save this file (the daemon runs its guards first)'}
                  onClick={() => void save()}
                  className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {dirty && (
                  <button
                    data-testid="skills-discard-edits"
                    type="button"
                    disabled={saving}
                    onClick={() => { setDraft(file.content); setBlockedDraft(null); }}
                    className="rounded px-2 py-1 text-[11px]"
                    style={{ color: 'var(--ink-dim)', border: '1px solid var(--surface-raised)' }}
                  >
                    Discard edits
                  </button>
                )}
              </div>
            </>
          )}

          {actionError !== null && (
            <p data-testid="skills-drawer-error" className="rounded px-2 py-1 text-[11px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
              {actionError}
            </p>
          )}
          {lastResult !== null && (
            <SkillFindings verb={lastResult.verb} result={lastResult.result} testId="skills-findings" />
          )}
        </div>
      </div>

      {(modal === 'reset' || modal === 'delete') && (
        <SkillConfirmModal
          skill={skill}
          action={modal}
          writer={writer}
          onClose={() => setModal(null)}
          onDone={(result) => {
            if (modal === 'delete') {
              setModal(null);
              onDeleted(skill.name, result);
            } else {
              afterDirWrite('Reset', result);
            }
          }}
        />
      )}
      {modal === 'replace' && (
        <SkillFilesMapModal
          mode="replace"
          name={skill.name}
          writer={writer}
          onClose={() => setModal(null)}
          onDone={(_name, result) => afterDirWrite('Replace', result)}
        />
      )}
    </aside>
  );
}
