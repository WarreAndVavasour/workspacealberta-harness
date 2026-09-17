# @workspacealberta/ui-alberta-grid

[English](README.md) | 中文

workspaceAlberta 会话视图标签页 **Grid**（`conversation.view` id `alberta-grid`）。这是 **v2 / Wilke**：对齐的 2D 编码始终可见，因此读者无需旋转 3D 场景即可还原每一项比较。

该插件是纯消费者：它注册一个视图标签页，并读取两路只读 Railway 数据源（已投影 AESO Current Supply Demand 与池价格）。它不新增 AESO 接口、不编造节电金额，也不改写 Railway 应用。

## 编码

燃料比较是从 0 起的共享基线柱形图（Claus Wilke，《数据可视化基础》第 17 章），覆盖 Solar / Wind / Gas（cogen+CC+steam+SC）/ Hydro+Other / Storage，并同时标注 MW 与占 AIL 的百分比。燃料色相是定性的 Okabe–Ito 风格颜色（第 4 章），图例与可选 3D 面板复用同一套色。AIL 是一个大号数字；可选 3D「负荷容器」仅作装饰。池价格是数值 `$/MWh` 加上冷–琥珀–热的顺序/发散色带（约 $40 以下为冷色，中段琥珀，尖峰为热色）——从不用光晕表示幅度，也不使用彩虹色。联络线（BC / Montana 及其净额）是从 0 起的有符号长度：进口向左，出口向右。HUD 显示轮询健康状态（“Live AESO feed”），而不是 CSD 的 `Last update` 时间戳。悬停与选中仍报告 MW 与负荷占比。`?lite` 或 WebGL 探测失败会隐藏轨道面板，并保留同一套 2D 柱。3D 面板在挂载时只提供交互轨道（第 26 章）；读数不依赖它。

## 数据

- `https://web-production-02936.up.railway.app/api/csd`（CSV 文本）
- `https://web-production-02936.up.railway.app/api/price`（CSV 文本）

Solar 是 AESO 可见、大于 5 MW 的发电。视图每 90 秒轮询一次。通过 `workspace-alberta.patch.yml` 挂载。

## 运行与构建

在 workspaceAlberta 检出中重新构建 official web 客户端，并且只重新拉起 **3081** 端口（不要动 :3080）：

```sh
git fetch origin
git checkout workspace-alberta
git pull origin workspace-alberta
pnpm install
DSH_CLIENT_BUILD_PROFILE=official DSH_CLIENT_TITLE=workspaceAlberta pnpm run build
DSH_TELEMETRY_DISABLED=1 pnpm wa --profile web --patch workspace-alberta.patch.yml --host 127.0.0.1 --port 3081 --no-open
```

RaspberryPiBot / CLIbot 应拉取本分支（或合并后的 `workspace-alberta`），执行同一套构建，然后重启已有的 :3081 `dsh` 进程。打开 **Grid** 标签页；加上 `?lite` 可强制走仅 2D 路径。

## 模型体验

无。Grid 视图在浏览器中渲染 AESO 形态的 CSV，这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **CSD last-update 时间戳会被解析，但 HUD 不展示** — 该馈送时钟会让一次实时轮询看起来过时；健康状态取最近一次成功的客户端轮询，而不是 AESO 打印的时间戳。
- **3D 可选且不具权威性** — Pi 级软件光栅化与 `?lite` 会卸载它；2D 柱仍是比较编码。
- **价格表中的短横行** — 最新小时在 AESO 结算前常打印 `-`；视图保留最近的数值 `$/MWh`，不会虚构价格。
