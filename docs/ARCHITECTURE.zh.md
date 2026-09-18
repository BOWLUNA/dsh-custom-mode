# 架构与踩坑记录

[English](ARCHITECTURE.md) | 中文

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
  id: "dsh-custom-mode",
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

本项目改用**平台共享 `/api` 频道上的五条精确路由**：

- 宿主半 `ctx.connection.fetch.register({ path: "/api/custom-mode/state", methods: ["GET", "POST"], requestBody: "buffered", fetch })` —— 一条路径一次注册
- 浏览器半 `fetch("/api/custom-mode/state?id=…", { method: "GET" | "POST" })`

优点：完全自包含，不占用任何 Cordis 服务名、不会和别人撞，也不必理解 Remote 的生成机制。而频道选 `/api` 而不是裸 `webServer` 表的原因是：**拥有 `/api` 的载体在任何路由被分发之前，就施加了平台的信任与鉴权策略** —— 于是栅栏是结构，不是一条要记住的规矩（见 §5.1）。

（精确路径注册带来两个后果：注册的 `path` 是**包含 `/api` 的绝对路径**，官方包也是这么传的；以及路由没有声明的方法永远不会被分发 —— 对只声明 POST 的路径发 GET，拿到的是该频道的 404，而不是 405。）

优点：完全自包含，不占用任何 Cordis 服务名，不可能和别人冲突；也不需要理解 Remote 生成机制。

### 5.1 为什么路由落在 `/api` 上：裸路由**不在**平台的浏览器信任栅栏里（实测，1.0.3 修）

上面这个写法有个当时没意识到的后果。`ctx.webServer` 是**裸 HTTP 表**；平台的
Host/Origin 栅栏 + 浏览器鉴权是 `@deepseek-ai/dsh-client-connection` 挂在**它自己挂载的
channel**（`/`、`/api`…）上的，直接在 `webServer` 上注册的路由**不经过**它。

实测（0.1.6-alpha.1，本插件修复前）：

```sh
# 未授权 GET：把整份系统提示词交出去
curl http://127.0.0.1:3081/custom-mode
→ 200 {"ok":true,...,"prompt":"You are a coding agent powered by ..."}

# 未授权 POST：直接改写 prompt.md
curl -X POST http://127.0.0.1:3081/custom-mode \
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


修好之后（本插件 1.0.3、dsh `0.1.6-alpha.2` —— 路由在 `/api` 上，代码里已无任何手搓检查）：

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3095/api/custom-mode                            → 401   （无 cookie）
curl -s -b "$JAR"  -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3095/api/custom-mode                 → 200
curl -s -b "$JAR"  -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.example' \
     -H 'Sec-Fetch-Site: cross-site' http://127.0.0.1:3095/api/custom-mode                                 → 403
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' http://127.0.0.1:3095/api/custom-mode     → 403
curl -s -b "$JAR"  -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3095/custom-mode                      → 404   （裸路由已不存在）
```

