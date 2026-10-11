import { useState } from 'react';
import { resetSkill, type SkillMutationResult, type SkillRow } from '../api/skills.js';
import { useModalEscape } from './Modal.js';
import { SkillFindings } from './SkillFindings.js';
import type { SkillsWriter } from './skillsWriter.js';
import { SectionTitle } from './ui/PageFrame.js';
import { StateBanner } from './ui/StateBanner.js';
import { readErrorKind } from '../api/errors.js';

/**
 * The typed-confirmation modal for RESET — the one destructive skill verb (the SteeringRetireModal
 * grammar: type the name to arm). Reset restores the skill's OWN files from the baseline,
 * discarding every local edit (a nested child skill's overrides survive); enablement is manifest
 * state and is never flipped by a reset. A user-added skill has no baseline, so the drawer never
 * offers this for one (disable is its off switch; there is no delete verb on the wire).
 *
 * Runs through the page's CAS writer and answers with the daemon's envelope
 * (`SkillMutationResult`): `blocked` keeps the modal open with the findings (nothing changed — a
 * corrupt baseline refuses to restore, `baseline-corrupt`); anything else closes it through
 * `onDone`; a revision conflict closes it plain — the page's reload prompt owns that moment.
 */

const BODY =
  'Restore the original files and discard your edits. The skill keeps its current on or off setting. Publish when you are ready to share the restored files with your helpers.';

export function SkillConfirmModal({ skill, writer, onClose, onDone }: {
  skill: SkillRow;
  writer: SkillsWriter;
  onClose: () => void;
  /** Fires after the wire answered with anything but `blocked`. */
  onDone: (result: SkillMutationResult) => void;
}): React.ReactElement {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<SkillMutationResult | null>(null);
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
    <div className="wk-pg-skills-scrim" >
      <div
        data-testid="skills-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="wk-card wk-pg-skills-modal"

      >
        <SectionTitle>{title}</SectionTitle>
        <p className="" style={{ color: 'var(--ink-muted)' }}>{BODY}</p>
        <label className="flex flex-col gap-1" style={{ color: 'var(--ink-muted)' }}>
          Type the skill name to confirm
          <input
            data-testid="skills-confirm-input"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={skill.name}
            spellCheck={false}
            className="wk-field"

          />
        </label>
        {error !== null && (
          <StateBanner data-testid="skills-confirm-error" kind={readErrorKind(error)} what="the reset" error={error} onRetry={() => void confirm()} />
        )}
        {blocked !== null && <SkillFindings verb="Reset skill" result={blocked} testId="skills-confirm-findings" />}
        {!armed && <p className="wk-field-note">{busy ? 'Wait for the reset to finish.' : 'Type the skill name exactly to enable Reset.'}</p>}
        <div className="flex items-center justify-end gap-2">
          <button
            data-testid="skills-confirm-cancel"
            type="button"
            onClick={onClose}
            className="wk-btn wk-btn--quiet"

          >
            Cancel
          </button>
          <button
            data-testid="skills-confirm"
            type="button"
            disabled={!armed}
            onClick={() => void confirm()}
            className="wk-btn wk-btn--danger"

          >
            {busy ? 'Resetting…' : 'Reset skill'}
          </button>
        </div>
      </div>
    </div>
  );
}
