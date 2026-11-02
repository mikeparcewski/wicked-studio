import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Composer } from '../src/components/session/Composer.js';
import { useCapabilities } from '../src/store/capabilities.js';

// Operator, round-2 live look: "there's no visible voice option" although crew had voice. The mic sits beside Send in
// every composer whenever crew has voice; on a crew without it there is none.
afterEach(() => { cleanup(); useCapabilities.setState({ loaded: false, voice: false }); });

const composer = (variant: 'desk' | 'session'): React.ReactElement => (
  <Composer composerKey={variant === 'desk' ? 'desk' : 's1'} text="" setText={() => undefined} onSend={() => undefined} placeholder="Ask" ariaLabel="Ask" variant={variant} />
);

describe('the mic beside Send', () => {
  it('is in the home and session composers, right before Send, when crew has voice', () => {
    useCapabilities.setState({ loaded: true, voice: true });
    render(<>{composer('desk')}{composer('session')}</>);
    for (const [mic, send] of [['desk-composer-voice', 'desk-composer-send'], ['session-composer-voice', 'session-composer-send']] as const) {
      const m = screen.getByTestId(mic);
      expect(m.getAttribute('aria-keyshortcuts')).toBe('Alt+V');
      expect(m.nextElementSibling).toBe(screen.getByTestId(send));
    }
  });
  it('is absent on a crew without voice', () => {
    useCapabilities.setState({ loaded: true, voice: false });
    render(composer('desk'));
    expect(screen.queryByTestId('desk-composer-voice')).toBeNull();
  });
});
