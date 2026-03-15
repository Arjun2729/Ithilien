# .ithilien-bundle Format Specification

## Overview

An `.ithilien-bundle` is a ZIP archive containing a self-contained, verifiable record of an Ithilien session. Bundles are portable: they can be exported from one machine, transferred, and imported on another for independent verification.

## Format Version

Current: `1`

## Archive Contents

| Entry | Required | Description |
|-------|----------|-------------|
| `metadata.json` | Yes | Bundle metadata (format version, bundler version, session ID, manifest copy) |
| `session.json` | Yes | Complete session data including all events |
| `manifest.json` | Yes | Session manifest (hash chain, fingerprint, signature, policy context) |
| `diffs/` | No | Individual file diffs as `.patch` files |

### metadata.json

```json
{
  "formatVersion": 1,
  "bundledAt": "2026-01-15T10:30:00.000Z",
  "bundledBy": "0.1.0",
  "sessionId": "abc123def456",
  "manifest": { "..." }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `formatVersion` | `1` | Bundle format version |
| `bundledAt` | string | ISO 8601 timestamp of when the bundle was created |
| `bundledBy` | string | Ithilien version that created the bundle |
| `sessionId` | string | Session identifier (nanoid, 12 chars) |
| `manifest` | object | Copy of the full SessionManifest |

### session.json

The full `Session` object as stored in `~/.ithilien/sessions/{id}.json`. Includes all events:

- `command_start` / `command_end` — lifecycle
- `file_created` / `file_modified` / `file_deleted` — filesystem changes (with optional diffs)
- `network_request` — outbound network activity
- `package_installed` — package manager operations
- `guardrail_triggered` — enforcement actions
- `policy_decision` — policy evaluation results (action, risk, category, rule, source, reason)
- `stdout` / `stderr` — process output

### manifest.json

The `SessionManifest` object containing:

| Field | Type | Description |
|-------|------|-------------|
| `version` | `1` | Manifest version |
| `sessionId` | string | Session identifier |
| `rootHash` | string | SHA-256 of all concatenated chain hashes |
| `eventCount` | number | Total number of events |
| `firstEventAt` | string | ISO 8601 timestamp of first event |
| `lastEventAt` | string | ISO 8601 timestamp of last event |
| `fingerprint` | object | Environment fingerprint (Docker image, profile, network mode, etc.) |
| `eventHashes` | array | Complete hash chain (eventHash, previousHash, chainHash per event) |
| `policyContext` | object? | Policy provenance (sources, merged policy hash, engine version) |
| `signature` | string? | Base64-encoded Ed25519 signature over the root hash |
| `publicKey` | string? | PEM-encoded Ed25519 public key |

#### policyContext

Present when the session was run with policy enforcement (Ithilien >= 0.2.0).

| Field | Type | Description |
|-------|------|-------------|
| `sources` | string[] | Policy sources that contributed rules (e.g., `["default-policy", "project-policy"]`) |
| `policyHash` | string | SHA-256 of the merged PolicyFile (deterministic JSON serialization) |
| `policyPath` | string? | Explicit `--policy` path, if used |
| `engineVersion` | string | Ithilien version that ran the policy engine |

### diffs/

Numbered patch files extracted from file modification events:

```
diffs/0001-src-auth-ts.patch
diffs/0002-package-json.patch
```

File names are sanitized: non-alphanumeric characters are replaced with hyphens. Only events with `type` in `[file_created, file_modified, file_deleted]` that have a `diff` field produce patch entries.

## Hash Chain

Each event is hashed independently, then chained:

```
Event 0 → eventHash0 + genesis(64 zeros) → chainHash0
Event 1 → eventHash1 + chainHash0         → chainHash1
Event 2 → eventHash2 + chainHash1         → chainHash2
...
rootHash = SHA-256(chainHash0 + chainHash1 + chainHash2 + ...)
```

- `eventHash`: SHA-256 of `JSON.stringify(event, sortedKeys)`
- `chainHash`: SHA-256 of `eventHash + previousChainHash`
- `rootHash`: SHA-256 of all `chainHash` values concatenated

## Verification

When importing a bundle, Ithilien:

1. Extracts `session.json` and ensures `manifest.json` is attached
2. Verifies event count matches `manifest.eventCount`
3. Replays the hash chain from genesis, comparing each `chainHash`
4. Computes root hash and compares against `manifest.rootHash`
5. Verifies Ed25519 signature if present
6. Rejects the bundle if any check fails

## Field Provenance

Fields in the manifest, report, and bundle are classified by how they are verified:

### Cryptographically verified

These fields are bound to the hash chain or signature. Tampering is detectable.

| Field | Binding |
|-------|---------|
| `manifest.rootHash` | SHA-256 of all concatenated chain hashes |
| `manifest.eventHashes[].chainHash` | SHA-256 of eventHash + previous chainHash |
| `manifest.eventHashes[].eventHash` | SHA-256 of deterministic JSON of each event |
| `manifest.signature` | Ed25519 over rootHash (when present) |
| `manifest.eventCount` | Verified by chain replay (count must match events) |

### Runtime-reported

These fields are recorded by the host-side logger during execution. They are covered by the hash chain *after recording* — modification is detectable, but the original recording is trusted.

| Field | Source |
|-------|--------|
| `manifest.fingerprint.*` | Docker image ID/tag, host OS, Node version, guardrail profile |
| `manifest.policyContext.*` | Policy sources, merged policy hash, engine version, hash algorithm |
| `session.events[]` | All events (commands, file changes, network, policy decisions) |
| `session.status` | Session outcome (completed, failed, denied, etc.) |
| `session.exitCode` | Process exit code |

### Informational metadata

These fields provide context but are not cryptographically bound. They can be set freely by the bundle creator.

| Field | Purpose |
|-------|---------|
| `metadata.formatVersion` | Bundle format version (for consumer compatibility) |
| `metadata.bundledAt` | When the bundle was created |
| `metadata.bundledBy` | Ithilien version that created the bundle |
| `manifest.version` | Manifest schema version |
| `report.schemaVersion` | Verification report schema version |
| `policyContext.hashAlgorithm` | Algorithm used for policy content hashing |

## Trust Assumptions

1. **The bundle creator is trusted to have recorded events honestly.** The hash chain proves events were not modified *after recording*. It does not prove the recording was complete or faithful.

2. **Signature proves key custody, not identity.** An Ed25519 signature proves the holder of the private key attested to the root hash. There is no PKI, certificate chain, or identity binding.

3. **Policy context is self-reported.** The `policyContext` in the manifest records which policy the session *claims* to have used. A malicious bundle creator could fabricate this. To verify policy compliance, the verifier must independently know the expected policy hash and compare.

4. **Bundle integrity relies on ZIP format.** No additional encryption or MAC is applied to the ZIP archive itself. The hash chain inside provides content integrity. Transport-level encryption (HTTPS, encrypted storage) is the user's responsibility.

5. **Denied sessions are valid.** A session with status `denied` is a legitimate audit record. The hash chain covers the denial events (`policy_decision`, `guardrail_triggered`). Verification of a denied session should succeed.
