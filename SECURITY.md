# 安全策略

## 报告问题

请用 GitHub 的 **private vulnerability reporting**（仓库 → Security → Report a vulnerability）提交，
不要开公开 issue。若该入口不可用，也可以开一个只写「有一个安全问题，请给一个私下渠道」的 issue，
不带任何细节。

我会在确认后尽量给出：影响范围、复现条件、修复版本，并在修复发布后再公开细节。

## 支持范围

本插件的版本号**跟随所适配的 DSH 版本**（见 README「版本策略与兼容性」），所以"支持哪个版本"
等价于"在哪个 DSH 版本上验证过"。当前只在下面这一行上开发与验证：

| 插件版本 | DSH 版本 | 状态 |
| --- | --- | --- |
| `0.1.6-alpha.1`（含本仓库 `review/2026-09-fixes` 分支之后的提交） | `0.1.6-alpha.1` | 支持 |
| 早于上述分支的 `0.1.6-alpha.1`（即最初的提交） | `0.1.6-alpha.1` | **受下文所述问题影响，建议升级** |

## 已知问题与修复

### 设置页私有路由未做鉴权（已修复，未发布）

**影响**：`/custom-mode` 这条路由注册在 `ctx.webServer` 的裸 HTTP 表上，而平台的
Host/Origin 栅栏与浏览器会话鉴权只作用在 Connection 服务挂载的 channel（`/`、`/api`…）上。
结果：**未授权**即可 `GET` 出整份系统提示词，并以 `content-type: text/plain` **POST** 改写
`prompt.md`。后者尤其重要——普通表单式跨站请求不触发 CORS 预检，因此用户浏览器里打开的
任意网页都能朝该端口 POST；响应读不到，但写入已经发生。

**已修复**：路由在处理任何请求之前先调用 `ctx.connection.requestRejection(req)`（与 `/api`
同一判定），并在该服务不可用时**失败关闭**（503 + 宿主日志），而不是退回不校验。

**缓解**（无法立即升级时）：该路由默认只绑 `127.0.0.1`，因此风险主要来自
(a) 同机的其他用户/进程，与 (b) 用户自己浏览器里的跨站请求。把 dsh 暴露到局域网或反向代理
之下会显著放大影响，请不要那样部署旧版本。

修复前后的完整实测（含 401/403 对照）见
[`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md) 第 2 节与 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) 第 9 节。

## 设计上的边界

- 本插件**不引入**任何网络出站请求，也不读凭据。
- 设置页只能写 preset 目录下的两个文件（`prompt.md`、`agent.cordis.yml`）与 `preset.yml`；
  写入前会校验提示词的插值变量，避免把一个手误升级成"该模式每个请求都失败"。
- `composition.mjs` 会对出厂组合里的 `!!js` 平台表达式求值（`new Function`）。它求值的是
  **本机已安装的组合文件**——那份文件本来就会被 DSH 当 Cordis 插件执行，因此这不引入新的信任面；
  但如果你从别处拿了一份组合文件放进 preset 目录，请按代码看待它。
