/**
 * studio#1461: on a phone (390x844) the launch form's composer (/runs/new) squeezed the words to a column a fifth of the
 * card wide, between the + button and the Voice and Send buttons, which kept their full width on the same row. On a
 * phone the words take the row's whole width, and +, Voice and Send sit on the row under them (Voice and Send at its
 * end). jsdom draws no layout, so the test pins both halves: the composer's markup carries the hooks, and the phone
 * block of composer.css wraps the row and puts the words first, full width.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { ChatInput } from '../src/components/ChatInput.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useNewWorkSeatsStore } from '../src/store/newWorkSeats.js';

const css = readFileSync(resolve(process.cwd(), 'src/styles/sections/composer.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');

/** The bodies of every `@media (max-width: 767px) {` block, joined. */
function phone(): string {
  const out: string[] = [];
  for (let at = css.indexOf('@media (max-width: 767px) {'); at > -1; at = css.indexOf('@media (max-width: 767px) {', at + 1)) {
    let depth = 0;
    const open = css.indexOf('{', at);
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}' && --depth === 0) { out.push(css.slice(open + 1, i)); break; }
    }
  }
  return out.join('\n');
}
const rule = (selector: string, within: string): string | null => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'u').exec(within)?.[1] ?? null;
};

beforeEach(() => {
  vi.restoreAllMocks();
  useNewWorkSeatsStore.setState({ seats: null, state: 'idle', loaded: false, saving: false, error: null });
  useCapabilities.setState({ voice: true, loaded: true } as never);
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  localStorage.clear();
});

describe('studio#1461: the launch composer on a phone', () => {
  it('marks the composer row and its words, with Voice and Send after the words', () => {
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const words = screen.getByTestId('launch-problem');
    expect(words).toHaveClass('wk-launch-problem');
    const row = words.parentElement!;
    expect(row).toHaveClass('wk-launch-bubble');
    // The control right after the words is the one that starts the second row's right-hand group.
    expect(words.nextElementSibling).toBe(screen.getByTestId('voice-open'));
    expect(screen.getByTestId('voice-open').nextElementSibling).toBe(screen.getByTestId('launch-submit'));
  });

  it('wraps the row on a phone, the words first and full width, the buttons at the end of the next row', () => {
    const block = phone();
    expect(rule('.wk-launch-bubble', block) ?? '').toMatch(/flex-wrap:\s*wrap/u);
    const words = rule('.wk-launch-bubble > .wk-launch-problem', block) ?? '';
    expect(words).toMatch(/order:\s*-1/u);
    expect(words).toMatch(/flex:\s*1 0 100%/u);
    expect(rule('.wk-launch-bubble > .wk-launch-problem + *', block) ?? '').toMatch(/margin-inline-start:\s*auto/u);
    // Only on a phone: at 1440 the row keeps its one line.
    expect(css.replace(block, '')).not.toMatch(/\.wk-launch-(?:bubble|problem)/u);
  });
});
