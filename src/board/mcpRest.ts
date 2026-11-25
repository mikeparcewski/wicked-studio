/**
 * studio#1399: the MCP server workflow's "Also expose as a REST API" option. The mcp-server workflow takes one
 * free-text intent (`POST /runs` `problem`), and its scaffold skill reads a REST ask in it as `--rest` (wicked-garden
 * #1566, #1339 done-when 3): the server then also serves `POST <basePath>/tools/<name>` and an OpenAPI description,
 * built from the same tools. Studio says it in one fixed line appended to the person's words, so the ask is the same
 * from New job's steps and from the chat's start row.
 */

/** The built-in workflow (the engine's `mcp-server` preset) that offers the option. */
export const MCP_SERVER_WORKFLOW = 'mcp-server';

/** The option's label, and its one line under it: what ticking it adds. */
export const REST_API_LABEL = 'Also expose as a REST API';
export const REST_API_HINT = 'Adds HTTP routes and an OpenAPI description, built from the same tools.';

/** The line the intent carries when the option is on (the garden skill keys on it). */
export const REST_API_INTENT_LINE = 'Also expose the tools as a REST API (mcp-scaffold --rest): HTTP routes and an OpenAPI description built from the same tools.';

/** Whether a launch of this workflow id offers the option. */
export function offersRestApi(workflowId: string | null | undefined): boolean {
  return workflowId === MCP_SERVER_WORKFLOW;
}

/**
 * The intent sent: the person's words, with the REST line as its one last line when the option is on (a copy of the
 * line already in the words, from a pasted earlier intent, is taken out first, so it is never there twice).
 */
export function withRestApi(intent: string, on: boolean): string {
  if (!on) return intent;
  const words = (intent.includes(REST_API_INTENT_LINE)
    ? intent.split(REST_API_INTENT_LINE).map((part) => part.trim()).filter((part) => part !== '').join('\n\n')
    : intent).trimEnd();
  return words === '' ? REST_API_INTENT_LINE : `${words}\n\n${REST_API_INTENT_LINE}`;
}
