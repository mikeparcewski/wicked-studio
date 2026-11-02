/**
 * Round 9d (#937 journeys): two layout rules a journey found broken, pinned here.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (f: string): string => readFileSync(join(__dirname, '..', 'src/styles', f), 'utf8');
const rule = (src: string, selector: string): string => {
  const i = src.indexOf(`${selector} {`);
  return i < 0 ? '' : src.slice(i, src.indexOf('}', i));
};

describe('round 9d layout rules', () => {
  it('the chosen Needs-you folder is an ink fill, so it differs from its track in Wicked Light (desk_inbox_look)', () => {
    const desk = css('sections/desk.css');
    expect(rule(desk, '.wk-inbox-folders .wk-inbox-folder[aria-selected="true"]')).toMatch(/background: color-mix\(in oklab, var\(--ink-high\) 12%, transparent\)/u);
    // Wicked Light's card and raised surfaces are both white: a surface-token pair cannot tell them apart
    expect(rule(desk, '.wk-inbox-folders .wk-inbox-folder[aria-selected="true"]')).not.toMatch(/--surface-card/u);
  });
  it('the reading pane is a step off the inbox card in every theme (desk_inbox_look)', () => {
    expect(rule(css('sections/desk.css'), '.wk-inbox-pane')).toMatch(/background: color-mix\(in oklab, var\(--ink-high\) 4%, var\(--surface-card\)\)/u);
  });
  it('the host panel’s version list flows under the lens line, not over it (desk_plugins_document)', () => {
    expect(rule(css('sections/editor-host.css'), '.wk-htab-versions .wk-artifact-versions')).toMatch(/position: static/u);
  });
});
