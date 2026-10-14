import { createContext, useContext } from 'react';
import type { RunHostContext } from '../../editors/hostApi.js';

/** What the page hosting artifacts supplies (HOST-API §6). Absent = no chat drawer, no phase, no gate actions. */
const Ctx = createContext<RunHostContext | null>(null);

export const RunHostProvider = Ctx.Provider;

export function useRunHost(): RunHostContext | null {
  return useContext(Ctx);
}
