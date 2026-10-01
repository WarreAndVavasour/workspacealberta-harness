# Agent Note: 只读 1Password 运行时凭据

Status: implemented

[English](2026-10-01-onepassword-runtime-source.md) | 中文

## Problem

workspaceAlberta 部署承诺集中存储秘密，但通用凭据提供者在本地持久化密钥和插件记录，并接受环境变量回退。浏览器启动还需要签名秘密记录；仅注入 API 密钥不能满足部署要求。

## Decision

[产品配置](../../../../workspace-alberta.patch.yml) 在现有凭据提供者中选择只读模式。引用名称和插件记录地址都映射到 1Password 字段 URI。每次操作通过 CLI 在内存中读取值，并限制时间和输出大小；诊断不包含 CLI 输出或解析器源文本。启动验证所有映射字段和记录。通用本地组合保留其原有行为。

提供者在调用变更回调前拒绝凭据写入，并禁用模型提供者的环境变量和文件凭据发现。浏览器启动读取预先配置的签名记录，不创建本地秘密。普通子进程环境不继承 `OP_*` 身份验证。诊断配置导出隐藏凭据字面值，现有配置来源检查拒绝产品配置中的字面值。

## Alternatives considered

`op run` 将 API 密钥注入宿主环境，但不集中存储持久浏览器或 OAuth 记录。远程读取后编辑项目不能满足现有跨进程变更保证；因此运行时不提供 1Password 写入。删除通用本地模式会破坏无关的受支持组合，而不会改善本部署。

## Consequences

交付前操作员必须配置浏览器签名记录并批准 CLI 访问。密钥变更影响下一次操作，不写入本地文件。保管库读取失败阻止激活；API 密钥界面写入和 OAuth 记录变更被拒绝。有独立凭据来源的可选集成和备份服务需要明确的切换审查。[操作员设置](../../../../docs/ops/ONEPASSWORD.zh.md) 描述步骤和访问缺口。针对性测试使用合成字段执行实际子进程协议；已授权保管库访问是独立的交付证据。

[凭据分层决策](2026-08-04-credentials-yaml-and-user-environment-layer.zh.md) 和[记录格式决策](2026-08-13-credential-records-and-authorization-flows.zh.md) 仍适用于通用组合；本模式部分取代它们在产品配置中的应用。
