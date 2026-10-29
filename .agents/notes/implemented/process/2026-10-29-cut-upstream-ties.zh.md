# Agent Note: 切断剩余的 DeepSeek Harness 上游关联

Status: implemented

[English](2026-10-29-cut-upstream-ties.md) | 中文

## Problem

[身份切换](2026-09-07-workspace-alberta-npm-identity-cutover.zh.md)之后，仓库在运行时、CI 与包元数据中仍指向 DeepSeek Harness 项目。九个 pull request 检查失败，原因都可追溯到该项目：

- `Issue policy` 与 `Issue lifecycle` 为一个只在上游组织中配置的 GitHub App（`DSH_ISSUE_APP_*`）签发 token，并读取上游 Project 看板。
- `Release (dsh)` 传入 `--family dsh`，而 `scripts/release/families.ts` 已不再定义该族。
- `Dependency layout` 拒绝了 `ui-alberta-grid` 的三个 peer，且三个 `wa` 发布成员的版本不在该族的统一版本上。
- Python 运行时冒烟测试对比的快照仍写着 `@deepseek-ai/dsh-system-prompt`。
- `E2E` 下载的 bubblewrap 构建已被 Ubuntu 归档池删除。

已发布代码还以 `deepseek-harness` 作为 `User-Agent` 产品标识并附带上游仓库 URL，每个 `package.json` 的 `repository.url` 都指向 `deepseek-ai/deepseek-harness`，Python 运行时的 node 模式会在 `@deepseek-ai/dsh` 下查找 CLI。

## Decision

- 删除 `issue-policy.yml`、`issue-lifecycle.yml`、`.github/issue-management/`、其 `test:issue-management` 脚本与门禁条目，以及 `ci-workflow.spec.ts` 中对应的测试块。Warre & Vavasour 的替代方案需要自己的 GitHub App。
- 将工作流中的发布族改名为 `wa`（`--family wa`、`wa-v*` tag、`Release (wa)`、`wa-npm-tarballs`），并把 `ui-alberta-grid`、`session-episode-recorder`、`web-search-cohere` 对齐到族版本。
- `ui-alberta-grid` 只保留 `@workspacealberta/cordis` 这一个 peer；它使用的其他 workspace 包按 `verify-package-dependencies` 的要求只作为 dev 依赖。
- 从 Launchpad librarian 下载 bubblewrap（它保留每个已发布的构建），并固定当前安全构建 `0.9.0-1ubuntu0.3`。
- 所有仓库 URL、User-Agent 注释、Python 项目 URL 与文档链接都指向 `github.com/WarreAndVavasour/workspacealberta-harness`；User-Agent 产品标识为 `workspacealberta-harness`。
- 将快照、测试、脚本与 `docs/rescope.md` 中的 `@deepseek-ai` 名称替换为对应的 `@workspacealberta` 名称，并删除目录生成器输出的旧 `#deepseek-aidsh-*` 锚点。
- 从 `README.zh.md` 中删除上游社区区块（CDN 图片、问卷表单）与文档站链接。

DeepSeek 仍是受支持的模型提供方：`api.deepseek.com`、DeepSeek LLM 与搜索包，以及真实 API e2e 工作流保持不变。

## Alternatives considered

**将 Issue 工作流改接到 Warre & Vavasour 的 GitHub App。** 暂缓：目前没有这样的 App，检查会一直失败，直到创建一个。

**把 `vendor/README.md` 与 `THIRD_PARTY_NOTICES.md` 中 vendored 包的来源改写为原始上游。** 否决：记录的 commit 只存在于 `cordis`、`cosmokit`、`schemastery` 的 `deepseek-harness` fork 中，换成其他 URL 会错误陈述 vendored 源码的出处。这些行是归属声明，不是运行时调用。

**重命名 `DSH_*` 环境变量与内部 `dsh` 标识符。** 暂缓，理由见身份切换 note：它们是运行时与磁盘格式契约。

## Consequences

没有任何 CI 作业、运行时请求或包 manifest 依赖上游 GitHub 组织、npm scope、CDN 或 issue 机器人。vendored 来源行、已归档的 Agent Note，以及描述过往决策的已实施 note 仍以历史身份提及上游项目。
