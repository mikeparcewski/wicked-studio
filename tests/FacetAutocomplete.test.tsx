import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FacetAutocomplete } from '../src/components/FacetAutocomplete.js';

/**
 * FacetAutocomplete (the user's ask: "tags filter to textbox autocomplete") — a `key=value` facet
 * filter as a typeahead over a caller-derived vocabulary. Single-select: picking an option applies
 * it (a clearable pill), and the × clears it back to the unfiltered view. The applied facet is
 * lifted state, so the host keeps filtering its own rows.
 */

const OPTIONS = ['domain=macos', 'domain=ops', 'project=wicked', 'repo=studio'];

function Harness({ options = OPTIONS }: { options?: string[] } = {}): React.ReactElement {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div>
      <FacetAutocomplete testId="fac" options={options} value={value} onChange={setValue} />
      <span data-testid="applied">{value ?? '(none)'}</span>
    </div>
  );
}

describe('FacetAutocomplete', () => {
  it('opens the full option list on focus and filters it as you type', async () => {
    render(<Harness />);
    const user = userEvent.setup();

    const input = screen.getByTestId('fac-input');
    await user.click(input);
    // Focus shows every option from the derived vocabulary.
    let opts = within(screen.getByTestId('fac-options')).getAllByTestId('fac-option');
    expect(opts.map((o) => o.getAttribute('data-facet'))).toEqual(OPTIONS);

    // Typing narrows the list case-insensitively (substring match).
    await user.type(input, 'domain');
    opts = within(screen.getByTestId('fac-options')).getAllByTestId('fac-option');
    expect(opts.map((o) => o.getAttribute('data-facet'))).toEqual(['domain=macos', 'domain=ops']);
  });

  it('selecting an option applies it (single-select) and shows a clearable pill', async () => {
    render(<Harness />);
    const user = userEvent.setup();

    const input = screen.getByTestId('fac-input');
    await user.click(input);
    await user.type(input, 'ops');
    await user.click(screen.getByTestId('fac-option')); // the single match, domain=ops

    expect(screen.getByTestId('applied')).toHaveTextContent('domain=ops');
    expect(screen.getByTestId('fac-active')).toHaveTextContent('domain=ops');
    // The list closes after a pick.
    expect(screen.queryByTestId('fac-options')).toBeNull();

    // Picking a different option REPLACES it (single-select).
    await user.click(input);
    await user.type(input, 'wicked');
    await user.click(screen.getByTestId('fac-option'));
    expect(screen.getByTestId('applied')).toHaveTextContent('project=wicked');

    // The × clears back to the unfiltered view.
    await user.click(screen.getByTestId('fac-clear'));
    expect(screen.getByTestId('applied')).toHaveTextContent('(none)');
    expect(screen.queryByTestId('fac-active')).toBeNull();
  });

  it('keyboard: ArrowDown highlights and Enter applies the highlighted option', async () => {
    render(<Harness />);
    const user = userEvent.setup();

    const input = screen.getByTestId('fac-input');
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}'); // highlight moves to index 1, Enter applies it
    expect(screen.getByTestId('applied')).toHaveTextContent('domain=ops');
  });

  it('renders nothing to open when the vocabulary is empty', async () => {
    render(<Harness options={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('fac-input'));
    expect(screen.queryByTestId('fac-options')).toBeNull();
  });
});
