# 故障排查

[English](TROUBLESHOOTING.md) | 中文

这份文档记的都是**实测复现过的失败**，每条都有症状、原因、自救办法。命令都可以直接复制。

先记住一条总的自查命令——它能区分「装没装上」和「装上了但没生效」：

```sh
dsh --profile web --dump-config | grep -n custom-mode
```

有输出 = 插件行已经进了组合树（剩下的问题都在浏览器侧）。
**没有输出** = profile 里没装上，或者装完没有重启 dsh。

---

## 1. 【严重】装完之后 dsh 起不来了，只剩一行 `pending`

### 症状

`./install.sh` 打印「安装完成」并以 0 退出。之后重启 dsh：

```
dsh: warning: 1 entry did not activate
custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
```

界面打不开、端口没人监听、agent 也没了 —— 整个 harness 只剩这一个插件在等两个永远不会出现的服务。
`dsh --profile web --dump-config` 的输出短得可疑：

```yaml
# == dsh-custom-mode
- id: custom-mode
  name: dsh-custom-mode
```

### 原因（已修复，但已经装过的机器需要自救）

`install.sh` 曾经有一段「清理解析不到的幽灵条目」逻辑，它按两个硬编码路径探测每个 bundle：

```
$DSH_HOME/profiles/<profile>/node_modules/<name>/package.json
$DSH_HOME/profiles/node_modules/<name>/package.json
```

