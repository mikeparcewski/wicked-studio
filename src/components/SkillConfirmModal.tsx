import { useState } from 'react';
import { deleteSkill, resetSkill, type SkillGuardResult, type SkillRow } from '../api/skills.js';
import { useModalEscape } from './Modal.js';
import { SkillFindings } from './SkillFindings.js';
import type { SkillsWriter } from './skillsWriter.js';

/**
 * The typed-confirmation modal for the two destructive skill verbs — the SteeringRetireModal
 * grammar (type the name to arm):
 *  - RESET restores the skill's OWN files from the baseline, discarding every local edit (a nested
 *    child skill's overrides survive); enablement is manifest state and is never flipped by a reset;
 *  - DELETE removes a USER-ADDED skill from the effective root (a shipped skill is disabled or
 *    reset, never deleted — the drawer offers Delete only for user-added).
 * Both run through the page's CAS writer and answer with the daemon's guard envelope: `blocked`
 * keeps the modal open with the findings (nothing changed); anything else closes it through
 * `onDone`; a revision conflict closes it plain — the page's reload prompt owns that moment.
 */

const COPY = {
  reset: {
    title: (name: string) => `Reset ${name}`,
    body: 'Restores every file this skill owns from the baseline and discards your local edits — the override becomes a shipped skill again. Enablement is manifest state and is NOT touched: a disabled skill stays disabled. Nothing reaches workers until the next Publish.',
    verb: 'Reset skill',
    busy: 'Resetting…',
    color: 'var(--status-gate)',
  },
  delete: {
    title: (name: string) => `Delete ${name}`,
    body: 'Removes this user-added skill from the effective root. There is no baseline to restore it from — keep a copy of its files if you may want it back. The current snapshot keeps serving it until the next Publish.',
    verb: 'Delete skill',
    busy: 'Deleting…',
    color: 'var(--status-fail)',
  },
} as const;

export type SkillConfirmAction = keyof typeof COPY;

export function SkillConfirmModal({ skill, action, writer, onClose, onDone }: {
  skill: SkillRow;
  action: SkillConfirmAction;
  writer: SkillsWriter;
  onClose: () => void;
  /** Fires after the wire answered with anything but `blocked`. */
  onDone: (result: SkillGuardResult) => void;
}): React.ReactElement {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<SkillGuardResult | null>(null);
  useModalEscape(onClose);

  const copy = COPY[action];
  const armed = typed === skill.name && !busy;

  const confirm = async (): Promise<void> => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      const result = await writer.run((rev) => (action === 'reset' ? resetSkill(skill.name, rev) : deleteSkill(skill.name, rev)));
      if (result === null) {
        onClose();
        return;
      }
      if (result.verdict === 'blocked') {
        setBlocked(result);
        setBusy(false);
        return;
      }
      onDone(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--scrim)' }}>
      <div
        data-testid="skills-confirm-modal"
        data-action={action}
        role="dialog"
        aria-modal="true"
        aria-label={copy.title(skill.name)}
        className="flex w-[28rem] max-w-[92vw] flex-col gap-3 rounded-xl p-4 shadow-2xl"
        style={{ background: 'var(--surface-card)', border: `1px solid ${copy.color}` }}
      >
        <h3 className="text-sm font-semibold" style={{ color: copy.color }}>{copy.title(skill.name)}</h3>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{copy.body}</p>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Type the skill name to confirm
          <input
            data-testid="skills-confirm-input"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={skill.name}
            spellCheck={false}
            className="rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
        {error !== null && (
          <p data-testid="skills-confirm-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {error}
          </p>
        )}
        {blocked !== null && <SkillFindings verb={copy.verb} result={blocked} testId="skills-confirm-findings" />}
        <div className="flex items-center justify-end gap-2">
          <button
            data-testid="skills-confirm-cancel"
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-[11px]"
            style={{ color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
          >
            Cancel
          </button>
          <button
            data-testid="skills-confirm"
            type="button"
            disabled={!armed}
            onClick={() => void confirm()}
            className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
            style={{ background: copy.color, color: 'var(--surface-base)' }}
          >
            {busy ? copy.busy : copy.verb}
          </button>
        </div>
      </div>
    </div>
  );
}