同一次运行也复验了写入路径：未授权的 `POST /api/custom-mode/state` 返回 401 且 `prompt.md` 未被改动，
带会话的调用则把两个文件都写好了。见 `docs/MEASUREMENTS.md` §16。

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
profiles/web/node_modules/dsh-custom-mode -> <repo>/editor
```

所以**仓库就是活跃代码**。曾经存在的 `$DSH_HOME/custom-mode/` 是早期布局的**陈旧副本**；往那里写文件不会有任何效果（客户端 bundle 的 `artifactBaseline` 报的是另一份的 size）。该目录已删除，避免继续误导。

排查这类问题的办法：读 `clientModules.artifactBaseline(id)`，它给出的 `path` 就是真正被监视/服务的那一份。

## 12. 行级 `inject` 会把整行卡死；要等服务的正确写法是作用域化的 `ctx.inject`

这条是实测撞出来的，教训比结论值钱。

**起因**：`install.sh --help` 与两份 README 都写了 `--profile tui`，而设置页插件当时在包级导出
`inject = ['webServer', 'agentPresets']`。tui 组合里这两个服务都不存在，于是每次启动 tui 都会打印：

```
dsh: warning: 1 entry did not activate
custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
```

**为什么这不能接受**：这一行与 [§5.1] 里那个"装完 dsh 变砖"的报错**完全相同**。一个正常的
"装错 profile"于是看起来和一次灾难性损坏没有区别 —— 这等于在教用户忽略唯一重要的那条警告。

**机制**：Cordis 的 `inject` 是**硬依赖**——名字在 `inject` 里，fiber 就一直等到它出现。没有
"可选依赖"这个形态（`cordis/src/registry.ts` 里 `inject` 只有必填语义）。

**正确写法**：让整行正常激活，把"需要服务的那部分"放进一个作用域化的子 fiber：

```js
export function apply(ctx) {
  ctx.inject(['webServer', 'agentPresets'], (scope) => {
    // 只有两个服务都在时才会走到这里
    scope.effect(() => scope.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }), '…')
  })
}
```

`ctx.inject(deps, callback)` 就是 `ctx.plugin({ inject: deps, apply: callback })` 的语法糖
（`registry.ts` 里 "Start a callback once the requested dependencies are available"），
所以它是**同一个声明的动态形态**，而不是绕开依赖系统。

**实测结果**：tui 有 TTY 启动也不再出现那行警告，web 里设置页照常（`401` 未授权 / `200` 带会话）。

**可复用的两条**：

- 插件只要有一半功能依赖某个服务，就别把那个服务写进行级 `inject` —— 否则那半边不适用时，
  整行都会变成一条看起来像故障的警告。
- 反过来，**绝不能**为了躲开 `pending` 就完全不声明依赖、在 `apply` 里 `ctx.get()` 猜服务在不在：
  在 web 里 `apply` 可能先于 `webServer` 就绪，那样设置页会静默地不注册。等待要用 `ctx.inject`。

## 13. 多助手：一个设置页管 N 个模式，为什么不需要新机制

最初的版本只管一个 preset（`$DSH_HOME/.agent-presets/custom`）。要变成「像常见聊天软件那样新增 /
删除助手」，先得回答：preset 这一层支持 N 个吗？**支持，而且这本来就是它的用法**：

- `dsh-agent-presets` 的 `scanRoot()` 会把用户预设根目录下**每个**合法子目录变成 roster 里的一行
  （`USER_PRESET_DIR = '.agent-presets'`，`PRESET_ID = /^[a-z0-9][a-z0-9-]*$/`）；
- discovery **不做缓存**：`list()` / `resolve()` 每次重新读根目录，所以刚建的目录下一次选会话就能选到；
- 每个 preset 目录是自包含的：`prompt-reader.mjs` / `prompt-tool.mjs` 用
  `new URL('./prompt.md', import.meta.url)` 定位提示词，拷一份就是一套独立提示词。

真正是单例的只有**设置页**：`paths.mjs` 把提示词路径写死成 `.../custom/prompt.md`，路由只有一条，
浏览器半假定只有一个模式。所以这次改动全部落在 editor 包里，`preset/` 的组成文件一份没动。

### 13.1 哪些目录归本工具管（这条判据是安全边界）

管理列表必须是**本工具创建的模式**，不能是「用户目录下的所有 preset」：

- 保存会**按基础模式重新生成组成文件**（逐行开关就是这么实现的）；
- 对一份手写的 `agent.cordis.yml` 做这件事 = 毁掉它。

判据：目录里有 `prompt.md`，且（有 `prompt-reader.mjs`，或组成文件里引用 `'./prompt-reader.mjs'`）。
第二个分支让「reader 被误删」也还能被补回来。只凭 `prompt.md` 判断会把别人手写的模式误认成
本工具的产物 —— 这个错误的代价是破坏性的，所以宁可判窄。

### 13.2 新增与删除都走平台自己的 authoring 通道

- **删除**用 `agentPresets.remove(id)`：平台自己拒绝 `trust: 'system'`，并再确认目录确实在可写根目录下
  （`deleteComposition` 里的 `preset.path.startsWith(dir)`）。比本插件自己 `rm -rf` 安全。
- **新增**用包内模板播种（`seedPreset` → `createAssistantDir`），**不用** `agentPresets.copy()`：
  copy 会把源助手的提示词、开关状态和附带文件一起继承过去；更关键的是，源助手被删光时就建不出新的。
  播种的另一个好处是「新建」就是全新的。
- 可写根目录**从 roster 推**（任一 `trust: 'user'` 行的祖父目录），而不是拼死路径：profile 可以用
  `roots` 把可写根指到别处，硬编码会在那种部署上写错地方。

### 13.3 删掉的助手不能复活

旧版 `apply()` 每次激活都 `seedPresetWithLog(PRESET_DIR)`。多助手之后这条语义变成 bug：用户删掉
`custom`，重启进程它又回来了。现在的规则是：

- 每次激活对**所有**受管目录做一次「只补缺失文件」的修复（保持永不覆盖，同时让「组成文件引用的模块
  被删掉 → 整个 preset 被判 broken、从选择器消失」有救）；
- 只有在**从没跑过**这里（根目录下没有 `.custom-mode.json`）时才创建 `custom`；
- 根目录里已有受管助手 → 直接补上标记，静默收养。

标记是个**文件**：discovery 的 `child.isDirectory()` 会跳过它，名字也不匹配 `PRESET_ID`，
所以它不会被当成一个 preset。

### 13.4 工具描述怎么知道自己属于哪个助手

`custom_prompt` 的 description 由设置页写进组成文件的行配置（`config.modeName`），模块再退回读同目录的
`preset.yml`，最后才用通用名。**旧助手里的旧模块不认识这个键** —— 这是刻意的：模块文件在用户目录里，
激活时不能偷偷覆盖（用户可能改过它）。想要新模块，跑一次 `./install.sh`（它只覆盖模块，保留 `prompt.md`）。

## 14. 界面控件用壳自己的原子组件，不自己写

页面的**布局**是本项目自己的（网格、卡片、间距），但**控件**一律来自
`@deepseek-ai/dsh-client-ui-primitives`：`Button` / `Input` / `Switch` / `Tag` / `Pill` /
`Tooltip` / `RiskConfirmation` 和整套图标。

### 14.1 为什么可以直接 require：壳的种子表

手写 bundle 不能 import ESM 包，只能 `require`。壳在启动时注册了一张**种子表**，把若干模块名
直接映射到它自己已经打包好的实例（`dsh-web-frontend/dist/assets/index-*.js` 里实测）：

```js
{"react":_c,"react-dom":bc,"react-dom/client":Ic,"@deepseek-ai/cordis":ec,
 "@deepseek-ai/dsh-client-store":Jc,"@deepseek-ai/dsh-client-ui-slots":ou,
 "@deepseek-ai/dsh-client-ui-primitives":Cy,"@deepseek-ai/dsh-client-ui-dockkit":Xw}
