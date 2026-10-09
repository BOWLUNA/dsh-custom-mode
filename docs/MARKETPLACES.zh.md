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

核心安装和加载检查在两个当前 DSH 通道上使用精确的 npm 打包产物，覆盖 API 访问、全部基础模式、提示词保留、移除、重装与真实 UI，包括原生 UI 修订（见[当前检查](CURRENT_COMPATIBILITY.zh.md)）。这证明共同的 bundle 合约，不代表市场 UI 安装已验收。安装应钉包版本，避免 pnpm 的发布时间缓存选择旧版。
