# DES-EDITOR-PLUGIN-CONTRACT-001: one plugin contract, three surfaces, the run page as the host

Status: rev 7 (codex r1: 1 P1 and 5 P2; r2: 1 P1 and 4 P2; r3: 4 P2; r4: 1 P2; r5: 1 P2; r6: 1 P2; all taken; r7 confirming), 2026-10-14, lane editors-v2. Builds on DES-EDITOR-PLUGINS-001 (`design/DES-artifact-editor-plugins.md`,
"EP" below) and DES-MCP-INSPECTOR-001. Operator direction (2026-10-13): "this should be a standard format and not
hardcoded into the main app (dynamically rendered from plugin)". Other inputs: "we also need to make sure plugin
builder is updated to match", the run page as the chat, and run page option B. Concepts: `concepts/editors.html`.

## 1. Problem, with evidence

Studio hosts editor plugins over `wicked.editor/1` (iframe plus MessagePort, `src/editors/protocol.ts:10-15`). But
the app still branches per type:

- `ArtifactMorph.tsx:285-297` picks `PluginArtifact` for `page`, the same component again with `kind="deck"` for
  `deck`, and the host-coded `PageEditor` for `document`. `ArtifactMorph.tsx:176` turns the deck review rail on only
  when `kind === 'deck'`, and `:257` hardcodes a "Demo video" button for `deck` or `document`. `EXPORTS` (`:39-43`)
  is a per-kind table.
- The video editor is not a plugin. `WalkthroughEditor.tsx` (522 lines) is host React.
- The MCP inspector is a plugin, but it lives on its own page (`McpInspectPage.tsx`, 662 lines), not in the run.
- Protocol 1 has three sizes (`inline | pane | full`, `protocol.ts:13`). Inline has no input: a host hit layer
  turns a click into "grow" (EP §3.1). So the inline card cannot carry the light controls the operator asked for
  (play, prev/next, try a tool call). The options panel and the full-screen shell do not exist as host surfaces.
- The builder (garden `skills/editor-scaffold`, `scripts/editor/{scaffold,conformance,pin,install}.py`, core preset
  `src/presets/editor-plugin.json`, studio `EditorHostPage.tsx`, crew `editors/pack-install.ts`) produces and
  checks protocol-1 plugins only.

## 2. Goals and non-goals

Goals:
1. ONE contract. A plugin declares its surfaces, and the host renders the card, the options panel and full screen
   from the declaration. There are no `kind ===` branches in the app's artifact path.
2. The run page (`/s/:id`) is the chat. Every turn says who responded (a seat, you, or crew). Gates, questions and
   plugin artifacts are inline cards. A permanent right **host panel** (option B) holds the run details as its base
   tab, and a plugin's Options adds that plugin's tabs. On narrow screens the panel collapses to a ribbon.
3. Full screen belongs to the host: the nav collapses on open and returns on exit, the header is host-drawn,
   Simple/Advanced appears when the plugin declares modes, and the host supplies the chat drawer.
4. Every existing plugin and editor moves onto it: `wicked-page`, `wicked-deck`, the MCP inspector, the document
   editor, and the demo video (as `wicked-video`).
5. The builder produces, previews and validates protocol 2. **Acceptance:** a plugin freshly scaffolded by the
   builder passes conformance and renders all three surfaces in the host, with no host code change.

Non-goals: a new transport, a plugin marketplace, plugin-defined host verbs, network for pack editors, and changes
to grants semantics (EP §6 stands).

## 3. Open-source and standard shapes considered

| Candidate | Fit | Verdict |
|---|---|---|
| **MCP Apps / `ui://` resources** (MCP UI extension: a server returns an HTML resource rendered in a sandboxed iframe, talking over postMessage JSON-RPC) | Same posture as ours: sandboxed iframe, postMessage, host-mediated tool calls | Adopt its **shape** (iframe, declared size hints, host-mediated actions, JSON messages), not its wire. Our transport is already a hardened MessagePort with strict parsing, activation rules and grants (EP §5.3, §8). Re-basing on MCP Apps would drop those, and its spec is still moving. For the MCP kind, the inspector can render a server's own `ui://` resource inside its frame later; that is out of scope here. |
| Web Components / custom elements | Rendering in the host document | Rejected. It is same-origin with the host, so there is no isolation. EP §8 requires an opaque-origin frame. |
| JSON Forms / react-jsonschema-form (host-rendered settings from a schema) | Options tabs that are plain settings | Adopt the **idea**, not the library. Protocol 2 has a closed, tiny `controls` vocabulary (§5.3) that the host renders with its own components. RJSF brings about 200 KB and arbitrary widgets. Its schema power (conditionals, custom widgets) is exactly what a plugin must not get in host chrome. |
| Penpal / post-robot (iframe RPC helpers) | Request/reply over postMessage | Not needed: `protocol.ts` already has strict envelopes and replies. |

