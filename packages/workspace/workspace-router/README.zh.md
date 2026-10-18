---
description: "通过现有 harness 工具进行受限的 Jev 采购路由。"
kind: "package-reference"
---

# @workspacealberta/wa-workspace-router

[English](README.md) | 中文

## 概述

可选的 Jev 采购决策工具 `workspace_route` 从明确请求中选择现有 MCP 操作。代码检查输入和已知招标引用，再返回建议或通过受保护的工具运行时执行。它不修改 agent loop，也不让分类器编造企业事实或标识符。 [决策记录](../../../.agents/notes/implemented/feature/2026-09-19-jev-workspace-decisions.zh.md)说明所有权和取舍。

## 目录

- [配置](#configuration)
- [决策行为](#decision-behavior)
- [部署](#deployment)
- [开发说明](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

`tools` 必须提供 search、match、details、deadlines、bid_room 的准确工具名；`minConfidence` 必须提供各操作阈值，另需 `referenceConfidence`。阈值在 0 到 1 之间且无默认值；应依据已标注部署样本选择。`mode` 默认 recommend，execute 允许一次受保护的子调用。置信度不是权限或正确性保证。

`apiKeyRef` 默认 TYPESAFE_API_KEY，通过现有凭据服务解析；`baseURL` 默认 `https://api.typesafe.ai`；`model` 默认 jev-1.14.0；`timeoutMs` 默认 10000。每次推理只尝试一次，不自动重试。取消或卸载会终止推理并等待在途工作结束。凭据不进入问题或会话记录。

完整请求 `maxRequestBytes` 默认 32768；完整结果 `maxResultBytes` 默认 65536；`maxReferences` 默认 32，最大 254；`maxEvidenceAgeMs` 默认 900000。输入过大在推理前失败；子调用后结果过大须先核查产物，不能盲目重试。

<a id="decision-behavior"></a>
## 决策行为

调用者提供 request、明确 keywords、profile、source、days、limit 或候选 references。引用包括准确标识符、标题和 Unix 毫秒检索时间。Jev 同时回答操作和候选引用 Choice 问题；只有选中分支会消费引用答案。代码复制标识符和企业事实，不生成缺失参数。

搜索需要关键词；匹配需要企业描述；详情与 bid-room 分析需要一个明确、新鲜且达到阈值的引用。缺失输入返回 clarify；低置信度、一般或复合请求、服务错误和非法响应返回 fallback。两者均不派发采购工具。API 的两位小数概率保留原值并容许相应累计舍入误差。

会话在推理前记录完整无密钥请求及策略，在派发前记录验证答案和决策，在子调用结束后记录结果。可加载 /invariant 伴随插件来强制该顺序；磁盘保留仍由会话持久化提供者负责。

<a id="deployment"></a>
## 部署

企业 workspace-alberta.patch.yml 在现有 MCP 客户端和原生 Cohere v2 旁以 recommend 模式挂载本包，固定 Jev 1.14，并将五种操作映射到 mcp__workspace_alberta__* 工具。TYPESAFE_API_KEY 通过现有凭据提供者解析。0.9 阈值是暂定审核设置，不是经校准的执行许可。

execute 必须显式配置，并通过现有工具守卫执行。两种模式都不编造缺失输入。选中的工具不可用时报告错误。通用 profile 不自动挂载路由器；基础 bundle 包含此包以支持可选组合。

<a id="dev-note"></a>
## 开发说明

[路由决策](../../../.agents/notes/implemented/feature/2026-09-19-jev-workspace-decisions.zh.md)说明分类器职责。[企业规划提案](../../../.agents/notes/proposed/feature/2026-09-19-jev-business-planning.zh.md)仍为提案。

<a id="model-experience"></a>
## 模型体验

### 路由工具与辅助问题

#### 模型可见内容

推理模型看到 [workspace_route 工具结构](../../../docs/tool-catalog.zh.md#workspacealbertawa-workspace-router)及包含 decision、证据和子执行结果的 JSON。它补问缺失信息、继续推理或总结结果，不重复已执行操作。Jev 看到明确状态及受限 Choice 问题。通用 UI 展示同一 JSON。

#### Token 影响

启用时工具结构给推理请求增加固定开销；结果追加到历史。每次调用增加一次受 maxRequestBytes 限制的辅助推理，记录相应用量。

#### KV Cache 影响

插件挂载期间工具结构稳定。路由结果追加在可复用前缀之后；Jev 接收变化的状态和候选项，不保证辅助缓存复用。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 包随基础 bundle 提供，通用 profile 仍需显式挂载；企业部署默认仅建议。它是显式工具，不是自动对话分类器，不改变 agent loop 或采购服务器。
- 它不判定投标资格、不自行检索证据、不抽取自由文本参数，也不保证跨重试的 MCP 副作用只发生一次。调用方提供的检索时间须可信。
- 请求、企业描述与引用标题发送给配置的 TypeSafe 端点。在线 Jev 的领域准确率、延迟、成本和阈值仍需部署评估；无密钥测试只证明代码和生命周期行为。
