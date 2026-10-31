import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import { requirementsNotGenerated } from '../src/board/requirementsState.js';

describe('requirementsNotGenerated (lane repo-page)', () => {
  it('reads crew\'s typed 404 and the workflow it names', () => {
    const e = new ApiError(404, 'No requirements graph yet for this repository', { error: 'x', code: 'notGenerated', workflow: 'map-it' });
    expect(requirementsNotGenerated(e)).toEqual({ workflow: 'map-it' });
  });
  it('defaults the workflow when the body names none', () => {
    expect(requirementsNotGenerated(new ApiError(404, 'x', { code: 'notGenerated' }))).toEqual({ workflow: 'domain-extraction' });
  });
  it('reads an older daemon\'s sentence', () => {
    expect(requirementsNotGenerated(new ApiError(404, 'requirements_graph.json not generated for this repo yet', { error: 'requirements_graph.json not generated for this repo yet' })))
      .toEqual({ workflow: 'domain-extraction' });
  });
  it('anything else is not this state', () => {
    expect(requirementsNotGenerated(new ApiError(404, 'Repo r1 not found', { error: 'Repo r1 not found' }))).toBeNull();
    expect(requirementsNotGenerated(new ApiError(500, 'boom', { code: 'notGenerated' }))).toBeNull();
    expect(requirementsNotGenerated(new Error('requirements_graph.json not generated'))).toBeNull();
    expect(requirementsNotGenerated(null)).toBeNull();
  });
});