```

所以 `require("@deepseek-ai/dsh-client-ui-primitives")` 与 `require("react")` 是同一类操作，
**不需要**在 `package.json` 里声明 `dsh.client.external` —— 那个字段服务于「图行」（在启动清单
里有自己一条记录的 bundle）。官方 `@deepseek-ai/dsh-client-ui-settings-general` 运行时也直接
require 它、且没有声明任何 `external`，这是可复制的先例。

种子表里还有 `@deepseek-ai/dsh-client-ui-slots` 与 `@deepseek-ai/dsh-client-store`：前者是官方页面
读插槽契约的通道，后者是跨页面小状态。

### 14.2 用它的收益是「不再漂移」

原子的样式随壳一起打包、由壳的 CSS 通过 `--dsw-*` token 决定，所以主题、深浅色、密度、圆角
以及未来任何一次改版都会自动作用到本页。自己写一遍 `<input>` / `<button>` 等于把壳的视觉规范
抄了一份，而抄的那份必然过时。

本项目的划线是「容器是我们的、控件是壳的」：`client.js` 的 CSS 只做布局，
`cpfe-btn*` / `cpfe-input` / `cpfe-switch*` / `cpfe-tag*` / `cpfe-pill*` 只服务于下面的降级路径。

### 14.3 降级：老壳没有这个种子词也要能开

`ui-primitives` 随壳版本走。探测写成 try/catch：取不到就用内置的朴素控件（**同样的 prop 契约**，
例如 `Switch.onChange` 一样回传下一个布尔值而不是事件对象），页面**变朴素但可用**，而不是白屏；
`RiskConfirmation` 缺失时删除退回原生 `confirm`，不把「不可逆操作要确认」这条护栏一起丢掉。

这和 §3 是同一个教训的两面：那里的失败是页面**静默不出现**，所以这里宁可降级，也要让 `apply` 成功。

### 14.4 顺带确认：客户端 bundle 的长缓存是安全的

`/plugins/??<id>/client.js&rev=<hash>` 的响应头是
`cache-control: public, max-age=31536000, immutable`，看着很危险。但 `dsh-client-modules` 的 rev 是
`artifactRevision(bundle, baseline)` —— 对 **client.js 的字节 + mtimeMs** 做 sha1。文件一改 rev 就变、
URL 就变，所以 immutable 是安全的：重启后**普通刷新**即可拿到新界面，不需要清缓存。

## 15. `settings.section` 不再给绑定好的 `t`：页面自带词典（0.1.6-alpha.2 实测）

这一节记录的是一次**真实翻车**：功能全对，界面却整页显示成 `assistant.heading`、`btn.create`
这种原始键（连左侧导航都变成 `nav`）。原因是页面依赖了一个**已经不存在**的契约。

### 15.1 权威契约：注册选项只剩三个

`settings.section` 的插槽声明（随 `dsh-cordis-client-runner` 一起打包，含文档）写着：

```
registerOptions: [
  { name: "id",    requirement: "required", type: "string" },
  { name: "order", requirement: "optional", type: "number" },
  { name: "label", requirement: "optional", type: "string | (() => string)" }
]
doc: … `label` (registrant-localized display text — the registrant re-registers with
     fresh text on locale change, so the shell never subscribes locale state; the ledger
     bump doubles as the shell's re-render trigger) …
```

**没有 `locale:` 了。** 壳不再为 section 绑定一个命名空间化的 `t`，因此 `props.t` 即便存在也不是
我们那个命名空间——正文于是全部回显键名。官方包里还能看到残留的 `locale: NS`（`ui-settings-plugins`
等），但契约里它已被移除，**不能依赖**。

而 `label` 的契约仍然明确支持 thunk，并说明「每次投影重新读取，所以本地化文本无需重新注册」，
所以导航标签继续用 thunk 是正确写法。

### 15.2 两条教训

**（1）不要依赖「注册一定成功」。** 本页原本把可见文案全部交给 `locale.register(ns, {zh, en})` +
壳递进来的 `t`。注册一旦不生效，页面就变成键名墙。现在：

- 壳的 `t` 仍然优先（能答就用它，语言切换时它自己会触发重渲染）；
- **bundle 自带的中英词典是地板**：`t()` 在壳答不上来时直接查自己的表，所以只要键在表里，
  就不可能显示成裸键；
- 语言切换由 `locale.subscribe()` 驱动重渲染，`activeLanguage()` 每次渲染重新读快照。

这不是「不用宿主 i18n」，而是「把它当加速器而不是地基」。测试里专门造了一个「`t` 一律回显键名」
的壳来跑这条路径（`test/client-bundle.test.mjs` §3），并验证过它在旧写法下确实变红。

**（2）`ctx.effect` 会吞掉回调里的异常——失败因此是静默的。**
注册写在 `ctx.effect(() => locale.register(...))` 里，而 `effect()` 把回调交给自己的 runner
（带 setup barrier 与 promise 处理），回调抛出的错误**不会**回到 `apply` 的 `try/catch`。
于是「注册失败」与「一切都好」在外部完全无法区分：页面照常出现、控制台一片安静、文案全是键名。
现在注册自己 `try/catch`、把原因 `console.warn` 出来，并在注册后回读一次
（`bind(ns)("nav") === "nav"` 即「注册了但宿主查不到」），把两种情形分别说清楚。

这条对**任何**写在 `ctx.effect` 里的初始化都成立：**别把它的异常当成会冒泡的异常来处理。**

## 16. 助手排序用 `preset.yml` 的 `order`，不另存一份状态

选择器里的顺序是 roster 的顺序，而 `dsh-agent-presets` 的排序键是 `order ?? Infinity`，再按 id
——这正是出厂 preset 声明自己顺序的方式。所以「上移/下移」不维护任何列表，而是给**每个**受管助手
写 `order: 1..N`：

- 顺序成为 preset 自己的属性：重启后仍在、文件里看得见、没有第二份状态可以与它漂移；
- 全部写满 1..N 是必要的：之前没排过序的助手根本没有 `order`，只给一个写就会与 id 排序混在一起；
- `meta.mjs` 的 writer 在**没有**显式传 order 时保留磁盘上的旧值——否则「改名」会把助手悄悄挪到队尾。

顺序只影响**新建会话**的选择器（roster 在每次读取时重新扫盘），已开的会话不受影响。

## 17. 真浏览器验证：单测看不见的那一公里

这个仓库的测试有个结构性盲区：它们能证明宿主半答得对、bundle 注册得上，但**看不见渲染出来的页面**。
§15 那次翻车就是这个盲区的产物——功能全对、页面也在，整页却是裸键，而**所有套件都是绿的**。

所以从这一版起，界面的验收标准不是「测试绿了」，而是 `tools/browser-verify.mjs` 在真实实例上跑过。

### 17.1 它断言什么

对着 CDP 端口驱动一个真浏览器，逐条断言：

1. **面板里没有任何裸翻译键**（内建一张清单：`assistant.heading`、`btn.create`、`status.enabled`…）；
2. 文案是**翻译过的**（区块标题、上移/下移/复制一份/导入/导出按钮都在）；
3. **每个开关都有可见行标题**——`Switch` 的 `label` 只进 `aria-label`，标题必须由页面自己画；
4. 左侧导航项不是裸键 `nav`；
5. **浏览器里跑一遍增删**：新建助手 → 出现在列表 → 打开风险确认弹窗 → 勾选 → 永久删除 → 从列表消失；
6. 页面 console 没有 `dsh-custom-mode` 的报错。

它自己**不启动** dsh，只吃一个带 token 的 URL：跑哪个实例、哪台机器由调用方决定
（实验机配方见仓库 `AGENTS.md` 的「The lab」一节与 `~/.dsh/AGENTS.md`）。

### 17.2 两个实测坑

- **设置面板自己就是 `[role=dialog]`**。所以「找确认弹窗」不能写
  `document.querySelector('[role=dialog]')`（那会拿到设置面板），必须**按内容在全部 dialog 里找**。
  第一版验证脚本正是这么失败的：断言失败、勾选框被勾上、但确认按钮没被点到。
- **勾选与确认必须分成两步**。`RiskConfirmation` 的确认按钮读的是 React 状态，
  在同一个 tick 里先 `click()` 勾选框再点确认，状态还没落地，删除不会发生。
