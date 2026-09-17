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

## 11. 设置页说找不到组成文件

从 npm 装（`dsh plugin --profile web add dsh-custom-mode`）之后，页面报

```
{"ok":false,"error":"找不到组成文件：/…/.agent-presets/custom/agent.cordis.yml"}
```

插件会在激活时播种 preset，所以这说明播种没有发生或没能写入。先看启动日志里有没有 `custom-mode:` 开头的行：

- **日志里什么都没有** —— 插件那一行压根没激活，见 §4。
- `custom-mode: preset 播种未完成 —— 无法创建 … EACCES` —— 运行 dsh 的用户对 `$DSH_HOME`（或 preset
  目录）没有写权限。这种情况只会报告并继续启动，坏的只有设置页。修权限、跑一次 `./install.sh`，
  或者手工把文件放进去：

  ```sh
  ls "$DSH_HOME/.agent-presets/custom"    # 应有 agent.cordis.yml、preset.yml、prompt.md、
                                          # prompt-reader.mjs、prompt-tool.mjs
  ```

播种每次激活只跑一次，而且只补缺失的文件 —— 它不会覆盖你写的 `prompt.md`，也不会覆盖设置页生成过的
`agent.cordis.yml`。所以如果某个文件补了又没，说明有别的什么东西在两次激活之间删掉了它。

## 12. 一次性验证清单（改完之后照着跑）

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

# 5. 设置页能列出助手、并读到其中一个的状态（cookie 见下方说明）
curl -s "http://127.0.0.1:3080/custom-mode" -H 'cookie: dsh-token=<token>' | head -c 300
curl -s "http://127.0.0.1:3080/custom-mode/state?id=custom" -H 'cookie: dsh-token=<token>' | head -c 300
```

> 第 5 条的 cookie 名与 token 取法随 dsh 版本可能不同；用浏览器打开设置页时看 Network 面板
> 里那条 `/custom-mode` 请求最省事。

## 13. 多助手：列表、新增、删除相关

### 13.1 某个模式没有出现在助手列表里

设置页**只管理本工具创建的模式**，判据是：目录里有 `prompt.md`，且（目录里有 `prompt-reader.mjs`，
或 `agent.cordis.yml` 里引用了 `'./prompt-reader.mjs'`）。

所以下面这些**不会**出现在列表里，这是有意的：

- 用官方选择器的「复制 preset」从 `standard` 等出厂模式复制出来的模式（身份走 `@deepseek-ai/dsh-persona`）；
- 自己手写的 preset。

原因是保存会**按基础模式重新生成组成文件**（逐行开关就是这么实现的），对手写的组成文件做这件事
等于毁掉它。想把它变成受管助手：让它的组成文件用 `./prompt-reader.mjs` 注入身份、并放一份
`prompt.md`，或者干脆在设置页新建一个助手再把提示词贴过去。

### 13.2 删掉的助手重启后又回来了

只有旧版本会这样：那时 `apply()` 每次激活都无条件播种 `custom`。现在的规则是——根目录下没有
`.custom-mode.json` 标记、且**一个受管助手都没有**时，才会创建 `custom`；否则只是补上标记。

如果确实遇到复活，检查 `$DSH_HOME/.agent-presets/.custom-mode.json` 是否存在；不存在就手工建一个
（内容 `{"seededAt":"…"}` 即可），再重启。

### 13.3 新增助手失败

页面会把后端给的原因原样显示，常见三种：

- **名字是空的** —— 后端拒绝空名字（空名字会让模式在各处显示成裸目录 id）。
- **目录已存在** —— 说明用户预设根目录下有同名目录，但 discovery 没把它算成一个模式（例如缺
  `agent.cordis.yml`）。换个名字，或者先处理掉那个目录。
- **复制模式模板失败** —— 包内的 `editor/preset/` 少了文件，或目标目录不可写。

### 13.4 助手改名了，但旧助手会话里的 `custom_prompt` 描述还是旧名字

工具描述来自组成文件里的 `config.modeName`，而**模块文件**（`prompt-tool.mjs`）在用户目录里、
激活时不会被覆盖（用户可能改过它）。旧版本装出来的助手，其模块不认识这个键。

跑一次 `./install.sh` 会刷新模块文件（它保留 `prompt.md`）。这只影响描述文案，工具的读写行为一直是
正确的。

## 14. 页面能开，但控件很朴素、和官方设置页不一样

这不是 bug，是**降级路径生效**了：本页的按钮、输入框、开关、标签、确认弹窗与图标都来自壳的
共享原子组件库 `@deepseek-ai/dsh-client-ui-primitives`，它必须由**壳**在启动时注册成种子词
（与 `react` 同级）。当前壳没有提供它时，页面会退回内置的朴素控件 —— 功能一致，外观更简。

确认方法：打开页面后看 Console，应当有一条

```
dsh-custom-mode: 当前壳没有在种子表里提供 @deepseek-ai/dsh-client-ui-primitives，
改用内置的朴素控件（功能一致，外观更简）。
```

要恢复统一外观，把 dsh 升到在种子表里注册了该包的版本即可（在 `dsh-web-frontend/dist/assets/index-*.js`
里搜 `dsh-client-ui-primitives` 就能确认有没有）。本插件不需要任何额外声明：`dsh.client.external`
是给「自己就是一条启动记录的 bundle」用的，而这个包是种子词，直接 `require` 即可（见
`docs/ARCHITECTURE.md` §14）。

## 15. 页面显示成 `assistant.heading`、`btn.create` 这类原始键

**0.1.6-alpha.2 起不应该再出现**：这是 `settings.section` 契约变化（`locale:` 选项被移除）造成的，
现在页面自带中英词典兜底（见 `docs/ARCHITECTURE.md` §15）。若仍看到键名，说明你用的是旧版编辑器包。

判断方法：打开页面看 Console。

```
dsh-custom-mode: 当前壳没有在种子表里提供 …        ← 另一回事（控件降级，见 §14）
dsh-custom-mode: 词典注册被拒，改用内置词典：…      ← 命名空间已被占用（多为热重载二次 apply）
dsh-custom-mode: 词典注册后宿主仍查不到 …，页面已改用内置词典。
```

三种情况下页面文案都是正常的（内置词典兜底）；这些警告只是告诉你宿主那一侧发生了什么。
若文案**确实**是键名，先确认 `editor/client.js` 是最新的（`grep -c assistant.heading editor/client.js`
应当大于 0，且同一条在 `editor/locales.mjs` 里存在），再重启 dsh 并刷新页面。

## 16. 调整顺序后选择器里的顺序没变

顺序写在每个助手目录的 `preset.yml` 里（`order: 1..N`）。若没生效，先看文件：

```
grep -n '^order:' "$DSH_HOME"/.agent-presets/*/preset.yml
```

- **一个都没有**：说明「上移 / 下移」没有真正调用成功，看页面状态栏的错误。
- **只有部分助手有**：这正是 writer 保留磁盘旧值的行为；对任意一个助手再点上移/下移一次，
  会给**所有**受管助手补齐 1..N。
- **文件对了但选择器没变**：选择器只在**新建会话**时读取 roster；已经打开的会话不受影响。
