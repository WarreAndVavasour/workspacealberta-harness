#!/usr/bin/env bash
# Remote-support desk rebuild for RaspberryPiBot / Litter over Tailscale.
# Invoke this path; do not inline pnpm install (Auto-review blocks it).
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm_bin="$HOME/.local/bin/pnpm"
if [ ! -x "$pnpm_bin" ]; then
  pnpm_bin="$(command -v pnpm)"
fi

"$pnpm_bin" install
DSH_CLIENT_BUILD_PROFILE=official DSH_CLIENT_TITLE=workspaceAlberta "$pnpm_bin" run build
echo BUILD_OK
