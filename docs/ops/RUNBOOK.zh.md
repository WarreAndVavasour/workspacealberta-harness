# workspaceAlberta harness — operations runbook

[English](RUNBOOK.md) | 中文

该部署的单一主机以受监督的用户服务运行 harness，并做加密的夜间备份。密钥放在 `.env`（已被 Git 忽略）和配置的凭证引用里；持久数据不出现在 `~/.workspaceAlberta` 之外。

## Service

- 单元：`~/.config/systemd/user/workspacealberta-harness.service`（`systemctl --user {status|restart|stop} workspacealberta-harness`）
- 绑定 `127.0.0.1:3081`；`Restart=always`，`RestartSec=5`；在登出/重启后仍保持（`loginctl show-user christian | grep Linger` 必须保持 `yes`）。
- 单元会设置 `DSH_HOME=~/.workspaceAlberta`，这也是该 fork 的内置默认值（`packages/util/home-paths` 中的 `DSH_HOME_DIR_NAME`），因此无论服务启动还是手动启动，都会解析到同一主目录。
- 日志：`journalctl --user -u workspacealberta-harness -f`。

## Remote support / desk rebuild

RaspberryPiBot / Litter 式远程支持从仓库根目录用 `bash scripts/wa-desk-rebuild.sh` 重建客户桌面检出（不要内联 `pnpm install`）。

## Home layout (`~/.workspaceAlberta`)

| Path | Contents |
|---|---|
| `sessions/` | 会话日志（JSONL+zstd），按工作区路径分组 |
| `storages/` | 工作区注册表、消息反馈 sidecar、投影 |
| `profiles/web/` | 配置补丁层（MCP 插入项 — 密钥走环境变量，从不写字面量） |
| `.credentials.yaml` | 凭证存储（会备份；暴露后须轮换） |

## Backups

- restic 仓库：`/data/backups/workspacealberta-restic`；口令：`~/.config/workspacealberta/backup-passphrase`（0600）。仓库和口令都丢失就等于备份丢失 — 把口令复制到离线处。
- 每天 03:00 由 `workspacealberta-backup.timer` 执行；保留策略 `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`。
- 手动备份：`systemctl --user start workspacealberta-backup.service`。
- 已验证的恢复（每季度演练）：

  ```sh
  export RESTIC_REPOSITORY=/data/backups/workspacealberta-restic
  export RESTIC_PASSWORD_FILE=~/.config/workspacealberta/backup-passphrase
  restic snapshots                      # pick a snapshot id
  restic restore <id> --target /tmp/r  # then diff against the live home
  ```

- 恢复到新主机：安装服务单元，从仓库恢复 `~/.workspaceAlberta`，在仓库检出里执行 `pnpm install && pnpm build:lib:host && pnpm build:web`，然后 `systemctl --user enable --now workspacealberta-harness`。

## Secrets

- `.env`（仓库根目录，已被 Git 忽略）：`COHERE_API_KEY`。服务通过 `EnvironmentFile` 加载。故意不包含 Composio：它是 WorkspaceAlberta 在别处的连接层，绝不是 harness 工具面 — 不要把 `mcp-composio` 行加回配置。
- 轮换：替换 `.env` 中的值，然后 `systemctl --user restart workspacealberta-harness`。
- 搜索/模型密钥分离：另建一把 Cohere 密钥并设置 `COHERE_SEARCH_API_KEY`（在 `web-search-cohere` 行上配置 `apiKeyEnv`），以便主循环与网页搜索的每分钟争用出现时拆开。

## Known gaps (tracked)

- `lefthook.yml` 已去掉推送时 typecheck（并发 agent 构建下不稳定，约 3 分钟）；该检查由 CI 负责 — 依赖它之前先接上 CI。
- 遗留的全局 `wa web`（npm 安装，端口 3080，PID 自 8 月 28 日起）仍期望旧的 `~/.dsh`；若被重启会重建该目录。方便时退役它：现在唯一受支持的启动器是 `systemctl --user`。
