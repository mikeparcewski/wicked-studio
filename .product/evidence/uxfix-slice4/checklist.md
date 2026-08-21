# DES-UXFIX-001 — Slice 4 experience-checklist verdicts (§4.1)

**Slice:** 4 — mode switcher weight + Chat first-run
**Date:** 2026-08-20
**Build:** branch `uxfix/slice-4-switcher-chat` (on top of slice 3, `7dda8b8`; production
commit `29e5cf5`)
**Rig:** `e2e/uxfix_slice4_test.py` — the shared W2 fixture server (`uxfix_fixture.py`,
extended with a four-seat roster + instant-warm chat endpoints; dataset and switches
untouched), captured per the §4.0 contract: 1440×900, `device_scale_factor=1`, every
capture waits on a `data-testid`, never a sleep. The DOM ACs backing each verdict all
passed in the same run with a NETWORK TAP (JSON report printed by the rig:
`openChat_requests_on_mount: 0`, `roster_requests_on_mount: 0`,
`open_body_clis: null` on Add agents, `open_body_clis: ["claude"]` on the first typed
send), and the slice-1, slice-2 AND slice-3 rigs were re-run against this exact
`dist-sameorigin` build — all green, no regression. Full vitest suite: 83 files /
778 tests green; lint and typecheck clean.

**Screenshots judged** (uncommitted evidence, `e2e/shots/uxfix/`):

| Scene | File |
|---|---|
| The weighted segmented switcher (element shot) | `uxfix-4-switcher.png` |
| Chat first-run: the teaching state, nothing armed | `uxfix-4-chat-firstrun.png` |
| The disclosed multi-agent strip + Close | `uxfix-4-chat-multiagent.png` |

Judged from the pixels alone, per §4.1 ("if you cannot tell from the image, it fails").

---

## EC7 — the surface teaches itself · **PASS**

Readable from the images alone:

- **The switcher teaches the current mode without a hover.** Below the segmented
  control, the active mode's one-line summary is always on screen — in
  `uxfix-4-switcher.png`: *"Talk to an agent with no artifact committed yet — and choose
  a mode by conversation."* Before this slice that sentence lived in a tooltip; a
  newcomer had to know to hover a low-contrast link to learn what a mode was.
- **Chat's first-run state says what Chat IS and what typing does.** The centre of
  `uxfix-4-chat-firstrun.png` is two lines — *"Chat with an agent about this project."*
  and *"No run, no gates — just talk. Ask for a deck or some code and I'll switch you to
  the right mode."* — which teach the surface, its cost model (no run, no gates), and
  the product's central trick (choose a mode by conversation, §2.4 rule 3), which this
  empty state is the ONE place to teach. The composer below is focused and its
  placeholder is the action ("Describe what you want…"); the sole disclosure
  (`+ Add agents`) sits under it, visibly subordinate.
- **The BEFORE is legible as the finding.** F6's ambush — "Group chat" header, six
  pre-armed agent chips, an "End chat" button before a word is typed — appears nowhere
  in the first-run shot: the header says **Chat**, carries zero chips, and has no
  teardown button. The rig asserts the strings "Group chat" and "End chat" appear
  nowhere in the page text.

## EC8 — the switcher looks like the spine · **PASS**

- In both full-page shots the switcher is the highest-contrast control on screen: the
  active **Chat** segment is a filled accent-yellow pill with dark ink and its glyph —
  the ONE fill of that colour in the chrome — while Build / Document / Video are real
  bordered segments (glyph + label, resting surface), not bare text. This is §2.5
  rule 1 verbatim: segmented, active FILLED, not underlined. The rig pins it below the
  pixels too: computed `backgroundColor` of the active segment is the literal accent
  (`rgb(255, 218, 25)`) and of an inactive segment is not.
- The four glyphs are the same four the board quick actions, rail verbs and doc tiles
  use (💬 ⚙ ▤ ▶ — §2.5 rule 4); the rail's `+ ⚙ Build + 💬 Chat` in the same shot
  demonstrates the one-vocabulary spine directly.
- Readiness behaviour is untouched (greyed-never-hidden with the enabling action in the
  title, §1.3 rule 3) — no unavailable mode occurs in the fixture, so that state is
  covered by the unit suite (`ProjectShell.gate.test.tsx`), not by these pixels.

## EC10 — no banned state · **PASS**

- **No ambush, no warmed seats on first run** — the slice's own banned state. The
  first-run shot shows zero chips and no Close, and the network tap proves the absence
  is real, not cosmetic: zero `POST /chats`, zero roster fetches on mount. Warm chips
  exist only in `uxfix-4-chat-multiagent.png`, i.e. only AFTER the one disclosure was
  clicked — where all four seats render green/ready with Close now present (V8).
- No bare spinner, no bare "Working…", no whimsy, no error-without-next-action anywhere
  in the three shots. The old pre-arm path's "Warming seats…" floater (a subject-less
  progress line on a surface the user never asked to warm) is gone entirely; seat
  progress now lives on the named per-agent chips (warming/ready/failed), which is
  §3.3's contract for the disclosed state.

---

## Notes / caveats (honest, not blocking)

1. **The multi-agent shot has an empty transcript.** The scene is the disclosed strip
   (chips + Close), not a conversation; replies stream over `/ws` in production and the
   fixture's socket only narrates the board's live run. The typed-send AC (user bubble +
   single-agent open + message POST) is asserted in the same rig run on a fresh tab,
   without a capture.
2. **"Add agents" stays offered after a single-agent first send** (one warm seat ≤ 1).
   Deliberate: one default agent is not the multi-agent strip, and the disclosure is
   how the roster arrives. It retires only once the roster is warmed in.
3. **The single default agent is the first council-enabled roster seat.** The
   `wicked_default_clis` localStorage set (SystemSettings) is not consulted; unifying
   the two "default agent" notions is a later pass. With no roster answer, the open
   omits `clis` and the daemon's roster decides.
4. **Warming more seats into an existing chat reuses the warm ones** — verified against
   the engine (`acp_runner.rs::chat_open` → `chat_ensure` reuses a live session per
   seat), so clicking Add agents after a single-agent send adds seats without dropping
   the first agent's conversation memory.
5. **The mid-switch "End chat" race is now structurally closed, and its test re-keyed.**
   The teardown control no longer exists before anything is armed, so the
   close-the-wrong-repo's-chat window the old always-visible button opened cannot be
   reached from the UI; the rejoin suite now pins exactly that (no Close mid-switch,
   both repos' stored ids intact).
6. **The kept-on-error chat shows Close with zero visible chips** (V8's one exception):
   when the daemon can't be reached to probe a stored id, the chat is real but
   unobservable, and Close is the operator's named way to disconnect it — the error
   copy points at it.
7. **FINDING-027 unchanged:** a stored chat the daemon still holds is rejoined on
   mount exactly as before (warm seats must not be orphaned); only the reclaimed case
   changed destination — it now lands on the first-run state instead of auto-minting a
   fresh warm-all chat, which was itself a miniature of F6.
