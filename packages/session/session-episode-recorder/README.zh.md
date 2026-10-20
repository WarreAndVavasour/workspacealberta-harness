# wa-session-episode-recorder

[English](README.md)

`episodeRecorder` 投影单元：将会话日志中的工具调用→结果对、审批决策和
`classify_tender` 清单折叠为按需求划分的episode轨迹（`wa.episode.v1` 形状），
并通过会话投影接缝提供服务。

一个episode = 一份RFP中的一个需求。从 `classify_tender` 结果中嗅探到的清单
（`wa.tender_requirements.v1`）生成episode头；后续步骤在工具名称、参数或
结果文本提及某个需求的 id 时归属到该需求；未提及任何需求的步骤保留在
`unscoped` 桶中。人工结果标签（看板清单）是另一个关注点 —— 模型永远不会
代替用户标记完成。

仅主机端：该投影不携带客户端视图。使用者是episode导出器
（仓库根目录的 `scripts/export-episodes.ts`），以及后续的看板标签同步。

产品原理与模式参见 `docs/episode-capture.md`。
