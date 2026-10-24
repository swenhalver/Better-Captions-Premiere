#!/bin/bash
# Move a running Premiere's project window onto the S-Space monitor and zoom it
# to fill the display (same as double-clicking its title bar).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
sspace="/Users/swenhalverson/Cursor Projects/S-Space/tools/s-space"
placement=$(python3 - "$sspace" <<'PY'
import json, subprocess, sys
cli = sys.argv[1]
def read(command):
    return json.loads(subprocess.check_output(['python3', cli, command]))
display = read('status')
windows = [w for w in read('windows').get('windows', [])
           if 'Premiere' in w.get('app', '') and w.get('title', '').rstrip(' *').endswith('.prproj')]
if not windows:
    print('none false')
else:
    w = windows[0]
    # S-Space's onDisplay means intersection, so it also includes straddling
    # windows. Skip a no-op move only when the entire window is already placed.
    placed = (display.get('displayActive') is True
              and w['x'] >= display['x'] - 2 and w['y'] >= display['y'] - 2
              and w['x'] + w['width'] <= display['x'] + display['width'] + 2
              and w['y'] + w['height'] <= display['y'] + display['height'] + 2)
    print(w['id'], str(placed).lower())
PY
)
read -r id fully_placed <<< "$placement"
[ "$id" != none ] || { echo "No Premiere project window found." >&2; exit 1; }
if [ "$fully_placed" != true ]; then
  python3 "$sspace" move --window "$id" | grep -q '"onDisplay": true' || { echo "S-Space refused to move window $id." >&2; exit 1; }
fi
swift "$root/scripts/maximize-premiere-sspace.swift"
# Moving/resizing can redistribute the dock even when the workspace name is
# unchanged. The saved layout must be reapplied after the last size change.
swift "$root/scripts/reset-premiere-layout.swift"
echo "Capture the settled window with Computer Use and run scripts/check-premiere-layout.swift before testing."
