/**
 * DES-EDITOR-PLUGIN-CONTRACT §7.4: the retired "Demo video" header button is an ordinary turn suggestion under the
 * conversation. The composer draws what it is handed as one-click chips while the box is empty, and hides them once
 * something is typed.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerSuggestion } from '../src/components/session/Composer.js';
import { DEMO_VIDEO_ID, openLaunchWizard, resetLaunchWizard, useLaunchWizard } from '../src/store/launchWizard.js';

beforeEach(() => {
  resetLaunchWizard();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const body = path === '/roster' ? { roster: [] } : path === '/repos' ? { repos: [] } : path === '/workflows' ? { workflows: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Harness({ suggestions }: { suggestions: readonly ComposerSuggestion[] }): React.ReactElement {
  const [text, setText] = useState('');
  return <Composer composerKey="s1" text={text} setText={setText} onSend={() => {}} placeholder="p" ariaLabel="a" variant="session" suggestions={suggestions} />;
}

const demo: ComposerSuggestion = {
  id: 'demo-video', label: 'Make a demo video of this',
  onPick: () => openLaunchWizard({ workflowId: DEMO_VIDEO_ID, projectId: 'p1', composerKey: 's1' }),
};

describe('turn suggestions in the composer', () => {
  it('"Make a demo video of this" opens the New job form on the demo video, in the project', () => {
    render(<Harness suggestions={[demo]} />);
    const chip = screen.getByTestId('composer-suggestion');
    expect(chip.textContent).toBe('Make a demo video of this');
    fireEvent.click(chip);
    expect(useLaunchWizard.getState()).toMatchObject({ open: true, draft: { workflowId: DEMO_VIDEO_ID, projectId: 'p1', composerKey: 's1' } });
  });

  it('they step aside while something is typed, and nothing shows without one', () => {
    const { unmount } = render(<Harness suggestions={[demo]} />);
    fireEvent.change(screen.getByTestId('session-composer-input'), { target: { value: 'hello' } });
    expect(screen.queryByTestId('composer-suggestions')).toBeNull();
    unmount();
    render(<Harness suggestions={[]} />);
    expect(screen.queryByTestId('composer-suggestions')).toBeNull();
  });
});
