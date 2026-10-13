# Agent Note: WorkspaceAlberta 中的原生 MCP 连接

Status: implemented

[English](2026-10-13-native-mcp-connections.md) | 中文

## 问题

企业主需要从 Harness 界面连接工具。要求单独的集成供应商，会为未使用的连接路径增加账户和部署依赖。

## 决定

[原生 MCP 连接](../../../../packages/mcp/mcp-connections/README.zh.md) 负责持久连接元数据、本地加密 OAuth 授权，以及设置使用的经过身份验证的 Remote。维护中的 MCP SDK 负责标准授权；现有 MCP 客户端向 Harness 贡献发现的工具。Web bundle 挂载服务，设置插件贡献连接分区。

## 考虑过的替代方案

**Composio 或 Nango：**供应商可以管理应用专用 OAuth 和连接器目录，但所需界面直接连接 MCP 服务器，无需额外账户或服务。标准 MCP 授权提供所需连接流程。

**仅配置 MCP 服务器：**组合条目仍适用于部署拥有的工具，但无法让企业主在设置中添加、登录和管理已保存的服务器。

## 后果

凭据保留在宿主，以现有浏览器会话密钥派生的密钥加密，不出现在连接元数据中。丢失该根密钥后需要重新登录。登录状态一次性使用，十分钟后过期，并在编辑、移除和关闭时取消。忘记登录会停用连接并移除本地授权；不会撤销供应商端访问。OAuth 当前要求标准 MCP 发现和动态注册；各 SaaS 连接器实现仍由所连接的服务器负责。
