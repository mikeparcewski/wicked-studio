import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ApiError, readErrorKind } from '../src/api/errors.js';
import { StateBanner } from '../src/components/ui/StateBanner.js';

afterEach(cleanup);
describe('slice C: an HTTP response is not a network failure', () => {
  it.each([424, 500, 503])('classifies HTTP %s and names the missing memory service', (status) => {
    const error = new ApiError(status, 'wicked-estate not installed');
    expect(readErrorKind(error)).toBe('error');
    render(<StateBanner kind={readErrorKind(error)} what="the memories" error={error.message} />);
    expect(screen.getByRole('alert').querySelector('p')).toHaveTextContent('Memory needs the code map service (wicked-estate), which isn’t installed or running.');
  });
  it('names the missing skills service', () => {
    const error = new ApiError(503, 'wicked-garden not installed');
    render(<StateBanner kind={readErrorKind(error)} what="skills" error={error.message} />);
    expect(screen.getByRole('alert').querySelector('p')).toHaveTextContent('Skills need wicked-garden, which isn’t installed or running.');
  });
  it('uses a plain first line for other HTTP errors and masks the path', () => {
    const error = new ApiError(500, `Could not read ${['', 'Users', 'alice', 'data'].join('/')}\nstack trace`);
    render(<StateBanner kind={readErrorKind(error)} what="skills" error={error.message} />);
    expect(screen.getByRole('alert').querySelector('p')).toHaveTextContent('Studio’s service answered with an error: Could not read ~/data');
    expect(screen.getByRole('alert').querySelector('p')).not.toHaveTextContent('stack trace');
  });
  it('reserves cannot reach for a fetch failure', () => {
    const error = new TypeError('Failed to fetch');
    expect(readErrorKind(error)).toBe('offline');
    render(<StateBanner kind={readErrorKind(error)} what="skills" error={error.message} />);
    expect(screen.getByRole('alert').querySelector('p')).toHaveTextContent('Studio can’t reach its service right now.');
  });
});
