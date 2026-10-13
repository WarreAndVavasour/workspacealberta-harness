---
description: "MCP 包组：挂载外部 Model Context Protocol 服务器，让它们的工具可以作为原生工具调用。"
kind: "package-group"
---

# MCP — 模型上下文协议

[English](README.md) | 中文

## 概述

本组的软件包连接外部 MCP 服务器，使其工具以稳定的服务器限定名称可用。在组合中配置服务器，或在 Web 设置 → 连接中管理用户自己的服务器。仅桥接 MCP 工具；不支持资源和提示。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

各软件包的 README 负责连接管理和传输行为的说明。

| 包 | 提供的能力 |
|---|---|
| [`mcp-client/`](mcp-client/README.zh.md) | 挂载一台外部 MCP 服务器，让模型可以把它的工具当作原生工具调用 |
| [`mcp-connections/`](mcp-connections/README.zh.md) | 在 Web 设置中保存、使用 OAuth 授权并管理用户自己的服务器 |

-----

<a id="related-documentation"></a>
## 相关文档

先用可运行的示例配置体验插件，再阅读 Agent Note 了解其背后的行为决策。

- [MCP 客户端插件 Agent Note](../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.zh.md)——桥接的设计：服务器限定命名、发现、执行与环境清洗。
- [MCP 客户端自动重连 Agent Note](../../.agents/notes/implemented/feature/2026-08-06-mcp-client-auto-reconnect.zh.md)——重连策略、单次中断的尝试预算与退出开关。
- [第三方记忆 MCP 示例 Agent Note](../../.agents/notes/implemented/feature/2026-07-31-third-party-memory-mcp-examples.zh.md)——作为参考配置交付的三个默认关闭的记忆服务器 overlay。
- [第三方记忆 MCP 指南](../../docs/user/guide/mcp-memory.zh.md)——可运行的 overlay 配置行与设置说明。
- [工具子系统参考](../../docs/subsystems/tools.zh.md)——接收已注册工具的 `ToolRuntime`。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
