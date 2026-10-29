/**
 * The run-thread plugins studio hosts (program DES-PLUGIN-EVENTS spike 1): each renders ONE sandboxed block in a run's
 * thread and observes the run's events on the topics it was granted. Spike 1 hosts only the first-party ones studio
 * ships in its own bundle; they are PRE-GRANTED the topics their manifest names, and every place that shows one says
 * so ("Built in · pre-granted"). A third-party run-thread plugin needs crew's registry to carry `inline` and
 * `observe[]` and the install consent to grant them: spike 1b.
 */

import bundles from 'virtual:wicked-run-plugins';
import phaseReport from './wicked-phase-report/manifest.json';
import { validPattern } from '../editors/runEvents.js';
import { RUN_THREAD_ONLY, type PermissionId } from '../editors/protocol.js';

export interface ObserveGrant { topic: string; why: string }
/** A run-thread request a plugin asks for (spike 3: `doc.read`, `doc.propose_edit`, `steer.propose`). */
export interface RunPermission { id: PermissionId; why: string }

export interface RunPlugin {
  id: string;
  title: string;
  version: string;
  protocol: number[];
  /** Where it renders: one block in a run's thread. */
  inline: 'run-thread';
  /** What it asked to observe (each with its reason), as the consent and the Plugins page show it. */
  observe: ObserveGrant[];
  /** The topic patterns granted: a built-in plugin is pre-granted what its manifest names (valid patterns only). */
  granted: string[];
  /** The requests it asked for, each with its reason; a built-in one is pre-granted them (run-thread ones only). */
  permissions: RunPermission[];
  /** How the grant was given, said wherever the plugin is shown. */
  grantedBy: 'built-in';
  firstParty: true;
  /** The plugin's one HTML file (framed from a blob: URL). */
  html: string;
  sha256: string;
}

function builtIn(m: { id: string; title: string; protocol: number[]; inline: string; observe: ObserveGrant[]; permissions?: Array<{ id: string; why: string }> }): RunPlugin | null {
  const b = bundles[m.id];
  if (b === undefined || m.inline !== 'run-thread') return null;
  return {
    id: m.id, title: m.title, version: b.version, protocol: m.protocol, inline: 'run-thread', observe: m.observe,
    granted: m.observe.map((o) => o.topic).filter(validPattern), grantedBy: 'built-in', firstParty: true, html: b.html, sha256: b.sha256,
    permissions: (m.permissions ?? []).filter((p): p is RunPermission => RUN_THREAD_ONLY.has(p.id as PermissionId)),
  };
}

export const RUN_PLUGINS: readonly RunPlugin[] = [builtIn(phaseReport)].filter((p): p is RunPlugin => p !== null);

const TOPIC_WORDS: Record<string, string> = {
  'wicked.run.session.*': 'when the job starts, resumes and ends',
  'wicked.run.unit.*': 'each step: planned, who works on it, started, finished',
  'wicked.run.human.awaited': 'when a decision waits on you',
  'wicked.run.checks.evaluated': 'what the checks found, and what was reused',
  'wicked.run.usage.reported': 'time, tokens and cost',
  'wicked.run.qe.decided': 'the QE acceptance decision',
};

const PERMISSION_WORDS: Record<string, string> = {
  'doc.read': 'reads the job’s working document',
  'doc.propose_edit': 'saves what you type in it, and adds its own lines under Decisions as itself',
  'steer.propose': 'suggests a note for the next step (you press Send)',
};
/** A run-thread request in plain words. */
export function permissionWords(id: string): string { return PERMISSION_WORDS[id] ?? id; }

/** A topic in plain words (an unknown one as itself). */
export function topicWords(topic: string): string {
  if (topic === 'wicked.**') return 'everything that happens in every run';
  return TOPIC_WORDS[topic] ?? topic;
}
