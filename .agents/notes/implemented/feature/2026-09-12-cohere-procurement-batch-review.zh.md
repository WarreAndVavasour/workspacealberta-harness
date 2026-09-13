# Agent Note: Cohere batch procurement review in the harness

Status: implemented

[English](2026-09-12-cohere-procurement-batch-review.md) | 中文

## Problem

Workspace Alberta 采购工作需要有依据、可引用的批量标书分析，但 harness 缺少采购专用工具：agent 只能用原始网页搜索临时拼凑并手动处理引用，而任何批量设计都可能带来无界并发的 provider 调用、错误原文泄露与虚构引用。采购 MCP 服务仍是标书数据的权威来源；harness 需要一个有诚实边界的消费侧合成层。

## Decision

harness 新增 `@workspacealberta/wa-procurement-base`（`packages/procurement/wa-procurement-base/`），提供 `procurement_review_batch` 工具：经 Cohere v2 chat 对调用方提供的证据逐条生成有依据摘要，并带原生引用。固定工作池（`concurrency`，默认 3）逐条结算每个请求的条目；超限队列在任何 provider 调用之前失败；可重试失败按上限退避；取消将 settled（已结算）与排队中的条目记为取消。引用记录对照响应原文与所提供的文档清单进行校验，拒收数量可计数。原生 PDF 与视频返回明确的不支持结果；超限或远程图片载荷在任何 provider 调用之前抛出。凭证按批次经凭证通道解析，绝不进入日志或错误文本；携带凭证的请求绝不跟随重定向。Fit 标签归调用方 agent 及其 `wa-procurement-base` skill 细则：需求的抽取绝不记为订阅方能力的验证。

## Alternatives considered

**批量使用无界 subagent 扇出。** 否决：每个商机一个 provider 请求且无并发上限，可能引发限流风暴，并将批量延迟与最慢条目绑定；工作池以固定上限实现同样的单条隔离。

**在采购 MCP 服务端新增批量端点。** 本次否决：合成凭证、模型边界与引用校验属于 harness 部署侧关切；MCP 服务保持数据与授权 API 定位，本工具像其他证据源一样消费它。

**宽松的引用修补（模糊跨度、猜测来源）。** 否决：修补后的引用看似证据，实则无处可指；拒收并升级才能让缺口可见。

## Consequences

100 个以上的商机可安全排队，逐条结果可观测，失败码固定；代价是相对并行扇出的延迟：吞吐受 `concurrency` 约束，超限证据需符合单次调用的文档与图片预算或由调用方拆分。PDF 抽取与视频帧采样仍是本工具报告而不填补的明确缺口。

## Testing

单元覆盖锁定队列边界（125 条在峰值并发 3 下结算、重试上限、取消、超限拒绝）、引用校验（Unicode 偏移、虚构 ID、错位跨度）、媒体拒绝、凭证分层、配置解析与 provider 错误映射，全部使用固定值与桩传输。真实 Loader 组合测试证明配置边界改变工具行为、每个请求的条目均有结算；桩传输仅用于测试，绝不作为线上验证呈现。
