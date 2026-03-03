---
title: Stop rubber-stamping AI agent permissions. Sandbox them instead.
tags: claude, ai, docker, security, opensource
---

In February 2025, a developer watched Claude Code execute `rm -rf /` inside their project directory. The incident landed on GitHub as [claude-code #10077](https://github.com/anthropics/claude-code/issues/10077), a stark reminder that autonomous agents can do real damage. Around the same time, Jake McAulay reported 11 GB of deleted files from an agent session gone wrong. PromptArmor demonstrated that a crafted `.docx` file could hijack an agent's tool calls through prompt injection. These aren't theoretical risks. They're things that happened to real developers who gave agents permission to act.

## The permission problem

Anyone who's used Claude Code in autonomous mode knows the pattern. The agent asks permission to run a command. You approve. It asks again. You approve. After the twentieth approval in ten minutes, you stop reading the prompts and start clicking "yes" on reflex.

That's approval fatigue, and it's the reason `--dangerously-skip-permissions` exists. The flag name is honest about what it does. It turns off the only safety mechanism between the agent and your filesystem, your credentials, your git history.

This leaves you with two choices: rubber-stamp every request (security theater with extra steps) or skip permissions entirely (accept that the agent has full access to your machine). Neither is a real answer.

NIST's January 2025 report on AI agent oversight concluded what practitioners already knew — human approval gates fail under cognitive load. The report found that authorization scope matters more than approval checkpoints. In other words: it doesn't matter how many times you click "approve" if the agent can access everything anyway. What matters is limiting what the agent can reach in the first place.

## Everyone arrives at the same conclusion

Read any blog post about running AI agents safely and you'll find the same recommendation: "just use Docker." Kyle Redelinghuys wrote about it. Boris Tane built guardrails around it. Thomas Wiegold documented his setup. The community has converged on containers as the answer, but nobody has productized it — a single tool that wraps any agent in a Docker sandbox with guardrails, captures a complete audit trail, and lets you review before applying changes.

That's what I built. The gap between "use Docker" and having a working tool you can `npm install` is surprisingly wide. You need volume mounts, network policies, resource limits, a way to capture what changed, a way to review it, and a way to apply it. Each piece is straightforward; wiring them together into a workflow that doesn't add friction is the actual work.

## Ithilien

Ithilien is a CLI tool that sandboxes AI coding agents in Docker containers with tamper-evident audit trails. The workflow is three steps:

```bash
# 1. Run the agent in a sandbox
ithilien run "claude --dangerously-skip-permissions -p 'fix all lint errors'"

# 2. Review what happened
ithilien show <session-id>
ithilien diff <session-id>

# 3. Apply changes you approve
ithilien apply <session-id>
```

The agent runs inside a Docker container with configurable guardrails — filesystem boundaries, network policies (none, allowlist, or full), CPU and memory limits, session timeouts. Your project is copied into the container; the agent works on the copy. Nothing touches your workspace until you explicitly approve it.

When the agent finishes, Ithilien captures every file change as a unified diff, every command with its output, every network request, and every guardrail event. The session summary shows you what happened at a glance:

```
Session Summary
────────────────────────────────────────
ID:        abc123def456
Status:    completed
Duration:  3m 22s
Profile:   default
Files:     +2 created | ~5 modified
Lines:     +142 -38
Review changes:
  ithilien diff abc123def456
Apply to workspace:
  ithilien apply abc123def456
```

It works with Claude Code, Codex CLI, Aider, Goose, or any terminal agent. The sandbox doesn't care what's inside it.

## Under the hood

### Guardrail profiles

Ithilien ships with three built-in profiles:

- **default** — Allowlist networking (package registries, GitHub, AI APIs), 4 CPUs, 8 GB memory, 1-hour timeout
- **strict** — No network at all, 2 CPUs, 4 GB memory, 30-minute timeout
- **permissive** — Full network, 8 CPUs, 16 GB memory, 2-hour timeout

You select a profile per-run: `ithilien run --profile strict "agent-command"`. All profiles block access to `~/.ssh`, `~/.aws`, and `~/.gnupg` by default. Protected file patterns prevent agents from touching `.env` files, private keys, and credentials. You can define custom profiles in your project's `.ithilien/config.json`.

The network allowlist in the default profile includes the package registries your agent is likely to need (npm, PyPI, crates.io) and the API endpoints it talks to (api.anthropic.com, api.openai.com, github.com). Everything else is blocked at the container level.

### Audit trail

Every session produces a JSON file stored at `~/.ithilien/sessions/<id>.json` containing the full event log. The event types are: command starts and exits (with exit codes), file creates/modifies/deletes (with unified diffs), network requests (allowed or blocked), package installations, stdout/stderr capture, and guardrail triggers.

You can view this as a terminal audit trail (`ithilien show <id>`), an HTML report (`ithilien show <id> --format html`), or read the raw JSON directly. The HTML report includes a dark-themed dashboard with event counts, line change stats, and the complete event timeline — useful for sharing with team leads or compliance reviewers who don't want to use the CLI.

### Tamper-evident integrity

Every event in the session gets a SHA-256 hash. Each hash is chained to the previous one, forming a hash chain where modifying any event invalidates everything after it. A root hash covers the entire chain. You can verify integrity at any time:

```bash
ithilien verify <session-id>
# ✓ Session abc123: integrity verified
#   Root hash:  4670a2c9522bbc1b...
#   Events:     184 (chain intact)
```

If you run `ithilien keygen`, future sessions are automatically signed with an Ed25519 keypair stored at `~/.ithilien/signing-key`. Signed sessions include a cryptographic signature over the root hash, so you can prove a session hasn't been modified since it was recorded.

### Portable bundles

Sessions can be exported as `.ithilien-bundle` files — ZIP archives containing the session data, manifest, hash chain, and individual file diffs. Import them on another machine for review:

```bash
ithilien export abc123
# ✓ Exported to ./abc123.ithilien-bundle

ithilien import abc123.ithilien-bundle
# ✓ Bundle verified and imported
```

This is useful for team code review of agent sessions, or for compliance workflows where you need to demonstrate what an agent did and prove the record wasn't altered.

### Remote approval

Ithilien also includes a remote approval server (`ithilien approve-server`) that integrates with Claude Code's hooks system. It generates a QR code you scan with your phone, letting you approve or deny individual tool calls from anywhere. This is an alternative to full autonomy — useful when you want the agent to work mostly independently but still gate destructive operations like `rm` or `git push`.

## What's next

I'm working on integration with CI pipelines so agent sessions can run as part of automated workflows with the same sandboxing guarantees. Team session sharing and role-based review workflows are on the roadmap. And I want to make the audit trail queryable — "show me every session where an agent modified package.json."

This is early. I'd appreciate feedback on what's useful, what's missing, and what's broken.

## Try it

```bash
npm install -g ithilien
ithilien init
ithilien run "your-agent-command-here"
```

Source: [github.com/Arjun2729/ithilien](https://github.com/Arjun2729/ithilien)
