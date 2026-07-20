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
      className="rounded-lg p-4 text-xs"
      style={{ border: '1px dashed rgba(230,237,243,0.15)', background: '#161c26', color: 'rgba(230,237,243,0.4)' }}
    >
      <p className="font-semibold" style={{ color: 'rgba(230,237,243,0.6)' }}>Campaign DAG — engine-real, not wired</p>
      <p className="mt-1">
        Pending core&apos;s <code className="font-mono">Campaign</code> primitive + <code className="font-mono">RunFinished</code> /{' '}
        <code className="font-mono">Campaign*</code> events (§4.3). Attaches to this same event stream when they land.
      </p>
    </div>
  );
}
