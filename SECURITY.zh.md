# 安全策略

[English](SECURITY.md) | 中文

## 报告问题

请用 GitHub 的 **private vulnerability reporting**（仓库 → Security → Report a vulnerability）提交，
不要开公开 issue。若该入口不可用，也可以开一个只写「有一个安全问题，请给一个私下渠道」的 issue，
不带任何细节。

我会在确认后尽量给出：影响范围、复现条件、修复版本，并在修复发布后再公开细节。

## 支持范围

本插件支持哪些 dsh，由 `editor/package.json` 的 `engines.dsh` 与 `@deepseek-ai/dsh` peer 范围声明
（见 README「版本」）；包版本走自己的线，不再承担这个信息。开发与验证覆盖下面这些行，最新在前：

| 插件版本 | DSH 版本 | 状态 |
| --- | --- | --- |
| `1.9.5`（当前发布版本） | `0.1.5-rc.2`（最新稳定版）**与** `0.1.6-alpha.2`（最新预览版） | **支持** —— 声明范围是 `>=0.1.5-rc.2 <0.2.0-0`，CI 对两条线各安装一次并各跑一遍完整测试 |
| `1.0.0`–`1.0.4` | `0.1.6-alpha.2` | 支持（已被取代） |
| `1.1.0`–`1.8.0` | `0.1.6-alpha.2`（`1.4.0` 起也支持 `0.1.5-rc.2`） | 支持（已被取代） |
| `0.1.6-alpha.1`（含本仓库 `review/2026-09-fixes` 分支之后的提交） | `0.1.6-alpha.1` | 支持（上一版） |
| 早于上述分支的 `0.1.6-alpha.1`（即最初的提交） | `0.1.6-alpha.1` | **受下文所述问题影响，建议升级** |

## 已知问题与修复

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
- 本插件**不引入**任何网络出站请求，也不读凭据。
- 设置页只能写 preset 目录下的两个文件（`prompt.md`、`agent.cordis.yml`）与 `preset.yml`；
  写入前会校验提示词的插值变量，避免把一个手误升级成"该模式每个请求都失败"。
- `composition.mjs` 会对出厂组合里的 `!!js` 平台表达式求值（`new Function`）。它求值的是
  **本机已安装的组合文件**——那份文件本来就会被 DSH 当 Cordis 插件执行，因此这不引入新的信任面；
  但如果你从别处拿了一份组合文件放进 preset 目录，请按代码看待它。
