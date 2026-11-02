import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CalmHead } from '../src/components/calm/Calm.js';
import { QuietHead } from '../src/components/ui/QuietPage.js';
import { PageFrame } from '../src/components/ui/PageFrame.js';
import { PageAskButton } from '../src/components/chat/PageChat.js';
import { PAGE_CHAT_KINDS, PAGE_CHAT_SPECS } from '../src/board/pageChat.js';
import { usePageChat } from '../src/store/pageChat.js';

// Operator, round 4: a page's chat has ONE entry, the same icon right beside the page title on every page (Report,
// Evaluate, Steering, Memory, Nerve Center, Learn, and now Agents, Repositories and Jobs); no Ask among the filters.
afterEach(() => { cleanup(); usePageChat.setState({ open: {} }); });

describe('the page chat title icon', () => {
  it('sits right after the title in each page head, an icon with a name, no Ask label', () => {
    render(<>
      <CalmHead title="Agents" titleAside={<PageAskButton kind="agents" testId="a" />} sentence="s" />
      <QuietHead title="Repositories" titleAside={<PageAskButton kind="repos" testId="r" />} sentence="s" />
      <PageFrame title="Learn" titleAside={<PageAskButton kind="learn" testId="l" />}><p>x</p></PageFrame>
    </>);
    for (const [id, title] of [['a', 'Agents'], ['r', 'Repositories'], ['l', 'Learn']] as const) {
      const icon = screen.getByTestId(id);
      expect(icon.previousElementSibling?.textContent).toBe(title);
      expect(icon.parentElement?.className).toBe('wk-pagetitle');
      expect(icon.textContent).toBe('');
      expect(icon.getAttribute('aria-label')).toBe(`Chat about ${title}`);
    }
  });

  it('opens and closes that page\'s inline chat', () => {
    render(<PageAskButton kind="jobs" testId="j" />);
    fireEvent.click(screen.getByTestId('j'));
    expect(usePageChat.getState().open.jobs).toBe(true);
    expect(screen.getByTestId('j').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('j'));
    expect(usePageChat.getState().open.jobs).toBe(false);
  });

  it('every page with a chat has a spec, Agents, Repositories and Jobs included', () => {
    for (const k of ['agents', 'repos', 'jobs'] as const) expect(PAGE_CHAT_KINDS).toContain(k);
    expect(PAGE_CHAT_KINDS.every((k) => PAGE_CHAT_SPECS[k].title !== '')).toBe(true);
  });
});
