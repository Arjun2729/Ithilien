# Ithilien Demo — Safe autonomous mode for AI coding agents
Output demo.gif

Require ithilien
Require docker

Set Shell "bash"
Set FontSize 22
Set Width 1200
Set Height 600
Set Padding 20
Set Margin 20
Set MarginFill "#1B4332"
Set BorderRadius 8
Set WindowBar Colorful
Set TypingSpeed 50ms
Set PlaybackSpeed 1.5

# Title
Type "# Ithilien — safe autonomous mode for AI coding agents"
Enter
Sleep 1.5s

# Run an agent in a sandbox
Type "ithilien run 'claude --dangerously-skip-permissions -p fix lint errors'"
Enter
# The run command outputs:
#   Ithilien
#   ────────────────────────────────────────
#   ✔ Docker available
#   ✔ Sandbox image ready
#   ✔ Snapshot: N files
#   Profile: default (Balanced safety for typical development work)
#   Timeout: 1h 0m
#   Network: allowlist
#   Command: claude --dangerously-skip-permissions ...
#   ────────────────────────────────────────
#   <agent output streams here>
#   ✔ N file(s) changed
#   Session Summary
#   ────────────────────────────────────────
#   ID:       <session-id>
#   Status:   completed
#   Duration: Nm NNs
#   ...
#   Review changes:
#     ithilien diff <session-id>
#   Apply to workspace:
#     ithilien apply <session-id>
Sleep 8s

# Show the session log
Type "ithilien log"
Enter
# Outputs a table:
#   SESSION ID      STATUS        DURATION    FILES       COMMAND
#   ────────────────────────────────────────────────────────────────────
#   abc123def456    completed     3m 22s      +2 ~5       claude --dangerously-skip...
Sleep 3s

# Show full audit trail
Type "ithilien show abc123def456"
Enter
# Outputs:
#   Audit Trail: abc123def456
#   ──────────────────────────────────────────────────
#   Started:  2026-03-03T...
#   Status:   completed
#   Command:  claude --dangerously-skip-permissions ...
#   Events:
#   17:44:45  ▶ Command: ...
#   17:44:50  + Created: src/auth.test.ts (1200b)
#   17:44:52  ~ Modified: package.json
#   17:45:10  ✓ Exit: 0
#   Integrity: ✓ Verified (root hash: 4670a2c9...)
#   Signed:    Not signed
Sleep 4s

# Verify session integrity
Type "ithilien verify abc123def456"
Enter
# Outputs:
#   ✓ Session abc123def456: integrity verified
#   Root hash:  4670a2c9522bbc1b...
#   Events:     12 (chain intact)
#   Signed:     Not signed
#   ...
Sleep 3s

# Show diffs
Type "ithilien diff abc123def456"
Enter
# Outputs unified diffs for all changed files
Sleep 3s

# Apply changes
Type "ithilien apply abc123def456"
Enter
# Interactive review per-file:
#   Apply src/auth.test.ts? (y/n)
Sleep 3s

Type "# Agent ran autonomously. You reviewed everything. Applied safely."
Enter
Sleep 3s
