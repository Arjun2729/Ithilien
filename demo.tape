# Ithilien Demo — Safe autonomous mode for AI coding agents
Output demo.gif

Set Shell "bash"
Set FontSize 20
Set Width 1200
Set Height 600
Set Padding 16
Set Margin 20
Set MarginFill "#1B4332"
Set BorderRadius 8
Set WindowBar Colorful
Set TypingSpeed 40ms
Set PlaybackSpeed 1.5
Set Theme "Catppuccin Mocha"
Set LoopOffset 60%

Hide
Type "cd /tmp/ithilien-demo && clear"
Enter
Sleep 500ms
Show

# Context
Type "# An AI agent just ran autonomously inside a Docker sandbox."
Enter
Type "# Let's review what it did."
Enter
Sleep 2s

# Session log
Type "ithilien log"
Enter
Sleep 3s

# Audit trail
Type "ithilien show CiUV3kcL3ys4"
Enter
Sleep 4s

# File diffs
Type "ithilien diff CiUV3kcL3ys4"
Enter
Sleep 5s

# Integrity verification
Type "ithilien verify CiUV3kcL3ys4"
Enter
Sleep 3s

# Apply
Type "ithilien apply CiUV3kcL3ys4"
Enter
Sleep 3s

# Tag
Type "# github.com/Arjun2729/Ithilien"
Enter
Sleep 3s
