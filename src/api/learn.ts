/**
 * The Learn wire (program DES-LEARN; mockup learn-and-panels states c, d, f-memory): the orchestrator's
 * personality, the first run's facts, and a steering-author run's drafted rules.
 *
 * The shapes are the contract's (`wicked-crew-api-types` 0.160.0: `Persona*`, `SetupKnown`,
 * `SteeringDraftResponse`, `GateDecision.keepRules`). Studio pins an older contract, so they are mirrored
 * here field for field; swap these for the contract's on the next pin. A daemon before 0.160.0 answers
 * these routes with Fastify's bare 404, which {@link isLearnRouteAbsent} names so callers say so.
 */

import { apiFetch } from './client.js';
import { isRouteAbsent } from './errors.js';
import { openingOf } from '../store/gates.js';
import type { ConformanceRule } from './types.js';

// ── Personality ───────────────────────────────────────────────────────────────────────────────

export type PersonaDial = 0 | 1 | 2;
export type PersonaHabit = 'says-unchecked' | 'tables' | 'cites' | 'names';
export const PERSONA_HABITS: readonly PersonaHabit[] = ['says-unchecked', 'tables', 'cites', 'names'];

export interface PersonaInput {
  name: string;
  colour: string;
  dials: { length: PersonaDial; warmth: PersonaDial; pushback: PersonaDial; initiative: PersonaDial };
  habits: PersonaHabit[];
  notes?: string;
}

export interface Persona extends PersonaInput {
  version: number;
  updatedAt: number;
}

export type PersonaScope = 'user' | `project:${string}`;

export interface PersonaResponse {
  user: Persona | null;
  projects: Record<string, Persona>;
  voice: { user: string | null; projects: Record<string, string> };
}

export interface PersonaSaved {
  scope: PersonaScope;
  persona: Persona;
  voice: string;
}

export function getPersonas(): Promise<PersonaResponse> {
  return apiFetch<PersonaResponse>('/persona');
}

export function putPersona(scope: PersonaScope, persona: PersonaInput): Promise<PersonaSaved> {
  return apiFetch<PersonaSaved>('/persona', { method: 'PUT', body: JSON.stringify({ scope, persona }) });
}

export function removePersonaOverride(projectId: string): Promise<{ removed: true }> {
  return apiFetch<{ removed: true }>(`/persona?scope=${encodeURIComponent(`project:${projectId}`)}`, { method: 'DELETE' });
}

// ── First run ─────────────────────────────────────────────────────────────────────────────────

export interface SetupKnown {
  git: { name: string | null; email: string | null } | null;
  languages: Array<{ name: string; files: number; share: number }>;
  filesCounted: number;
  nearby: Array<{ name: string; path: string }>;
}

export function getSetupKnown(): Promise<SetupKnown> {
  return apiFetch<SetupKnown>('/setup/known');
}

// ── Steering-author drafts ───────────────────────────────────────────────────────────────────

export interface SteeringDraftResponse {
  runId: string;
  ready: boolean;
  rules: ConformanceRule[];
  source?: 'deliverable' | 'transcript' | 'gate-prompt';
  /** (wicked-crew#1982, crew api-types next) When `ready`: the ord of the gate the engine's record shows open, the gate
   *  these drafts are answered at. ABSENT on an older crew, or when the record keeps no gate rows. */
  gateOrd?: number;
  /** (wicked-crew#1982) When `ready`: which OPENING of that gate the drafts were read at (core#1808). ABSENT on an older
   *  crew, or an engine that does not number openings. */
  gateSeq?: number;
}

export function getSteeringDraft(runId: string): Promise<SteeringDraftResponse> {
  return apiFetch<SteeringDraftResponse>(`/governance/steering/author/${encodeURIComponent(runId)}/draft`);
}

/** The gate a draft read names: crew's integers only (an ord is a non-negative integer, an opening a positive one). */
function draftGate(draft: SteeringDraftResponse | undefined): { ord?: number; gateSeq?: number } {
  const ord = draft?.gateOrd;
  const seq = draft?.gateSeq;
  return {
    ...(typeof ord === 'number' && Number.isInteger(ord) && ord >= 0 ? { ord } : {}),
    ...(typeof seq === 'number' && Number.isInteger(seq) && seq > 0 ? { gateSeq: seq } : {}),
  };
}

/** Approve a steering-author run's propose gate, landing only the kept rule ids (crew 0.160.0). It names the gate the
 *  person's drafts were read at (wicked-crew#1982: `draft.gateOrd` and `draft.gateSeq`), so crew refuses it (409
 *  gate_changed) once that opening has closed and the gate re-opened. A draft from an older crew names none: then
 *  (studio#1493) the opening of the run's gate when this tab's gate store holds it, else none, as before. */
export function keepDraftedRules(runId: string, keepRules: readonly string[], draft?: SteeringDraftResponse): Promise<{ status: string; landing?: { outcome: string; ruleIds: string[]; declinedIds?: string[]; error?: string } }> {
  const read = draftGate(draft);
  const named = read.ord !== undefined || read.gateSeq !== undefined;
  const gateSeq = openingOf(runId);
  const gate = named ? read : gateSeq === undefined ? {} : { gateSeq };
  return apiFetch(`/runs/${encodeURIComponent(runId)}/gate`, {
    method: 'POST',
    body: JSON.stringify({ approve: true, keepRules: [...keepRules], ...gate }),
  });
}

/** A daemon from before these routes (crew < 0.160.0): Fastify's bare unknown-route 404. */
export function isLearnRouteAbsent(e: unknown): boolean {
  return isRouteAbsent(e);
}
