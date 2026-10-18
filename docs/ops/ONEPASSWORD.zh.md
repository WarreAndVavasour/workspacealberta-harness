---
description: "面向操作员的教程：workspaceAlberta 只读 1Password 凭据来源及经批准的部署切换。"
kind: "tutorial"
---

# workspaceAlberta 1Password 设置

[English](ONEPASSWORD.md) | 中文

[产品部署配置](../../workspace-alberta.patch.yml) 为 API 密钥引用和插件凭据记录选择只读 1Password 来源。[凭据提供者](../../packages/credentials/credentials-local/README.zh.md) 通过有时间和输出限制的 `op read` 子进程读取各字段，仅在内存中捕获输出，不将解析值注入配置文件或宿主环境。CLI 不可用、字段不可访问或为空、记录无效都会阻止启动。该来源不回退到环境变量、`.env` 或 `.credentials.yaml`。

## 操作员设置

1. 在交付主机安装 [1Password CLI](https://developer.1password.com/docs/cli/get-started/)。通过操作员批准的现有桌面会话或最小权限服务账户进行身份验证。账户登录、新服务账户和持久访问配置需要用户参与。不要把身份验证令牌放入仓库或生成的配置文件。
2. 配置部署保管库，并把实际字段引用复制到部署配置。示例地址为 `op://workspaceAlberta/Cohere/api-key` 和 `op://workspaceAlberta/Harness/browser-session-record`；它们是配置地址，不证明项目已经存在。使用桌面应用复制字段引用；可用不可变保管库或项目 ID 替代名称。
3. 在第一个字段存放经批准的 Cohere 密钥。浏览器字段包含 JSON 记录，`kind: "grant"`，以及 `payload: { "version": 1, "secret": "<base64url encoding of 32 random bytes>" }`。通过经批准的私密迁移流程迁移有效的现有浏览器签名记录，或在该流程中生成替代值。绝不输出该值。替换它并重启会使现有浏览器 Cookie 失效。
4. 停止服务以进行切换。删除通过明文 `EnvironmentFile` 加载密钥的指令，并在获批 CLI 身份下使用常规入口 `wa --profile web --patch workspace-alberta.patch.yml`。只有验证保管库迁移后，才清理工作目录或主目录的 `.env` 秘密及 `.credentials.yaml`。代码不会改动遗留文件。
5. 启动服务。成功激活证明全部已配置字段可读且各带类型标签的 JSON 记录有效。确认 Models 凭据视图报告来源为 `1password`、`writable: false`，在浏览器进行身份验证，并执行一次经批准的普通 Cohere 请求。不要使用疑似泄露的密钥测试。保管库失败必须阻止启动；在保管库轮换 API 密钥后，下一次请求必须获得新值，而不改写本地文件。

## 轮换

对于已确认的泄露，在提供方账户中撤销或轮换凭据，将替代值存入 1Password，并批准生产切换。检查提供方审计或用量记录，在撤销后核对扫描器状态；不要探测旧密钥。历史重写、强制推送、远程产物删除和凭据撤销需要单独批准。轮换后协调清理包含凭据的备份或日志。

## 交付限制

本模式在调用记录变更回调前拒绝凭据写入。harness 的 API 密钥输入、pi-ai 自定义配置请求头和 OAuth 授权或刷新写入不可用；须在 1Password 预先配置获批字段。通用上游组合仍可使用本地凭据模式。使用显式子进程环境或独立凭据文件的可选集成，需要单独切换审查后才能宣称每个部署集成都集中存储。现有备份口令文件和服务单元不属于本仓库补丁，也需要获批迁移。1Password 访问是有权限的宿主访问；该来源无法防范同一用户的任意宿主程序或自行调用 CLI 的受信任插件。

[1Password 秘密引用](https://developer.1password.com/docs/cli/secret-references/) 定义字段 URI 语法。提供者使用 [CLI read 命令](https://developer.1password.com/docs/cli/reference/commands/read/) 的 `--no-newline`，绝不使用 `--out-file`。
