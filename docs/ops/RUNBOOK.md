# workspaceAlberta harness — operations runbook

English | [中文](RUNBOOK.zh.md)

The deployment's single host runs the harness as a supervised user service with an encrypted nightly backup. The product overlay requires [1Password credential setup](ONEPASSWORD.md) for provider keys and browser signing records. Harness state lives in `~/.workspaceAlberta`; service units and the backup passphrase have separate locations listed below.

## Service

- Unit: `~/.config/systemd/user/workspacealberta-harness.service` (`systemctl --user {status|restart|stop} workspacealberta-harness`)
- Binds `127.0.0.1:3081`; `Restart=always`, `RestartSec=5`; lingers across logout/reboot (`loginctl show-user christian | grep Linger` must stay `yes`).
- `DSH_HOME=~/.workspaceAlberta` is set by the unit AND is the fork's built-in default (`DSH_HOME_DIR_NAME` in `packages/util/home-paths`), so any launch path — service or manual — resolves the same home.
- Logs: `journalctl --user -u workspacealberta-harness -f`.

## Remote support / desk rebuild

RaspberryPiBot / Litter-style remote support rebuilds a customer desk checkout with `bash scripts/wa-desk-rebuild.sh` from the repo root (no inline `pnpm install`).

## Home layout (`~/.workspaceAlberta`)

| Path | Contents |
|---|---|
| `sessions/` | Session logs (JSONL+zstd), grouped by workspace path |
| `storages/` | Workspace registry, message-feedback sidecar, projections |
| `profiles/web/` | Profile patch layer (MCP inserts; nonsecret credential references only) |
| `.credentials.yaml` | Legacy local credential store; ignored by the product's 1Password mode; migrate and retire with approval |

## Backups

- restic repo: `/data/backups/workspacealberta-restic`; passphrase: `~/.config/workspacealberta/backup-passphrase` (0600). Losing both the repo and the passphrase loses the backups — copy the passphrase offline.
- Nightly at 03:00 via `workspacealberta-backup.timer`; retention `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`.
- Manual backup: `systemctl --user start workspacealberta-backup.service`.
- Tested restore (rehearse quarterly):

  ```sh
  export RESTIC_REPOSITORY=/data/backups/workspacealberta-restic
  export RESTIC_PASSWORD_FILE=~/.config/workspacealberta/backup-passphrase
  restic snapshots                      # pick a snapshot id
  restic restore <id> --target /tmp/r  # then diff against the live home
  ```

- Restore-onto-new-host: install the service units, restore `~/.workspaceAlberta` from the repo, `pnpm install && pnpm build:lib:host && pnpm build:web` in the repo checkout, `systemctl --user enable --now workspacealberta-harness`.

## Secrets

- Follow [1Password setup and rotation](ONEPASSWORD.md) for approved vault access and service cutover. The source refuses local credential writes and environment fallback. Remove secret-bearing `EnvironmentFile` instructions only after migration is verified.
- For approved search/model key separation, add a `COHERE_SEARCH_API_KEY` field mapping in `onePassword.refs` and set the search row's `apiKeyEnv` to that name. Provision its value in 1Password.
- Composio is the WorkspaceAlberta connection layer elsewhere; do not add an `mcp-composio` row to the harness profile.

## Known gaps (tracked)

- Push-time typecheck was removed from `lefthook.yml` (flaky under concurrent agent builds, ~3 min); CI owns that gate — wire CI before relying on it.
- The legacy global `wa web` (npm install, port 3080, PID since Aug 28) still expects the old `~/.dsh`; if restarted it recreates that directory. Retire it when convenient: `systemctl --user` is the only supported launcher now.
