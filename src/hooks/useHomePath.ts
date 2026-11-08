import { displayPath, displayText } from '../board/homePath.js';

/**
 * The path formatter every screen uses (studio#458/#460/#462): `~/…` for a path under the home directory.
 *
 * Privacy (e2e-1105, 2026-11-08): a home directory never renders, "Show technical details" or not. The switch
 * once showed the full path, so a screen share with it on printed the account name and the folder layout in
 * the thread. `~/…` names the same place in a shell. The hooks keep their shape so callers need no change.
 */
export function useDisplayPath(): (path: string) => string {
  return displayPath;
}

/** The same over free text: a unit's output, a finding's message, a card's sentence. */
export function useDisplayText(): (text: string) => string {
  return displayText;
}
