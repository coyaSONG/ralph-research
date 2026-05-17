#!/usr/bin/env bash

# Reproducible 60-second screen-friendly demo of `rrx demo code`.
# Pipe this through `asciinema` (or any terminal recorder) to produce the
# asciicast/gif referenced from the README.
#
# Usage:
#   asciinema rec --command "./scripts/record-demo.sh" docs/assets/demo.cast
#   agg docs/assets/demo.cast docs/assets/demo.gif        # optional GIF render
#
# The script intentionally only uses commands that ship with the runtime so
# the recording stays faithful to what a new user would type.

set -euo pipefail

pause() {
  # 1.6 seconds is the slowest delay that still feels alive on a terminal
  # recording. Tighten or loosen to taste, but keep it consistent.
  sleep 1.6
}

type_out() {
  # Print a command with a trailing newline so it shows up in the recording
  # as if a human typed it.
  printf '$ %s\n' "$1"
}

DEMO_DIR=$(mktemp -d -t ralph-demo-XXXXXX)
trap 'rm -rf "$DEMO_DIR"' EXIT

clear
type_out "ralph-research --version"
ralph-research --version 2>/dev/null || npx --yes ralph-research --version
pause

clear
type_out "ralph-research demo code --path $DEMO_DIR --json"
if command -v ralph-research >/dev/null 2>&1; then
  ralph-research demo code --path "$DEMO_DIR" --json
else
  npx --yes ralph-research demo code --path "$DEMO_DIR" --json
fi
pause

clear
type_out "cd $DEMO_DIR && ls .ralph/runs/run-0001/"
cd "$DEMO_DIR"
ls .ralph/runs/run-0001/
pause

clear
type_out "cat .ralph/runs/run-0001/decision.json"
cat .ralph/runs/run-0001/decision.json
pause

clear
type_out "cat .ralph/frontier.json"
cat .ralph/frontier.json
pause

clear
printf 'Demo complete. Inspect more at: %s\n' "$DEMO_DIR"
