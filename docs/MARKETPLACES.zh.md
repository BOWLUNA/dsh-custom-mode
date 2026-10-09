# 插件市场接口

[English](MARKETPLACES.md) | 中文

这些是 DSH profile 插件市场，不是 VS Code、JetBrains 或 MCP 目录。本版不向外部目录提交收录，也不发送外部消息。

| 市场 | 发现接口 | 安装机制 | 限制 |
| --- | --- | --- | --- |
| [dshmarket](https://github.com/dsh-market/dsh-market)，npm `dshmarket` | curated [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) YAML；`https://awesome-dsh-plugin.com/plugins.json`（`name`、`url`、可选 `npm`） | 优先 npm，回退 GitHub 源码；设置 → 插件市场 | 2026-10-09 11:56 UTC 的 JSON 响应包含本根 npm 包 `2.2.2`。目录更新仍由上游控制。 |
| [DSH Plugin Hub](https://github.com/dshplugin/dsh-plugin-hub)，npm `dsh-plugin` | `https://api.dsh-plugin.org/plugins.en.json`；压缩字段 `s/r/vr/wi/ic/igc` 或规范字段 `slug/source/install` | npm、GitHub 或 Hub 验证过的 DSH 安装命令 | 同次检查发现根 npm 包 `v2.2.2`，已审核且可在 web 安装。仓库身份为小写，匹配忽略大小写。 |
| [DSH Plugin Store](https://github.com/DshMarketPlace/dsh-plugins-store)，npm `dshmarketplace-plugin` | `https://dshmarketplace.dev/api/v1/plugins`；`results`、`fullName`、`npmPackage`、`installCheck` | DSH profile 插件管理器，也通过 Store 的搜索与安装工具提供 | UI 只显示 `installCheck: passed`。我们的根条目和旧 `#editor` 条目均返回 `null`，等待市场方安装审核。 |

前两个仓库在 2026-10-08/09 有活动；较小的 Store 在 2026-10-05 有活动。它们是依据真实 DSH 生态项目筛选的候选，不代表所有第三方市场都已集成。

根 `package.json` 就是实际安装清单：公开 npm 包 `dsh-custom-mode`、MIT 许可证、仓库地址、`dsh.bundle.patch`、`exports["./client"]`、`dsh.client.platform: web` 和一致的 peer/engine DSH 范围。包不需要构建或安装脚本。现有 `screenshots.json` 保留为仓库侧截图接口，不增加虚构的市场专用字段。

`tools/market-check.mjs` 规范化每种已核实的格式，分别报告发现状态与安装能力。生成安装参数时只接受这个精确的根仓库和 npm 身份，拒绝已删除的 `editor` 子目录，不执行下载的命令。`--self-test` 检查三种格式及不安全或过期输入；`--fixture-dir` 可离线重放捕获的公开目录 JSON。接口不可达不会被记作空目录或发现测试成功。

核心安装和加载检查在两个当前 DSH 通道使用精确打包的 npm 产物，覆盖 API 访问、全部基础模式、提示词持久化、移除、重装和实际渲染 UI，包括原生 UI 修订（见[当前检查](CURRENT_COMPATIBILITY.zh.md)）。应固定包版本，避免 pnpm 发布年龄缓存选中旧版。

## 真实市场 UI 候选安装（2026-10-09）

尚未发布的 `2.2.3` 候选（提交 `a326c38972fa4cdc85ab550751a4ea38d8bd416e`）通过各市场可用 UI 入口安装到独立临时 Web profile。公开目录仍解析到已发布的 `2.2.2`，目录安装按钮无法验收尚未发布的候选。

| 市场包 | 宿主 | 真实 UI 入口和结果 |
| --- | --- | --- |
| `dshmarket@1.66.14` | `0.2.0-rc.2` | Advanced → Backup & Restore → Import and preview → Start restore，导入只含包元信息和固定 GitHub 依赖的本地 profile 备份。成功安装 `2.2.3`，设置页和 API 可用。停用后路由移除，恢复启用后可用。卸载后依赖和 bundle 移除。 |
| `dsh-plugin@1.6.2` | `0.2.1-alpha.2` | Custom → DSH command 接受下方固定提交的 `git+https` 来源。成功安装 `2.2.3`，自动挂载，设置页和 API 可用，随后卸载成功。GitHub 地址输入拒绝 `#ref`，DSH 命令输入可保留。该 Hub UI 没有单独的启用开关。 |
| `dshmarketplace-plugin@0.2.0` | `0.2.0-rc.2` | Plugin store 搜索 `dsh-custom-mode` 无匹配，明确显示只收录安装验证通过的插件。没有自定义 URL、文件或分支输入。候选安装、启用和卸载仍受上游条目筛选限制；未修改任何目录数据。 |

```sh
dsh plugin --profile web add git+https://github.com/BOWLUNA/dsh-custom-mode.git#a326c38972fa4cdc85ab550751a4ea38d8bd416e
```

两次成功安装均与候选 packlist 的全部 32 个文件一致，且只有一个 bundle 挂载项。卸载后两类路由均返回 404，依赖和 bundle 项消失，普通样本提示词文件保留且哈希不变。测试使用真实浏览器点击，没有模型调用、市场提交或新增凭据，验证后已停止临时宿主。结果仅验收所列 UI 路径，不宣称 Store 已审核通过或支持跨生态市场。
