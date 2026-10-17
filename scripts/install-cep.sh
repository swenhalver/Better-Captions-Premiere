#!/bin/zsh
set -euo pipefail
caption_repo_dir="${0:A:h:h}"
exec node "$caption_repo_dir/scripts/install.cjs"