profile **模板自带**的 in-box bundle（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`）不在
这两个位置 —— 它们由 dsh 自己的安装锚点解析 —— 于是被判定为幽灵并**从 `dsh.profile.bundles`
里删除**。基础 bundle 一没，`llm` / `session` / `webServer` / `agentPresets` 全都不再装配。

这不是猜测，是实测：全新 `DSH_HOME` 跑一遍旧版 `install.sh`，profile 的 bundles 从
`["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]` 变成 `["dsh-custom-mode"]`。

dsh 自己的 `reconcilePlugins` 明确写着 in-box bundle「are never touched」，所以正确做法是
**只增不删**。现在的 `install.sh` 就是这么做的，并且加了一道安装后自检：
组合树少于 20 行就直接报错退出，而不是让你到下次重启才发现。

### 自救（已经被旧版装坏的机器）

把缺的名字加回 profile 清单即可，不需要重装任何东西：

```sh
# 1. 看现在缺了什么
node -p "JSON.stringify(require(process.env.HOME + '/.dsh/profiles/web/package.json').dsh.profile.bundles)"

# 2. 加回模板自带的两个（按 profile 模板而异；web/tui 都是这两个）
node -e '
const fs = require("fs");
const p = process.env.HOME + "/.dsh/profiles/web/package.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const want = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];
j.dsh.profile.bundles = [...new Set([...want, ...(j.dsh.profile.bundles ?? [])])];
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
console.log("bundles =", j.dsh.profile.bundles);
'

# 3. 确认恢复：应当有上百行
dsh --profile web --dump-config | wc -l
```

重启 dsh 后应当恢复正常。

> 如果你在安装插件**之前**备份过 `$DSH_HOME`，也可以直接从备份里取回这个 `package.json`。

---

## 2. WSL 下 `dsh plugin add` 失败：pnpm 的 Rust panic

### 症状

```
==> 2/2 安装设置页插件 "dsh-custom-mode" 到 profile "web"
Error:   × Main thread panicked.
  ├─▶ at pnpm\crates\config\src\defaults.rs:51:39
  ╰─▶ current dir is an absolute path with drive letter
dsh: pnpm failed in profile directory /home/<user>/.dsh/profiles/web
```

### 原因

`dsh plugin` 是**转发给 PATH 上的 `pnpm`** 的（`spawnSync("pnpm", …)`，cwd = profile 目录）。
WSL 的 PATH 默认包含 Windows 的目录，所以很容易先命中 `Windows` 版的
`pnpm.cmd`/`pnpm.exe`。它以 Windows 的方式理解 `/home/...` 这个 cwd，于是 panic。

### 修复

让 PATH 上的 pnpm 是 **Linux 版**：

```sh
corepack enable pnpm     # 在 corepack 所在目录生成 pnpm 垫片
which pnpm               # 必须是 /home/... 或 /usr/...，不能是 /mnt/c/...
```

或者用 nvm/apt 装一个 Linux 版 Node 后再 `npm i -g pnpm`。

现在的 `install.sh` 会在第 0 步就把这个情况指出来，不会等到 pnpm 报一句难懂的 panic。

---

## 3. 改了 `editor/client.js`，页面没变化

先分清改的是哪一半 —— 两半的重载机制完全不同：

| 改的文件 | 生效方式 |
| --- | --- |
| `editor/client.js`（浏览器半） | **自动**：`dsh-client-hmr` 每 ~500ms stat 轮询 bundle 文件，约 1 秒后页面自行更新，**不用重启、不用刷新** |
| `editor/index.mjs` / `composition.mjs` / `meta.mjs` / `paths.mjs`（宿主半） | **必须重启 `dsh web`**：它们是主进程里的行 |

HMR 的前提：profile 的组合里 `dsh-client-hmr` 处于启用状态（`dsh --profile web --dump-config | grep -A2 'id: hmr'`），
并且**页面还开着**——SSE 断了就不会有推送，此时刷新一次页面即可。

> 早期文档里有一句「改 client.js 必须重启」，那是错的（与 `ARCHITECTURE.md` §10 的实测矛盾）。
> 已改正。

---

## 4. 设置面板里没有「自定义模式 / Custom mode」这一项

按顺序查：

1. **插件在组合树里吗**：`dsh --profile web --dump-config | grep custom-mode`。
2. **装完重启过 dsh 吗**：bundle 的客户端内容只在**启动装配期**进入客户端图。
3. **`dsh.client` 与 `exports["./client"]` 是否都在** `editor/package.json` 里
   （缺任何一个，浏览器半就不会被发现，而且**不会报错**）。
4. **宿主半的服务依赖满足吗**：宿主半 `inject = ["webServer", "agentPresets"]`，
   缺任一服务时插件会停在 `pending`（启动日志里会写 waiting for services）。
5. 浏览器 Console 是否有 `dsh-custom-mode:` 开头的报错 —— 这一页的失败策略是
   「宁可整页不出现，也绝不把页面搞崩」，所以它只会往 Console 说话。

---

## 5. 模式选择器里没有「自定义模式」

preset 是**文件**，让 dsh 看不见它的原因通常是文件本身坏了：

- `$DSH_HOME/.agent-presets/<id>/preset.yml` 的 YAML 写坏 → 该模式**静默消失**（不报错）。
  用编辑器改过的话，确认 `name:` 是带引号的单行标量。设置页写入时会自动转义，手工编辑则不会。
- 目录里缺 `agent.cordis.yml`。
- 目录名不能是 `standard` / `ptc` / `minimal` / `cordis` —— 那是内置模式的名字。
- 模式是**新建会话**时才读的：已经开着的会话不会中途换模式。

---

## 6. 保存提示词被拒绝

渲染器做**严格插值**：一个完整的 `{{...}}` 组必须是已注册的变量，否则渲染**抛错**，
后果不是「这段不生效」，而是**该模式每个模型请求都失败**。所以两条写入路径都会先校验：

| 文本 | 结果 |
| --- | --- |
| 纯文本 | 接受 |
| `{{model}}` / `{{cwd}}` / `{{provider}}` | 接受 |
| `{{}}`、`{{ model }}`、`{{Model}}`、`{{foo}}` | 拒绝并说明原因 |
| 不闭合的单个 `{{` | 接受（渲染器当字面量） |

要写字面量花括号，用单个 `{` 或不闭合的 `{{`。

**已经写坏了怎么办**：直接改文件，绕过校验：

```sh
$EDITOR ~/.dsh/.agent-presets/custom/prompt.md
```

或者把整份提示词临时清成一句纯文本，再进设置页改。

---

## 7. 版本不匹配

本插件的版本号**跟着官方走**（当前 `0.1.6-alpha.1`）。升级 dsh 之后如果设置页空白或启动时报
「当前 DSH 版本缺少所需 API」，就是耦合点断了：见 README 的「耦合点清单」，逐条核对。

`install.sh` 第 0 步会把 `dsh --version` 与插件声明的适配版本放在一起打印，不一致时给警告。

---

## 8. 用了非默认 preset 目录名，设置页读不到提示词

编辑器默认只认 `$DSH_HOME/.agent-presets/custom/prompt.md`。用 `--preset-id mine` 装的话，
必须让 **dsh 进程**带上环境变量（`export` 在你自己的 shell 里不算 —— dsh 得是从带这个变量的
环境里启动的）：

```sh
export DSH_CUSTOM_PROMPT_PATH="$DSH_HOME/.agent-presets/mine/prompt.md"
```

systemd 服务里则写进 unit 的 `Environment=`。

---

## 9. 安全：设置页的私有路由必须过平台的鉴权

### 症状（0.1.6-alpha.1 上实测过，本仓库已在源码层修复）

修复前的 `/custom-mode` 是**未授权可读写**的：

```sh
curl http://127.0.0.1:3080/custom-mode            # 200，整份系统提示词被读走
curl -X POST http://127.0.0.1:3080/custom-mode \
     -H 'content-type: text/plain' --data '{"mode":"standard","overrides":{},"prompt":"PWNED"}'
                                                           # 200，prompt.md 真的被改写
```

而同一台机器上官方路由都返回 401。原因：平台的 Host/Origin 栅栏与浏览器鉴权只作用在
`@deepseek-ai/dsh-client-connection` 挂载的 channel（`/`、`/api`…）上，插件直接在
`ctx.webServer` 注册的路由**不经过**它。

`text/plain` 这个细节很关键：**普通表单式跨站请求不触发预检**，所以用户访问的任意网页都能朝
这个端口 POST。响应虽然读不到，但写入已经发生 —— 对持有 Shell 与文件工具的 agent 而言，
这是可以远程触发的提示词注入。

### 现在的行为

路由在处理任何请求之前先问平台：

```js
const rejection = ctx.get('connection').requestRejection(req)
```

修完的实测：

| 请求 | 结果 |
| --- | --- |
| 未授权 GET | `401 unauthorized` |
| 未授权 POST（`text/plain`） | `401`，文件未被改写 |
| POST + `Origin: https://evil.example` + `Sec-Fetch-Site: cross-site` | `403 forbidden` |
| 带合法 `dsh-auth-*` cookie（正常浏览器会话） | `200`，功能照旧 |

**你自己装的是哪个版本**：看 `editor/index.mjs` 里有没有 `connectionRejection`。
没有的话，要么升级本仓库，要么先别把这个设置页暴露在能被别人访问的端口上
（默认只绑 `127.0.0.1`，风险主要在**多用户机器**与**浏览器内的跨站请求**）。

`connection` 服务取不到时（DSH 版本不匹配），路由**失败关闭**（返回 503 并在宿主日志里说明），
而不是退回「不校验也能用」。

---

## 10. 装进 tui / headless 之类的 profile：能用的比预期少

`./install.sh --help` 与两份 README 都写了 `--profile tui`，但**实测**要先看清一件事：

```sh
dsh --profile web      --dump-config | grep agent-presets   # 有
dsh --profile tui      --dump-config | grep agent-presets   # 无
dsh --profile headless --dump-config | grep agent-presets   # 无
```

`agent-presets` 这个服务**只出现在 web 组合里**，而「自定义模式」正是由它挂载的。所以在 tui 里
不是"设置页看不到"，而是**这个模式根本不存在**：新建会话时选不到它。设置页还额外需要
`webServer`（它是个 Web 页面），tui 同样没有。

修复前，装进 tui 之后每次启动都会打印这一行：

```
dsh: warning: 1 entry did not activate
custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
```

它和 [§1](#1-严重装完之后-dsh-起不来了只剩一行-pending) 里那个"装完 dsh 变砖"的报错**一模一样**，
所以极具误导性——一个正常的、装错 profile 的安装，看起来和一次灾难性损坏没有区别。
现在插件改成**作用域内等待服务**（`ctx.inject`），不再把整行卡在 `pending`，`install.sh` 也会在
装完后当场说明这个 profile 里没有设置页可用。

**结论**：想用图形化设置页，就装进 web profile。装进别的 profile 不会弄坏任何东西，但也用不上。

---

## 11. 一次性验证清单（改完之后照着跑）

```sh
# 1. 两个测试套件（其中 63 项是组成文件编译器）
DSH_SHIPPED_PRESETS_DIR="$(node -e '
  const {createRequire}=require("module");
  const r=createRequire(process.argv[1]);
  console.log(require("path").join(require("path").dirname(r.resolve("@deepseek-ai/dsh-agent-presets/package.json")),"presets"));
' "$PWD/editor/index.mjs")" node test/composition.test.mjs
node test/locales.test.mjs

# 2. 插件行进了组合树
dsh --profile web --dump-config | grep custom-mode

# 3. 组合树没有塌（应当是上百行，不是 1 行）
dsh --profile web --dump-config | wc -l

# 4. preset 被 dsh 看见了（重启 dsh 之后、新建会话时）
dsh --profile web --dump-config >/dev/null && ls "$HOME/.dsh/.agent-presets/custom"

# 5. 设置页能读到状态（把 <token> 换成 dsh web 启动时打印的那个）
curl -s "http://127.0.0.1:3080/custom-mode" \
  -H 'cookie: dsh-token=<token>' | head -c 300
```

> 第 5 条的 cookie 名与 token 取法随 dsh 版本可能不同；用浏览器打开设置页时看 Network 面板
> 里那条 `/custom-mode` 请求最省事。
