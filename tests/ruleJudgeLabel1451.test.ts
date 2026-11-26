/**
 * studio#1451: when a stand-in judges the steering rules, the engine's judges note ends with the stand-in's label in
 * parentheses, and that label has commas of its own. The note was split on every comma, so the run page listed parts of
 * the label as judges. The lines here are the engine's own, as wicked-core writes them:
 * - `cli_runner.rs` (`engine_note`, "\n{text}\n"): "rule check: {n} steering rule(s) in force; judges: {seats joined
 *   by ", "}" plus " ({label})" when a stand-in sits;
 * - `standin.rs` `label`: "{display} stood in for {role}, {model}: {reason}", with the rule judge's role words "the
 *   rule check" and `Reason::words` (only one helper: "only {display} was signed in"; every helper a party: "every
 *   signed-in helper ({seats}) built or reviewed this work").
 */
import { describe, expect, it } from 'vitest';
import { floorLineOf } from '../src/board/floorLine.js';
import { floorWords } from '../src/board/floorRun.js';

const LABEL_ONE = "Claude Code stood in for the rule check, using Claude Code's default model: only Claude Code was signed in";
const LABEL_PARTIES = "Claude Code stood in for the rule check, using another model (claude-opus-4): every signed-in helper (Claude Code, Codex) built or reviewed this work";
const note = (judges: string): string => `\nrule check: 3 steering rule(s) in force; judges: ${judges}\n`;
const words = (text: string): string => floorWords({ ord: 5, phase: 'rules', minutes: 0, since: 0, check: null, ...(floorLineOf(text)?.judges !== undefined ? { judges: floorLineOf(text)!.judges! } : {}) } as never);

describe('studio#1451: a stand-in rule judge\'s label is not read as more judges', () => {
  it('one stand-in judge, its label in parentheses: one judge, named as a stand-in', () => {
    const text = note(`claude~1 (${LABEL_ONE})`);
    expect(floorLineOf(text)?.judges).toEqual(['claude~1']);
    expect(words(text)).toBe('Checking the steering rules · 0 min · judge Claude Code (stand-in)');
  });

  it('a real judge and a stand-in, the label holding parentheses of its own', () => {
    const text = note(`codex, claude~1 (${LABEL_PARTIES})`);
    expect(floorLineOf(text)?.judges).toEqual(['codex', 'claude~1']);
    expect(words(text)).toBe('Checking the steering rules · 0 min · judges Codex and Claude Code (stand-in)');
  });

  it('with no stand-in the note reads as before', () => {
    expect(floorLineOf(note('codex, pi'))?.judges).toEqual(['codex', 'pi']);
    expect(floorLineOf(note('none'))?.judges).toEqual([]);
  });
});
