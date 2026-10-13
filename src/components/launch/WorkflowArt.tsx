import type { ReactElement, ReactNode } from 'react';
import { DRAFT_EPICS_ID } from '../../store/launchWizard.js';

/**
 * THE NEW JOB CARDS' ART (operator 2026-10-12): one small line drawing per built-in workflow, and a
 * neutral one for a workflow studio does not know (a custom def, a preset). Inline SVG, drawn on one
 * 96×64 grid with one stroke weight: the lines are `currentColor` (the card's ink), the one detail
 * that says what the job does is the theme accent, and soft fills are the accent wash — so every
 * drawing follows the light and dark themes. Decorative: the card's name and purpose say it in words,
 * so the drawing is hidden from assistive tech.
 */

/** A soft panel every drawing stands on, so the set reads as one family. */
function Frame({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg className="wk-wf-art" viewBox="0 0 96 64" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect className="wk-wf-art-ground" x="0" y="0" width="96" height="64" rx="12" stroke="none" />
      {/* The drawing sits inside the panel with a margin all round (strokes do not scale). */}
      <g transform="translate(9.6 6.4) scale(0.8)">{children}</g>
    </svg>
  );
}

const A = 'wk-wf-art-accent';
const W = 'wk-wf-art-wash';

function BugArt(): ReactElement {
  return (
    <Frame>
      <path d="M44 16c0-3 2-5 4-5s4 2 4 5" />
      <path d="M44 14l-4-4M52 14l4-4" />
      <ellipse className={W} cx="48" cy="34" rx="11" ry="15" />
      <path d="M48 20v29" />
      <path d="M37 28h-7M37 36h-8M38 44l-6 4M59 28h7M59 36h8M58 44l6 4" />
      <circle className={A} cx="70" cy="18" r="6" />
      <path className={A} d="M67.5 18l2 2 3.5-4" />
    </Frame>
  );
}

function FeatureArt(): ReactElement {
  return (
    <Frame>
      <rect x="22" y="14" width="44" height="34" rx="4" />
      <path d="M22 22h44" />
      <circle cx="27" cy="18" r="0.75" />
      <circle cx="31" cy="18" r="0.75" />
      <rect className={W} x="28" y="28" width="14" height="14" rx="2" />
      <path d="M47 30h13M47 36h9M47 42h11" />
      <path className={A} d="M72 10v10M67 15h10M70 26v4M68 28h4" />
    </Frame>
  );
}

function MigrationArt(): ReactElement {
  return (
    <Frame>
      <rect x="14" y="18" width="22" height="28" rx="3" strokeDasharray="3 3" />
      <path d="M19 26h12M19 32h12M19 38h8" />
      <rect className={W} x="60" y="18" width="22" height="28" rx="3" />
      <path d="M65 26h12M65 32h12M65 38h8" />
      <path className={A} d="M40 32h16M51 27l5 5-5 5" />
    </Frame>
  );
}

function McpServerArt(): ReactElement {
  return (
    <Frame>
      <rect className={W} x="16" y="13" width="30" height="10" rx="2" />
      <rect x="16" y="27" width="30" height="10" rx="2" />
      <rect x="16" y="41" width="30" height="10" rx="2" />
      <path d="M21 18h0.5M21 32h0.5M21 46h0.5M28 18h12M28 32h12M28 46h12" />
      <path d="M46 32h10c4 0 6-2 6-6v-2" />
      <path className={A} d="M57 24h10v-6c0-3-2-5-5-5s-5 2-5 5zM59 13V8M65 13V8" />
    </Frame>
  );
}

function DomainExtractionArt(): ReactElement {
  return (
    <Frame>
      <path d="M48 32L26 18M48 32L24 46M48 32L70 16M48 32L72 44M48 32v18" />
      <circle cx="24" cy="18" r="5" />
      <circle cx="22" cy="46" r="5" />
      <circle cx="72" cy="15" r="5" />
      <circle cx="74" cy="45" r="5" />
      <circle cx="48" cy="53" r="3" />
      <circle className={`${A} ${W}`} cx="48" cy="32" r="8" />
    </Frame>
  );
}

function EditorPluginArt(): ReactElement {
  return (
    <Frame>
      <path d="M22 12h26l8 8v32H22z" />
      <path d="M48 12v8h8" />
      <path d="M28 28h20M28 34h16M28 40h12" />
      <path className={`${A} ${W}`} d="M58 34h6a4 4 0 0 1 8 0h4v8a4 4 0 0 1 0 8v4H58z" />
    </Frame>
  );
}

function LearnArt(): ReactElement {
  return (
    <Frame>
      <path className={W} d="M48 22c-6-5-16-6-26-4v30c10-2 20-1 26 4 6-5 16-6 26-4V18c-10-2-20-1-26 4z" />
      <path d="M48 22v30" />
      <path d="M28 26h13M28 32h13M55 26h13M55 32h9" />
      <path className={A} d="M62 10v14l4-3 4 3V10z" />
    </Frame>
  );
}

function WriteTestsArt(): ReactElement {
  return (
    <Frame>
      <rect x="28" y="12" width="40" height="42" rx="4" />
      <rect className={W} x="38" y="8" width="20" height="8" rx="2" />
      <path className={A} d="M34 27l3 3 5-6M34 38l3 3 5-6" />
      <path d="M47 27h14M47 38h14" />
      <rect x="34" y="45" width="8" height="5" rx="1" strokeDasharray="2 2" />
      <path d="M47 48h9" />
    </Frame>
  );
}

function DraftEpicsArt(): ReactElement {
  return (
    <Frame>
      <rect className={`${A} ${W}`} x="34" y="10" width="28" height="9" rx="2" />
      <path d="M48 19v6M30 25h36M30 25v4M66 25v4" />
      <rect x="18" y="29" width="24" height="8" rx="2" />
      <rect x="54" y="29" width="24" height="8" rx="2" />
      <path d="M24 37v5M36 37v5M60 37v5M72 37v5" />
      <rect x="18" y="42" width="11" height="10" rx="2" />
      <rect x="31" y="42" width="11" height="10" rx="2" />
      <rect x="54" y="42" width="11" height="10" rx="2" />
      <rect x="67" y="42" width="11" height="10" rx="2" />
    </Frame>
  );
}

/** A workflow studio has no drawing for: a plain run of steps. */
function FallbackArt(): ReactElement {
  return (
    <Frame>
      <circle cx="22" cy="32" r="7" />
      <circle className={W} cx="48" cy="32" r="7" />
      <circle cx="74" cy="32" r="7" />
      <path d="M29 32h12M55 32h12" />
      <path className={A} d="M45 32l2 2 4-4" />
    </Frame>
  );
}

const ART: Readonly<Record<string, () => ReactElement>> = {
  bug: BugArt,
  feature: FeatureArt,
  migration: MigrationArt,
  'mcp-server': McpServerArt,
  'domain-extraction': DomainExtractionArt,
  'editor-plugin': EditorPluginArt,
  learn: LearnArt,
  'qe-author-tests': WriteTestsArt,
  [DRAFT_EPICS_ID]: DraftEpicsArt,
};

/** Whether studio has its own drawing for a workflow key (else the neutral one is drawn). */
export function hasWorkflowArt(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(ART, key);
}

/** The drawing for a workflow key; the neutral one for a key studio does not know. */
export function WorkflowArt({ workflowKey }: { workflowKey: string }): ReactElement {
  const Art = hasWorkflowArt(workflowKey) ? ART[workflowKey]! : FallbackArt;
  return <Art />;
}
