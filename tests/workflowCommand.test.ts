// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  commandLine, parseWorkflowCommand, presetCommandLine, workflowItems,
  WORKFLOWS_EMPTY_LINE, WORKFLOWS_LOADING_LINE, WORKFLOW_ROWS_MAX, type WorkflowRow,
} from '../src/board/workflowCommand.js';
import type { WorkflowDef } from '../src/api/types.js';
import type { Preset } from '../src/api/teamPlan.js';

/**
 * S19a (DES-STUDIO-REBUILD-001 §5.5/§5.7): the `/workflow-<key>` command — parsing, the menu's rows
 * and the one line each shows, all read off the daemon's own shapes. Pure.
 */

const def = (id: string, phases: string[], isSystem?: boolean): WorkflowDef =>
  ({
    id,
    phases: phases.map((p) => ({ id: p })),
    ...(isSystem === undefined ? {} : { is_system: isSystem }),
  }) as unknown as WorkflowDef;

const preset = (name: string, steps: string[], system?: boolean): Preset =>
  ({
    name,
    scope: 'global',
    steps: steps.map((s) => ({ catalog: s, id: s })),
    created_by: 'operator',
    updated_at: 0,
    ...(system === undefined ? {} : { system }),
  }) as unknown as Preset;

const keys = (rows: WorkflowRow[]): string[] => rows.map((r) => r.key);

describe('parseWorkflowCommand', () => {
  it('reads the key and the intent after it', () => {
    expect(parseWorkflowCommand('/workflow-bug the charge never clears'))
      .toStrictEqual({ key: 'bug', rest: 'the charge never clears' });
  });
  it('reads a bare command with empty intent', () => {
    expect(parseWorkflowCommand('/workflow-bug')).toStrictEqual({ key: 'bug', rest: '' });
    expect(parseWorkflowCommand('  /workflow-migration  ')).toStrictEqual({ key: 'migration', rest: '' });
  });
  it('is first-token only — a mid-sentence command is a sentence, never a launch', () => {
    expect(parseWorkflowCommand('fix /workflow-bug later')).toBeNull();
    expect(parseWorkflowCommand('please run /workflow-bug')).toBeNull();
  });
  it('ignores anything that is not the command, a keyless command, or another command', () => {
    expect(parseWorkflowCommand('/workflow-')).toBeNull();
    expect(parseWorkflowCommand('/workflow')).toBeNull();
    expect(parseWorkflowCommand('/build')).toBeNull();
    expect(parseWorkflowCommand('workflow-bug')).toBeNull();
    expect(parseWorkflowCommand('')).toBeNull();
  });
});

describe('commandLine', () => {
  it('names the phase count and the first four phases', () => {
    expect(commandLine(def('qe-author-tests', ['recon', 'author', 'verify', 'review', 'deliver'])))
      .toBe('5 phases: recon → author → verify → review → …');
  });
  it('singularizes one phase and says so for none', () => {
    expect(commandLine(def('solo', ['recon']))).toBe('1 phase: recon');
    expect(commandLine(def('empty', []))).toBe('no phases listed');
  });
});

describe('presetCommandLine', () => {
  it('names a preset and its steps', () => {
    expect(presetCommandLine(preset('ship-it', ['understand', 'build', 'deliver'])))
      .toBe('preset · 3 steps: understand → build → deliver');
  });
  it('falls back to the name with no steps', () => {
    expect(presetCommandLine(preset('nothing', []))).toBe('preset · nothing');
    expect(presetCommandLine(preset('one', ['build']))).toBe('preset · 1 step: build');
  });
});

describe('workflowItems', () => {
  it('offers ordinary defs first, then presets, never a system entry', () => {
    const defs = [def('feature', ['plan', 'build']), def('onboarding', ['ask'], true), def('bug', ['recon'])];
    const presets = [preset('ship-it', ['build']), preset('chatty', ['ask'], true)];
    expect(keys(workflowItems('', defs, presets))).toStrictEqual(['feature', 'bug', 'ship-it']);
  });
  it('narrows by the command or the key, case-insensitively', () => {
    const defs = [def('feature', []), def('bug', []), def('migration', [])];
    expect(keys(workflowItems('workflow-b', defs, null))).toStrictEqual(['bug']);
    expect(keys(workflowItems('bug', defs, null))).toStrictEqual(['bug']);
    expect(keys(workflowItems('WORKFLOW-M', defs, null))).toStrictEqual(['migration']);
  });
  it('a def and a preset of the same name are one row and the def wins', () => {
    const defs = [def('bug', ['recon', 'build'])];
    const presets = [preset('bug', ['other'])];
    const rows = workflowItems('', defs, presets);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('workflow');
    expect(rows[0]?.line).toBe('2 phases: recon → build');
  });
  it('carries the command, the launch id and the source', () => {
    expect(workflowItems('', [def('bug', ['recon'])], null)[0])
      .toStrictEqual({ key: 'bug', cmd: 'workflow-bug', workflowId: 'bug', line: '1 phase: recon', source: 'workflow' });
  });
  it('caps the rows at WORKFLOW_ROWS_MAX', () => {
    const many = Array.from({ length: 12 }, (_, i) => def(`wf-${i}`, []));
    expect(workflowItems('', many, null)).toHaveLength(WORKFLOW_ROWS_MAX);
  });
  it('offers a row for an id studio has never seen, its line read off the catalog', () => {
    const rows = workflowItems('wo', [def('qe-author-tests', ['recon', 'author', 'verify', 'review', 'deliver'])], null);
    expect(rows).toStrictEqual([{
      key: 'qe-author-tests', cmd: 'workflow-qe-author-tests', workflowId: 'qe-author-tests',
      line: '5 phases: recon → author → verify → review → …', source: 'workflow',
    }]);
  });
  it('a preset of more than four steps ends in "…"', () => {
    expect(presetCommandLine(preset('long', ['a', 'b', 'c', 'd', 'e']))).toBe('preset · 5 steps: a → b → c → d → …');
  });
  it('reads a cold catalog as no rows, never a throw', () => {
    expect(workflowItems('', null, null)).toStrictEqual([]);
  });
});

describe('the menu lines', () => {
  it('are one plain sentence each', () => {
    expect(WORKFLOWS_LOADING_LINE).toBe("Reading the daemon's workflows…");
    expect(WORKFLOWS_EMPTY_LINE).toBe('This daemon lists no workflows.');
  });
});
