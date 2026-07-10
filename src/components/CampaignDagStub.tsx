/**
 * PLACEHOLDER — Campaign DAG view (DES-STUDIO-001 §4.3, DES-CAMPAIGN-001 §11.11).
 *
 * Deliberately not built: core has no `Campaign` primitive, no `LaunchCampaign`
 * command, and no `Campaign*` / `RunFinished` CoreEvents yet (grep: zero hits in
 * wicked-core). The DAG view attaches to the SAME WS plumbing when those additive
 * CoreEvent variants land — the event switch already tolerates unknown types, so
 * this arrives with zero rework. No fabricated data.
 */
export function CampaignDagStub(): React.ReactElement {
  return (
    <div
      data-testid="campaign-dag-stub"
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-400"
    >
      <p className="font-semibold text-gray-500">Campaign DAG — engine-real, not wired</p>
      <p className="mt-1">
        Pending core&apos;s <code>Campaign</code> primitive + <code>RunFinished</code> /{' '}
        <code>Campaign*</code> events (§4.3). Attaches to this same event stream when they land.
      </p>
    </div>
  );
}
