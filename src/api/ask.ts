/**
 * Guided asks (design DES-GUIDED-CHAT; mockup learn-and-panels state h): ONE typed shape for every question a person
 * answers inline — a gate, a seat's or MCP server's question, the power-mode pause — rendered by `AskCard` instead of
 * button rows.
 *
 * The shapes are the contract's (`wicked-crew-api-types` 0.153.0: `Ask`, `AskOption`, `AskKind`, `AskAnswer`,
 * `AskHost`, `ElicitationMulti`). Studio pins an older contract, so they are mirrored here field for field; swap these
 * for the contract's on the next pin (as `RunInventoryResponse` in `./types.ts`).
 */

/** The six ways a person answers. */
export type AskKind = 'confirm' | 'choose' | 'pick' | 'text' | 'scale' | 'confirm_reason';

/** Which route answers the ask. */
export type AskHost = 'gate' | 'elicitation' | 'chat' | 'learn' | 'plugin' | 'power';

export interface AskOption {
  id: string;
  label: string;
  sub?: string;
  /** What happens if this option is taken: shown while it is hovered or selected ("If you choose this: …"). */
  consequence?: string;
  /** The wire answer (a gate action token, an elicitation option, a pause decision). */
  token: string;
  tone?: 'primary' | 'neutral' | 'danger';
  /** Marked "Recommended", and preselected. */
  recommended?: boolean;
  /** Taking it asks for a reason first. */
  needsReason?: boolean;
  /** Shown, not choosable; the words say why. */
  disabled?: string;
  meta?: string;
}

export type AskScale =
  | { steps: string[]; consequences?: string[] }
  | { min: number; max: number; step: number; labels: [string, string] };

export interface Ask {
  id: string;
  host: AskHost;
  from: { kind: 'engine' | 'seat' | 'plugin' | 'studio'; id: string; label: string };
  prompt: string;
  detail?: string;
  kind: AskKind;
  options?: AskOption[];
  multi?: { min?: number; max?: number };
  default?: string | string[] | number;
  scale?: AskScale;
  text?: { placeholder?: string; maxChars?: number; optional?: boolean };
  then?: Ask;
  answeredBy: 'person' | 'any';
  undoMs?: number;
  /** "You chose: {label}" · "You picked: {labels}" · "You noted: {text}" · "You set: {label}". */
  record: string;
}

export interface AskAnswer {
  askId: string;
  option?: string;
  options?: string[];
  text?: string;
  value?: number;
  reason?: string;
}

/** (api-types 0.153.0) A multi-select question's bounds. */
export interface ElicitationMulti { min: number; max: number }

/** `POST /runs/:id/elicitation` body with a multi-select's `values` (api-types 0.153.0 `ElicitationResponse`). */
export interface ElicitationAnswerBody {
  elicitationId: string;
  action: 'accept' | 'decline' | 'cancel';
  content?: { response: string } | { values: string[] };
}
