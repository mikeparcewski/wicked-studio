/** @vitest-environment node */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

function jobBlock(name: string): string {
  const block = WORKFLOW.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))?.[0];
  expect(block, `job "${name}" is missing from release.yml`).toBeDefined();
  return block!;
}

describe('release.yml certification boundary (studio#1189)', () => {
  it('gates the draft through publish -> registry -> github-release', () => {
    jobBlock('publish');
    expect(jobBlock('registry')).toMatch(/^    needs: publish$/m);
    expect(jobBlock('github-release')).toMatch(/^    needs: registry$/m);
  });

  it('keeps the release cut base and publishes only in the publish job', () => {
    const publish = jobBlock('publish');
    expect(publish).toMatch(/^      TESTID_BASE_REF: HEAD\^1$/m);
    expect(publish).toMatch(/^          fetch-depth: 2$/m);
    expect(publish).toContain('npm publish --access public --provenance');
    expect(publish).not.toMatch(/gh release|npm view|serve_probe/);
    expect(jobBlock('registry')).not.toContain('npm publish');
    expect(jobBlock('github-release')).not.toContain('npm publish');
  });

  it('waits for the exact served version with bounded, uncached lookups', () => {
    const registry = jobBlock('registry');
    expect(registry).toContain('VERSION="${GITHUB_REF_NAME#v}"');
    expect(registry).toContain('timeout 60 npm view --prefer-online "wicked-studio@${VERSION}" version');
    expect(registry).toMatch(/if served="\$\(timeout 60 npm view[^\n]+\)"\s*\\?\s*&& \[ "\$served" = "\$VERSION" \]; then/);
    expect(registry).toMatch(/then\s+echo [^\n]+\n\s+break/);
    expect(registry).toMatch(/^\s+sleep 30$/m);
  });

  it('fails after a deadline of at least five minutes and explains safe reruns', () => {
    const registry = jobBlock('registry');
    expect(registry).toContain('started="$(date +%s)"');
    const minutes = registry.match(/deadline=\$\(\( started \+ (\d+) \* 60 \)\)/)?.[1];
    expect(Number(minutes)).toBeGreaterThanOrEqual(5);
    expect(registry).toMatch(/if \[ "\$now" -ge "\$deadline" \]; then\s+echo "::error::[^\n]+\n\s+exit 1\s+fi/);
    expect(registry).toContain('publish job succeeded');
    expect(registry).toContain('re-run failed jobs');
    expect(registry).toContain('never the publish job');
    expect(registry).toContain('EPUBLISHCONFLICT');
    expect(registry).not.toMatch(/continue-on-error|::warning::/);
  });

  it('creates only a draft and leaves existing releases alone', () => {
    const release = jobBlock('github-release');
    expect(release).toContain('uses: actions/checkout@');
    expect(release).toContain('GH_TOKEN: ${{ github.token }}');
    expect(release).toMatch(/if gh release view "\$TAG"[^\n]+; then\s+echo "[^\n]+draft or published[^\n]+"\s+exit 0\s+fi/);
    expect(release.indexOf('gh release view')).toBeLessThan(release.indexOf('python3 scripts/changelog-section.py'));
    const create = release.match(/^\s+gh release create [^\n]+/m)?.[0];
    expect(create).toBeDefined();
    expect(create).toContain('"$TAG" --draft --verify-tag --title "$TAG" --notes-file "$RUNNER_TEMP/relnotes.md"');
    expect(release).not.toMatch(/--latest|--draft=false|gh release edit/);
  });

  it('uses generic notes only for a missing CHANGELOG section', () => {
    const release = jobBlock('github-release');
    expect(release).toContain('python3 scripts/changelog-section.py "$TAG" > "$RUNNER_TEMP/relnotes.md"');
    expect(release).toMatch(/set \+e\s+python3[^\n]+\n\s+code=\$\?\s+set -e/);
    expect(release).toMatch(/if \[ "\$code" -eq 1 \]; then\s+printf 'Release %s\\n' "\$TAG" > "\$RUNNER_TEMP\/relnotes.md"\s+echo "::warning::/);
    expect(release).toMatch(/elif \[ "\$code" -ne 0 \]; then\s+echo "::error::[^\n]+\n\s+exit "\$code"/);
  });

  it('grants release writes only to github-release and OIDC only to publish', () => {
    expect(WORKFLOW).toMatch(/^permissions:\n  contents: read\n/m);
    expect(WORKFLOW.match(/^\s+contents: write\b/gm)).toHaveLength(1);
    expect(jobBlock('github-release')).toMatch(/^    permissions:\n      contents: write\b/m);
    expect(WORKFLOW.match(/^\s+id-token: write\b/gm)).toHaveLength(1);
    expect(jobBlock('publish')).toMatch(/^    permissions:\n      contents: read\n      id-token: write\b/m);
    expect(jobBlock('registry')).not.toMatch(/contents: write|id-token: write/);
  });
});
