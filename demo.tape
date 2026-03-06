# Ithilien Demo
Output demo.gif

Set Shell "bash"
Set FontSize 20
Set Width 1200
Set Height 650
Set Padding 16
Set Margin 20
Set MarginFill "#1B4332"
Set BorderRadius 8
Set WindowBar Colorful
Set TypingSpeed 35ms
Set PlaybackSpeed 0.6
Set LoopOffset 70%

# --- Hidden setup ---
Hide
Type "cd /tmp/ithilien-demo && clear"
Enter
Sleep 500ms
Show

# ═══════════════════════════════════════════
# ACT 1: Inspect what the agent did
# ═══════════════════════════════════════════

# Show the audit trail
Type "ithilien show YE5E06BNAIQA"
Enter
Sleep 7s

# Show the diffs — THE MONEY SHOT
Type "ithilien diff YE5E06BNAIQA"
Enter
Sleep 9s

# ═══════════════════════════════════════════
# ACT 2: Verify integrity
# ═══════════════════════════════════════════
Type "ithilien verify YE5E06BNAIQA"
Enter
Sleep 6s

# ═══════════════════════════════════════════
# ACT 3: Apply the changes
# ═══════════════════════════════════════════
Type "ithilien apply YE5E06BNAIQA"
Enter
Sleep 2s
Type "y"
Enter
Sleep 5s

# ═══════════════════════════════════════════
# END
# ═══════════════════════════════════════════
Sleep 3s
