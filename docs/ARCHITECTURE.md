# 架构与踩坑记录

这份文档记录的是**实测结论**，不是设计偏好。每条都对应一次运行时验证，写下来是因为它们决定了这个项目为什么长成现在这样。

## 1. 为什么设置页必须拆成独立插件，不能写成 preset 的一行

这是整个项目最重要的一条约束。

一个 agent preset 的组成文件（`agent.cordis.yml`）里，**可以**写一行引用自带模块：

```yaml
- id: persona
  name: './prompt-reader.mjs'
```

因为 preset 的相对路径按 preset 目录解析（`dsh-agent-presets` 的 `classifyRowSpecifier` 把 `./x` 归为 `preset` 类型，用 `Include` 重写过 baseUrl 的子树来 import）。

**但浏览器半不行。** web 客户端的模块扫描器（`@deepseek-ai/dsh-client-modules`）：

- 在**启动装配期**运行 —— 构造函数里 `for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name)`；
- 只读**根 loader 的条目**；
- 命中失败会 `throw new ClientPackageCompositionError`，**整个 boot 失败**。

而 agent preset 的行是由 `dsh-agent-presets` 通过 `Include` 子树的 `PresetTree`、**按会话作用域在运行时挂载**的，**不在根 loader 里**。

实测数据（在真实运行中查的）：

```
root loader entries:      161
client graph entries:      56   ← 其中没有 preset 的行
```

所以写在 preset 里的浏览器半**永远不会被发现**，只会变成死代码。能挂载浏览器半的平面只有**根平面**（profile）。

**结论**：拆成两个产物 —— preset（文件）+ 设置页插件（profile bundle）。

## 2. bundle 插件怎么被装配

设置页插件是一个 **bundle**：`package.json` 声明 `dsh.bundle.patch`，profile 的 `dsh.profile.bundles` 列出它。

组合顺序（`composeProfile`）：

```
bundlePatches → profile.cordis.patch.yml → $DSH_HOME/cordis.patch.yml → --patch overlays
```

两个易错点：

- **bundle 补丁用 `- insert:` 新增行**，而 **profile 自己的 `cordis.patch.yml` 只能替换已存在的行**（新增会报 `entry not found`）。第一版我把新行写在 profile 补丁里，直接被拒。
- 包解析先试 `INSTALL_ANCHOR`（dsh 安装目录），失败后**回退到 profile 目录**：

```js
for (const anchor of [installAnchor, join(profileDir, "package.json")]) { … }
```

所以 `dsh plugin --profile <p> add ./editor` 装进 profile 的包能被解析到，不需要装进 dsh 安装目录。

## 3. `dsh.client.inject` 必须声明（这个 bug 让页面一开始没出现）

浏览器半要读服务：

```js
const slots = ctx.get("slots")
```

**只这样写不行。** 客户端注册表会守卫服务读取，官方每个 settings 插件都额外导出：

```js
exports.apply = apply
exports.inject = inject     // inject = ["slots"]
```

症状很隐蔽：客户端图里**有条目、有正确的 rev、bundle 也被服务**，但页面就是不出现——因为 `apply` 被守卫拒绝，注册从未发生。加上 `exports.inject` 后立即正常。

## 4. 浏览器半的手写 bundle

本包的 `client.js` 是**手写**的，不是构建产物。格式：

```js
window.__ModuleLoader__.load({
  id: "dsh-custom-prompt-editor",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const react = require("react")       // ← 从「种子模块表」解析
    function apply(ctx) { … }
    exports.apply = apply
    exports.inject = ["slots"]
    return module.exports
  },
})
```

