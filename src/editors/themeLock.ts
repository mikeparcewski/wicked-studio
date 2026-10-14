/**
 * One theme writer per document while a Match runs (codex h4-r3): "Match a website or a PDF" waits for the learned
 * theme file to change, and a Style change in that window would write the same file and pass for the learn's result.
 * While a document is matching, the adapter refuses other theme writes with the reason; the Match's own apply passes.
 */
const matching = new Set<string>();
const key = (projectId: string, docId: string): string => `${projectId}\u0000${docId}`;

export function beginMatch(projectId: string, docId: string): void { matching.add(key(projectId, docId)); }
export function endMatch(projectId: string, docId: string): void { matching.delete(key(projectId, docId)); }
export function isMatching(projectId: string, docId: string): boolean { return matching.has(key(projectId, docId)); }
