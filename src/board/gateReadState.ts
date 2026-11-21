export type GateReadState = 'reading' | 'failed' | null;

/** Only an unanswered gate needs a loading line; receipts, Undo and run questions keep their own UI. */
export function gateReadState({ waiting, hasGate, pending, answering, question, askTurn, failed }: {
  waiting: boolean;
  hasGate: boolean;
  pending: boolean;
  answering: boolean;
  question: boolean;
  askTurn: boolean;
  failed: boolean;
}): GateReadState {
  if (!waiting || hasGate || pending || answering || question || askTurn) return null;
  return failed ? 'failed' : 'reading';
}
