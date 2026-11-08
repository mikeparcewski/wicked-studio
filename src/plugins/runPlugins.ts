/**
 * The built-in run-thread plugins studio bundles. They are pre-granted the topics and run-thread permissions their
 * manifests name. The run-plugin store merges these with observe-only installs from crew's registry; installed
 * plugins receive only the topics crew granted for that build.
 */

import bundles from 'virtual:wicked-run-plugins';
import phaseReport from './wicked-phase-report/manifest.json';
import phaseReportIcon from './wicked-phase-report/icon.svg?raw';
import { parsePanels, type PanelDecl } from '../board/runPluginPanels.js';
import { parseVisuals, svgDataUrl, type PluginVisuals } from './visuals.js';
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
  /** What it is: a plugin of a run (it observes a run's events). Where it renders is `panels`. */
  inline: 'run-thread';
  /** The sections it registers (DES-LEARN §1.2): today the run's Details panel only. */
  panels: PanelDecl[];
  /** One line for its card on the Plugins page. */
  description: string;
  /** Its icon, colour and preview for the Plugins page. */
  visuals: PluginVisuals;
  /** What it asked to observe (each with its reason), as the consent and the Plugins page show it. */
  observe: ObserveGrant[];
  /** The granted topic patterns: crew’s decided set for an install; the valid manifest topics for a built-in. */
  granted: string[];
  /** The requests it asked for, each with its reason; a built-in one is pre-granted them (run-thread ones only). */
  permissions: RunPermission[];
  /** How the grant was given, said wherever the plugin is shown. */
  grantedBy: 'built-in' | 'install';
  firstParty: boolean;
  /** A built-in’s HTML file (framed from a blob: URL); empty for an installed entry. */
  html: string;
  /** Installed entries use the daemon’s hash-pinned bundle route, with its CSP. */
  entryUrl?: string;
  enabled?: boolean;
  sha256: string;
}

/** A built-in plugin's files its manifest names, bundled with it (`visuals.icon`). */
const FILES: Record<string, Record<string, string>> = { 'wicked-phase-report': { 'icon.svg': phaseReportIcon } };

interface Manifest {
  id: string; title: string; protocol: number[]; inline: string; observe: ObserveGrant[]; permissions?: Array<{ id: string; why: string }>;
  panels?: unknown; description?: string; visuals?: { icon?: string; color?: string; live?: boolean };
}

function builtIn(m: Manifest): RunPlugin | null {
  const b = bundles[m.id];
  if (b === undefined || m.inline !== 'run-thread') return null;
  const icon = m.visuals?.icon !== undefined ? FILES[m.id]?.[m.visuals.icon] : undefined;
  return {
    id: m.id, title: m.title, version: b.version, protocol: m.protocol, inline: 'run-thread', observe: m.observe,
    panels: parsePanels(m.panels), description: typeof m.description === 'string' ? m.description.slice(0, 160) : '',
    visuals: parseVisuals({ ...m.visuals, icon: icon !== undefined ? svgDataUrl(icon) : undefined }),
    granted: m.observe.map((o) => o.topic).filter(validPattern), grantedBy: 'built-in', firstParty: true, html: b.html, sha256: b.sha256,
    permissions: (m.permissions ?? []).filter((p): p is RunPermission => RUN_THREAD_ONLY.has(p.id as PermissionId)),
  };
}

export const RUN_PLUGINS: readonly RunPlugin[] = [builtIn(phaseReport as Manifest)].filter((p): p is RunPlugin => p !== null);

const TOPIC_WORDS: Record<string, string> = {
  'wicked.run.session.*': 'when the job starts, resumes and ends',
  'wicked.run.unit.*': 'each step: planned, who works on it, started, finished',
  'wicked.run.human.awaited': 'when a decision waits on you',
  'wicked.run.checks.evaluated': 'what the checks found, and what was reused',
  'wicked.run.usage.reported': 'time, tokens and cost',
  'wicked.run.qe.decided': 'the QE acceptance decision',
  'wicked.run.intake.planned': 'the rigor the QE plan set at intake',
  'wicked.run.rigor.rescored': 'every rigor re-score: up, down or unchanged, and what triggered it',
  'wicked.run.checkpoint.reached': 'each checkpoint of a power-mode build',
  'wicked.run.turn.*': 'the orchestrator’s turns: started and finished',
  'wicked.run.handoff.stepped': 'each hand-off step: checks, review, QE and compliance',
  'wicked.run.power.toggled': 'when power mode is switched on or off',
};

const PERMISSION_WORDS: Record<string, string> = {
  'doc.read': 'reads the job’s context document',
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
