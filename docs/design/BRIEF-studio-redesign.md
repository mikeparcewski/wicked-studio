# Design brief: wicked-studio. One studio, two states of mind, governed throughout

(Operator direction, 2026-09-27. The first dogfood run designs this.)

## Who the user is
A forward-deployed engineer who manages an agent team. Their job is to make sure the agents are high performers: cost-effective, high quality, and always improving. They also make things WITH the team: RFPs, points of view, architecture, process redesigns, demos, code.

## What human behaviour demands
- Working memory holds about 4 things; even strong performers hit context overload.
- Every switch leaves attention residue, and interrupts cost more than the decisions they bring.
- Repeated decisions wear judgment down, so turn repeated decisions into policies.
- Trust comes from track record: verify where it hasn't been earned, stand back where it has.
- Managers don't operate the work. They set goals and standards, watch a few vital signs, handle exceptions, and improve the system.
- Creative work needs flow: the work fills the screen, collaborators work alongside, interruptions wait at the edge.

## The two states of mind
1. **Making (flow).** The work itself is the centre: a canvas of documents, diagrams, boards, demo cuts and code. You set direction, the team brings drafts and options, you pick and shape, they refine. Build things by talking or by pointing. Everything else goes quiet; only true breaks come through, and they wait at the edge.
2. **Managing (short and deliberate).** Three questions, nothing more:
   - Is the team performing? A few vital signs against targets: quality (first-pass acceptance, rework, escaped defects), cost per outcome, speed, trend. Drill down by seat, skill or work kind only when a sign is off.
   - What needs my judgment? A few batched items, each with a recommendation. Each decision can become a rule.
   - What should change? Improvement proposals learned from outcomes (routing, skills, steering rules, budgets). Accept or reject.
3. **The crossings are designed too.** Going in: where this piece stands. Coming out: what the team did and what waits. Standing orders cover the time in between.

## Governance, all through it
- Making: governance runs in the background. Steering rules apply by default, the evaluator is never the creator, and nothing leaves without the deliver gate. Each piece shows its provenance: which agent made it, which rules checked it, and the evidence. Governance shows up only when it stops or changes something, and says why in one line.
- Managing: governance is a vital sign. What the rules caught, gaps, and rules that cost more than they're worth. Improvement means changing policy: steering rules proposed and retired, routing and budgets. Every change is audited.
- The human's own decisions and standing orders are governed too: recorded, bounded (an order never answers the deliver gate), and auditable.

## What stays available, one step down
Plans and the fleet of runs, the gates, members and council, raw events, terminals and worktrees, config. The orchestrator detail exists for when you dig in; it's never the default view.

## Inputs
- The prior design exploration: the orchestrator console, judged 136/160, too busy as a primary surface. See docs/design/orchestrator-console.md and its 108-row capability inventory. Every capability still needs a home.
- The ten behaviours already built (handover, dark when healthy, peek/jump/back, ranked queue, undo, raw in one step, switch brief, capture, outbound, standing orders). Skins sit over one behaviour layer.

## Deliverables
- A spec: the two states and the crossings, the three management questions with their exact vital signs and data sources, how governance appears, where every capability lives, and a behaviour-first build plan.
- A clickable local prototype.
- Visual restraint. Calm is the feature.