## 4. The model: one plugin, up to three live instances, one host

```
thread turn ──► CARD instance        (surface "card",    the plugin's frame inside host card chrome)
host panel ──► OPTIONS instance(s)   (surface "options", one frame per plugin-rendered tab; or host-rendered controls)
full screen ──► FULL instance        (surface "full",    the plugin's frame inside the host full-screen shell)
```

- **Scope is the artifact, not the plugin**: an instance group is keyed by (editor id, artifact key). Relays
  (`host.selection`, `artifact.changed`, `options.*`) never cross groups, so one plugin opening two artifacts keeps
  two separate states.
- **At most three instances per group**: one card/full instance, and one options instance per open options group.
  The options instance hosts every plugin-rendered tab and switches between them on `host.tab`. It also owns the
  `options.values` and `options.changed` exchange for that group's controls tabs. It is mounted when Options is
  pressed, even for a group of controls-only tabs, where it renders nothing visible. It is disposed when the group
  closes.
- All instances are the same hash-pinned bundle, each in its own `sandbox="allow-scripts"` frame with its own port.
  `host.hello.surface` tells the instance which one it is.
- **The card and full screen are one instance that morphs** (EP's never-re-parent rule, EP-D2). The card's frame
  grows into the full-screen shell and shrinks back, so a playing video keeps playing. The options instance is
  separate, because it is visible at the same time as the card.
- The host keeps the instances in step. Every `selection.set` from one instance reaches the others as
  `host.selection`. `artifact.changed` goes to all of them. Mode changes go only to the full instance.
- A v1 plugin is one instance. The host maps `inline` to the card (with the v1 hit layer and no plugin actions),
  `pane` to a single options tab named "Editor", and `full` to full screen with no modes (§9).

## 5. The plugin's declaration (protocol 2)

### 5.1 Where it lives

The declaration is in the plugin's manifest (`editor.json` for first-party plugins, `wicked-pack.json` `editors[]`
for packs) as `surfaces`. It is echoed in `plugin.ready.payload.surfaces`. The host renders from the **registry
copy** when crew lists it (crew's EditorView gains `surfaces`, §8.2). Otherwise it uses the copy in `plugin.ready`,
which is accepted only when it is byte-equal, as canonical JSON, to what the bundle's own manifest says. The
conformance run (§8.3) checks that they agree. Until crew ships the field, the host reads `plugin.ready`, because
crew's manifest schema strips unknown keys (`registry.ts:66`, a non-strict `z.object`). So an older crew keeps
listing a protocol-2 first-party editor.

### 5.2 Shape

```jsonc
"protocol": [1, 2],
"surfaces": {
  "card": {
    "interactive": true,                 // the frame gets pointer and keys inside the card (v1 inline never did)
    "aspect": "16:9",                    // "16:9" | "4:3" | "auto" (auto: the plugin reports its height, ≤ 560 css px)
    "actions": [                         // ≤ 4, drawn by the HOST in the card footer
      { "id": "next",   "label": "Next chapter", "verb": "plugin" },
      { "id": "export", "label": "Export",       "verb": "host:export" }
    ]
  },
  "options": {
    "tabs": [                            // ≤ 5; added to the host panel when the operator presses Options
      { "id": "chapters", "label": "Chapters", "render": "plugin" },
      { "id": "captions", "label": "Captions", "render": "controls", "controls": [ /* §5.3 */ ] }
    ]
  },
  "full": { "modes": ["simple", "advanced"], "default": "simple" }   // modes optional; omit for one mode
}
```

Rules (checked by the host parser, crew's registry, garden's pack check and conformance):
- Ids match `^[a-z][a-z0-9-]{0,31}$`. Labels are 1 to 24 plain characters (letters, digits, space and `·-'`). Labels
  may not contain the **host's decision words**: approve, accept, deliver, merge, send, launch, delete, remove,
  stop, deny, allow, grant, install. Those verbs appear only on host-owned controls (EP §5.5 "gate actions stay in
  the host"; §7.3). Unicode confusables of those words are refused: the label is NFKC-normalized and checked
  against an ASCII-skeleton list.
- `verb` is `plugin` (the host sends `host.action {id}` to the card or full instance, which then acts only through
  its granted requests) or one of the closed **host verbs**: `host:export` (needs `artifact.export`) or `host:ask`
  (puts the current selection as an "about:" chip and focuses the composer). Approve, Send back, Re-record and
  Stop are never plugin verbs. They are host controls on the host's gate card, review rail or run tab, drawn from
  run state, not from the plugin (§6.3).
- Ids are unique within their routing scope: action ids within `card.actions`, tab ids within `options.tabs`, and
  control ids within one tab. A duplicate refuses the whole declaration.
- `full.modes`, when present, is exactly `["simple","advanced"]` (the only modes), and `full.default` is one of
  them (`simple` when omitted). Without `modes`, there is no toggle and no `host.mode`.
- Every surface is optional except `card`. With no `options`, the card has no Options button. With no `full`, it
  has no Full screen button.

### 5.3 Host-rendered controls (closed vocabulary)

`{ "id", "label", "type": "toggle" | "segmented" | "select" | "color" | "text" | "range", "options"?: [{id,label}] (≤ 8),
"min"?, "max"?, "step"?, "maxChars"? (≤ 200) }`. There is no free HTML, no conditionals and no custom widgets.

- Per type: `select` and `segmented` require `options` (2 to 8); `range` requires finite `min`, `max` and `step`;
  `toggle` values are booleans; `color` values pass `isColor`; `text` values are strings within `maxChars`. A value
  is accepted only when it is a member of the options (select, segmented) or a finite number within the range on the
  step grid. Host and parser use the same checks (one shared module).
- Bounds: at most 12 controls per tab; options ids unique within a control, at most 8; for `range`, `min < max`
  and `0 < step ≤ max - min`; `maxChars` 1 to 200. A violation refuses the declaration.
- The host renders them with its own components and keeps their values.
- The values come from the plugin (`options.values {tab, values}`), and changes go to the plugin as
  `options.changed {tab, id, value}` requests, whose reply confirms or reverts the control (§6).
- The plugin applies a change through its granted requests: for example, a theme token write is `theme.set`
  (§7.2), and a deck note is `version.write`.
- Values are validated by type before they are sent: colours by the theme grammar's `isColor`, text by length.

## 6. Messages added in protocol 2

All are additive over v1 (EP §5.4 evolution rule). A v2 host speaks v1 to a v1-only plugin.

| Direction | type | kind | payload | notes |
|---|---|---|---|---|
| host → plugin | `host.hello` | event | v1 fields plus `surface: 'card'\|'options'\|'full'`, `tab?: string`, `mode?: 'simple'\|'advanced'` | per instance |
| host → plugin | `host.surface` | event | `{ surface, mode? }` | card ↔ full morph of the one instance |
| host → plugin | `host.mode` | request | `{ mode }` → `{ mode }` | full instance only; the reply echoes the mode now shown (conformance asserts the echo) |
| host → plugin | `host.action` | request | `{ id }` → `{ handled: boolean, status?: string (≤ 120) }` | only for a declared `verb:"plugin"` action, fired by a host click. It grants **no** user activation (rev 1, codex r1 P1). A write that follows is an ordinary `version.write`: versioned, shown on the host's thread line with Undo. `tools/call` keeps the v1/MCP rule (a click inside the plugin's own frame, checked by the host) |
| host → plugin | `host.tab` | event | `{ tab }` | options instance only: which of its plugin tabs is shown |
| host → plugin | `host.selection` | event | `{ anchors: AnchorRef[] }` | another instance pointed; ids only |
| host → plugin | `options.changed` | request | `{ tab, id, value }` → `{ applied: boolean, rev: number, values: Record<id, value>, reason?: string (≤ 120) }` | host-rendered controls. The host shows the control as pending until the reply, then shows `values` (the plugin's truth). On `applied:false`, or a timeout, the control reverts to the last confirmed value and the host line says why. Changes are serialized **per tab**: one `options.changed` in flight per tab, later edits queue (only the newest value per control is kept), so a reply's whole-tab `values` can never overwrite a newer confirmed value. Every snapshot carries `rev`, a per-tab counter the plugin increments on each change of its truth; both `options.values` and the reply carry it. The host keeps the highest `rev` it has seen per tab and discards any snapshot with a lower or equal `rev`, whenever it arrives |
| plugin → host | `options.values` | event | `{ tab, rev: number, values: Record<id, value> }` | ≤ 16 values, each validated by its control type |
| plugin → host | `ui.height` | event | `{ px }` | card with `aspect:"auto"` only; clamped to 120 to 560 |
| plugin → host | `ui.morph` | event | v1 shape, plus `{ to: 'full' }` and `{ to: 'card' }` | |
| plugin → host | `theme.set` | request | `{ base: number, tokens: LearnedThemeTokens }` → `{ version }`; error `head_moved` with `{ head }` when the artifact head is not `base` (the same optimistic rule as `version.write`, EP §5.6), so concurrent card and options writes can't overwrite a newer theme | needs the new `artifact.theme` permission; the host PUTs `/d/:doc/api/theme/learned` (interactive's per-field grammar, `theme-grammar.js:76-82`, is re-checked there) |

Not added, by design: a plugin cannot name or trigger an approval, a gate, a delivery, a run or a send.
`host.action` exists only for ids the plugin declared, and only after a host click.

## 7. Host surfaces

### 7.1 The card (in the thread)

- Host chrome (always): the plugin tag (manifest `title`), the artifact title, host status pills (version, "2
  changed" from adapter state), the declared actions as host buttons, then **Options** and **Full screen**, plus
  the "about:" chip once something is pointed at.
- The turn above the card says who produced the artifact (the seat from the unit that wrote the version).
- The frame: `interactive:true` lets the frame take pointer and keys inside its own box, with the v1 key rules
  (forwardable list, one grapheme to the composer). `interactive:false` keeps the v1 hit layer.
- Only the newest card in view and any grown one run a live frame. Older ones show the static thumbnail (EP §3.1).
- Inline protocol-1 plugins render exactly as today.

### 7.2 The host panel (run page option B)

- One right panel per run page, 400 css px, collapsible. It collapses to a 1-line ribbon below 1200 css px.
  - **Run** tab (host, always first): workflow, repo(s), the phases with the current one, the agents and their
    roles, the checks that ran and didn't, spend, assurance, and actions (Look underneath, Download code, Stop,
    Tech details).
  - **Host tabs from adapter capabilities**: after the plugin's tabs the host appends its own, at most 3: **Review**
    when the adapter reports `parts` and a review store, **Versions** when it reports versions, and **Checks** when
    checks are readable. They don't count against the plugin's 5. The card shows **Options** when there is any
    plugin tab or host tab.
  - Pressing **Options** on a card appends that plugin's tabs, marked with a dot, and focuses its first tab.
    Another plugin's Options replaces the plugin group, so one plugin group shows at a time. The close button
    removes the group.
- Plugin-rendered tabs mount an options instance (`surface:'options'`, `tab`) in the panel body. Controls tabs are
  host-rendered (§5.3).
- `artifact.theme` is a new permission: "change this artifact's theme". The engine grants it by default to
  first-party editors and asks for it for packs, under EP §6.

### 7.3 Full screen

- Opening it sets the shell's `navCollapsed` flag, and leaving it restores the flag. The host calls
  `requestFullscreen()` on its own shell container (EP §5.5 `ui.fullscreen`) only on an explicit host button, never
  automatically.
- Host header: plugin tag, title, the run's current phase, a Simple/Advanced segmented control (only if
  `full.modes` is set; it sends `host.mode`), the gate/host actions for the artifact's open gate (EP §5.5), **Chat**
  (toggles the drawer), and **Esc** (back to the card).
