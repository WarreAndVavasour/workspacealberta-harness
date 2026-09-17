# APC 账户连接

[English](README.md) | 中文

此本地 MCP 连接器允许 Cohere harness 打开 APC 登录、保留专用浏览器会话，并下载商机文件和补遗。请在用户登录的桌面上运行：带图形会话的 Raspberry Pi，或 Windows/Linux/macOS 工作站。无需 Codex、APC API 密钥或 GitHub 中的 APC 密码。

## 设置与测试

前提：Python 3.11+、仓库的 Node/pnpm 依赖及 Web 构建，以及图形桌面。Linux 上若安装程序提示缺少库，请安装 Playwright 的 Chromium 系统依赖。在仓库根目录运行：

```sh
python integrations/apc/run.py setup
python integrations/apc/run.py test
python integrations/apc/run.py start
```

为 harness 保留 `COHERE_API_KEY` 配置。启动器同时应用 Cohere 部署和本地 APC 配置，在 `http://127.0.0.1:3081` 提供应用。请先停止占用该端口的 harness。安装会创建被 Git 忽略的 Python 虚拟环境，启动器自动选择其中的解释器。

在 harness 聊天中说 **“Connect APC.”** Cohere 调用 `mcp__apc_local__apc_connect`，在主机上打开专用 Chromium 窗口。在 APC 官方页面登录并完成人工验证，然后说 **“Download the documents for AB-2026-05716.”** 如果 APC 再次要求验证，在同一窗口完成后说 **“Resume the APC download.”** 待处理商机在进程重启后仍保留。连接器不在后台轮询，也不会在没有后续工具调用时自动继续。

下载会以登录的供应商账户表达兴趣并订阅商机更新，工具说明已披露此效果。连接器不提交投标、不更改合作关系、不发送邮件。不会导入个人 Chrome 会话：请在专用窗口首次登录。账户必须仍关联 APC 供应商企业。

## 连接与存储

四个工具按情况返回 `connected`、`sign_in_required`、`verification_required`、`download_failed` 或 `downloaded`。浏览器错误和无效输入成为 MCP 错误。账户连接不代表文件访问成功；只有完整下载凭据才能证明文件已获取。模型不能传入任意 URL、浏览器脚本、密码或 Cookie。工具结果使用现有 MCP 客户端的通用呈现和会话日志。

默认存储目录为 `~/.workspacealberta/apc`。`browser-profile/` 包含敏感会话数据；`pending.json` 标识中断任务；`opportunities/<APC-reference>/` 包含按内容寻址的文件和原子更新的 `manifest.json`。凭据记录来源页面、获取时间、字节数及 SHA256。浏览器或 E2B 关闭后文件仍保留。重试重新获取当前列表；相同内容覆盖同一文件，变化的版本另行保留。只有全部下载完成才标记 `complete: true`。部分文件不代表已完成 RFP 审阅。

这些工具不导出浏览器凭据或登录页面内容，不记录浏览器追踪，也不将它们发送到 E2B。返回的文件可用于下游处理。这并不构成与同一操作系统用户运行的其他工具之间的隔离：请保护主机账户，将浏览器配置文件排除在模型文件访问和共享备份之外。POSIX 目录仅允许所有者访问；Windows 使用用户目录 ACL。一个进程拥有一个账户配置文件；并发进程必须使用不同的 `WA_APC_HOME`。多用户 Web 部署需要独立操作系统账户或等效隔离。

启动前从主机环境读取配置：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `WA_APC_HOME` | `~/.workspacealberta/apc` | 私有账户配置及文件存储 |
| `WA_APC_CHROMIUM` | Playwright Chromium | 可选浏览器路径，包括 Pi 系统 Chromium |
| `WA_APC_TIMEOUT_MS` | `20000` | 每个浏览器操作的超时 |
| `WA_APC_MAX_DOCUMENTS` | `64` | 商机文件数量上限 |
| `WA_APC_MAX_BYTES` | `104857600` | 下载后每个文件的接受大小上限 |

MCP 配置允许每次工具调用四分钟。大型列表可能超时：待处理凭据仍保留，用户可重试。文件大小限制用于验证已收到的文件，不限制网络传输。APC 页面变化、文件限制、会话过期或人工验证可能阻止获取；连接器不会绕过这些检查。没有图形桌面的 Pi 无法显示登录窗口；不包含远程嵌入式登录或专用 Connections 设置面板。

## 验证

`run.py test` 使用真实 Chromium、本地门户夹具和实际 stdio MCP 服务器。提交的示例记录涵盖工具发现、拒绝路径输入、登录交接、继续下载六个文件、将哈希与保存内容比对以及关闭后的持久化。浏览器回归测试覆盖验证交接、Cookie/任务持久化、页面结构变化和保留登录页面。CI 不需要真实 APC 凭据；用户的实际测试单独验证当前 APC 兼容性。
