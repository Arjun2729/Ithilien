# Security Model

Ithilien is an execution firewall and evidence layer for AI coding agents. This document describes its trust model, security properties, and known limitations.

## Threat Model

### What Ithilien protects against

1. **Accidental destructive actions** — Policy rules detect and block common dangerous commands (`rm -rf`, `git push --force`, `curl | sh`, etc.) before execution.
2. **Post-hoc tampering of audit trails** — SHA-256 hash chains make any modification to recorded events immediately detectable during verification.
3. **Unauthorized network access** — Network allowlist mode restricts outbound connections to approved domains using DNS pre-resolution and iptables rules.
4. **Credential exposure** — Sensitive directories (`~/.ssh`, `~/.aws`, `~/.gnupg`) are blocked from container mounts. Protected file patterns detect modifications to `.env`, `.pem`, and key files.
5. **Resource abuse** — CPU, memory, and time limits prevent runaway processes.

### What Ithilien does NOT protect against

1. **Determined adversarial agents** — A sophisticated agent running inside the container can potentially bypass shell-level guardrails. Policy enforcement via shell function override (e.g., the `git` wrapper) can be circumvented by calling the binary directly (`/usr/bin/git`).
2. **Docker escape** — Ithilien relies on Docker's isolation. It does not add additional kernel-level sandboxing (no seccomp profiles, no user namespace remapping beyond non-root).
3. **Data exfiltration via allowed channels** — If an agent has network access to allowed domains, it can send data to those domains. The allowlist controls *where* traffic goes, not *what* is sent.
4. **Side-channel attacks** — No protection against timing, cache, or other side-channel attacks.
5. **Malicious policy files** — Policy files are trusted input. A compromised policy file can weaken all protections.

## Trust Boundaries