- Chat drawer: the run's own thread and composer, compact, on the right (360 px). It is closed by default
  (operator decision 8, a default not yet confirmed). The composer's "about:" chip follows `selection.set`.
- The body is the morphed card/full instance.

### 7.4 What leaves the app

- `ArtifactMorph`'s per-kind branches and its `EXPORTS` table. Exports come from the adapter's capability list.
- `PageEditor` (once `wicked-doc` covers `document`).
- The "Demo video" header button. It becomes an ordinary turn suggestion ("Make a demo video of this").
- `DeckReview` as a deck-only rail. Approvals become the host's **review** capability. It applies to any adapter
  that reports parts (slides, chapters, sections) and is drawn by the host in the card ("Approve slide") and in a
  host tab "Review", from interactive's review store (`interactive#294`). The capability is keyed by the adapter's
  `parts()`, not by kind.
- `WalkthroughEditor` as host React. It becomes `wicked-video` (§10 slice H6). Gate verbs (Re-record, Ask helpers
  to fix) stay host controls.
- `McpInspectPage` as a separate destination. The inspector plugin renders on the run page through the same card,
  panel and full screen, and `/mcp/inspect` stays as a deep link that opens the same host.

The **adapter** stays host code per data plane (interactive-doc, demo, walkthrough, mcp). It is chosen by the
artifact's data source, not by the plugin or kind. Its capability list (`read`, `write`, `parts`, `media`,
`export`, `theme`, `mcp`) decides which host verbs exist.

