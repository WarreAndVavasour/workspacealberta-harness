---
description: "在 WorkspaceAlberta 设置中直接添加、授权和管理 MCP 服务器；配置允许的 OAuth 回调来源和宿主加密存储。"
kind: "package-reference"
---

# @workspacealberta/wa-mcp-connections

[English](README.md) | 中文

## 概述

在**设置 → 连接**中添加远程 MCP 服务器或本地服务器命令。通过受保护服务器自己的 OAuth 授权页面登录。已保存的连接在重启后恢复；在同一页面启用、停用、重新连接、编辑、忘记登录或移除。发现的工具通过 MCP 客户端进入现有 Harness 工具管线。无需集成供应商账户。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web bundle 将此服务与设置、凭据、工具和经过身份验证的浏览器连接一起挂载。

### 添加和管理服务器

打开设置，选择连接，再选择**添加连接**。对于远程服务器，输入 MCP URL；需要登录时选择 OAuth。保存后选择**登录**，打开服务器的授权页面。对于本地服务器，输入命令和参数；可选的环境变量值引用现有 Harness 凭据名称，而不粘贴密钥。

停用保留已保存的连接和授权，同时移除其工具。重新连接刷新工具发现。忘记登录会停用连接并删除此终端的授权；供应商端撤销仍需单独操作。移除还会删除已保存的连接。一个服务器失败不会阻止另一个服务器连接。

### 部署配置

默认 OAuth 回调来源为 localhost 和 127.0.0.1 的 3080、3081 端口。对于 Tailscale 或 HTTPS 部署，在 `callbackOrigins` 中设置精确的浏览器来源；浏览器主机也必须被现有浏览器连接信任。回调返回该来源的 `/?mcp_oauth_callback=1`。远程 OAuth 要求 HTTPS；开发环境支持环回 HTTP。

```yaml
- id: mcp-connections
  name: '@workspacealberta/wa-mcp-connections'
  config:
    callbackOrigins: ['https://terminal.example.ca']
```

`storageDirectory` 可选择加密授权目录。默认目录是 Harness 主目录下的 `mcp-connections/oauth`。恢复这些记录时，请保留现有的浏览器会话密钥。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

连接元数据存储在 `mcp-connections` 设置命名空间中。MCP SDK 负责授权发现、动态客户端注册、PKCE、资源验证、授权码交换和刷新。一次性登录状态在十分钟后过期，并绑定到已保存的服务器；编辑、移除和关闭都会取消待完成的登录。浏览器回调在调用经过身份验证的宿主 Remote 前，从地址栏清除授权码和状态。

OAuth 令牌、客户端注册和发现状态使用 AES-256-GCM 加密，独立的 HKDF 密钥从现有浏览器会话密钥派生。关联数据将每条记录绑定到连接 id 和服务器 URL。待完成的 PKCE 验证器仅保留在内存中。移除或更改服务器时，在删除授权前关闭其 OAuth 适配器，因此迟到的 SDK 写入无法恢复已删除的授权。连接视图和设置中不包含凭据。

现有 MCP 监督器负责传输代次和工具注册。设置更改分别协调各连接；插件卸载会关闭传输并注销工具。此服务同时拥有已保存的元数据和实时连接句柄，因此不发布独立的不变量伴随模块。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [MCP 客户端](../mcp-client/README.zh.md)——发现和工具执行。
- [设置](../../settings/settings/README.zh.md)——持久连接元数据。
- [浏览器连接](../../client/connection/README.zh.md)——经过身份验证的访问。

-----

<a id="model-experience"></a>
## 模型体验

### 已连接的 MCP 工具

#### 模型看见什么

已启用的服务器通过现有 MCP 客户端贡献所发现工具的描述和输入 schema。OAuth 授权和连接管理方法不是模型工具。工具执行遵循现有的执行和会话记录路径。

#### Token 影响

服务器连接期间，发现的工具 schema 增加请求 token。已停用或移除的服务器不贡献工具 schema。

#### KV Cache 影响

未变化的工具集合保留工具定义前缀。启用、停用或更改服务器的工具可能改变该前缀，并降低缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下边界定义支持的连接流程。

- OAuth 登录要求远程 MCP 服务器支持标准 OAuth 发现和动态客户端注册；此处不配置手动客户端注册或任意 SaaS API。
- 本地命令在 Harness 宿主运行。仅桥接 MCP 工具；资源和提示不属于此界面。
- 设置页面打开时轮询连接状态。此界面不提供供应商端令牌撤销或组织共享凭据存储。
- Harness 重启会取消待完成的登录。丢失或轮换宿主浏览器会话密钥后，需要忘记受影响的授权并重新登录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

将 OAuth 凭据保留在宿主 API 后面，并在更改 SDK 适配器生命周期前验证取消行为。

</details>
