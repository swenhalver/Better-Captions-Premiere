#!/bin/bash
# Move a running Premiere's project window onto the S-Space monitor and zoom it
# to fill the display (same as double-clicking its title bar).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
sspace="/Users/swenhalverson/Cursor Projects/S-Space/tools/s-space"
id=$(python3 "$sspace" windows | python3 -c "import json,sys; w=[w for w in json.load(sys.stdin).get('windows',[]) if 'Premiere' in w.get('app','') and w.get('title','').endswith('.prproj')]; print(w[0]['id'] if w else '')")
[ -n "$id" ] || { echo "No Premiere project window found." >&2; exit 1; }
python3 "$sspace" move --window "$id" | grep -q '"onDisplay": true' || { echo "S-Space refused to move window $id." >&2; exit 1; }
swift "$root/scripts/maximize-premiere-sspace.swift"