```
┌─────────────────────────────────────────────────────┐
│                 Host Machine (Trusted)               │
│                                                     │
│  Operator controls:                                 │
│  - Policy file selection                            │
│  - Profile selection                                │
│  - Signing key custody                              │
│  - Which sessions to trust                          │
│                                                     │
│  ┌─────────────────────────────────────────────────┐ │
│  │          Docker Container (Untrusted)           │ │
│  │                                                 │ │
│  │  Agent runs here with:                          │ │
│  │  - Limited filesystem (volume + blocked paths)  │ │
│  │  - Limited network (none/allowlist/full)        │ │
│  │  - Resource caps (CPU, memory, timeout)         │ │
│  │  - Shell-level guardrails (best-effort)         │ │
│  │                                                 │ │
│  └─────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─────────────────────────────────────────────────┐ │
│  │          Integrity Layer (Evidence)             │ │
│  │                                                 │ │
│  │  - Events recorded by host-side logger          │ │
│  │  - Hash chain computed after session ends       │ │
│  │  - Manifest signed with operator's Ed25519 key  │ │
│  │  - Verification replays chain independently     │ │
│  │                                                 │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Security Properties

### Tamper evidence (hash chain)

**Claim:** If any event in a session is modified, added, or removed after recording, verification will detect it.

**Mechanism:** Each event is hashed with SHA-256. A chain hash links each event to its predecessor (genesis = 64 zero bytes). The root hash covers all chain hashes. Verification replays the entire chain and compares.

**Caveat:** This proves events weren't modified *after recording*. It does not prove the recording itself was complete or honest. The host-side logger is trusted.

### Signature integrity (Ed25519)

**Claim:** A signed manifest proves the operator who held the private key attested to the root hash at signing time.

**Mechanism:** Ed25519 signature over the root hash string, using PKCS8/SPKI PEM key format via Node.js crypto.

**Caveat:** Key custody is the operator's responsibility. Ithilien stores private keys at `~/.ithilien/signing-key` with 0600 permissions. There is no key rotation, revocation, or certificate chain. A compromised key invalidates all signatures made with it.

### Policy provenance (manifest.policyContext)

**Claim:** The manifest records which policy governed the session, including the merged policy hash, contributing sources, and engine version.

**Mechanism:** Before execution, the merged PolicyFile is hashed with SHA-256 using deterministic JSON serialization (recursive sorted keys). The hash, source list, optional explicit policy path, and Ithilien version are stored in `manifest.policyContext`.

**Caveat:** The policy context is self-reported by the session creator. A verifier must independently know the expected policy hash to confirm the session was governed by the correct policy. Ithilien does not enforce policy hash matching during verification — it only records what was used.

### Field provenance

**Claim:** Every field in the manifest and verification report is classified by how it is verified, so auditors can distinguish cryptographic proof from self-reported data.

**Mechanism:** Fields are classified into three tiers:
1. **Cryptographically verified** — bound to the hash chain or Ed25519 signature (rootHash, eventHashes, signature, eventCount).
2. **Runtime-reported** — recorded by the host-side logger and covered by the hash chain after recording (fingerprint, policyContext, events, session status).
3. **Informational metadata** — not cryptographically bound (formatVersion, bundledAt, schemaVersion).

**Caveat:** Runtime-reported fields prove events weren't modified *after recording*, but do not prove the recording was honest. The host-side logger and the session creator are trusted. See [BUNDLE-FORMAT.md](docs/BUNDLE-FORMAT.md) for the full provenance table.

### Pre-execution policy enforcement

**Claim:** The policy engine evaluates every command *before* execution. Commands matching `deny` rules are blocked and never run. Commands matching `ask` rules require explicit human approval.

**Mechanism:**
1. Policy is loaded from built-in defaults, global (~/.ithilien/policy.json), and project (.ithilien/policy.json) sources, or from an explicit `--policy` path.
2. The command string is normalized (trim + collapse whitespace) and matched against regex patterns in first-match-wins order.
3. Each command rule specifies an action (allow/deny/ask/log), risk level, and category.
4. A `policy_decision` event is emitted into the audit trail for every evaluated command, including the action, risk, matched rule, source, and reason.
5. For `deny`: execution is blocked before any container or process is started. The session is saved with status `denied`.
6. For `ask`: if running interactively (TTY), the user is prompted. If non-interactive, the command fails closed (denied).
7. For `allow`/`log`: execution proceeds normally. `log` additionally prints a notice.

**Enforcement guarantees:**
- A denied command never executes. The denial is recorded in the audit trail.
- An `ask` command in a non-interactive context (CI, piped stdin) is always denied. This is fail-closed behavior.
- Policy evaluation happens on the host side, before Docker container creation. It cannot be bypassed from within the container.

**What is NOT enforced:**
- `paths` and `network` rules are defined in the schema but not yet evaluated. If present in a policy file, a warning is printed.
- Policy only evaluates the top-level command passed to `ithilien run`. It does not intercept sub-commands or shell operations within the container. For in-container enforcement, the shell-wrapper guardrails (Phase 1) still apply.

**Caveat:** Pattern matching is heuristic. Commands can be obfuscated to bypass detection (e.g., base64-encoded strings, variable interpolation, indirect execution via `bash -c`). Policy enforcement is a speed bump for the top-level command, not a comprehensive security boundary.

### Command normalization

Before pattern matching, the command string is normalized by:
- Trimming leading/trailing whitespace
- Collapsing runs of whitespace to a single space

What is explicitly NOT normalized (by design):
- Shell expansion (`$VAR`, `$(cmd)`, backticks)
- Alias resolution
- Path resolution (`/usr/bin/git` vs `git`)
- Quoting or escaping

This means `rm  -rf` and `rm -rf` match the same patterns, but `"rm" "-rf"` or `$RM -rf` will not match the `rm` patterns.

### Container isolation (Docker)

**Claim:** The agent process runs in an isolated environment with controlled filesystem, network, and resource access.

**Mechanism:** Docker containers with volume isolation, network modes (none/allowlist/full), blocked path exclusion, resource limits (CPU, memory, timeout).

**Caveat:** Docker isolation depends on the host kernel. Ithilien does not add seccomp profiles, AppArmor policies, or user namespace remapping. The `CAP_NET_ADMIN` capability is granted in allowlist mode (required for iptables), which expands the container's privileges. Container escape vulnerabilities in Docker would bypass all isolation.

## Known Bypass Risks

1. **Git shell override bypass:** The git policy enforcement overrides `git` as a bash function. Calling `/usr/bin/git` directly, or using a different shell, bypasses this.

2. **Network allowlist bypass:** A process can connect to IP addresses directly, bypassing DNS-based restrictions. The iptables rules mitigate this, but only for resolved allowlist IPs. New IPs for allowed domains won't be reachable.

3. **Protected file detection is post-hoc:** Protected file patterns are checked after execution completes. The agent can modify these files during execution; Ithilien only detects and logs the modification afterward.

4. **Command obfuscation:** Policy regex patterns match literal command strings. Base64-encoded commands, variable interpolation, or indirect execution (`bash -c "$(echo cm0gLXJm | base64 -d)"`) will bypass pattern matching.

5. **`--no-sandbox` mode:** Completely disables container isolation. The agent runs with full host access. Only the audit trail is preserved.

### Agent wrappers

**Claim:** The `--agent` flag is a convenience that constructs a shell command string from a user prompt. It does not add or modify any security boundary.

**Mechanism:**
- The wrapper is a pure function: `prompt -> shell command string`.
- The constructed command passes through the identical pipeline as a manually typed command: policy evaluation, enforcement decision, container execution.
- Policy evaluator sees the full expanded command, not the raw prompt.
- The session audit trail records both the expanded command (`session.command`) and the original prompt (`session.prompt`).

**What wrappers do NOT provide:**
1. **No agent version verification** — The wrapper does not check what version of the agent binary is installed in the sandbox image.
2. **No prompt integrity** — The prompt is embedded in a shell string via POSIX single-quote escaping. The agent binary receives it as a command-line argument. There is no guarantee the agent processes the prompt as intended.
3. **No agent output inspection** — The wrapper does not parse, filter, or validate agent output. All output is recorded as raw stdout/stderr in the audit trail.
4. **No behavioral constraints** — For Claude Code, the wrapper passes `--dangerously-skip-permissions`, which disables Claude Code's built-in permission system. Ithilien's container sandbox and policy engine replace that boundary, but they operate at the shell/process level, not the agent-semantic level.

**Shell escaping:** Prompts are embedded using POSIX single-quote escaping (`'` replaced with `'\''`). This prevents shell injection through the prompt string. However, the agent itself may execute arbitrary commands within the sandbox based on the prompt content — that is expected behavior, constrained by the container sandbox, not the wrapper.

## Recommendations

1. **Use signing keys** — Generate a keypair with `ithilien keygen` and verify manifests to detect post-hoc tampering.
2. **Review policy files** — Customize `.ithilien/policy.json` for your project's specific risks.
3. **Use strict profile for untrusted agents** — The `strict` profile disables all network access and tightens resource limits.
4. **Never use `--no-sandbox` in production** — It disables all isolation guarantees.
5. **Keep Docker updated** — Container isolation depends on Docker and the host kernel.
6. **Treat audit trails as evidence, not proof** — The hash chain proves events weren't modified after recording, but doesn't prove the recording was complete.
7. **Verify bundles in CI** — Use `ithilien inspect <bundle> --format json` in CI pipelines to verify bundle integrity. This confirms hash chain integrity and optional signature validity, but does not prove the recording was faithful. To verify a session ran under a specific policy, compare `report.policy.policyHash` against a known-good value. See [docs/CI.md](docs/CI.md) for workflows and patterns.

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly by opening a GitHub issue or contacting the maintainers directly. Do not exploit vulnerabilities in production systems.