## 8. Security, compatibility, conformance

### 8.1 Security (deltas from EP §8)

- More frames: up to three per plugin. Each is a separate opaque-origin frame with its own port, grants and rate
  budget. The host's live-frame cap is 6 per page, and older cards fall back to thumbnails.
- An interactive card puts plugin pixels in the thread where the operator's eyes are. Spoofing defences:
  - host chrome frames the card on all sides, with the plugin tag always visible;
  - plugin labels never use the decision words (§5.2);
  - the host's own buttons have a distinct style and sit outside the frame;
  - a click inside the frame is never a host action.
- `host.action` carries no user activation. A card button can therefore never authorize a `tools/call`, and any
  write it leads to is an undoable version on the host's thread line.
- Controls values are host-validated. A plugin cannot make the host render HTML or a URL.
- `theme.set` is a write: it is subject to `artifact.theme`, interactive's grammar, and Undo (a new version).

### 8.2 Versioning and compatibility

- Negotiation: `plugin.ready.protocol` lists [1] or [1,2], and the host picks the highest common version. The v1
  parser stays and v2 message types are only accepted on a v2 port. A v1 plugin sees no change.
- Manifests: `surfaces` is required when `protocol` includes 2 and refused when it doesn't.
  - crew `EditorManifestSchema` and `EditorView` gain `surfaces?` (api-types minor).
  - garden `wicked-pack.schema.json` adds `surfaces` to the editor entry.
