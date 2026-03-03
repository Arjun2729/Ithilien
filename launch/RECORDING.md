# Recording the Demo GIF

## Prerequisites
- Install VHS: `brew install vhs` (macOS) or see https://github.com/charmbracelet/vhs
- Docker must be running
- Ithilien must be installed globally: `npm install -g .`
- An agent must be available inside Docker (the demo uses Claude Code; needs `ANTHROPIC_API_KEY` set)

## Record

```bash
vhs launch/demo.tape
```

> **Note**: The demo.tape includes comments showing expected output. Since `ithilien run` requires a real Docker session, you may need to either:
> 1. Run with a real agent and let VHS capture the live output
> 2. Pre-run a session, then edit the tape to use `ithilien show/diff/verify` on that real session ID

## Optimize

```bash
# Install gifsicle if needed: brew install gifsicle
gifsicle -O3 --lossy=80 demo.gif -o demo-opt.gif
mv demo-opt.gif demo.gif
```

The optimized GIF should be under 5MB for fast GitHub README loading.

## Tips

- If the agent session takes too long for a demo, use `--timeout 120` to cap it at 2 minutes
- For a cleaner demo, pre-run a session and script the tape to just show `log`, `show`, `diff`, `verify`, and `apply` on the existing session ID
- Replace placeholder session IDs in the tape with real ones from `ithilien log`
