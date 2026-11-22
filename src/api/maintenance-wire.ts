/**
 * Wire shapes of crew's repository removal and maintenance drain (crew#1230, crew#1475; wicked-crew-api-types
 * 0.220.0 `UnregisterRepoResponse`, `MaintenanceRequest`, `MaintenanceState`). Studio pins an older api-types, so
 * they are typed here, field for field, until the pin moves.
 */

/** `DELETE /api/v1/repos/:id` 200. The checkout and its code map stay on disk. Refusals: 404 `repo_not_found`;
 *  409 `repo_in_use` (`runIds` when crew's own check finds the live runs) or `repo_in_project` (the projects named
 *  in `error`); 501 `repo_unregister_unsupported` on an older engine. */
export interface UnregisterRepoResponse {
  repoId: string;
  removed: true;
}

/** `POST /api/v1/maintenance`'s body. Drain lasts until crew restarts. */
export interface MaintenanceRequest {
  drain: boolean;
}

/** `GET` and `POST /api/v1/maintenance`: whether crew admits new work, and the work running now. */
export interface MaintenanceState {
  draining: boolean;
  /** Unix milliseconds when drain was turned on; `null` while admitting work. */
  since: number | null;
  /** No run is planning, distributing or executing. Parked and human-held runs are idle. */
  idle: boolean;
  active: Array<{ runId: string; status: string }>;
}
