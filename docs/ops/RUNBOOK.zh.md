# workspaceAlberta harness — 运维手册

[English](RUNBOOK.md) | 中文

该部署的单一主机以受监督的用户服务运行 harness，并带加密的夜间备份。密钥放在 `.env`（已 gitignore）与 profile 的凭据引用中；`~/.workspaceAlberta` 之外不存放任何持久数据。

## 服务

- 单元：`~/.config/systemd/user/workspacealberta-harness.service`（`systemctl --user {status|restart|stop} workspacealberta-harness`）
- 绑定 `127.0.0.1:3081`；`Restart=always`，`RestartSec=5`；跨注销／重启保持 linger（`loginctl show-user christian | grep Linger` 必须保持 `yes`）。
- 单元设置 `DSH_HOME=~/.workspaceAlberta`，且这是该 fork 的内置默认（`packages/util/home-paths` 中的 `DSH_HOME_DIR_NAME`），因此任何启动路径——服务或手工——都解析到同一 home。
- 日志：`journalctl --user -u workspacealberta-harness -f`。

## 远程支持／桌面重建

RaspberryPiBot／Litter 风格的远程支持从仓库根目录用 `bash scripts/wa-desk-rebuild.sh` 重建客户桌面 checkout（不内联 `pnpm install`）。

## Home 布局（`~/.workspaceAlberta`）

| Path | Contents |
|---|---|
| `sessions/` | 会话日志（JSONL+zstd），按工作区路径分组 |
| `storages/` | 工作区注册表、message-feedback sidecar、投影 |
| `profiles/web/` | Profile 补丁层（MCP 插入——密钥走环境变量，从不写字面量） |
| `.credentials.yaml` | 凭据存储（已备份；泄露时轮换） |

## 备份

- restic 仓库：`/data/backups/workspacealberta-restic`；口令：`~/.config/workspacealberta/backup-passphrase`（0600）。仓库与口令同时丢失即丢失备份——把口令离线另存一份。
- 每晚 03:00 由 `workspacealberta-backup.timer` 执行；保留策略 `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`。
- 手工备份：`systemctl --user start workspacealberta-backup.service`。
- 已验证的恢复（每季度演练）：

  ```sh
  export RESTIC_REPOSITORY=/data/backups/workspacealberta-restic
  export RESTIC_PASSWORD_FILE=~/.config/workspacealberta/backup-passphrase
  restic snapshots                      # pick a snapshot id
  restic restore <id> --target /tmp/r  # then diff against the live home
  ```

- 恢复到新主机：安装服务单元，从仓库恢复 `~/.workspaceAlberta`，在仓库 checkout 中执行 `pnpm install && pnpm build:lib:host && pnpm build:web`，然后 `systemctl --user enable --now workspacealberta-harness`。

## 密钥

- `.env`（仓库根目录，已 gitignore）：`COHERE_API_KEY`（Chat API v2 模型路由，前缀 `https://api.cohere.com/v2`）与 `EXA_API_KEY`（web 搜索）。服务经 `EnvironmentFile` 加载它们。Composio 故意缺席：它是别处的 WorkspaceAlberta 连接层，绝不是 harness 工具面——不要把 `mcp-composio` 行加回 profile。
- 轮换：替换 `.env` 中的值，然后 `systemctl --user restart workspacealberta-harness`。
- 搜索留在 Exa。不要在此桌面注册 Cohere 搜索，也不要把 `COHERE_API_KEY` 复用为搜索凭据。

## 已知缺口（已跟踪）

- 推送时的 typecheck 已从 `lefthook.yml` 移除（并发 agent 构建下不稳定，约 3 分钟）；该门禁由 CI 负责——在依赖它之前先接上 CI。
- 遗留的全局 `wa web`（npm install，端口 3080，PID 自 8 月 28 日起）仍期望旧的 `~/.dsh`；若被重启会重建该目录。方便时退役它：现在唯一受支持的启动器是 `systemctl --user`。
