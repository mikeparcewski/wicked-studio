import { useCallback, useState } from 'react';
import { useAgentsReads } from '../../store/agentsReads.js';
import { AgentModal } from './AgentModal.js';

/**
 * SIGN IN, RIGHT HERE (operator 2026-10-27: a run card's "Sign in" opened General settings). Every "Sign
 * in" beside a seat that cannot work opens that agent's sign-in modal where it was pressed: the same
 * `AgentModal` the Agents page uses, asked with `intent="sign-in"`. When the modal closes the roster is
 * read again, and every surface that follows the shared roster (the gate card's reassign and withheld
 * seats, the New job wizard's helpers) re-derives its seat options from that fresh reading.
 */
export function refreshSeatsAfterSignIn(): void {
  void useAgentsReads.getState().load();
}

export function useSignInHere(): { open: (agentKey: string) => void; modal: React.ReactElement | null } {
  const [key, setKey] = useState<string | null>(null);
  const open = useCallback((agentKey: string) => setKey(agentKey), []);
  const close = useCallback(() => { setKey(null); refreshSeatsAfterSignIn(); }, []);
  return { open, modal: key === null ? null : <AgentModal agentKey={key} intent="sign-in" onClose={close} /> };
}
