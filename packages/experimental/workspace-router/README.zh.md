# @workspacealberta/wa-experimental-workspace-router

[English](README.md) | 中文

这是按需启用的 Jev 决策树，用于 WorkspaceAlberta 采购请求。`workspace_route` 工具选择一个现有 MCP 操作，检查明确提供的输入和已知招标编号，然后返回建议，或通过 Harness 的受保护 ToolRuntime 执行操作。[Agent Note](../../../.agents/notes/implemented/feature/2026-09-19-jev-workspace-decisions.md) 说明职责归属及取舍。

## 配置

插件要求提供 `tools`，分别指定 `search`、`match`、`details`、`deadlines` 和 `bid_room` 的确切工具名称；`minConfidence`，为每个操作指定阈值；以及 `referenceConfidence`。阈值取值为零到一，没有默认值。应通过部署环境中的已标注样本评估来选择阈值：置信度描述答案分布，并不代表权限或正确性。`mode` 默认为 `recommend`；`execute` 允许调用一次受保护的子工具。两种模式下，所选工具不可用都会明确报错。

`apiKeyRef` 默认为 `TYPESAFE_API_KEY`，在激活和每次调用时通过 `ctx.credentials` 解析。`baseURL` 默认为 `https://api.typesafe.ai`，`model` 默认为 `jev-latest`，`timeoutMs` 默认为 10000。推理只尝试一次，不自动重试。取消或卸载会中止推理并等待在途工作结束。凭据值不会进入问题或会话记录。

`maxRequestBytes` 默认为 32768，限制完整 Jev 请求；`maxResultBytes` 默认为 65536，限制返回的 JSON。`maxReferences` 默认为 32，上限为 254。`maxEvidenceAgeMs` 默认为 900000。输入超限会在推理前失败。子工具结果超限时，会提示操作可能已完成；重试前应检查其产物。

## 决策行为

调用方提供用户请求，以及明确的关键词、企业资料、来源、时间范围、数量限制或检索到的招标记录。记录包含确切编号、标题和以 Unix 毫秒表示的检索时间。Jev 接收这些状态，并同时回答操作选择问题及存在候选记录时的编号选择问题。仅所选分支使用的编号答案影响决策。路由器复制编号和企业信息，不生成缺失参数。

搜索要求关键词；匹配要求企业描述；详情和投标室分析要求置信度足够且未过期的唯一编号。歧义或输入缺失返回 `clarify`。置信度不足、通用或复合请求、服务故障及格式错误的响应返回 `fallback`，交给推理模型处理。这些结果不会调用采购工具。已接受的调用仅向支持相应字段的操作传递来源、天数和数量限制。

会话在推理前记录不含凭据的完整推理请求和策略，在分派前记录相关且经过验证的答案及决策，并记录已结束的子工具结果。将 `/invariant` 伴随插件与不变量注册表一起加载，可强制检查此顺序。只有组合中包含会话持久化提供方时，日志才会持久保存。

## 配置教程

1. 在本地环境或根目录 `.env` 中配置 `TYPESAFE_API_KEY`、`DEEPSEEK_API_KEY` 和 `WORKSPACEALBERTA_MCP_URL`。MCP 端点必须提供五个现有 WorkspaceAlberta 工具。如果服务器要求身份验证，请在 MCP 客户端配置中添加相应设置。
2. 将 `WORKSPACE_ROUTER_THRESHOLDS` 设为包含五个操作阈值的 JSON 对象，将 `WORKSPACE_ROUTER_REFERENCE_CONFIDENCE` 设为编号选择阈值。缺失值会导致配置验证失败。
3. 将[无界面覆盖配置](../../../examples/headless-agent/workspace-router.cordis.yml)加载到[无界面示例](../../../examples/headless-agent/README.md)中。要求智能体针对具体采购请求调用 `workspace_route`。检查返回的建议和记录的证据后，再将 `mode` 改为 `execute`。

如需通过仓库 Loader 驱动查看开发跟踪，请在仓库根目录运行：

```sh
node --import tsx/esm examples/headless-agent/tests/fixtures/headless-driver.ts examples/headless-agent/workspace-router.cordis.yml "Use workspace_route to search for steel fabrication opportunities. Keywords: steel fabrication."
```

该命令打印示例的测试 JSONL 事件流。定向的真实分类器检查命令为 `pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/workspace-router/tests/jev.e2e.ts`；缺少 `TYPESAFE_API_KEY` 时会跳过，并为合成的已标注请求报告选择、置信度、延迟和 token 用量。这组小规模冒烟样本不校准部署阈值，也不计算成本。

## 模型体验

### 路由工具与辅助问题

#### 模型看到什么

推理模型看到 [workspace_route 工具 schema](../../../docs/tool-catalog.md#workspacealbertawa-experimental-workspace-router)，以及包含 `decision`、可用证据和子工具 `execution` 的 JSON。它询问缺失信息、继续推理、展示建议或总结已执行结果，而不重复执行。Jev 看到提供的请求和状态，以及有限范围的 Choice 问题。通用 UI 渲染展示相同 JSON，没有终端或差异视图。

#### Token 影响

工具启用期间，其 schema 给每次推理请求增加固定开销；结果追加到会话历史。每次调用增加一次辅助推理请求，包含明确状态和独立问题，并受 `maxRequestBytes` 限制。相关模型用量随决策记录。

#### KV 缓存影响

插件加载期间，推理模型的工具 schema 保持稳定。路由结果追加在可复用前缀之后。Jev 接收变化的状态和候选选项；插件不保证辅助模型缓存复用。

## 已知限制与延后工作

- 此私有原型不包含在发行包中。它是显式工具，不会自动分类会话，也不修改智能体循环或 WorkspaceAlberta 服务器。
- 它不评分投标资格、不自行检索证据、不提取自由文本参数，也不保证重试时 MCP 副作用仅发生一次。调用方提供的检索时间必须可信。
- 调用方的请求、企业资料和招标标题会发送到配置的 TypeSafe 端点。真实 Jev 的质量、延迟、成本和生产阈值需要部署评估；无密钥测试仅验证路由及生命周期行为。
