## Problem and result / 问题与结果

<!-- What concrete problem does this solve, and how does behavior change? Link related issues. For fixes, include a sanitized before/after reproduction.
解决什么具体问题，行为如何改变？关联相关 issue；修复问题时，附脱敏的修复前后复现结果。 -->

## Change type / 变更类型

- [ ] Documentation or templates / 文档或模板
- [ ] Settings UI or translations / 设置页或翻译
- [ ] Host APIs, composition or persistence / 宿主 API、组成或持久化
- [ ] Installation or packaging / 安装或打包
- [ ] Release preparation / 发布准备

## Validation / 验证

Record what actually ran: command, exact Node/DSH version and platform, result, and evidence. Use **Pass / Fail / Not run / N/A**, with a reason for Not run or N/A; do not mark an unexecuted check as passed.

记录实际执行的命令、精确 Node/DSH 版本和平台、结果及证据。使用 **通过 / 失败 / 未执行 / 不适用**；未执行或不适用要说明原因，不将未执行写成通过。

| Check / 检查 | Exact environment / 精确环境 | Result / 结果 | Evidence or reason / 证据或原因 |
| --- | --- | --- | --- |
| Command / 命令 | | | |

Apply the checks below to the changed scope and explain each N/A in the table. See [Contributing](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/CONTRIBUTING.md) for commands and requirements.

按变更范围选择下列检查，在表中说明各项 N/A 的原因；命令和要求见[贡献指南](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/CONTRIBUTING.zh.md)。

- Runtime, installation or user-file writes: relevant regression tests, failure/recovery behavior and preservation of existing user data. / 运行时、安装或用户文件写入：相关回归、失败/恢复行为及既有用户数据保留。
- UI or copy: real browser interaction for UI changes; keep `client.js` and `locales.mjs` aligned. Recapture changed screenshots with `tools/screenshots/`. / UI 或文案：UI 变更需真实浏览器交互；同步两份词典；截图变更用现有工具重新采集。
- HTTP routes: retain `ctx.connection.fetch.register(...)` on the fenced `/api` channel and verify `test/editor-route.test.mjs`. / HTTP 路由：保持共享 `/api` 安全边界及路由测试。
- Composition: preserve untouched rows byte-for-byte, including `!!js` and disabled states; new rows need `ROW_META` and bilingual `row.<id>.label` entries. / 组成：未改行逐字节保留条件与禁用状态；新行需元数据及双语标签。
- Documentation: verify links and current claims; update both languages and pairing records when a pair changes. / 文档：检查链接与当前声明；配对文档变更时同步双语及配对记录。

## Compatibility and release impact / 兼容性与发布影响

<!-- Separate declared compatibility from exact versions actually tested. For host API changes, update the current contracts in Architecture and relevant compatibility checks; do not infer support from a dist-tag. If declared support changes, align package ranges, CI pins and bilingual records. Explain unverified Desktop/model boundaries.
区分声明的兼容范围与实测精确版本。宿主 API 变更需更新 Architecture 当前契约及相关兼容检查，不从 dist-tag 推导支持。支持范围变更时，同步包清单范围、CI 精确版本与双语记录。说明未验证的 Desktop/模型边界。 -->

[Architecture](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/ARCHITECTURE.md) · [Compatibility](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/CURRENT_COMPATIBILITY.md)

<!-- Is this PR preparing a release? If yes, record the new plain x.y.z plugin version, changelog and required release evidence. Otherwise write N/A; a documentation-only PR need not bump the package version.
本 PR 是否准备发布？如是，记录新的普通 x.y.z 插件版本、变更记录与必需发布证据；否则写 N/A，纯文档 PR 不必升包版本。 -->

A release must satisfy the complete checks and existing gated workflow in [Publishing](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/PUBLISHING.md), including compatibility and browser gates. Those release requirements cannot be marked N/A or bypassed by this template.

发布必须满足[发布指南](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/PUBLISHING.zh.md)的完整检查与现有门禁流程，包括兼容性与浏览器门禁；不能用此模板将发布必需项标 N/A 或跳过。

## Known gaps and trade-offs / 已知缺口与取舍

<!-- Unverified behavior, remaining risks and follow-up work. / 未验证行为、残余风险与后续工作。 -->