种子模块表由 web 前端提供，0.1.6 里包含：

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-ui-dockkit
```

所以 `require("react")` 可以工作，**不需要打包器、不需要安装依赖**。

整个 `load()` 调用外面包了 `try/catch`，避免这个包把页面搞崩——最坏情况只是这一页不出现。

## 5. 与宿主通信：私有 HTTP 路由

浏览器半边没有 `host.call`（那是动态 Cordis 包的专用通道），静态加载的插件走的是 `ctx.remote.<namespace>`——那需要宿主注册 Remote 命名空间和类型化契约，重且易错。

本项目改用**一条私有 HTTP 路由**：

- 宿主半 `ctx.webServer.register({ kind: "exact", path: "/custom-prompt-editor", handler })`
- 浏览器半 `fetch("/custom-prompt-editor", { method: "GET" | "POST" })`

优点：完全自包含，不占用任何 Cordis 服务名，不可能和别人冲突；也不需要理解 Remote 生成机制。

### 5.1 但裸路由**不在**平台的浏览器信任栅栏里（实测，已修）

上面这个写法有个当时没意识到的后果。`ctx.webServer` 是**裸 HTTP 表**；平台的
Host/Origin 栅栏 + 浏览器鉴权是 `@deepseek-ai/dsh-client-connection` 挂在**它自己挂载的
channel**（`/`、`/api`…）上的，直接在 `webServer` 上注册的路由**不经过**它。

实测（0.1.6-alpha.1，本插件修复前）：

```sh
# 未授权 GET：把整份系统提示词交出去
curl http://127.0.0.1:3081/custom-prompt-editor
→ 200 {"ok":true,...,"prompt":"You are a coding agent powered by ..."}

# 未授权 POST：直接改写 prompt.md
curl -X POST http://127.0.0.1:3081/custom-prompt-editor \
     -H 'content-type: text/plain' --data '{"mode":"standard","overrides":{},"prompt":"PWNED"}'
→ 200 {"ok":true,...}         # 文件真的被改了

# 同一台机器上，官方路由的表现
curl http://127.0.0.1:3081/                → 401
curl http://127.0.0.1:3081/api/settings    → 401
```

`content-type: text/plain` 这一点让它不只是「本机进程能改」：**普通表单式跨站请求不需要预检**，
所以用户访问的任意网页都能朝这个端口 POST，把 agent 的系统提示词改成攻击者想要的内容
（响应读不到，但写入已经发生）。对一个手里有 Shell 与文件工具的 agent 来说，这是实打实的
提示词注入通道。

**修法**：把平台自己的裁决接到这条路由上 —— `ctx.connection.requestRejection(req)`
（Host/Origin 栅栏 + 浏览器会话校验），和 `/api` 拿到的是同一个判定：

```js
const rejection = ctx.get('connection').requestRejection(req)   // 403 / 401 / undefined
if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
```

修完的实测结果：

```
未授权 GET                              → 401 unauthorized
未授权 POST (text/plain)                → 401，文件未被改写
POST + Origin: https://evil.example
     + Sec-Fetch-Site: cross-site       → 403 forbidden
