# Ithilien — Tamper-evident audit trails for AI coding agents

AI agents run autonomously. Compliance frameworks demand explainable logs. Nobody provides them.

Ithilien captures every action an AI coding agent takes — file changes, commands, network requests, policy decisions — links them into a SHA-256 hash chain, associates them with the agent's own reasoning, and produces auditor-ready compliance reports that prove nothing was tampered with after the fact.

[![CI](https://github.com/Arjun2729/ithilien/actions/workflows/ci.yml/badge.svg)](https://github.com/Arjun2729/ithilien/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ithilien.svg)](https://www.npmjs.com/package/ithilien)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<p align="center">
  <img src="./demo.gif" alt="Ithilien demo" width="800">
</p>

## The problem

**EU AI Act Article 12** (effective August 2026) requires high-risk AI systems to maintain immutable logs of every automated decision. **NIST AI RMF** and **OWASP LLM Top 10** both mandate tool invocations with timestamps, decision traceability, and reasoning capture.

Today's AI coding agents — Claude Code, Aider, Codex, Goose — run autonomously and produce no audit trail an external auditor can verify. You get a diff. You don't get:

- A record of *why* each change was made (the agent's reasoning)
- Proof that the record wasn't modified after the run
- Evidence of which guardrails were active and what they blocked
- A portable artifact a compliance team or CI pipeline can independently verify

Ithilien closes this gap.

## What Ithilien produces

For every agent run, Ithilien generates:

- **A tamper-evident audit trail** — SHA-256 hash chain over every session event. Modify any event and verification detects it.
- **A compliance report** — maps each file change to the reasoning that motivated it, the guardrails that were active, and the integrity hash proving the record is authentic.
- **A portable session bundle** — ZIP archive with full session, manifest, diffs, and compliance report. Anyone can verify it, locally or in CI, without Docker.
- **Optional Ed25519 signature** — cryptographic attestation of the session's root hash.

```
  run                  review               verify / export        apply
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐   ┌──────────┐
│ Agent runs   │     │ Audit trail: │     │ Hash chain       │   │ Selective│
│ in Docker    │ ──► │ file changes │ ──► │ verification,    │──►│ apply to │
│ sandbox      │     │ reasoning    │     │ compliance rpt,  │   │ workspace│
│ (optional)   │     │ enforcement  │     │ portable bundle  │   │          │
└──────────────┘     └──────────────┘     └──────────────────┘   └──────────┘
```

## Quick start

```bash
npm install -g ithilien
ithilien init
ithilien run "claude --dangerously-skip-permissions -p 'fix all lint errors'"
```

After the agent finishes:

```bash
ithilien show <session-id>                    # Full audit trail
ithilien compliance-report <session-id>       # Compliance report with reasoning
ithilien verify <session-id>                  # Verify hash chain integrity
ithilien apply <session-id>                   # Apply changes to workspace
```

Export and share:

```bash
ithilien export <session-id>                  # Export as .ithilien-bundle (includes compliance report)
ithilien inspect <bundle>                     # Inspect without importing
ithilien compliance-report <id> --format json # Machine-readable compliance report
```

## Compliance

### EU AI Act Article 12

Article 12 requires high-risk AI systems to automatically log and retain immutable records of every decision, including the reasoning or criteria involved. The logging obligation applies regardless of whether a human is in the loop.

Ithilien addresses this by:

- Recording every file change, command, network request, and policy decision as a tamper-evident event
- Associating each action with the agent's own emitted reasoning (extracted from stdout)
- Attaching a SHA-256 hash chain that makes retroactive modification detectable
- Generating per-session compliance reports with EU AI Act risk classification and retention guidance

The compliance report includes an `euAiActRiskLevel` field (`minimal`, `limited`, `high`) inferred from session characteristics. For production deployments, verify this classification against your own system risk assessment.

### NIST AI RMF alignment

The four NIST AI RMF core functions are all evidenced in every session:

| Function | Evidence |
|----------|---------|
| **GOVERN** | Policy provenance recorded — which rules governed the session, their content hash, and source hierarchy |
| **MAP** | Session context captured — original prompt, agent type, environment fingerprint |
| **MEASURE** | Event counts, timing, reasoning coverage percentage, enforcement stats |
| **MANAGE** | Every allow/deny/ask decision recorded with rule match, risk level, and reason |

### OWASP LLM Top 10

Every tool invocation (file write, command execution, network call) is recorded with a timestamp, the agent context, and the policy outcome. The audit trail is the evidence an OWASP LLM audit requires.

## Features

### Tamper-evident audit trail

Every session event is linked into a SHA-256 hash chain. The chain is verified by replaying it from the event list — no external trust anchor required.

```bash
ithilien verify <id>                   # Terminal output with event breakdown
ithilien verify <id> --format json     # Machine-readable VerificationReport
```

### Reasoning extraction

Ithilien captures agent reasoning at two fidelity levels:

**Structured (sidecar, preferred):** Pass `--reasoning-sidecar` and Ithilien mounts `/tmp/ithilien-reasoning.jsonl` inside the container. Agents write structured events directly:

```json
{"type":"reasoning","content":"The auth token validation is missing expiry checks","intent":"fix security vulnerability","timestamp":"2026-01-01T12:00:00Z"}
```

When `--agent claude` is used alongside `--reasoning-sidecar`, Ithilien automatically appends a system prompt instructing Claude Code to write to the sidecar before each file operation — no manual configuration required.

**Heuristic (stdout parsing, fallback):** When no sidecar data is present, Ithilien parses stdout for Claude Code `<thinking>` blocks, Aider edit rationale, and generic prose reasoning.

The compliance report shows:

```
+ Modified src/auth/validator.ts
    hash: a3f8bc12d7e1...
    why:  [rationale, high] fix security vulnerability: The auth token
          validation is missing expiry checks
```

If the agent emitted no parseable reasoning, the `why` field is empty and `reasoningCoveragePercent` is 0 — which is itself an auditable signal.

### Compliance reports

```bash
ithilien compliance-report <id>               # Terminal summary
ithilien compliance-report <id> --format json # Full JSON artifact
ithilien compliance-report <id> -o report.json
```

The JSON report is the artifact you hand to an auditor. It contains:

- `entries[]` — every auditable event with `what`, `why`, `context`, `eventHash`, `chainHash`, `policyDecision`
- `reasoning` — all extracted reasoning blocks with confidence levels and event associations
- `compliance` — EU AI Act risk level, retention days, NIST RMF functions, framework tags
- `rootHash` + `integrityValid` — cryptographic proof of record authenticity
- `summary` — quick stats including `reasoningCoveragePercent`

Compliance reports are also embedded in exported bundles as `compliance-report.json`.

### Portable bundles

Export sessions as `.ithilien-bundle` ZIP files. Bundles include the full session, manifest, hash chain, diffs, and compliance report. Anyone with Ithilien can inspect and verify them — no Docker required.

```bash
ithilien export <id>
ithilien inspect my-session.ithilien-bundle
```

### CI verification

Verify bundles in any CI system. Pure cryptographic operation, no Docker needed.

```bash
ithilien inspect my-session.ithilien-bundle --format json
ithilien inspect my-session.ithilien-bundle --format summary >> "$GITHUB_STEP_SUMMARY"
```

Exit codes: `0` = valid, `1` = verification failed, `2` = invalid input. See [docs/CI.md](docs/CI.md).

### Sandbox and container runtime

Agents run in Docker containers with configurable guardrails:

- **Filesystem** — workspace isolation, blocked paths (`~/.ssh`, `~/.aws`), protected file patterns (`.env*`, `*.pem`)
- **Network** — `none` (air-gapped), `allowlist` (approved domains only), `full`
- **Resources** — CPU, memory, and session timeout limits

Three built-in profiles: `default` (balanced), `strict` (maximum isolation), `permissive` (minimal restrictions).

#### Runtime comparison

| Runtime | Isolation | Kernel | Recommended |
|---------|-----------|--------|-------------|
| gVisor (runsc) | Syscall interception | Separate (user-space) | **Yes** |
| Docker (runc) | Process/namespace | Shared host | Fallback only |

**gVisor** intercepts every syscall in a user-space kernel (Sentry). The agent process never reaches the host kernel directly, dramatically reducing the kernel attack surface. Recommended for any compliance use case or adversarial-agent scenario.

**Docker (runc)** provides process isolation and namespace separation but shares the host kernel. It stops accidents; it does not protect against an agent that exploits a kernel vulnerability.

Honest limitation: gVisor is not equivalent to a microVM. For maximum isolation on sensitive workloads, Firecracker or Kata Containers are stronger. gVisor is the right default for most teams.

#### Runtime selection

```bash
ithilien init               # Auto-detects gVisor; writes runtime to .ithilien/config.json
ithilien run --runtime gvisor-runsc "..."   # Explicit per-run override
ithilien run --runtime docker-runc "..."    # Force Docker (not recommended)
```

The `runtime` field in `.ithilien/config.json` sets the project default. `--runtime auto` (default) uses gVisor if available.

#### Installing gVisor

```bash
# Linux (quickstart)
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null
sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install    # registers runsc with Docker
sudo systemctl restart docker
```

Full install docs: https://gvisor.dev/docs/user_guide/install/

The sandbox is a feature, not the product. You can run Ithilien with `--no-sandbox` and still get the full audit trail and compliance report.

### Pre-execution policy enforcement

Commands are evaluated against policy rules before execution. Dangerous commands (`rm -rf /`, `git push --force`, `curl | sh`) are blocked. Risky commands prompt for confirmation. Every policy decision is recorded in the audit trail with the rule that matched, risk level, and rationale.

Policy files merge from built-in defaults, global config, project config, and CLI overrides. Every session records the merged policy's content hash for provenance. See [SECURITY.md](SECURITY.md).

### Optional Ed25519 signing

```bash
ithilien keygen                    # Generate signing keypair
```

Once a key exists, sessions are automatically signed. The root hash is signed; verification checks both chain and signature.

## Commands

| Command | Description |
|---------|-------------|
| `ithilien run <cmd>` | Run an agent command (sandboxed or `--no-sandbox`) |
| `ithilien compliance-report <id>` | Generate compliance report with reasoning (`--format json`) |
| `ithilien show <id>` | Show full audit trail for a session |
| `ithilien diff <id>` | Show unified diff of all file changes |
| `ithilien apply <id>` | Apply changes from a session to your workspace |
| `ithilien verify <id>` | Verify integrity of a session (`--format json/summary`) |
| `ithilien export <id>` | Export a session as a `.ithilien-bundle` file |
| `ithilien inspect <file>` | Inspect a bundle without importing (`--format json/summary`) |
| `ithilien import <file>` | Import and verify a `.ithilien-bundle` file |
| `ithilien keygen` | Generate an Ed25519 signing keypair |
| `ithilien log` | List recent sessions |
| `ithilien init` | Initialize Ithilien in the current project |
| `ithilien profiles` | List available guardrail profiles |
| `ithilien agents` | List available agent wrappers |
| `ithilien approve-server` | Start remote approval server for phone-based tool approvals |

## Supported agents

Ithilien works with any CLI agent. The audit layer wraps the command — it doesn't need to understand the agent. Reasoning extraction is agent-aware for Claude Code and Aider; other agents fall back to heuristic prose detection.

| Agent | Example |
|-------|---------|
| Claude Code | `ithilien run "claude --dangerously-skip-permissions -p 'fix tests'"` |
| Aider | `ithilien run "aider --yes-always 'refactor auth module'"` |
| Codex CLI | `ithilien run "codex --full-auto 'add input validation'"` |
| Goose | `ithilien run "goose session start -a 'add error handling'"` |
| Any CLI agent | `ithilien run "<your-agent-command>"` |

### Agent wrappers

The `--agent` flag constructs the shell command from a prompt and records the original prompt for audit purposes.

```bash
ithilien run --agent claude "fix all lint errors"
```

List available wrappers with `ithilien agents`.

## What Ithilien is not

- **Not a semantic monitor.** Ithilien records events and enforces shell-level boundaries. It does not interpret what the agent is doing inside the container.
- **Not equivalent to a microVM, even with gVisor.** gVisor's syscall interception is strong isolation, but it is not Firecracker or Kata Containers. For maximum isolation on the most sensitive workloads, a microVM runtime is stronger. gVisor is the right default for most teams.
- **Not a guarantee against all adversarial agents.** Shell-level guardrails can be bypassed; gVisor significantly raises the bar but is not a complete security boundary. See [SECURITY.md](SECURITY.md).
- **Not a legal compliance solution on its own.** Ithilien provides the technical artifact; compliance programs require organizational policy, risk assessment, and human oversight on top.

## Trust model

The strongest guarantee is **post-hoc integrity** — the hash chain makes retroactive tampering detectable. The weaker guarantee is **in-container behavioral control** — shell-level guardrails are best-effort.

Read [SECURITY.md](SECURITY.md) for the full threat model, trust boundaries, bypass risks, and recommendations.

## Requirements

- [Docker](https://docs.docker.com/get-docker/) (required for sandboxed runs, not needed for `--no-sandbox` or verification)
- Node.js >= 20

## Configuration

Run `ithilien init` to create a `.ithilien/config.json` in your project. Choose from built-in profiles:

- **default** — Balanced safety. Allowlist networking, 4 CPUs, 8 GB memory, 1h timeout.
- **strict** — Maximum isolation. No network, 2 CPUs, 4 GB memory, 30m timeout.
- **permissive** — Minimal restrictions. Full network, 8 CPUs, 16 GB memory, 2h timeout.

Override per-run with `--profile <name>`.

## CI integration

Verify bundles and generate compliance reports in any CI system without Docker.

```bash
npx ithilien inspect my-session.ithilien-bundle --format json
npx ithilien compliance-report <id> --format json -o compliance.json
```

For GitHub Actions job summaries:

```bash
ithilien inspect my-session.ithilien-bundle --format summary >> "$GITHUB_STEP_SUMMARY"
```

See [docs/CI.md](docs/CI.md) for example workflows, patterns, and the CI trust model.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
