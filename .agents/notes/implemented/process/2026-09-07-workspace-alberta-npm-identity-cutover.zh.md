# Agent Note: Workspace Alberta 的 npm 与 CLI 身份切换

Status: implemented

[English](2026-09-07-workspace-alberta-npm-identity-cutover.md) | 中文

## Problem

产品以 Workspace Alberta / Warre & Vavasour 运营，但第一方 npm 名称、TypeScript 模块说明符和操作员 CLI 仍使用 DeepSeek Harness 身份（DeepSeek 作用域下的 `dsh-*` 包、根包 `dsh-root`、命令 `dsh`）。操作员和包消费者无法把本仓库当作独立产品。

## Decision

第一方 npm 作用域为 `@workspacealberta`。原先 DeepSeek 作用域下的 `dsh-<name>` 包现为 `@workspacealberta/wa-<name>`；CLI 包为 `@workspacealberta/wa`；工作区根包为 `@workspacealberta/wa-root`。Vendored Cordis 包在同一作用域下保留无前缀名称（`@workspacealberta/cordis`，以及 [docs/rescope.md](../../../../docs/rescope.zh.md) 中的其余八个映射名）。已经使用 `@workspacealberta` 且没有 `dsh-` 前缀的包（`ui-alberta-grid`、`web-search-cohere`）保持原名。

面向用户和 systemd 的 CLI 为 `wa`（`pnpm wa`、`apps/cli` 的 bin、Commander 程序名、发布族 id `wa`、标签前缀 `wa-v`）。包清单里的 `dsh` 键仍是 Loader 已读取的 profile/bundle 元数据字段；改它会变成另一次磁盘格式变更。`DSH_HOME` 等环境变量保持不变，以便现有 Pi 单元继续解析 `~/.workspaceAlberta`。

产品文档（`README.md`、`WORKSPACE_ALBERTA.md`、`CONTRIBUTING.md`、`BRAND_GUIDELINES.md`、`AGENTS.md`、`workspace-alberta.patch.yml`、`workspace-alberta-apc.patch.yml`）把 Workspace Alberta 写成产品本身，而不是 DeepSeek Harness 的 profile 或补丁层。APC 启动器运行 `pnpm wa`。MIT 版权与第三方声明仍是法律归属的存放处。

已归档 Agent Note 不改写：它们是带哈希封印的历史快照，且 `.rgignore` 已把该树排除在仓库搜索之外。`LICENSE*` 和 `THIRD_PARTY*` 文件保留上游版权字符串。

## Alternatives considered

**只改 npm 作用域，保留 `@workspacealberta/dsh-*`。** 否决，因为产品指令禁止继续发布 DSH 包族。`dsh-` → `wa-` 前缀是 CLI 重命名的机械对应，并保持第一方包族一致。

**改用 `@warre-vavasour/`，或去掉每个包上的 `wa-` 前缀。** 否决：`@workspacealberta` 已用于 Cohere 搜索和 Alberta Grid 包；去掉 `dsh-` 又不加替代前缀会与 `session`、`web` 等短名冲突。新的第一方包继续使用 `@workspacealberta/wa-<pkg>`，除非已有产品专用名称。

**在同一次变更中重命名 `DSH_*` 环境变量和清单中的 `dsh` 元数据键。** 否决：它们是已部署单元和 profile bundle 的运行时与磁盘约定。本次切换是身份和导入解析，不是主目录或 bundle 格式升级。

**改写已归档 Agent Note，使即使加上 `--no-ignore`，DeepSeek 作用域搜索也为空。** 否决：归档封印禁止改内容，且文档中的成功标准搜索已通过 `.rgignore` 排除该树。

## Consequences

每个第一方导入、`package.json` 名称、tsconfig 路径和 `cordis.yml` 插件行都必须使用 `@workspacealberta`。`pnpm install` 和 `pnpm run build` 必须解析新名称。操作员输入 `wa`，而不是 `dsh`。`publishOrder` 按安装边排序，不依赖按包名 DFS 的访问顺序，因此像 `ui-alberta-grid` 这种排在 `wa-*` 前面的既有作用域包不能把 host-apiproxy → api-remotes 安装边反转。Issue policy 对话的是当前 GitHub 仓库（`GITHUB_REPOSITORY`），而不是写死的上游 owner/repo。若以后要重命名 `DSH_HOME` 或 `manifest.dsh`，需要单独的格式/版本决策和集群迁移。
