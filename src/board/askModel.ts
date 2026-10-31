import type { Ask, AskAnswer, AskOption, ElicitationMulti } from '../api/ask.js';
import type { GateRowChoice } from './gateRowModel.js';

/**
 * Guided asks (DES-GUIDED-CHAT §2): the wire shapes that exist map onto ONE `Ask`, and `AskCard` draws it. Nothing
 * here changes a wire body: each host turns the `AskAnswer` back into its own (a `GateDecision`, an elicitation
 * `content`, a pause decision).
 */

/** The option a choose / confirm ask starts on: its `default`, else the recommended option, else none. */
export function initialOption(ask: Ask): string | null {
  const opts = ask.options ?? [];
  const usable = (id: string | undefined): id is string => id !== undefined && opts.some((o) => o.id === id && o.disabled === undefined);
  if (typeof ask.default === 'string' && usable(ask.default)) return ask.default;
  const rec = opts.find((o) => o.recommended === true && o.disabled === undefined);
  return rec?.id ?? null;
}

/** The picks a pick ask starts with: its `default` ids that can be picked. */
export function initialPicks(ask: Ask): string[] {
  const opts = ask.options ?? [];
  const ids = Array.isArray(ask.default) ? ask.default : typeof ask.default === 'string' ? [ask.default] : [];
  return opts.filter((o) => ids.includes(o.id) && o.disabled === undefined).map((o) => o.id);
}

/** A pick ask's bounds, filled: at least `multi.min` (default 1; an explicit 0 lets the person keep none), at most
 *  every option that can be picked. */
export function pickBounds(ask: Ask): { min: number; max: number } {
  const usable = (ask.options ?? []).filter((o) => o.disabled === undefined).length;
  const min = Math.max(0, Math.floor(ask.multi?.min ?? 1));
  return { min, max: Math.max(min, Math.min(usable, ask.multi?.max ?? usable)) };
}

function labelsOf(ask: Ask, ids: readonly string[]): string {
  return (ask.options ?? []).filter((o) => ids.includes(o.id)).map((o) => o.label).join(', ');
}

/** The answered line: "You chose: Split into two lanes" (with the reason when one was given). */
export function recordLine(ask: Ask, answer: AskAnswer): string {
  const opt = (ask.options ?? []).find((o) => o.id === answer.option);
  const scaleLabel = answer.value !== undefined && ask.scale !== undefined && 'steps' in ask.scale ? ask.scale.steps[answer.value] ?? String(answer.value) : answer.value !== undefined ? String(answer.value) : '';
  const text = answer.text !== undefined && answer.text.trim() !== '' ? `“${answer.text.trim()}”` : 'nothing to add';
  const line = ask.record
    .replace('{label}', opt?.label ?? scaleLabel)
    .replace('{labels}', labelsOf(ask, answer.options ?? []))
    .replace('{text}', text);
  return answer.reason !== undefined && answer.reason.trim() !== '' ? `${line} · “${answer.reason.trim()}”` : line;
}

/** The record words each kind uses when the host names none. */
export const RECORD: Record<Ask['kind'], string> = {
  confirm: 'You said: {label}',
  choose: 'You chose: {label}',
  confirm_reason: 'You chose: {label}',
  pick: 'You picked: {labels}',
  text: 'You noted: {text}',
  scale: 'You set: {label}',
};

const YES = /^(y|yes|yep|ok|okay|sure|approve|accept|continue|proceed|true)$/i;
const NO = /^(n|no|nope|decline|reject|cancel|stop|false)$/i;

/** Two options that read as yes and no (in either order): a confirm, answered by picking one. */
export function isYesNo(options: readonly string[]): boolean {
  if (options.length !== 2) return false;
  const [a, b] = options.map((o) => o.trim());
  return (YES.test(a!) && NO.test(b!)) || (NO.test(a!) && YES.test(b!));
}

/** The elicitation fields an ask needs (the store's `OpenElicitation`, a `GET /runs/:id/elicitation` body). */
export interface ElicitationLike {
  elicitationId: string;
  message: string;
  options: string[] | null;
  recommended?: number;
  multi?: ElicitationMulti;
}

/**
 * A seat's or MCP server's question as an ask: free text when it offers no options; a pick-several when the engine
 * says `multi`; a yes/no confirm when its two options read so; otherwise choose one. The producer's recommendation
 * is marked and preselected (a question is not a gate: nothing waits out an undo window).
 */
