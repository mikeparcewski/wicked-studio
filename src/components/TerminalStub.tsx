/**
 * PLACEHOLDER — xterm.js terminal pane (DES-STUDIO-001 §4.2, DES-TERMINAL-001 §6).
 *
 * Deliberately not built: core-ts has NOT bound the terminal methods yet
 * (`openTerminal`/`writeTerminal`/`resizeTerminal`/`closeTerminal` — "a separate
 * follow-on task", wicked-core-ts lib.rs). The daemon can already RECEIVE
 * `terminalOutput` frames over the event stream, but cannot open/write a
 * terminal, so the interactive pane + its dedicated `/ws/terminal/:id` channel
 * are blocked. No fabricated terminal.
 */
export function TerminalStub(): React.ReactElement {
  return (
    <div
      data-testid="terminal-stub"
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-400"
    >
      <p className="font-semibold text-gray-500">Terminal — not wired</p>
      <p className="mt-1">
        Pending the core-ts terminal method bindings (<code>openTerminal</code> et al., §4.2). The
        xterm.js pane + <code>/ws/terminal/:id</code> channel land when those bind.
      </p>
    </div>
  );
}
