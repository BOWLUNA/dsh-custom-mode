# 安全策略

[English](SECURITY.md) | 中文

## 报告问题

不要在公开故障报告中发布漏洞细节。2026-10-27的仓库检查中，GitHub私密漏洞报告功能尚未启用。
如果 **Security → Report a vulnerability** 入口实际可用，使用该私报入口；否则先用
[私密渠道请求表单](https://github.com/BOWLUNA/dsh-custom-mode/issues/new?template=security_contact.yml)
请维护者提供私下报告渠道。这个请求是公开的，不附漏洞细节、利用代码、凭据或用户数据。
此处不提供未经确认的私报邮箱。

取得私下渠道后，再提供受影响版本、影响范围与合成复现步骤，去除token地址、API key、Cookie、
私人提示词和历史。确认后尽量说明影响与修复版本，并在修复后公开细节；不承诺响应或修复时限。

## 当前验证范围

安装兼容性由[package.json](package.json)中的`engines.dsh`与`@deepseek-ai/dsh` peer范围声明，
插件使用独立版本线。精确已完成检查及平台边界集中维护在
[CURRENT_COMPATIBILITY.zh.md](docs/CURRENT_COMPATIBILITY.zh.md)。

| 插件版本 | DSH 版本 | 状态 |
| --- | --- | --- |
| `2.3.0`（候选） | 声明范围不变；当前精确宿主目标为 `0.2.1-rc.2`、`0.2.1-rc.4`、`0.2.2-alpha.2`，保留旧版回归 | **已声明支持范围，验证待完成** —— 不继承2.2.6作为新发布集成与原生更新流程验收；已完成证据与边界见 CURRENT_COMPATIBILITY.zh.md |

上面记录的是当前包的兼容与验证范围，不定义安全支持截止日期或旧版修复计划。

## 历史记录

[2.2.6验证记录](docs/CURRENT_COMPATIBILITY.zh.md#226-验证范围)保留精确宿主结果与验收边界。更早的2.2.5记录包含页面/生命周期检查通过后发现的cwd提示词合约缺口；两者都不是2.3.0的新验收。

更早发布声明保留在[变更记录](CHANGELOG.zh.md)、兼容历史与Git历史中，不承诺当前支持、旧版修复计划或新的桌面验收。`review/2026-09-fixes`之前的初始 `0.1.6-alpha.1` 构建受下文路由问题影响，建议升级。

## 已知问题与修复

下面事件描述的是旧实现，不是当前的路由注册方式。

### 设置页私有路由曾未做鉴权（已修复，随 `1.0.1` 发布）

**影响**：`/custom-mode` 这条路由注册在 `ctx.webServer` 的裸 HTTP 表上，而平台的
Host/Origin 栅栏与浏览器会话鉴权只作用在 Connection 服务挂载的 channel（`/`、`/api`…）上。
结果：**未授权**即可 `GET` 出整份系统提示词，并以 `content-type: text/plain` **POST** 改写
`prompt.md`。后者尤其重要——普通表单式跨站请求不触发 CORS 预检，因此用户浏览器里打开的
任意网页都能朝该端口 POST；响应读不到，但写入已经发生。

**已修复（两次）**：`1.0.1` 在每个请求开头自己调平台的检查函数，服务缺失时失败关闭。`1.0.3` 把这个设计
整个删掉了：路由注册在平台共享的 `/api` 频道（`ctx.connection.fetch.register`），载体在分发**之前**施加
loopback/`trustedHosts` 的 Host 检查、`Sec-Fetch-Site`/`Origin` 与浏览器会话 cookie。已经没有可被挪动、
重排或忘记的手搓检查；`connection` 不存在时一条路由都不会注册。

**缓解**（无法立即升级时）：该路由默认只绑 `127.0.0.1`，因此风险主要来自
(a) 同机的其他用户/进程，与 (b) 用户自己浏览器里的跨站请求。把 dsh 暴露到局域网或反向代理
之下会显著放大影响，请不要那样部署旧版本。

修复前后的完整实测（含 401/403 对照）见
[`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.zh.md) 第 2 节与 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.zh.md) 第 9 节。

## 设计上的边界

- 设置页的路由注册在平台的共享 **`/api` 频道**上（`ctx.connection.fetch.register`），因此载体在分发前
  会施加 loopback/`trustedHosts` 的 Host 检查、`Sec-Fetch-Site`/`Origin` 判定与签名过的浏览器会话
  cookie。插件自己不做鉴权检查 —— 这正是关键：围栏是**结构**，不是一条要记住的规矩。（在此之前，路由挂在
  裸 `webServer` 表上、必须自己调 `ctx.connection.requestRejection`；忘记调的那个版本记录在上文。）
- 提示词和组成编辑不主动查询包注册表。用户明确要求检查更新，或继续在官方Plugins界面更新时，
  请求由宿主通过其配置的registry和包管理通道处理。插件不读取凭据、不更改授权，也不替代宿主的
  确认与更新流程。
- 数据变更包括受管助手的提示词、元数据、组成、提示词历史与事务/恢复文件。
  `prompt-history.jsonl`包含完整历史提示词，分享文件时应把历史和恢复副本同样视为提示词数据。
  创建/删除助手会管理相应目录，激活会维护播种标记与受管代码；提示词写入前校验插值变量，
  避免手误导致后续请求失败。
- `composition.mjs` 会对出厂组合里的 `!!js` 平台表达式求值（`new Function`）。它求值的是
  **本机已安装的组合文件**——那份文件本来就会被 DSH 当 Cordis 插件执行，因此这不引入新的信任面；
  但如果你从别处拿了一份组合文件放进 preset 目录，请按代码看待它。
