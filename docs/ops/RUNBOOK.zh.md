# workspaceAlberta harness — 运维手册

[English](RUNBOOK.md) | 中文

部署的单个主机以受监督的用户服务运行 harness，并使用加密的每夜备份。产品配置为提供方密钥和浏览器签名记录要求 [1Password 凭据设置](ONEPASSWORD.zh.md)。Harness 状态位于 `~/.workspaceAlberta`；服务单元和备份口令使用下文列出的独立位置。

## 服务

- 单元：`~/.config/systemd/user/workspacealberta-harness.service` （`systemctl --user {status|restart|stop} workspacealberta-harness`）
- 绑定 `127.0.0.1:3081`；`Restart=always`、`RestartSec=5`；注销或重启后继续运行 （`loginctl show-user christian | grep Linger` 必须保持 `yes`）。
- 单元设置 `DSH_HOME=~/.workspaceAlberta`，该值也是本分支的内置 默认值（`packages/util/home-paths` 的 `DSH_HOME_DIR_NAME`），因此服务或手动启动 都解析到相同的主目录。
- 日志：`journalctl --user -u workspacealberta-harness -f`。

## 远程支持与桌面重建

RaspberryPiBot 或 Litter 风格的远程支持使用仓库根目录中的 `bash scripts/wa-desk-rebuild.sh` 重建客户的桌面工作目录（不内联 `pnpm install`）。

## 主目录布局（`~/.workspaceAlberta`）

| 路径 | 内容 |
|---|---|
| `sessions/` | 按工作区路径分组的会话日志（JSONL+zstd） |
| `storages/` | 工作区注册表、消息反馈伴随数据和投影 |
| `profiles/web/` | 配置叠加层（MCP 插入；仅使用非秘密凭据引用） |
| `.credentials.yaml` | 遗留本地凭据存储；产品的 1Password 模式忽略它；经批准后迁移和清理 |

## 备份

- restic 仓库：`/data/backups/workspacealberta-restic`；口令： `~/.config/workspacealberta/backup-passphrase`（0600）。同时丢失仓库 和口令就会失去备份；须在离线位置保存口令副本。
- 每夜 03:00 由 `workspacealberta-backup.timer` 执行；保留策略为 `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`。
- 手动备份：`systemctl --user start workspacealberta-backup.service`。
- 已规定的恢复验证（每季度演练）：

  ```sh
  export RESTIC_REPOSITORY=/data/backups/workspacealberta-restic
  export RESTIC_PASSWORD_FILE=~/.config/workspacealberta/backup-passphrase
  restic snapshots                      # pick a snapshot id
  restic restore <id> --target /tmp/r  # then diff against the live home
  ```

- 恢复到新主机：安装服务单元，从备份仓库恢复 `~/.workspaceAlberta`， 在代码工作目录执行 `pnpm install && pnpm build:lib:host && pnpm build:web`， 再执行 `systemctl --user enable --now workspacealberta-harness`。

## 秘密

- 按 [1Password 设置与轮换](ONEPASSWORD.zh.md) 完成获批保管库访问和服务切换。该来源拒绝本地凭据写入和环境回退。仅在验证迁移后才删除含秘密的 `EnvironmentFile` 指令。
- 如需经批准地分离搜索与模型密钥，在 `onePassword.refs` 增加 `COHERE_SEARCH_API_KEY` 字段映射，并把搜索配置的 `apiKeyEnv` 设为该名称。在 1Password 配置其值。
- Composio 是其他产品的 WorkspaceAlberta 连接层；不要在 harness 配置增加 `mcp-composio`。

## 已记录的缺口

- `lefthook.yml` 已移除推送时的类型检查（并发智能体构建时不稳定， 约需 3 分钟）；CI 拥有该检查，依赖它之前须配置 CI。
- 遗留全局 `wa web`（npm 安装，端口 3080，自 8 月 28 日存在的进程）仍 使用旧的 `~/.dsh`；重启它会重新创建该目录。应在合适时清理它， 受支持的启动方式为 `systemctl --user`。
