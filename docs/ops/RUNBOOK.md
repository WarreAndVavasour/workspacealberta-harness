# workspaceAlberta harness — operations runbook

English | [中文](RUNBOOK.zh.md)

The deployment's single host runs the harness as a supervised user service with an encrypted nightly backup. Secrets live in `.env` (gitignored) and the profile's credential references; nothing durable lives outside `~/.workspaceAlberta`.

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
| `profiles/web/` | Profile patch layer (MCP inserts — keys via env, never literals) |
| `.credentials.yaml` | Credential store (backed up; rotate on exposure) |

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

- `.env` (repo root, gitignored): `COHERE_API_KEY` (Chat API v2 model route at prefix `https://api.cohere.com/v2`) and `EXA_API_KEY` (web search). The service loads them via `EnvironmentFile`. Composio is intentionally absent: it is the WorkspaceAlberta connection layer elsewhere, never a harness tool surface — do not re-add an `mcp-composio` row to the profile.
- Rotation: replace the value in `.env`, then `systemctl --user restart workspacealberta-harness`.
- Search stays on Exa. Do not register Cohere search on this desk or reuse `COHERE_API_KEY` as the search credential.

## Known gaps (tracked)

- Push-time typecheck was removed from `lefthook.yml` (flaky under concurrent agent builds, ~3 min); CI owns that gate — wire CI before relying on it.
- The legacy global `wa web` (npm install, port 3080, PID since Aug 28) still expects the old `~/.dsh`; if restarted it recreates that directory. Retire it when convenient: `systemctl --user` is the only supported launcher now.
