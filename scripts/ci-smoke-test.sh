#!/usr/bin/env bash
# CI smoke test for Ithilien bundle verification.
#
# Simulates the CI verification flow locally:
#   1. Builds the project
#   2. Creates a test bundle using the library
#   3. Runs inspect in all three output formats
#   4. Verifies exit codes
#
# Requirements: Node.js >= 20, pnpm
# No Docker or external services required.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLI="node $PROJECT_DIR/dist/cli.js"
TMPDIR=$(mktemp -d)
BUNDLE="$TMPDIR/test-session.ithilien-bundle"
PASSED=0
FAILED=0

cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

pass() {
  echo "  PASS: $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "  FAIL: $1"
  FAILED=$((FAILED + 1))
}

echo ""
echo "Ithilien CI Smoke Test"
echo "======================"
echo ""

# Step 1: Build
echo "Building project..."
cd "$PROJECT_DIR"
pnpm build --silent 2>/dev/null || pnpm build
echo ""

# Step 2: Create a test bundle using a Node.js helper
echo "Creating test bundle..."
BUNDLE_PATH="$BUNDLE" node --input-type=module <<'NODESCRIPT'
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';

const bundlePath = process.env.BUNDLE_PATH;

// Build a minimal valid session with hash chain
const events = [
  { type: 'command_start', timestamp: '2026-01-01T00:00:00.000Z', command: 'echo test' },
  { type: 'file_created', timestamp: '2026-01-01T00:01:00.000Z', path: 'hello.txt', size: 5 },
  { type: 'command_end', timestamp: '2026-01-01T00:05:00.000Z', exitCode: 0 },
];

// Compute hash chain
function hashEvent(event) {
  const keys = Object.keys(event).sort();
  const content = JSON.stringify(event, keys);
  return createHash('sha256').update(content).digest('hex');
}

let previousHash = '0'.repeat(64);
const eventHashes = events.map((event, i) => {
  const eventHash = hashEvent(event);
  const chainHash = createHash('sha256').update(eventHash + previousHash).digest('hex');
  const result = { eventIndex: i, eventHash, previousHash, chainHash };
  previousHash = chainHash;
  return result;
});

const allChainHashes = eventHashes.map(e => e.chainHash).join('');
const rootHash = createHash('sha256').update(allChainHashes).digest('hex');

const fingerprint = {
  dockerImageId: 'sha256:smoketest',
  dockerImageTag: 'ithilien/sandbox:latest',
  agentCommand: 'echo test',
  hostOS: 'darwin-arm64',
  nodeVersion: process.version,
  ithilienVersion: '0.1.0',
  guardrailProfile: 'default',
  profileHash: 'a'.repeat(64),
  networkMode: 'none',
  networkAllowlist: [],
  capturedAt: '2026-01-01T00:00:00.000Z',
};

const manifest = {
  version: 1,
  sessionId: 'smoke-test-001',
  rootHash,
  eventCount: events.length,
  firstEventAt: events[0].timestamp,
  lastEventAt: events[events.length - 1].timestamp,
  fingerprint,
  eventHashes,
};

const session = {
  id: 'smoke-test-001',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:05:00.000Z',
  status: 'completed',
  command: 'echo test',
  profile: 'default',
  projectPath: '/tmp/project',
  exitCode: 0,
  events,
  manifest,
};

const metadata = {
  formatVersion: 1,
  bundledAt: new Date().toISOString(),
  bundledBy: '0.1.0',
  sessionId: session.id,
  manifest,
};

const zip = new AdmZip();
zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)));
zip.addFile('session.json', Buffer.from(JSON.stringify(session, null, 2)));
zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
zip.writeZip(bundlePath);

console.log('Bundle created at: ' + bundlePath);
NODESCRIPT

echo ""

# Step 3: Test inspect --format json
echo "Testing: inspect --format json"
if $CLI inspect "$BUNDLE" --format json > "$TMPDIR/report.json" 2>&1; then
  # Check that the output is valid JSON with expected fields
  if node -e "const r = JSON.parse(require('fs').readFileSync('$TMPDIR/report.json','utf8')); if (!r.valid || !r.schemaVersion || !r.sessionId) process.exit(1);" 2>/dev/null; then
    pass "inspect --format json exits 0 and produces valid JSON with schemaVersion"
  else
    fail "inspect --format json output missing expected fields"
  fi
else
  fail "inspect --format json exited non-zero"
fi

# Step 4: Test inspect --format summary
echo "Testing: inspect --format summary"
if $CLI inspect "$BUNDLE" --format summary > "$TMPDIR/summary.md" 2>&1; then
  if grep -q "## Ithilien Verification Report" "$TMPDIR/summary.md" && grep -q "| Integrity | Pass |" "$TMPDIR/summary.md"; then
    pass "inspect --format summary exits 0 and produces Markdown with Pass"
  else
    fail "inspect --format summary output missing expected Markdown"
  fi
else
  fail "inspect --format summary exited non-zero"
fi

# Step 5: Test inspect --format terminal
echo "Testing: inspect --format terminal"
if $CLI inspect "$BUNDLE" > /dev/null 2>&1; then
  pass "inspect --format terminal exits 0"
else
  fail "inspect --format terminal exited non-zero"
fi

# Step 6: Test exit code 2 for missing file
echo "Testing: inspect exits 2 for missing file"
set +e
$CLI inspect "$TMPDIR/nonexistent.ithilien-bundle" --format json > /dev/null 2>&1
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -eq 2 ]; then
  pass "inspect exits 2 for missing file"
else
  fail "inspect exited $EXIT_CODE for missing file (expected 2)"
fi

# Step 7: Test no ANSI codes in summary output
echo "Testing: summary has no ANSI escape codes"
if grep -P '\x1b\[' "$TMPDIR/summary.md" > /dev/null 2>&1; then
  fail "summary output contains ANSI escape codes"
else
  pass "summary output has no ANSI escape codes"
fi

# Step 8: Test JSON report has bundle section
echo "Testing: JSON report has bundle section"
if node -e "const r = JSON.parse(require('fs').readFileSync('$TMPDIR/report.json','utf8')); if (!r.bundle || !r.bundle.formatVersion) process.exit(1);" 2>/dev/null; then
  pass "JSON report includes bundle metadata"
else
  fail "JSON report missing bundle section"
fi

# Summary
echo ""
echo "Results: $PASSED passed, $FAILED failed"
echo ""

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