export function askFromElicitation(e: ElicitationLike, from: string): Ask {
  const base = { id: e.elicitationId, host: 'elicitation' as const, from: { kind: 'seat' as const, id: from, label: from }, prompt: e.message, answeredBy: 'any' as const };
  if (e.options === null || e.options.length === 0) return { ...base, kind: 'text', text: { placeholder: 'Your answer' }, record: RECORD.text };
  const rec = e.recommended !== undefined && e.recommended >= 0 && e.recommended < e.options.length ? e.recommended : null;
  const options: AskOption[] = e.options.map((o, i) => ({ id: String(i), label: o, token: o, ...(i === rec ? { recommended: true } : {}) }));
  if (e.multi !== undefined) {
    const detail = e.multi.min === e.multi.max ? `Pick ${e.multi.min}.` : `You can pick more than one${e.multi.max < options.length ? ` (up to ${e.multi.max})` : ''}.`;
    return { ...base, kind: 'pick', options, multi: { min: e.multi.min, max: e.multi.max }, ...(rec !== null ? { default: [String(rec)] } : {}), detail, record: RECORD.pick };
  }
  const kind = isYesNo(e.options) ? 'confirm' : 'choose';
  return { ...base, kind, options, record: RECORD[kind] };
}

/** An answered elicitation as its `POST` content: `{values}` for a pick (in option order), else `{response}`. */
export function elicitationContent(ask: Ask, answer: AskAnswer): { response: string } | { values: string[] } | null {
  const opts = ask.options ?? [];
  if (ask.kind === 'pick') {
    const values = opts.filter((o) => (answer.options ?? []).includes(o.id)).map((o) => o.token);
    return values.length > 0 ? { values } : null;
  }
  if (ask.kind === 'text') {
    const t = (answer.text ?? '').trim();
    return t === '' ? null : { response: t };
  }
  const o = opts.find((x) => x.id === answer.option);
  return o === undefined ? null : { response: o.token };
}

/** The gate choices that ask for a reason as they are taken (DES-GUIDED-CHAT §4 "Reasons for danger"): Stop. The
 *  note-bearing choices (send back, steer, the floor override, skip QE) already ask for their words. */
export const REASON_KEYS = new Set(['stop']);
/** The gate choices drawn as danger. */
export const DANGER_KEYS = new Set(['stop', 'reject', 'decline']);

/** One gate choice as an ask option: its words, its consequence, and whether it asks for words first. */
export function gateOption(choice: GateRowChoice, opts: { label?: string; sub?: string; consequence?: string | null; recommended?: boolean }): AskOption {
  const consequence = opts.consequence ?? (choice.title !== '' ? choice.title : undefined);
  return {
    id: choice.key,
    label: opts.label ?? choice.label,
    token: choice.key,
    ...(opts.sub !== undefined ? { sub: opts.sub } : {}),
    ...(consequence !== undefined && consequence !== null ? { consequence } : {}),
    ...(DANGER_KEYS.has(choice.key) || choice.key.startsWith('reject') ? { tone: 'danger' as const } : {}),
    ...(opts.recommended === true ? { recommended: true } : {}),
    ...(choice.needsNote || REASON_KEYS.has(choice.key) ? { needsReason: true } : {}),
    ...(choice.disabled === true ? { disabled: 'Studio does not know what this answer does, so it is not offered.' } : {}),
    ...(choice.isDefault === true ? { meta: 'default' } : {}),
  };
}

/**
 * A gate as an ask: every choice the gate offers is an option, in the gate's order with Stop last, the engine's
 * recommendation marked and preselected. Only a person answers it, and the answer waits 10 s with Undo.
 */
export function askFromGate(input: {
  id: string;
  prompt: string;
  from: string;
  options: AskOption[];
  recommended: string | null;
}): Ask {
  const stop = input.options.filter((o) => o.id === 'stop');
  const options = [...input.options.filter((o) => o.id !== 'stop'), ...stop];
  return {
    id: input.id,
    host: 'gate',
    from: { kind: 'engine', id: 'engine', label: input.from },
    prompt: input.prompt,
    kind: 'choose',
    options,
    ...(input.recommended !== null ? { default: input.recommended } : {}),
    answeredBy: 'person',
    undoMs: 10_000,
    record: RECORD.choose,
  };
}
