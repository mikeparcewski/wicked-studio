import type { AuditEntry } from '../api/types.js';
import type { StandingOrderRule } from '../api/standingOrders.js';

/**
 * STANDING ORDERS (Studio OS behaviour 10) — the pure half.
 *
 * Two jobs, both words: say a parsed rule back in plain words so the person confirms what
 * the daemon will actually do (never the seat's paraphrase of their words), and turn an
 * order's audit entry into the handover's line — which always NAMES the order.
 */

const ACTION_WORDS: Record<StandingOrderRule['action'], string> = {
  approve: 'approve',
  hold: 'hold',
  notify: 'queue a message for you on',
};

/** "While you are away: approve the intake gate on project Alpha". */
export function ruleWords(rule: StandingOrderRule, projectName: (id: string) => string | undefined): string {
  const when = rule.activeWhen === 'away' ? 'While you are away' : 'Always';
  const what =
    rule.trigger.kind === 'gate'
      ? rule.trigger.phase === '*'
        ? 'every gate'
        : `the ${rule.trigger.phase} gate`
      : rule.trigger.severity === '*'
        ? 'any finding'
        : `a ${rule.trigger.severity.toUpperCase()} finding`;
  const where =
    rule.scope.kind === 'all' ? 'every project' : `project ${projectName(rule.scope.projectId) ?? rule.scope.projectId}`;
  const verb = ACTION_WORDS[rule.action];
  const tail = rule.action === 'hold' && rule.trigger.kind === 'gate' ? ' for you' : '';
  return `${when}: ${verb} ${what}${tail} on ${where}`;
}

function orderOf(e: AuditEntry): { id: string; text: string } | undefined {
  if (e.actor?.kind !== 'system' || typeof e.actor.id !== 'string' || !e.actor.id.startsWith('standing-order:')) return undefined;
  const o = (e.detail ?? {})['standingOrder'] as { id?: unknown; text?: unknown } | undefined;
  return typeof o?.text === 'string' ? { id: String(o.id ?? ''), text: o.text } : undefined;
}

/** The handover's line for an action a standing order took, or undefined for any other entry. */
export function standingOrderActionText(e: AuditEntry): string | undefined {
  const o = orderOf(e);
  if (o === undefined) return undefined;
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const named = `Standing order "${o.text}"`;
  switch (e.action) {
    case 'gate.decided':
      return d['approve'] === true ? `${named} approved a gate for you` : `${named} answered a gate for you`;
    case 'standing-order.held':
      return typeof d['phase'] === 'string' && d['phase'] !== ''
        ? `${named} held the ${d['phase']} gate for you`
        : typeof d['severity'] === 'string'
          ? `${named} held a ${d['severity'].toUpperCase()} finding for you`
          : `${named} held a gate for you`;
    case 'standing-order.notified':
      return `${named} queued a message (not sent)${typeof d['text'] === 'string' ? `: ${d['text']}` : ''}`;
    default:
      return undefined;
  }
}