- First-party plugins (`scripts/build-editors.mjs` `EDITORS`) move to `protocol:[1,2]` with surfaces. During the
  transition crew strips the field and the host reads `plugin.ready` (§5.1).

### 8.3 Conformance (garden `conformance.py`, studio `EditorHostPage`, crew install)

New cases, all run in studio's conformance host page in headless Chromium:
- **13** surfaces: `plugin.ready.surfaces` equals the manifest's (canonical JSON), and labels pass the word and
  length rules.
- **14** card: it mounts with `surface:'card'`; with `aspect:"auto"`, `ui.height` arrives within 2 s and is
  clamped; every declared `plugin` action answers `host.action` within 2 s with `handled` true or false.
- **15** options: each plugin tab mounts with `surface:'options', tab` and survives `host.selection`; each
  controls tab's `options.values` validates.
- **16** full: `host.surface` card→full keeps the instance (no reload, no second `plugin.ready`); with modes,
  every `host.mode` request is answered within 2 s with the same mode.
- **16b** activation: a test handler for `host.action` that calls `tools/call` is refused (`not_granted` for want of a
  click), while the same call after an in-frame click succeeds against the conformance fake bridge.
- **17** v1 compatibility: a protocol-[1] plugin still passes 1 to 12 under a v2 host.