带合法 dsh-auth-* cookie（浏览器会话）   → 200（功能照旧）
```

**两条可复用的结论**：

- 插件在 `ctx.webServer` 上注册路由 = 自己负责安全。需要浏览器访问的，一律先过
  `connection.requestRejection`；只给本机进程用的，也要意识到它是**任何**本机进程都能调的。
- `connection` 服务在 bundle 行的 `apply()` 执行时**还没就绪**（实测：写进 `inject` 会让插件
  停在 `pending`），所以要在**请求时**惰性取 `ctx.get('connection')`，并在取不到时**失败关闭**。

## 6. 为什么不用 `dsh-settings` 的 API

社区插件 `dsh-session-prompt` 的宿主半是：

```js
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
```

在 dsh `0.1.6-alpha.1` 上，`dsh-settings` 的**实际导出**只有：

```
SettingsConflictError, SettingsProvider, default, redactSecrets
```

那两个函数**在整个 0.1.6 代码库里都不存在**。因为它是 bundle 层，宿主半 import 失败会让 boot 挂掉。

本项目因此**完全不使用** `dsh-settings`：提示词存在普通文件里，设置页自己读写。

## 7. 校验 `{{…}}`：把一个本地错误变成模式级故障

`@deepseek-ai/dsh-system-prompt` 的渲染规则：

```js
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/
// 完整 {{x}} 组：名字必须合法且已注册，否则 throw
// 不闭合的单个 {{ ：视为字面量
```

抛错的后果不是「这句不生效」，而是**该模式每个请求都失败**。所以两条写入路径都在落盘前校验，只放行 `model` / `cwd` / `provider`（`dsh-agent-loop` 注册的三个）。

校验逻辑在 `preset/prompt-tool.mjs` 与 `editor/index.mjs` 里**各有一份**，是有意重复：这样 preset 不必依赖编辑器的安装位置，编辑器的路径也可配置。

## 8. 调试方法（下次改这个插件时有用）

- **确认行进了组合树**：`dsh --profile <p> --dump-config | grep <package>`
- **确认客户端模块能被发现**：挂一个动态 Cordis 插件，`ctx.get('clientModules').graph().entries` 里找自己的包 id。有条目 = 组合成功；没有 = 发现环节失败。
- **确认浏览器半真的跑了**：在 `apply` 里 `console.log`，看浏览器 Console。
- **`ctx.loader.entries()` 只有根平面的条目**，别用它验证 preset 的行。
- 改 `client.js` 内容后**不用重启**：HMR 会重建客户端图（见下方 §10）；只有改宿主半才需要重启。

## 9. 一句话总结

> preset 管**提示词内容**（每步重新求值），profile bundle 管**编辑界面**（启动装配期发现）。
> 两者唯一的契约是**同一个文件路径**。

## 10. 客户端热重载实测可用（改界面不用重启）

`dsh-client-hmr` 的宿主半每 `pollIntervalMs`（默认 500ms）**stat 轮询**每个客户端插件的 bundle 文件；`mtimeMs`/`size` 一变就调用 `clientModules.rebuilt(id)` → 重建客户端图 → 通过 `/plugins/events` 的 SSE 推给页面 → 浏览器半 `reload(id, rev)`：

```
modLoader.invalidate(id, rev)
await modLoader.prefetch(id)
await tearDownEntryFiber(entry)
removeOwnedStyles(id)        // 删掉该插件自己的 <style data-plugin="<id>">
await entry.refresh()        // 重新执行 bundle → 重新 apply
```

**手写 bundle 同样适用**：不需要构建产物，只要 `dsh.client` + `exports["./client"]` 就位。实测证据（改文件后不刷新页面）：

```
graph rev    726f30aa8dd9 → 74bc149b2eca
entry rev    345c0f1330e41a14-47 → 50e01f6dc101
页面表现      紫色测试竖条自行消失，bundle 执行计数 1 → 2
```

两个可复用的结论：

- **`/plugins/events` 返回 200 不能证明路由存在**——SPA 兜底也会 200。要看 `content-type`：真实的 SSE 路由返回 `text/event-stream`。用 `Accept: text/event-stream` 请求才能分辨。
- **验证「浏览器那一跳」不需要 DevTools**：在 `apply()` 里对 `window` 上的计数器自增，并把它渲染到页面上。计数增长即证明 bundle 被重新执行；这是插件自杀式重启之外唯一能远程看到浏览器状态的办法。

### 开发循环因此改变

改 `editor/client.js` → **约 1 秒后页面自己更新**，不需要重启 `dsh web`，不需要刷新。只有改动**宿主半**（`index.mjs`/`composition.mjs`/`meta.mjs`）才需要重启——那是主进程里的行。

## 11. 一个把我坑了很久的路径陷阱

`install.sh` 把编辑器包**链接到仓库目录**：

```
profiles/web/node_modules/dsh-custom-prompt-editor -> <repo>/editor
```

所以**仓库就是活跃代码**。曾经存在的 `$DSH_HOME/custom-prompt-editor/` 是早期布局的**陈旧副本**；往那里写文件不会有任何效果（客户端 bundle 的 `artifactBaseline` 报的是另一份的 size）。该目录已删除，避免继续误导。

排查这类问题的办法：读 `clientModules.artifactBaseline(id)`，它给出的 `path` 就是真正被监视/服务的那一份。
