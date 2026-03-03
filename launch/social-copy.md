# Social Copy — Ithilien Launch

## Twitter/X Thread

**Tweet 1:**
I built an open-source tool that sandboxes AI coding agents in Docker containers with tamper-evident audit trails.

It's called Ithilien. Here's why it exists:

**Tweet 2:**
Every developer using Claude Code or Codex in autonomous mode faces the same choice:

- Approve 100+ permission prompts per hour (approval fatigue)
- Skip permissions entirely (hope nothing breaks)

Neither is a real answer.

**Tweet 3:**
The community has converged on "just use Docker." But nobody productized it.

Ithilien wraps any terminal agent in a Docker sandbox with configurable guardrails — filesystem boundaries, network policies, resource limits.

**Tweet 4:**
The workflow:

1. `ithilien run "claude -p 'fix lint errors'"`
2. Agent runs in a container. You watch or walk away.
3. `ithilien diff <id>` — review every file change
4. `ithilien apply <id>` — apply what you approve

**Tweet 5:**
Every session gets a complete audit trail — file diffs, commands, network requests, guardrail events.

SHA-256 hash chain makes it tamper-evident. Optional Ed25519 signing.

[INSERT DEMO GIF HERE]

**Tweet 6:**
Works with Claude Code, Codex CLI, Aider, Goose, or any terminal agent. The sandbox doesn't care what's inside it.

Three built-in profiles: default (allowlist network), strict (air-gapped), permissive (full access).

**Tweet 7:**
It's MIT licensed and early. Feedback welcome.

github.com/Arjun2729/ithilien

---

## Reddit: r/ClaudeAI

**Title:** I built an open-source Docker sandbox for running Claude Code autonomously — with tamper-evident audit trails

**Body:**

I've been using Claude Code with `--dangerously-skip-permissions` for a while, and the name of that flag is honest — it is dangerous. After reading about the `rm -rf /` incident and a few close calls of my own, I wanted a way to let Claude run freely without giving it my entire machine.

Ithilien wraps Claude Code (or any terminal agent) in a Docker container with configurable guardrails. Filesystem boundaries block access to `~/.ssh`, `~/.aws`, and credentials. Network modes let you allowlist only package registries and APIs, or go fully air-gapped. Resource limits cap CPU, memory, and session duration.

After the agent finishes, you get a complete audit trail — every file change as a unified diff, every command with output, every network request. Review it with `ithilien show` or `ithilien diff`, then selectively apply changes back to your workspace with `ithilien apply`.

The audit trail is tamper-evident: every event is SHA-256 hashed into a chain, and you can optionally sign sessions with Ed25519 keys. Sessions export as portable `.ithilien-bundle` files for team review.

It's MIT licensed, early stage, and I'd appreciate feedback — especially on what guardrails matter most and what's missing from the audit trail.

GitHub: https://github.com/Arjun2729/ithilien

---

## Reddit: r/programming

**Title:** Ithilien: Docker sandbox + tamper-evident audit trail for autonomous AI coding agents (open source)

**Body:**

AI coding agents (Claude Code, Codex CLI, Aider, etc.) increasingly run in autonomous mode where they execute commands, modify files, and install packages without human approval per action. The problem is obvious: an agent with shell access can do anything you can do.

Ithilien is a CLI tool that wraps any terminal agent command in a Docker container with configurable guardrails (filesystem boundaries, network policies, resource limits) and captures a complete audit trail. After the agent finishes, you review file diffs and selectively apply changes.

The audit trail is tamper-evident — SHA-256 hash chain over every event, optional Ed25519 signing, portable `.ithilien-bundle` exports. This turns "the agent said it did X" into "here's a cryptographic record of exactly what happened."

Agent-agnostic. Works with anything that runs in a terminal. Three built-in guardrail profiles (strict/default/permissive) or define your own.

MIT licensed: https://github.com/Arjun2729/ithilien

---

## Reddit: r/devops

**Title:** Open-source Docker sandboxing for AI coding agents — tamper-evident audit trails with SHA-256 hash chains

**Body:**

If your team is using AI coding agents (Claude Code, Codex, Aider, etc.) in any kind of autonomous capacity, you've probably had the "what happens if the agent goes rogue" conversation.

Ithilien takes a zero-trust approach: the agent runs inside a Docker container with explicit guardrails. Filesystem access is scoped to the workspace copy. Network access is configurable — air-gapped, allowlisted to package registries and APIs, or full. CPU, memory, and session duration are capped. Secrets directories (`~/.ssh`, `~/.aws`, `~/.gnupg`) are blocked.

Every session produces a tamper-evident audit trail: file changes as unified diffs, command execution logs, network requests, guardrail triggers. Events are SHA-256 hashed into a chain. Sessions can be signed with Ed25519 and exported as portable `.ithilien-bundle` files — useful for compliance workflows or team review.

The apply step is explicit — changes don't touch your workspace until you review and approve them.

MIT licensed: https://github.com/Arjun2729/ithilien

---

## Hacker News First Comment

I built Ithilien because I got tired of choosing between approval fatigue and giving Claude Code full access to my machine.

It's a CLI tool that wraps any terminal agent in a Docker container with configurable guardrails (filesystem boundaries, network allowlisting, resource limits). After the agent finishes, you review the full audit trail — file diffs, command output, network requests — and selectively apply changes.

The audit trail is tamper-evident: SHA-256 hash chain over every event, optional Ed25519 signing, exportable as portable `.ithilien-bundle` archives.

It's agent-agnostic — works with Claude Code, Codex CLI, Aider, Goose, or anything that runs in a terminal. Three built-in profiles: strict (air-gapped), default (allowlist networking), permissive (full access).

Stack: TypeScript, Commander.js, Dockerode, Node.js crypto (no external crypto deps).

I'd especially appreciate feedback on the guardrail profiles — what defaults make sense for real autonomous agent workflows, and what should be configurable that isn't yet.

---

## Product Hunt Tagline

Safe autonomous mode for AI coding agents

---

## Product Hunt First Comment

Ithilien sandboxes AI coding agents in Docker containers with tamper-evident audit trails. Run Claude Code, Codex, or any terminal agent autonomously — then review every file change, command, and network request before applying anything to your workspace. SHA-256 hash chains and optional Ed25519 signing make the record tamper-evident. MIT licensed.

https://github.com/Arjun2729/ithilien

---

## Direct Outreach Template

Hey — I saw your [post/article/thread about running AI agents safely]. I built an open-source tool called Ithilien that does something similar to what you described: Docker sandboxing with guardrails and tamper-evident audit trails for any terminal agent. Would appreciate your take if you have a minute: [link]
