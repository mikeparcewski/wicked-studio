import { useState } from 'react';
import { resetSkill, type SkillGuardResult, type SkillRow } from '../api/skills.js';
import { useModalEscape } from './Modal.js';
import { SkillFindings } from './SkillFindings.js';
import type { SkillsWriter } from './skillsWriter.js';

/**
 * The typed-confirmation modal for RESET — the one destructive skill verb (the SteeringRetireModal
 * grammar: type the name to arm). Reset restores the skill's OWN files from the baseline,
 * discarding every local edit (a nested child skill's overrides survive); enablement is manifest
 * state and is never flipped by a reset. A user-added skill has no baseline, so the drawer never
 * offers this for one (disable is its off switch; there is no delete verb on the wire).
 *
 * Runs through the page's CAS writer and answers with the daemon's guard envelope: `blocked` keeps
 * the modal open with the findings (nothing changed); anything else closes it through `onDone`; a
 * revision conflict closes it plain — the page's reload prompt owns that moment.
 */

const BODY =
  'Restores every file this skill owns from the baseline and discards your local edits — the override becomes a shipped skill again. Enablement is manifest state and is NOT touched: a disabled skill stays disabled. Nothing reaches workers until the next Publish.';

export function SkillConfirmModal({ skill, writer, onClose, onDone }: {
  skill: SkillRow;
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

  const title = `Reset ${skill.name}`;
  const armed = typed === skill.name && !busy;

  const confirm = async (): Promise<void> => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      const result = await writer.run((rev) => resetSkill(skill.name, rev));
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
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex w-[28rem] max-w-[92vw] flex-col gap-3 rounded-xl p-4 shadow-2xl"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--status-gate)' }}
      >
        <h3 className="text-sm font-semibold" style={{ color: 'var(--status-gate)' }}>{title}</h3>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{BODY}</p>
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
        {blocked !== null && <SkillFindings verb="Reset skill" result={blocked} testId="skills-confirm-findings" />}
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
            style={{ background: 'var(--status-gate)', color: 'var(--surface-base)' }}
          >
            {busy ? 'Resetting…' : 'Reset skill'}
          </button>
        </div>
      </div>
    </div>
  );
}
