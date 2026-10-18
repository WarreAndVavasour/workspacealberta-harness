---
description: "使用 Jev 分类文档章节，并在持续的 harness 对话中保存企业项目计划。"
kind: "package-reference"
---

# @workspacealberta/wa-project-tools

[English](README.md) | 中文

## 概述

编制提案前先分类来源章节，再将项目计划和交付证据保存在同一对话中。Jev 提供受限判断；主模型负责规划并使用 harness 的可用工具。挂载会话持久化后，检查点可跨轮次和重新加载保留。每个资料批次产生一次辅助 TypeSafe 请求。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [开发说明](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

与工具、文件系统、凭据、会话和会话持久化提供者一起挂载插件。必须提供 `minConfidence`；请依据部署的已标注样本选择。已启用的企业部署与凭据引用见[项目交付指南](../../../docs/user/workspace-projects.zh.md)。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyRef` | `TYPESAFE_API_KEY` | 服务端 TypeSafe 凭据引用 |
| `baseURL` | `https://api.typesafe.ai` | TypeSafe API 根地址 |
| `model` | `jev-1.14.0` | 固定分类器版本 |
| `minConfidence` | 必填 | 低于此置信度时交回章节供复核 |
| `maxRequestBytes` | `32768` | 完整序列化辅助请求的大小上限 |
| `enableImages` | `false` | 允许 PNG/JPEG 检查；企业覆盖配置已启用 |
| `maxImageBytes` | `4194304` | 完整图像文件字节上限 |
| `enableLongContext` | `false` | 允许显式较大文本批次；企业覆盖配置已启用 |
| `maxLongRequestBytes` | `1048576` | 较大文本批次的完整 JSON 字节上限 |
| `maxLongSections` | `128` | 较大批次章节上限；最多 256 |
| `maxSections` | `16` | 单请求章节数；最多 64 |
| `maxCheckpointBytes` | `65536` | 所提供完整项目计划的大小上限 |
| `timeoutMs` | `10000` | 单次推理尝试的时限 |

`project_read` 返回最新计划及调用代理可见的工具。`project_checkpoint` 使用预期修订号替换完整计划；冲突后须重新读取并协调。`project_classify_sections` 将提供的原文和引用发送给 TypeSafe，一并分类独立章节，并返回概率与复核标志。`project_inspect_image` 通过已配置文件系统读取有界本地 PNG/JPEG，返回页面类型、专家审核概率及归一化 Box。图像字节与 SHA-256 随请求保存以供重放。它发送 Images 请求头；仅当显式要求 `useLongContext` 且请求超过 `maxRequestBytes` 时，文本发送 Long-Context 请求头。禁用的路径在推理前报错。这些工具不执行采购操作。缺少凭据、无效回答和提供者失败会产生工具错误；主模型可继续普通推理。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

会话日志保存项目检查点和不含密钥的推理记录。检查点在追加前验证唯一标识、来源引用、无环依赖和产物位置。进行中或已完成任务要求依赖已完成。保存会等待会话持久化屏障；没有写入者或刷新失败会报告错误，因此重试前须重新读取。完整状态替换使并行的陈旧写入失败，避免覆盖新工作。推理遵循调用取消和插件卸载。此包使用现有工具与凭据服务，不新增提供者服务。不发布 invariant 伴随入口：检查点没有独立维护的缓存或投影可与日志比较。

</details>

<a id="dev-note"></a>
## 开发说明

[决策记录](../../../.agents/notes/implemented/feature/2026-10-14-cohere-project-recovery.zh.md) 区分已实现的资料分类与检查点，以及拟议的规划工作代理实验。

<a id="model-experience"></a>
## 模型体验

### 项目工具

#### 模型看到什么

四个工具的模式与 JSON 结果提供章节分类、所给引用、可用工具、当前修订、阻塞项和报告的产物。继续项目时主模型必须调用 `project_read`；不安装自动上下文注入或自主调度器。

#### Token 影响

工具说明增加请求开销。资料文本或图像字节进入一次辅助 Jev 请求，其分类结果加入主模型历史。项目文档保留在来源产物中，而不塞进有界检查点。

#### KV Cache 影响

工具定义在激活期间保持稳定。结果追加到对话历史；此包不保证复用 Jev 推理缓存。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 分类不等于信息抽取、资格核验或投标授权。所给引用、来源哈希和产物位置均作为声明记录；本插件不读取或独立核验内容。完成状态由调用方报告，不代表人工验收。主模型通过已连接工具负责解析、综合和验证。项目归属单个对话；请保留同一对话和持久化 harness home。不提供后台恢复、多设备协调、外部操作恰好执行一次、PDF 渲染、OCR 转录或成本改善保证。图像与长上下文能力仍属实验性质。字节限制不保证符合提供者 token 限制；被拒批次须拆分。低置信度区域须视觉复核。图像记录增加会话磁盘用量。企业复核阈值 0.9 是临时策略，未经校准；任何分类均不授权业务操作。
