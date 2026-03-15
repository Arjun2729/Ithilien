# CI Integration

Ithilien bundles can be verified in any CI system. Verification is a pure cryptographic operation — it replays the SHA-256 hash chain and checks the optional Ed25519 signature. No Docker is required.

## Assumptions

These example workflows and commands assume:

- **Node.js >= 20** is available in the CI environment.
- **Ithilien is published to npm** (`npm install -g ithilien` works). If not yet published, build from source: `git clone && pnpm install && pnpm build && node dist/cli.js inspect ...`.
- **The `.ithilien-bundle` file already exists** — either committed to the repo or uploaded as an artifact by a prior job.
- **Repository is checked out** (for committed-bundle workflows).
- **`jq` is available** for JSON-parsing patterns (pre-installed on GitHub-hosted runners).

## Quick Start

```bash
# If published to npm:
npm install -g ithilien

# If building from source:
git clone https://github.com/Arjun2729/ithilien.git
cd ithilien && pnpm install && pnpm build
alias ithilien="node $(pwd)/dist/cli.js"

# Verify a bundle (exits 0/1/2):
ithilien inspect my-session.ithilien-bundle --format json
```

Exit code `0` means the bundle is intact. Exit code `1` means verification failed. Exit code `2` means invalid input (file not found, malformed bundle).

## Output Formats

| Format | Flag | Use case |
|--------|------|----------|
| Terminal | `--format terminal` (default) | Local inspection with colored output |
| JSON | `--format json` | Machine-readable for CI scripts and tooling |
| Summary | `--format summary` | Markdown for GitHub Actions `$GITHUB_STEP_SUMMARY` |

## Exit Codes

| Code | Meaning | CI behavior |
|------|---------|-------------|
| 0 | Verification passed | Step succeeds |
| 1 | Verification failed (chain broken, signature invalid) | Step fails |
| 2 | Invalid input (file not found, malformed bundle) | Step fails |

## GitHub Actions

Copy one of the example workflows into your `.github/workflows/` directory:

### Committed bundles

Use [`examples/verify-bundle.yml`](../examples/verify-bundle.yml) when you commit `.ithilien-bundle` files to your repository. The workflow triggers on push/PR when bundle files change.

```yaml
# .github/workflows/verify-bundle.yml
# See examples/verify-bundle.yml for the full workflow
```

### Artifact bundles

Use [`examples/verify-artifact.yml`](../examples/verify-artifact.yml) as a reusable workflow when the bundle is produced by one job and verified by another.

```yaml
jobs:
  agent:
    runs-on: ubuntu-latest
    steps:
      # Run agent and export the session
      - run: ithilien run "claude -p 'fix tests'"
      # Replace <session-id> with the actual session ID from the run output
      - run: ithilien export <session-id>
      - uses: actions/upload-artifact@v4
        with:
          name: ithilien-bundle
          path: '*.ithilien-bundle'

  verify:
    needs: agent
    uses: ./.github/workflows/verify-artifact.yml
    with:
      artifact_name: ithilien-bundle
      # Replace with the actual bundle filename
      bundle_filename: session-<id>.ithilien-bundle
```

### Job summaries

Both workflows write a Markdown summary to `$GITHUB_STEP_SUMMARY`:

```bash
ithilien inspect my-bundle.ithilien-bundle --format summary >> "$GITHUB_STEP_SUMMARY"
```

The summary includes session status, integrity result, signature status, event breakdown, and policy context.

## Patterns

### Signed bundles

If you sign sessions with `ithilien keygen`, the verification report includes signature status. To enforce signatures in CI:

```bash
REPORT=$(ithilien inspect my-bundle.ithilien-bundle --format json)
SIGNED=$(echo "$REPORT" | jq -r '.signature.valid')
if [ "$SIGNED" != "true" ]; then
  echo "Bundle is not signed or signature is invalid"
  exit 1
fi
```

### Policy hash comparison

To verify a session ran under a specific policy, compare the `policy.policyHash` field against a known-good value:

```bash
REPORT=$(ithilien inspect my-bundle.ithilien-bundle --format json)
POLICY_HASH=$(echo "$REPORT" | jq -r '.policy.policyHash')
EXPECTED="abc123def456..."
if [ "$POLICY_HASH" != "$EXPECTED" ]; then
  echo "Session ran under unexpected policy: $POLICY_HASH"
  exit 1
fi
```

### Denied session detection

Sessions blocked by policy enforcement have `sessionStatus: "denied"`. To detect this:

```bash
REPORT=$(ithilien inspect my-bundle.ithilien-bundle --format json)
STATUS=$(echo "$REPORT" | jq -r '.sessionStatus')
if [ "$STATUS" = "denied" ]; then
  echo "Session was denied by policy"
  # This is informational — denied sessions still verify as intact
fi
```

## Local-to-CI Workflow

A typical end-to-end flow:

1. **Run the agent locally:**
   ```bash
   ithilien run "claude --dangerously-skip-permissions -p 'add input validation'"
   ```

2. **Review the session:**
   ```bash
   ithilien show <session-id>
   ithilien verify <session-id>
   ```

3. **Export the bundle:**
   ```bash
   ithilien export <session-id>
   ```

4. **Commit the bundle to your repo:**
   ```bash
   git add session-<id>.ithilien-bundle
   git commit -m "Add agent session evidence"
   ```

5. **CI verifies automatically** via the workflow file.

6. **Team members can inspect locally:**
   ```bash
   ithilien inspect session-<id>.ithilien-bundle
   ```

## Other CI Systems

Ithilien works with any CI system that supports Node.js. The general pattern:

```bash
# Install (if published to npm)
npm install -g ithilien

# Verify (exits 0/1/2)
ithilien inspect path/to/bundle.ithilien-bundle --format json

# Optionally save the report
ithilien inspect path/to/bundle.ithilien-bundle --format json > report.json
```

## Local Smoke Test

A smoke-test script is included at [`scripts/ci-smoke-test.sh`](../scripts/ci-smoke-test.sh). It simulates the CI verification flow locally:

```bash
./scripts/ci-smoke-test.sh
```

The script builds the project, creates a test bundle, runs `inspect` in all three output formats, and verifies exit codes. No Docker or external services are required.

## Trust Model

CI verification proves:

- **Tamper evidence:** The hash chain confirms events were not modified after recording.
- **Signature attestation:** If signed, the operator who held the private key attested to the session integrity.
- **Policy provenance:** The report records which policy governed the session and its content hash.

CI verification does **not** prove:

- **Faithful recording:** The host-side logger is trusted. A compromised host could omit events before hashing.
- **Policy compliance:** The policy hash is self-reported. A verifier must independently know the expected hash to confirm the correct policy was used.
- **Execution environment:** The environment fingerprint (Docker image, OS, etc.) is runtime-reported metadata. It is covered by the hash chain but relies on honest recording.

See [SECURITY.md](../SECURITY.md) and [BUNDLE-FORMAT.md](BUNDLE-FORMAT.md) for the full trust model and field provenance classification.
