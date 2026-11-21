/**
 * wicked-crew-api-types 0.217.0 `EditorGrantsChangedFrame` (crew#1674); local while studio pins 0.216.0.
 * An open host for `id` must re-read GET /editors/:id/grants and call setGrants; a 404 means drop every grant.
 */
export interface EditorGrantsChangedFrame {
  type: 'editorGrantsChanged';
  id: string;
  version?: string;
  sha256?: string;
  reason: 'install' | 'update' | 'removed' | 'grant';
}