Crew's install re-runs the same conformance (`pack-install.ts`). The editor test page (Settings → Developer →
Editor plugins → open) shows the three surfaces side by side: the card in a mock thread turn, the options tabs in a
mock host panel, and full screen with Simple/Advanced and the chat drawer. **Acceptance test:** a CI job scaffolds a
plugin with `scaffold.py` and the defaults, pins it, runs conformance (all cases), then a studio journey loads it on
the editor test page and asserts all three surfaces render from the declaration. No host code is touched.

## 9. Mapping of today's editors

| Editor | Today | Protocol 2 surfaces |
|---|---|---|
| `wicked-page` (`page`) | plugin v1, inline/pane/full | card: interactive page preview, actions `host:ask`, `host:export`; options: Style (controls via `theme.set`) and Versions (host); full: modes simple/advanced (Advanced adds element style and checks) |
| `wicked-deck` (`deck`) | plugin v1, plus a host-coded DeckReview rail | card: large fitted slide, prev/next inside the frame; actions `host:ask`, `host:export`; host review capability adds "Approve slide"; options: Style (controls), Review (host); full: Fit/100% and Present inside the plugin, no modes |
| document editor (`document`) | host `PageEditor` | becomes `wicked-doc`: card, options Style, full with coverage as a plugin tab |
| demo video (`demo-video`, `walkthrough`) | host `WalkthroughEditor` | becomes `wicked-video`: card player plus chapter chips; options Chapters (plugin), Captions and Theme (controls); full modes simple/advanced; gate verbs stay host controls |
| MCP inspector (`mcp-server`) | plugin v1 on its own page | card: tool list, try a call (a click inside the plugin's own frame, the MCP §4 rule), result; options Tools, Resources, Log (plugin); full modes simple/advanced |
| pack editors | v1 | unchanged until rebuilt; v1 mapping (§4) |

## 10. Slices (one PR each; studio PRs stay open for the operator's review)

| # | Repo | Slice |
|---|---|---|
| H1 | studio | protocol 2 in `protocol.ts` (parser, envelopes, word rules) and `host.ts` (surface, mode, action, selection relay, options, height); unit tests |
| H2 | studio | host surfaces: `PluginCard`, `HostPanel` (Run tab plus plugin tabs, ribbon below 1200 px), `FullShell` (nav collapse, header, modes, chat drawer); `ArtifactMorph` renders from the declaration; v1 mapping |
| H3 | studio | run page = chat: who responded on each turn, the panel B wiring, every SessionView feature in its mapped home (concepts "Run page: where today's features go") |
| H4 | studio | `wicked-page` and `wicked-deck` to protocol 2; deck review becomes the host review capability; the per-kind branches go |
| H5 | studio | MCP inspector to protocol 2 on the run page |
| H4b | studio | `wicked-doc` for `document` (the PageEditor moves; requirement coverage becomes its plugin tab); conformance 1 to 17 |
| H6 | studio | `wicked-video` plugin (the WalkthroughEditor moves), plus the multi-chapter fixture |
| H7 | studio | editor test page shows the three surfaces; the acceptance journey |
| B1 | garden | pack schema `surfaces`, scaffold template v2, conformance cases 13 to 17, skill text |
| B2 | crew | `EditorManifestSchema` and `EditorView` `surfaces`, install conformance, api-types minor |
| E1 | interactive | per-chapter takes and stitching, video theme and caption settings, deck check |

## 11. Failure modes

- An instance fails to start: its surface shows "This part didn't start · Reload it". The other surfaces keep
  working.
- Surfaces mismatch (manifest vs ready): the host refuses v2 and falls back to the v1 mapping, saying so.
- Live-frame cap reached: the oldest card becomes a thumbnail.
- Options for a plugin whose card is gone (the thread scrolled away): the options instance stays. The card's
  thumbnail shows "open in the panel".

## 12. Tests

- **Unit:** parser cases for every new type and every word-rule refusal; host relay (selection, changed, mode);
  the v1 mapping.
- **Conformance:** cases 13 to 17 against the scaffold template, `wicked-page`, `wicked-deck`, `wicked-doc`, the MCP
  inspector and `wicked-video`.
- **Journeys (1440×700, light and dark, screenshots looked at):**
  - run page B: Options adds tabs and the close button removes them;
  - full screen: the nav collapses and returns, Simple/Advanced, the chat drawer;
  - each ported plugin's card;
  - the scaffolded plugin on the test page.
