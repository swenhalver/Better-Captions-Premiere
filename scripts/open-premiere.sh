#!/bin/bash
# Launch Premiere Pro 2026 on the S-Space test monitor with the most recently
# opened project, once any previous Premiere process has fully exited.
#
#   bash scripts/open-premiere.sh            # reopen the most recent project
#   bash scripts/open-premiere.sh FILE.prproj
#   bash scripts/open-premiere.sh --dry-run  # print the project, launch nothing
#   bash scripts/open-premiere.sh --main-display  # only when Swen says he is remote:
#                                                 # skip S-Space, open on the main display
#
# Never touches a running or quitting Premiere: it only polls the process and
# launches after it is gone. Opening while it is still shutting down shows the
# Finder dialog "The application is not open anymore".
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
bundle=com.adobe.PremierePro.26
dry_run=0 main_display=0 project=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --main-display) main_display=1 ;;
    *) project="$arg" ;;
  esac
done

if [ -z "$project" ]; then
  # The active profile is the one Premiere wrote most recently. Its MRU list is
  # newest first; entry 0 is the project that was open last.
  prefs=$(ls -t "$HOME/Documents/Adobe/Premiere Pro/26.0"/Profile-*/"Adobe Premiere Pro Prefs" 2>/dev/null | head -1 || true)
  if [ -n "$prefs" ]; then
    project=$(grep -o '<BE.Prefs.MRU.Document.0>[^<]*' "$prefs" | head -1 | sed -e 's/^<BE.Prefs.MRU.Document.0>//' \
      -e 's/&apos;/'"'"'/g' -e 's/&quot;/"/g' -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&amp;/\&/g' || true)
  fi
fi
if [ -n "$project" ] && [ ! -f "$project" ]; then
  echo "Most recent project is missing, opening Premiere without it: $project" >&2
  project=""
fi

if [ "$dry_run" = 1 ]; then echo "${project:-<no project>}"; exit 0; fi

while pgrep -f "MacOS/Adobe Premiere Pro 2026$" >/dev/null; do sleep 3; done

if [ "$main_display" = 1 ]; then
  if [ -n "$project" ]; then open -b "$bundle" "$project"; else open -b "$bundle"; fi
  echo "Opened Premiere on the main display with: ${project:-<no project>}"
else
# Testing happens on the S-Space virtual monitor, never the main display.
# launch-premiere-test.swift registers Premiere with S-Space, launches it
# hidden, places every window on S-Space and only then reveals it.
sspace="/Users/swenhalverson/Cursor Projects/S-Space/tools/s-space"
if ! python3 "$sspace" status 2>/dev/null | grep -q '"displayActive": true'; then
  python3 "$sspace" start >/dev/null 2>&1 || true
  sleep 3
fi
if [ -z "$project" ]; then
  echo "No recent project found. Open a project in Premiere first; not launching on the main display." >&2
  exit 1
fi
swift "$root/scripts/launch-premiere-test.swift" --project "$project"
echo "Opened Premiere on S-Space with: $project"
# Require normal maximization; the verifier never presses the full-screen button.
swift "$root/scripts/maximize-premiere-sspace.swift"
fi

# The Premiere Pro MCP bridge (MCPBridgeCEP) starts itself in the background
# when Premiere launches and refreshes bridge-owner.json while running. Only the
# file is checked here; Premiere itself is never queried.
owner="${PREMIERE_TEMP_DIR:-/tmp/premiere-mcp-bridge}/bridge-owner.json"
bridge_ready=0
for _ in $(seq 1 60); do
  if [ -f "$owner" ] && [ $(( $(date +%s) - $(stat -f %m "$owner" 2>/dev/null || echo 0) )) -le 3 ]; then
    echo "Premiere Pro MCP bridge is running"; bridge_ready=1; break
  fi
  sleep 2
done
if [ "$bridge_ready" != 1 ]; then
  echo "Premiere Pro MCP bridge did not report within 2 minutes (open Window > Extensions > MCP Bridge (CEP) to check)" >&2
  exit 1
fi
# Restore after project/extension startup and verified normal window sizing.
# Shrink/grow alone can collapse the dock while the workspace name stays the
# same. A successful menu press is not rendered-layout verification.
if [ "$main_display" != 1 ]; then
  swift "$root/scripts/maximize-premiere-sspace.swift"
fi
swift "$root/scripts/reset-premiere-layout.swift"
echo "Capture the settled window with Computer Use and run scripts/check-premiere-layout.swift before testing."
