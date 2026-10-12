#!/usr/bin/env bash
# Weekday maintenance run for the wa-procurement-improver skill.
# Owns the scan cursor and run receipts; the skill owns the proposal. At most one PR per run.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${WA_IMPROVER_HOME:-$HOME/.workspaceAlberta/improver}"
ENVFILE="${WA_IMPROVER_ENV:-$HOME/.config/wv/improver.env}"
REPO="${WA_IMPROVER_REPO:-HarleyCoops/workspacealberta-harness}"
TARGET="${WA_IMPROVER_TARGET:-workspace-alberta}"
mkdir -p "$STATE/receipts"
[ -f "$ENVFILE" ] && . "$ENVFILE"

# Non-overlapping runs.
exec 9>"$STATE/lock"
flock -n 9 || { echo "previous run still active"; exit 0; }

# The human merge gate needs an automation identity without merge or target-branch write access.
: "${WA_IMPROVER_GH_TOKEN:?set WA_IMPROVER_GH_TOKEN (bot token, no merge or branch-protection bypass) in $ENVFILE}"
export GH_TOKEN="$WA_IMPROVER_GH_TOKEN"
: "${COHERE_API_KEY:?set COHERE_API_KEY in $ENVFILE}"

START="$(date -u +%FT%TZ)"
CURSOR="$(python3 -c "import json,sys;print(json.load(open('$STATE/cursor.json')).get('last_completed',''))" 2>/dev/null || true)"
[ -n "$CURSOR" ] || CURSOR="$(date -u -d '-7 days' +%FT%TZ)"

git -C "$REPO_DIR" fetch -q origin "$TARGET"
WT="$(mktemp -d "$STATE/wt.XXXXXX")"
trap 'git -C "$REPO_DIR" worktree remove --force "$WT" 2>/dev/null || true' EXIT
git -C "$REPO_DIR" worktree add -q --detach "$WT" "origin/$TARGET"

SKILL="$WT/.agents/skills/wa-procurement-improver/SKILL.md"
PROMPT="Operate as the wa-procurement-improver defined in $SKILL (read it as your only operating instructions).
Repository: $REPO. Target branch: $TARGET. Authorized feedback sources: issues and PRs labelled wa-feedback in $REPO.
Last completed scan cursor: $CURSOR. Freeze the scan upper bound at $START.
Work in the isolated checkout at $WT. Create at most one PR titled 'wa-skill: <principle>' against $TARGET.
End your final message with exactly one line: OUTCOME: proposed <PR URL> | OUTCOME: no edit <reason> | OUTCOME: blocked <step>."

OUT="$STATE/receipts/$START.log"
set +e
(cd "$WT" && DSH_TELEMETRY_DISABLED=1 pnpm --silent wa --profile headless --patch workspace-alberta.patch.yml "$PROMPT") >"$OUT" 2>&1
RC=$?
set -e

OUTCOME="$(grep -E '^OUTCOME: ' "$OUT" | tail -1 || true)"
case "$OUTCOME" in
  "OUTCOME: proposed"*|"OUTCOME: no edit"*)
    [ $RC -eq 0 ] && printf '{"last_completed":"%s"}\n' "$START" >"$STATE/cursor.json" ;;
  *) echo "run not complete (rc=$RC); cursor retained" >&2; exit 1 ;;
esac
echo "$START $OUTCOME" >>"$STATE/receipts/index.log"
