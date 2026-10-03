/** Types for scripts/build-editors.mjs (EP-P2): the first-party editor bundles, as crew's registry reads them. */
export interface EditorDecl {
  id: string;
  title: string;
  protocol: number[];
  kinds: string[];
  sizes: Array<'inline' | 'pane' | 'full'>;
  permissions: Array<{ id: string; why: string }>;
}
export interface BuiltEditor { id: string; version: string; bytes: number; sha256: string; dir: string }
export const EDITORS: EditorDecl[];
export function externalReferences(html: string): string[];
export function buildEditors(outDir: string, opts?: { version?: string }): Promise<BuiltEditor[]>;
