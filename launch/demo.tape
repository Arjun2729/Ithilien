# Ithilien Demo — tamper-evident evidence for AI agent sessions
Output demo.gif

Set Shell "bash"
Set FontSize 20
Set Width 1200
Set Height 700
Set Padding 20
Set Margin 20
Set MarginFill "#1B4332"
Set BorderRadius 8
Set WindowBar Colorful
Set TypingSpeed 40ms
Set PlaybackSpeed 1.5

# Title
Type "# Ithilien — tamper-evident evidence for AI agent sessions"
Enter
Sleep 1.5s

# Step 1: Show agent wrappers
Type "ithilien agents"
Enter
Sleep 3s

# Step 2: Show guardrail profiles
Type "ithilien profiles"
Enter
Sleep 3s

# Step 3: The hero — inspect a bundle
Type "# An agent ran in a sandbox. Here's the evidence bundle."
Enter
Sleep 1s
Type "ithilien inspect launch/demo-session.ithilien-bundle"
Enter
Sleep 4s

# Step 4: CI-ready Markdown summary
Type "# CI pipeline output (GitHub Actions job summary)"
Enter
Sleep 1s
Type "ithilien inspect launch/demo-session.ithilien-bundle --format summary"
Enter
Sleep 4s

# Closing
Type "# Every agent session. Verified. Auditable. Portable."
Enter
Sleep 2s
