import { ApiError } from '../api/errors.js';

/** The preset whose last step (`wicked-core domain-graph`) writes a repository's requirements graph. */
export const DOMAIN_EXTRACTION_ID = 'domain-extraction';

/**
 * crew's "not generated yet" answer for `GET /repos/:id/requirements`, as a state rather than a
 * refusal (lane repo-page): the 404 carries `code: 'notGenerated'` and the workflow that generates
 * the graph (api-types 0.153.0 `RequirementsNotGenerated`). Returns that workflow, or null when `e`
 * is anything else (an unknown repository's 404 carries no code and stays an error).
 *
 * A daemon from before the typed answer (crew ≤ 0.16.11) sends only its sentence
 * ("requirements_graph.json not generated for this repo yet"); that sentence is read the same way
 * until those daemons are gone.
 */
export function requirementsNotGenerated(e: unknown): { workflow: string } | null {
  if (!(e instanceof ApiError) || e.status !== 404) return null;
  const body = typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>) : {};
  if (body['code'] === 'notGenerated') {
    const wf = body['workflow'];
    return { workflow: typeof wf === 'string' && wf.trim() !== '' ? wf : DOMAIN_EXTRACTION_ID };
  }
  if (/requirements_graph\.json not generated/.test(e.wire)) return { workflow: DOMAIN_EXTRACTION_ID };
  return null;
}
