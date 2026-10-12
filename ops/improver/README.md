# Improver job

Runs `wa-procurement-improver` weekdays at 07:00 America/Edmonton. Documented in `WORKSPACE_ALBERTA.md` (maintenance clock).

- `run.sh` serializes runs with a lock, runs in a fresh worktree of `origin/workspace-alberta`, and uses the Cohere route through `wa --profile headless`. The cursor lives in `~/.workspaceAlberta/improver/cursor.json` and advances only after a recorded `OUTCOME:` of `proposed` or `no edit`. Receipts are in `receipts/`.
- It refuses to run without `WA_IMPROVER_GH_TOKEN`, a dedicated bot token with no merge or protection-bypass rights, so the human merge gate holds. Settings go in `~/.config/wv/improver.env` (`WA_IMPROVER_GH_TOKEN`, `COHERE_API_KEY`). Never commit this file.
- Install on the Pi: copy `wa-improver.service` and `wa-improver.timer` to `~/.config/systemd/user/`, adjust `WorkingDirectory` and `ExecStart` to the harness checkout, then `systemctl --user enable --now wa-improver.timer`.
- A merge reaches a desk only after that checkout updates; a push does not update the fleet.
