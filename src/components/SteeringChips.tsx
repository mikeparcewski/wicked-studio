import type { SteeringEffect } from '../api/steering.js';

/** The Steering surface's shared chip grammar — severity and effect, one spelling
 *  for the rule list and the rule drawer. */

export const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--status-fail)',
  error: 'var(--status-fail)',
  warn: 'var(--status-gate)',
  info: 'var(--ink-muted)',
};

export const EFFECT_COLOR: Record<SteeringEffect, string> = {
  deny: 'var(--status-fail)',
  allow_with_conditions: 'var(--status-gate)',
  allow: 'var(--status-done)',
};

export function SeverityChip({ severity }: { severity: string }): React.ReactElement {
  return (
    <span
      className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
      style={{ background: 'var(--surface-raised)', color: SEVERITY_COLOR[severity] ?? 'var(--ink-muted)' }}
    >
      {severity}
    </span>
  );
}

/** The effect badge — rendered ONLY when the rule carries an effect; a rule without one is
 *  recall-only, exactly as today, and gets no badge to lie with. */
export function EffectBadge({ effect }: { effect: SteeringEffect }): React.ReactElement {
  return (
    <span
      data-testid="steering-effect-badge"
      data-effect={effect}
      className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold font-mono uppercase"
      style={{ color: EFFECT_COLOR[effect], border: `1px solid ${EFFECT_COLOR[effect]}` }}
    >
      {effect === 'allow_with_conditions' ? 'allow+cond' : effect}
    </span>
  );
}
