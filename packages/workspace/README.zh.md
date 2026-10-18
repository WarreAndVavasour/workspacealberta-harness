---
description: "workspace 组地图：持久工作区实体家族、用户目录的持久记录与基于会话头的成员资格记账，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/workspace

[English](README.md) | 中文

## 概述

workspace 组提供持久目录项目与对话级交付计划。`workspace` 将会话归入命名目录，移除目录项目时不会删除会话历史。`project-tools` 为主模型提供持久项目检查点与有界 Jev 文档分类。按需选择目录导航、持续企业工作或两者；各自状态归属不同组件。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`workspace`](workspace/README.zh.md) | 提供命名且有序的项目，并在每个目录下聚合其会话 | `ctx.workspaceRegistry` |
| [`project-tools`](project-tools/README.zh.md) | 保存对话项目计划，并用 Jev 分类带引用文档章节 | 仅工具 |
| [`workspace-router`](workspace-router/README.zh.md) | 使用 Jev 建议或受保护地执行一个现有采购操作 | 仅工具 |

-----

<a id="related-documentation"></a>
## 相关文档

- [采购路由](../../docs/subsystems/workspace-router.zh.md) — 受限 Jev 判断与受保护执行。
- [Workspace 子系统](../../docs/subsystems/workspace.zh.md)——项目及其会话的权威功能约定。
- [领域 KV 存储 Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)——项目记录背后的存储设计。
- [Workspace UI 产品流 Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.zh.md)——首次启动如何从会话历史构建项目，以及 GUI 如何排序。
- [删除 Workspace 注册记录决策](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.zh.md)——为什么移除项目绝不会删除其文件夹或会话。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
