# 实测记录

[English](MEASUREMENTS.md) | 中文

> 文件名用英文（`MEASUREMENTS.md`）是为了与 `docs/` 下其它文档一致；正文为中文。

这份文档记录**在真机上跑出来的结果**，不是设计说明。每条都给出命令与当时的输出，便于复跑核对。
环境：dsh `0.1.6-alpha.1`、Node 24.21.0、WSL2（mirrored 网络模式）、全新 `DSH_HOME`
（不碰开发机上正在用的那个实例）。

复跑方式见每节的命令；`$REPO` 指本仓库，`$H` 指一个独立的 `DSH_HOME`。

---

## 0. 端到端：改提示词 → **下一步就生效**（真实会话，两个来回）

整个项目就立在这一句话上，而它此前只有"读取函数会被重新求值"的单元测试，没有"agent loop
真的每一步都调它"的端到端证据。这一节补的就是它。

**为什么要用「标记」而不是让它复述系统提示词**：直接要求模型复述系统提示词会被拒绝
（实测：`我不能复述系统提示词的内容` —— 这是合理的安全行为，不是 bug）。所以改成在提示词里
植入一条**格式规则**，看模型的实际行为是否跟着文件走：

```
【格式规则，每次回答都必须遵守】
你的每一条回答，第一行必须正好是下面这一串字符，前后不留任何其他字符：

MARK-ONE
```

**做法**：在真实运行的 web 实例里开一个会话，问一句 → 回答后**不重启、不刷新、不新建会话**，
只把 `prompt.md` 里的 `MARK-ONE` 改成 `MARK-TWO`，再在**同一个会话**里问第二句。

**实测结果**（同一个浏览器页面，同一个 session）：

```
第 1 轮：1+1 等于几？   →  MARK-ONE  2          （用量 8.1K tok）
（把 prompt.md 改成 MARK-TWO）
第 2 轮：2+2 等于几？   →  MARK-TWO  4          （用量 9.3K tok）
```

判定：

```json
{
 "turn1_hasMarkOne": true,
 "turn2_hasMarkTwo": true,
 "turn2_stillOnlyMarkOne": false,
 "finalPromptMarker": "MARK-TWO"
}
```

也就是说：**编辑文件 → 下一步模型调用就用新文本**，成立；不需要重启，也不需要新建会话。
（`prompt-reader.mjs` 的单元测试还证明了稳态下不会重复读盘：一个 `stat` 与尺寸比对。）

两轮之间，界面里会出现一行「**系统提示词更新**」—— 那是 dsh 自己标的，说明它检测到系统提示词在会话中途变了。

驱动脚本的思路见下：先用 CDP 把工作区选好、把问题打进 composer，再轮询页面文本直到标记出现。

> **一条走不通的路，记下来省得再试**：`dsh --profile headless`（单轮 CLI）**不能**用来测这个。
> 它明确拒绝运行带 agent preset 的会话，源码里写着：
> `session "…" runs under agent preset "…", which the one-shot runner does not compose`。
> 所以端到端只能用 web 实例跑。

### 0.1 顺带验证：`agent-presets.default` 是运行时设置项，不是组合里的值

```sh
DSH_HOME=$H dsh --profile web --dump-config | grep -A3 'id: agent-presets'
#   config:
#     default: standard          ← 组合里写死的默认值
```

而 `$H/settings.yaml` 里的 `agent-presets: { default: custom }` 会在运行时覆盖它（首页的模式
选择器随即显示「自定义模式」）。这两处不是同一个东西，排查"为什么默认模式没变"时容易搞混。

---

## 1. 全新环境安装：会用旧版 `install.sh` 踩到的那个坑

```sh
rm -rf "$H" && mkdir -p "$H"
cp ~/.dsh/.credentials.yaml "$H/"          # 只要能启动就行，不涉及模型调用
DSH_HOME="$H" ./install.sh                  # ← 修复前的版本
```

修复前输出：

```
==> 2/2 安装设置页插件 "dsh-custom-mode" 到 profile "web"
    已移除解析不到的残留条目: ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]
    bundle 已登记: ["dsh-custom-mode"]
安装完成。          ← 退出码 0，用户看不出任何异常
```

`$H/profiles/web/package.json` 的 bundles 从
`["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]` 变成 `["dsh-custom-mode"]`，
于是：

```sh
DSH_HOME="$H" dsh --profile web --dump-config
# == dsh-custom-mode
- id: custom-mode
  name: dsh-custom-mode
# ↑ 全文就这两行（正常是 158 行）

DSH_HOME="$H" dsh web --port 3081 --no-open
# dsh: warning: 1 entry did not activate
# custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
# ↑ 服务永远等不到：没有界面、没有 agent
```

**触发条件**（实测两种顺序）：

| 顺序 | 结果 |
| --- | --- |
| 全新 `DSH_HOME` → 直接 `./install.sh` | **踩中** |
| 全新 `DSH_HOME` → 先启动过一次 `dsh web` → `./install.sh` | 不踩中：启动会把 harness 依赖填充进 `profiles/node_modules`，旧探测路径因此命中 |

修复后（`==> 3/3 安装后自检`）：

```
    安装前 bundles: []
    bundle 已登记: ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","dsh-custom-mode"]
==> 3/3 安装后自检（组合 profile）
    组合树 158 行，dsh-custom-mode 已就位
```

护栏本身也验证过：手工把 profile 改成 bug 后的状态再跑，它以非 0 退出：

```
    自检失败: 组合树只有 1 行，基础 bundle 疑似丢失（正常应有上百行）。
    当前 bundles: ["dsh-custom-mode"]
    自救: 把 profile 模板自带的 bundle 名（如 @deepseek-ai/dsh-base、
          @deepseek-ai/dsh-web-app）加回上面这个列表，见 docs/TROUBLESHOOTING.md。
```

---

## 2. 设置页路由的未授权读写（安全）

修复前（实例跑在 3081）：

```sh
curl http://127.0.0.1:3081/custom-mode
# → 200 {"ok":true,…,"prompt":"You are a coding agent powered by {{model}} model.…"}

curl -X POST http://127.0.0.1:3081/custom-mode \
     -H 'content-type: text/plain' \
     --data '{"mode":"standard","overrides":{},"prompt":"PWNED-BY-UNAUTHENTICATED-POST\n"}'
# → 200 {"ok":true,"mode":"standard","note":"已保存（基础模式：standard）…"}
head -1 "$H/.agent-presets/custom/prompt.md"
# PWNED-BY-UNAUTHENTICATED-POST          ← 文件真的被改了

curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081/
# 401
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081/api/settings
# 401
```

修复后：

| 请求 | 结果 |
| --- | --- |
| 未授权 GET | `401 unauthorized` |
| 未授权 POST（`text/plain`） | `401`，文件未被改写 |
| POST + `Origin: https://evil.example` + `Sec-Fetch-Site: cross-site` | `403 forbidden` |
| 带合法 `dsh-auth-*` cookie（浏览器会话） | `200`，功能照旧 |

复跑：

```sh
# 未授权
curl -s -o /dev/null -w 'GET  %{http_code}\n' "http://127.0.0.1:3081/custom-mode"
curl -s -o /dev/null -w 'POST %{http_code}\n' -X POST "http://127.0.0.1:3081/custom-mode" \
  -H 'content-type: text/plain' --data '{"mode":"standard","overrides":{},"prompt":"x"}'
# 有会话（token 从 dsh web 的日志里取）
curl -s -c /tmp/cj -o /dev/null "http://127.0.0.1:3081/?token=$TOKEN"
curl -s -b /tmp/cj -o /dev/null -w 'AUTH %{http_code}\n' "http://127.0.0.1:3081/custom-mode"
```

---

## 3. 功能链路：拨开关 → 保存 → 磁盘上的实际结果

在设置页把「网页检索与抓取」拨掉并点保存，页面状态栏返回：

```
已保存（基础模式：standard）。新建会话即生效，当前会话保持原配置。
```

磁盘上（`$H/.agent-presets/custom/agent.cordis.yml`）：

```yaml
# 本文件由「自定义模式」设置页生成，请勿手工编辑——下次保存会覆盖。
# 基础模式: standard
# 生成时间: 2026-09-17T10:03:12.800Z
…
- id: tool-web                    # ← 被显式关闭的行
  name: '@deepseek-ai/dsh-tool-web'
  disabled: true
…
- id: tool-bash                   # ← 没碰过的行，平台条件逐字节保留
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
```

两件事同时得到证明：显式开关生效；**未触碰的行保持出厂状态**（这是这个项目正确性的核心，
也是 `composition.test.mjs` 那 63 项在防的东西）。

页面另一处可以立刻看出平台表达式确实在宿主端求值：在 Linux 上，`Shell（pwsh）` 显示
「已停用 / 跟随平台」，而 `Shell（bash）` 是「已启用 / 跟随平台」——两者在 YAML 里都带
`!!js` 条件。

---

## 4. 热更新契约：改文件 → 下一次求值就是新文本

真会话里的端到端演示需要模型调用；不依赖模型的等价证据是直接驱动 `prompt-reader.mjs`：
按注册表的方式取出 persona section 的 `text` provider 并调用它。

```sh
node test/prompt-reader.test.mjs
```

```
PASS  prefix 的 text 是函数（每步重新求值）
PASS  改文件后下一次求值读到新文本（无需重启）
PASS  未变化时不重新读盘（删除后仍给出缓存文本）
PASS  被清空后仍给出上一版内容
PASS  complete: true 时不再注册 suffix
结果: 15 通过, 0 失败
```

---

## 5. 双语与深浅色

不是"看代码觉得应该没问题"，而是通过**界面自己的控件**切换后截图核对：

| 动作 | 观察到的结果 |
| --- | --- |
| 语言 → English | 导航项自动变成 `Custom mode`；小节标题变成 `Mode name` / `Base mode` / `Plugin switches` / `System prompt` |
| 外观 → 深色 | 整页跟随（含卡片、徽标、输入框），无硬编码色值 |

这两条现在不再各配一张图（重复画面不值得让读者多下载几百 KB）：切换是**真的做了**，
断言与观察值写在 `tools/screenshots/observed.json` 里，拍摄脚本见 `tools/screenshots/`。

---

## 6. 测试与 CI

```sh
node test/run.mjs
```

```
出厂 preset 目录: …/dsh-agent-presets/presets
（来源：$DSH_HOME/profiles/node_modules）
结果: 63 通过, 0 失败      ← 组成文件编译器
结果: 15 通过, 0 失败      ← 热更新契约
结果: 65 通过, 0 失败      ← 词典（含 client.js 手抄副本的漂移检查）
7 个套件全部通过
```

解析链在两种布局下都验证过：

| 布局 | 命中的来源 |
| --- | --- |
| 本机装了 dsh | `$DSH_HOME/profiles/node_modules` |
| 干净目录里 `npm install @deepseek-ai/dsh@0.1.6-alpha.1`（CI 的做法） | 从本文件做 Node 解析 |

CI 用 npm 上那份 dsh 自带的 presets，与本机逐字节相同（`diff -rq` 无差异），所以 CI 的结论是
真结论，而不是拿自造 fixture 跑出来的。

---

## 7. 装到非 web profile：哪些能用、哪些不能（实测）

`install.sh --help` 与两份 README 都写了 `--profile tui`，但**实测**要分清两个层次：

| profile | 组合里有没有 `agent-presets` | 组合里有没有 `webServer` | 结果 |
| --- | --- | --- | --- |
| `web` | 有 | 有 | 模式可选 + 设置页可用（全功能） |
| `tui` | **没有** | **没有** | 模式**无法被选中**；设置页也不存在 |
| `headless` | 没有（且即使补上也会被拒绝，见 §0） | 没有 | 同上 |

`agent-presets` 只在 web 组合里出现（`dsh --profile web --dump-config | grep agent-presets` 有输出，
tui/headless 都是 0 行），而「自定义模式」这个 preset 正是由它挂载的——**所以在 tui 里它不是"设置页
看不到"，而是这个模式根本不存在**。

修复前，每次启动 tui 都会打印这一行（与 §1 那个"装完 dsh 变砖"的报错一模一样，纯误导）：

```
dsh: warning: 1 entry did not activate
custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
```

修复后不再 pending（插件改成作用域内等待服务），`install.sh` 也会**按 profile 分别说明**——
这里刻意不写成"模式本身仍可用"，因为在 tui 上那句话不成立：

```
    注意: profile "tui" 里这个插件只有一部分能生效。
          · 组合里没有 agent-presets：**「自定义模式」无法被选中**，
            preset 文件被复制过去了，但没有任何东西会挂载它
          · custom_prompt 工具可用（会话里直接说「把系统提示词改成……」）
          · 没有设置页：组合里没有 web 服务器
          要用完整功能（模式可选 + 图形化设置页），请装进 web profile：
            ./install.sh --profile web
```

web profile 上同一段自检不打印任何提示（实测出现次数 0），收尾说明也照常给出
"新会话选「自定义模式」"。

---

## 8. 卸载往返：`uninstall.sh` 曾留下一个软链

```sh
DSH_HOME=$H ./install.sh >/dev/null          # 装上
DSH_HOME=$H ./uninstall.sh                   # 卸掉
ls "$H/profiles/web/node_modules" | grep custom
# 修复前：dsh-custom-mode      ← 仍在（指向仓库的软链）
# 修复后：（无输出）
```

`package.json` 的 `dependencies` 与 `dsh.profile.bundles` 当时都已经清干净了，只有 pnpm 留下的
软链还在（pnpm 12.4.2 上复现）。它不影响 dsh 装配（装配只看 bundles），但 uninstall 就该不留
痕迹——尤其是随后删掉仓库时它会变成断链。现在只删这一个包名。

卸载后的完整状态（实测）：

```
bundles:      ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]   ← 回到模板原样
dependencies: undefined                                              ← 清空
preset 目录:  保留（提示词也保留，符合默认行为）
组合树:       157 行（= 装上时的 158 行减去本插件那一行）
```

另外验证了二次安装的幂等性：装上 → 手工改 `prompt.md` → 再装一次，脚本保留用户提示词，
只更新模式文件（`检测到已存在的 prompt.md，保留它（只更新模式文件）`）。

---

## 9. 市场安装：全新 `DSH_HOME` 上的播种

市场的安装是一条命令，所以这个包必须自己就够用。在一个全新 `DSH_HOME`（只复制了凭据）上装打包好的
tarball 再启动，实测：

```
$ DSH_HOME=$H dsh plugin --profile web add dsh-custom-mode-0.1.6-alpha.1.rev1.tgz
+ dsh-custom-mode file:/tmp/dsh-custom-mode-0.1.6-alpha.1.rev1.tgz

$ ls $H/.agent-presets/custom        # 启动前：没有，播种发生在激活时
  （不存在）

$ DSH_HOME=$H dsh web --port 3082 --no-open
custom-mode: 已播种 preset 到 …/.agent-presets/custom（新建 5 个文件: agent.cordis.yml, preset.yml,
prompt.md, prompt-reader.mjs, prompt-tool.mjs）
dsh web: http://127.0.0.1:3082/?token=…
```

之后新建会话的模式选择器里就能选到它（用拍摄脚本同一套 CDP 驱动读的列表：`Standard mode / PTC mode /
Minimal mode / Creator mode / 自定义模式`），设置页也能读到完整状态：

```
GET /custom-mode（带会话 cookie） → 200 {"ok":true,"mode":"standard",…19 行…}
GET /custom-mode（不带 cookie）   → 401
```

验收其余各项：

| 项目 | 结果 |
| --- | --- |
| 第二次启动 | 完全没有 `已播种` 日志 —— preset 完整时一个字都不写 |
| 启动前已存在的 `prompt.md` | 事后逐字节相同（`md5` 未变）；另外四个文件被补齐 |
| `$DSH_HOME/.agent-presets` 只读 | dsh 照常启动；日志 `preset 播种未完成 —— 无法创建 … EACCES`，设置页返回 `{"ok":false,"error":"找不到组成文件：…"}` |
| 走设置页自己的路由改名 + 切基础模式 | `preset.yml` → `name: "My Renamed Mode"`，组成文件表头 `# 基础模式: minimal`，行数 19 → 3，提示词被重写 |
| 在播种出来的实例上跑完整 UI 流程 | 拍摄脚本读到状态、拨掉一行、保存成功（`已保存（基础模式：standard）…`）、切换语言与主题 |

## 10. 面向 dsh `0.1.6-alpha.2` 的升级核对 —— 耦合点逐条静态验证

项目的版本策略要求：官方发新版后，先照耦合点清单核对，再动版本号。这一节就是 `0.1.6-alpha.2` 的
那次核对，而且**不需要浏览器**——契约都是类型声明，拉下包就能回答。

**方法**：下载 `dsh-agent-presets`、`dsh-system-prompt`、`dsh-client-locale`、
`dsh-client-connection`、`dsh-tools`、`dsh-host-webserver`、`dsh-client-ui-settings`、
`dsh-client-ui-slots` 的 `0.1.6-alpha.2` 包；把本项目依赖的声明从新版与本机已装的
`0.1.6-alpha.1` 里各抓一遍；逐条比对。然后把整套测试**对着两个版本的出厂 preset 各跑一次**。

### 所有耦合点均未变化

| 耦合点 | 声明所在包 | 结果 |
| --- | --- | --- |
| `agentPresets.list()` 返回形状（`trust`、`path`） | `dsh-agent-presets` | 未变（11 处匹配） |
| `systemPrompt.section({ text: fn })` —— text 作为 provider | `dsh-system-prompt` | 未变 |
| `PromptSection.complete` | `dsh-system-prompt` | 未变 |
| `locale.register` / `locale.bind` | `dsh-client-locale` | 未变 |
| `connection.requestRejection`（失败关闭 503） | `dsh-client-connection` | 未变 |
| `tools.register(definition: ToolDefinition)` | `dsh-tools` | 未变 |
| `WebRoute { kind, path, handler }` | `dsh-host-webserver` | 未变 |
| `settings.section` 插槽：`kind: list`、`scope: root`、owner props | `dsh-client-ui-settings` | 未变 |
| `locale:` 注册选项（提供绑定的 `t`） | `dsh-client-ui-slots` | 仍然存在——原文："present exactly on entries whose registration declares `locale:`" |

### 确实变了的部分：每个模式多一行

`standard`、`ptc`、`cordis` **各多且只多一行**——`tool-plugin-manager`
（`@deepseek-ai/dsh-plugin-manager/tools`）；`minimal` 未变。**不需要改任何代码**：编译器运行时
读出厂组成文件，重新生成时会自动带上。它只是没有显示标签，现已补齐中英两份；并且
`composition.test.mjs` 现在断言"出厂每一行都能查到 `ROW_META` 条目"，所以下次官方新增行会让
CI 变红，而不是在界面上静默显示成裸 id。

### 测试结果

```
DSH_SHIPPED_PRESETS_DIR=<0.1.6-alpha.1 的 preset> node test/run.mjs   → 8 个套件全部通过
DSH_SHIPPED_PRESETS_DIR=<0.1.6-alpha.2 的 preset> node test/run.mjs   → 8 个套件全部通过
```

### 附带发现：以 root 运行时，`chmod` 无法伪造不可写目录

`test/seed.test.mjs` 原先对父目录用 `chmod 0o500` 来触发播种的失败路径。实测：**root 会绕过权限位**，
于是播种照样成功，三条断言翻红。它们**在 CI（非 root 的运行器）上绿，在以 root 跑套件的人那里红**
——一个"结果取决于谁在跑"的测试。改用普通文件阻断路径后，任何用户下都返回 `ENOTDIR`，这些断言
在任何地方含义一致。

---

## 11. 多助手：一个设置页新增/删除/切换 N 个模式（真实实例）

环境同 §9：全新的 `DSH_HOME=/tmp/dsh-dev`，web profile，独立端口 3081 —— 不碰开发机上正在用的实例。

### 11.1 测试套件

```
$ node test/run.mjs
出厂 preset 目录: /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets
（来源：$DSH_HOME/profiles/node_modules）
…
结果: 64 通过, 0 失败      composition.test.mjs
结果: 26 通过, 0 失败      composition-edge.test.mjs
结果: 15 通过, 0 失败      prompt-reader.test.mjs
结果: 37 通过, 0 失败      prompt-tool.test.mjs
结果: 45 通过, 0 失败      meta.test.mjs
结果: 56 通过, 0 失败      assistants.test.mjs   ← 本次新增
结果: 94 通过, 0 失败      editor-route.test.mjs ← 由 1 条路由扩到 5 个端点
结果: 31 通过, 0 失败      seed.test.mjs
结果: 66 通过, 0 失败      locales.test.mjs
结果: 19 通过, 0 失败      client-bundle.test.mjs ← 本次新增（浏览器半的注册契约）
结果: 16 通过, 0 失败      manifests.test.mjs
11 个套件全部通过（presets 来源：$DSH_HOME/profiles/node_modules）   ← 合计 469 项检查
```

### 11.2 安装与启动

```
$ DSH_HOME=/tmp/dsh-dev ./install.sh
    组合树 164 行，dsh-custom-mode 已就位
$ DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open --host 127.0.0.1
dsh web: http://127.0.0.1:3081/?token=…
```

用 token 换到浏览器会话 cookie（`GET /?token=…` → `303` + `set-cookie: dsh-auth-…`），下面全部带这份 cookie。

### 11.3 栅栏与列表

```
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/custom-mode
401                                          ← 未授权（栅栏仍然第一优先）

$ curl -s -b "$JAR" http://127.0.0.1:3081/custom-mode
{"ok":true,"assistants":[{"id":"custom","name":"自定义模式","description":"完整编码能力…"}],
 "root":"/tmp/dsh-dev/.agent-presets"}
```

### 11.4 新增两个助手（一个中文名、一个英文名）

```
$ curl -s -b "$JAR" -H 'content-type: application/json' \
    -d '{"name":"写作助手","description":"负责写文档与博客"}' http://127.0.0.1:3081/custom-mode/create
{"ok":true,"id":"custom-2","name":"写作助手",…}      ← 中文 slug 为空 → custom-2

$ curl -s -b "$JAR" -H 'content-type: application/json' \
    -d '{"name":"Writer"}' http://127.0.0.1:3081/custom-mode/create
{"ok":true,"id":"writer","name":"Writer",…}          ← 英文名直接当目录名

$ ls -1 /tmp/dsh-dev/.agent-presets/
custom
custom-2
writer
```

新目录里是 5 个文件的完整模板，其中 `agent.cordis.yml` 是按 standard 重新生成的：

```
$ head -3 /tmp/dsh-dev/.agent-presets/custom-2/agent.cordis.yml
# 本文件由「自定义模式」设置页生成，请勿手工编辑——下次保存会覆盖。
# 助手: 写作助手 (custom-2)
# 基础模式: minimal
$ grep -n modeName /tmp/dsh-dev/.agent-presets/custom-2/agent.cordis.yml
77:    modeName: "写作助手"
```

### 11.5 每份提示词各自独立（这是「多个 Agent 各自可自定义」的判据）

```
$ curl -s -b "$JAR" -H 'content-type: application/json' \
    -d '{"id":"custom-2","mode":"minimal","overrides":{"tool-fs":false},
         "prompt":"你是写作助手，负责把要点写成清晰的文档。\n\n工作目录：{{cwd}}\n",
         "name":"写作助手","description":"负责写文档与博客"}' \
    http://127.0.0.1:3081/custom-mode/state
{"ok":true,"id":"custom-2","mode":"minimal","note":"已保存（写作助手，基础模式 minimal）。…"}

$ head -c 30 /tmp/dsh-dev/.agent-presets/custom/prompt.md   → You are a coding agent pow
$ head -c 30 /tmp/dsh-dev/.agent-presets/custom-2/prompt.md → 你是写作助手，负责把要点写成清
$ head -c 30 /tmp/dsh-dev/.agent-presets/writer/prompt.md   → You are a coding agent pow
```

校验仍然守着写入路径（拒绝时文件不动）：

```
$ curl -s -b "$JAR" -H 'content-type: application/json' \
    -d '{"id":"custom-2","mode":"minimal","prompt":"x {{foo}} y"}' …/custom-mode/state
{"ok":false,"error":"保存被拒绝：{{foo}} 不是已注册的变量，渲染时会报错并让本模式每个请求都失败。可用：{{model}}、{{cwd}}、{{provider}}。"}
```

### 11.6 删除：出厂模式不可删，自己建的可以

`remove` 走的是 `scope.agentPresets.remove(id)`，所以「删的确实是 roster 里的那一行」这件事本身就是
「运行中的进程已经发现了新目录」的证明：

```
$ curl … -d '{"id":"standard"}' …/custom-mode/delete
{"ok":false,"error":"找不到助手「standard」。设置页只管理本工具创建的模式…"}

$ curl … -d '{"id":"writer"}' …/custom-mode/delete
{"ok":true,"id":"writer","note":"已删除「writer」。正在使用它的会话不受影响；新建会话时不再出现。"}
$ ls -1 /tmp/dsh-dev/.agent-presets/
custom
custom-2
```

方法与子路径（`GET` 不能建助手）：

```
$ curl -s -o /dev/null -w "%{http_code}\n" -b "$JAR" …/custom-mode/create   → 405
$ curl -s -b "$JAR" …/custom-mode/nope
{"ok":false,"error":"未知的子路径：/custom-mode/nope"}
$ curl … --data-binary @4MB.json …/custom-mode/state                        → 500（请求体过大）
```

### 11.7 新助手真的会出现在模式选择器里

选择器读的就是 discovery，所以直接问 discovery（跑在真实实例的 `DSH_HOME` 上）：

```
$ node /tmp/roster-check.mjs
custom     user    自定义模式        mountable
custom-2   user    写作助手         mountable      ← 没有 broken，说明组成文件可加载、每行都能解析
standard   system  标准模式         mountable
ptc        system  PTC 模式        mountable
minimal    system  极简模式         mountable
cordis     system  创造模式         mountable
```

浏览器半也确认是新的（页面加载的那份 bundle，与仓库文件逐字节一致，只多了 `sourceMappingURL`）：

```
$ curl -s -b "$JAR" '…/plugins/??dsh-custom-mode/client.js&rev=…' -o /tmp/served-client.js
http=200 bytes=44361
$ diff /tmp/served-client.js editor/client.js
874,875d873
< ;
< //# sourceMappingURL=/plugins/??dsh-custom-mode/client.js.map&rev=…
```

**未验证的一项**：没有浏览器可用，所以 React 实际渲染出来的界面（助手列表、按钮布局）没有截图核对。
其余链路（路由、磁盘、roster、bundle）都在真实实例上跑过。

---

## 12. 界面对齐壳的原子组件（种子表实测）+ 复制助手（真机）

### 12.1 决定这层 UI 能不能成立的证据：种子表

手写 bundle 只能 `require`。所以「用官方控件」的前提是壳把控件注册成了种子词。在
`dsh-web-frontend/dist/assets/index-8VXBH-f-.js`（616 KB）里搜到的就是那张表：

```
$ python3 - <<'PY'   # 在 dist 里搜 dsh-client-ui-primitives 并打印上下文
...untime":_c,"react-dom":bc,"react-dom/client":Ic,"@deepseek-ai/cordis":ec,
"@deepseek-ai/dsh-client-store":Jc,"@deepseek-ai/dsh-client-ui-slots":ou,
"@deepseek-ai/dsh-client-ui-primitives":Cy,"@deepseek-ai/dsh-client-ui-dockkit":Xw}}var ix=class{...
```

它和 `react` 同级，因此任何 bundle 都能 require，且**不需要** `dsh.client.external`
（那个字段服务于启动清单里有独立记录的「图行」）。

### 12.2 它在启动清单里的形态（容易被误判）

```
$ python3 … 解析 globalThis["__DSH_BOOT__"]
keys: ['rev', 'entries', 'batches'];  entries: 59
--- @deepseek-ai/dsh-client-ui-primitives      → (NOT A ROW)
--- @deepseek-ai/dsh-client-ui-settings-general → {"id":"…settings-general","url":"/plugins/??…&rev=b97a6adea38cd90c-20","inject":[…]}
--- dsh-custom-mode                             → {"id":"dsh-custom-mode","url":"/plugins/??dsh-custom-mode/client.js&rev=b97a6adea38cd90c-49","rev":"…-49"}
declared by @deepseek-ai/dsh-client-ui-subagent in inject
declared by @deepseek-ai/dsh-client-ui-jobs in inject
```

即：**它不是一条 entry**，只出现在两个官方 bundle 的 `inject` 里，而官方
`settings-general` 运行时 require 它却没有声明 —— 与 12.1 的种子表结论一致。
（只看 boot manifest 会得出「必须先声明依赖」的错误结论。）

### 12.3 复制助手（真机，端口 3081）

```
$ curl … -d '{"id":"custom","mode":"minimal","overrides":{"tool-fs":false},
              "prompt":"原始提示词 MARK-SOURCE\n","name":"原始助手","description":"被复制的那一个"}' …/custom-mode/state
{"ok":true,…}

$ curl … -d '{"name":"副本助手","from":"custom"}' …/custom-mode/create
{"ok":true,"id":"custom-2","name":"副本助手",
 "note":"已复制出「副本助手」：提示词、基础模式与插件开关都来自「custom」，之后各改各的，互不影响。"}

$ curl … '…/custom-mode/state?id=custom-2'
{"id":"custom-2","mode":"minimal","overrides":{},"prompt":"原始提示词 MARK-SOURCE\n",
 "name":"副本助手","description":"被复制的那一个","promptPath":"/tmp/dsh-dev/.agent-presets/custom-2/prompt.md"}

$ grep -c MARK-SOURCE /tmp/dsh-dev/.agent-presets/*/prompt.md
/tmp/dsh-dev/.agent-presets/custom/prompt.md:1
/tmp/dsh-dev/.agent-presets/custom-2/prompt.md:1
```

`overrides` 是 `{}` 而不是 `{"tool-fs":false}`：源自己也是 `{}` —— minimal 模式里没有 `tool-fs` 这一行，
所以那个开关在写入时就被忽略了。复制体与源**逐字段一致**，这正是要断言的性质。

### 12.4 缓存头与 rev（决定用户要不要清缓存）

```
$ curl -D - … '/plugins/??dsh-custom-mode/client.js&rev=b97a6adea38cd90c-49'
HTTP/1.1 200 OK
cache-control: public, max-age=31536000, immutable
```

immutable 看着危险，但 rev 是内容哈希：

```
dsh-client-modules/lib/index.js:
  function artifactRevision(bundle, baseline) {
    return framedHash("plugin-artifact", [bundle, Buffer.from(String(baseline.mtimeMs))]);
  }
  const rev = artifactRevision(readFileSync(record.meta.clientPath), baseline);
```

文件字节或 mtime 一变，rev 就变，URL 就变。**所以重启后普通刷新即可**。

### 12.5 套件

```
结果: 104 通过, 0 失败      editor-route.test.mjs  ← 新增：路由常量防漂移、复制助手
结果: 26 通过, 0 失败       client-bundle.test.mjs ← 新增：原子组件有/无两条路径
11 个套件全部通过（presets 来源：$DSH_HOME/profiles/node_modules）   ← 合计 486 项检查
```

---

## 13. `settings.section` 契约变化导致的整页键名 + 排序真机验证

### 13.1 权威契约（不是推断）

插槽声明随 `dsh-cordis-client-runner` 一起打包，含 `registerOptions` 与文档：

```
$ python3 - <<'PY'   # 在 dsh-cordis-client-runner/lib/client.js 里取 settings.section 的声明
{
  key: "settings.section", kind: "list", scope: "root",
  registerOptions: [
    { name: "id",    requirement: "required", type: "string" },
    { name: "order", requirement: "optional", type: "number" },
    { name: "label", requirement: "optional", type: "string | (() => string)" }
  ],
  ownerProps: […SettingsSectionOwnerProps…],
  standardProps: ["useResource: UseResource", "useWorkspaces: …", …]
}
```

**`locale:` 不在其中。** 旧写法依赖它把壳绑定好的 `t` 递进组件，于是正文全部回显键名。

### 13.2 启动清单：本插件只装一次（排除「重复 apply」这一支）

```
$ 解析 globalThis["__DSH_BOOT__"]
entries: 59
dsh-custom-mode 出现次数: 1
它的 manifest 行: [{"id":"dsh-custom-mode","url":"/plugins/??dsh-custom-mode/client.js&rev=e159d1f9c23eee42-49","rev":"e159d1f9c23eee42-49"}]
ui-primitives 是不是一条 entry: False        ← 它是种子词，不是图行
```

所以「页面出现两次注册/两次 apply」在这一版不成立；配合上面的契约变化，正文键名的解释是充分的。

### 13.3 修复后的服务端产物与词典内容

```
$ curl -s '…/plugins/??dsh-custom-mode/client.js&rev=e159d1f9c23eee42-49' -o /tmp/s3.js
http=200 bytes=70019
$ node -e "…统计内联词典…"
served ZH 条数: 127
served ZH 里有 nav 吗: true
served ZH 里有 assistant.heading 吗: true
```

即：地板词典确实随包送达，且包含导航与页面所需的键。

### 13.4 排序（真机，端口 3081）

```
$ 依次创建 Alpha / Beta / Gamma
 created alpha Alpha / created beta Beta / created gamma Gamma

$ curl … /custom-mode            → alpha:Alpha | beta:Beta | custom:自定义模式 | gamma:Gamma
$ curl … -d '{"id":"beta","direction":"up"}' …/custom-mode/reorder
{"ok":true,"id":"beta","order":["beta","alpha","custom","gamma"],
 "note":"顺序已保存：新建会话时的模式选择器按这个顺序排列。"}
$ curl … /custom-mode            → beta:Beta | alpha:Alpha | custom:自定义模式 | gamma:Gamma

$ for d in custom alpha beta gamma; do grep ^order: /tmp/dsh-dev/.agent-presets/$d/preset.yml; done
custom   order: 3
alpha    order: 2
beta     order: 1
gamma    order: 4

$ curl … -d '{"id":"beta","direction":"up"}' …/custom-mode/reorder
{"ok":false,"error":"「Beta」已经在最前面。"}
$ curl … -d '{"id":"custom","direction":"sideways"}' …/custom-mode/reorder
{"ok":false,"error":"未知的排序方向：sideways"}
$ curl -o /dev/null -w '%{http_code}' …/custom-mode/reorder     （GET）
405
```

顺序落在 `preset.yml` 而不是插件自己的状态里，所以重启后仍生效；`GET` 不会改动它。

### 13.5 客户端 bundle 仍是内容哈希定址

```
cache-control: public, max-age=31536000, immutable
rev = artifactRevision(readFileSync(clientPath), { mtimeMs })
```

改文件 → rev 变 → URL 变。**重启后普通刷新即可**，无需清缓存。

---

## 14. 真浏览器验证（实验机，dsh `0.1.6-alpha.2`）

这是本项目第一次**看见**自己渲染出来的页面。跑 harness 的那台机器（会话机）是**宿主**，不能拿它当
测试目标——重启它等于杀掉正在跑的会话。所以验证放在一台可以随便重启的实验机上做。
下面的 `$LAB` 指实验机（操作者自己的 `~/.dsh/AGENTS.md` 里记着它的地址与启动脚本）；
一份只需要「另一台机器 + 一个浏览器」的通用配方见仓库 `AGENTS.md` 的「The lab」一节。

### 14.1 实验机准备（含 dsh 升级）

```
$ ssh "$LAB" 'dsh --version'
0.1.6-alpha.1
$ ssh "$LAB" 'npm i -g @deepseek-ai/dsh@0.1.6-alpha.2'      # 后台跑，注意 npm 标签坑
$ ssh "$LAB" 'dsh --version'
0.1.6-alpha.2
```

npm 标签有坑：`latest` 停在旧的 `0.1.5-rc.2`，新版在 `alpha` 上；升级很慢（腾讯云镜像），
必须后台 + 轮询，不要用 ssh 前台等。

```
# 独立 DSH_HOME + 免首启弹窗的 settings.yaml（只放 onboarding/locale/theme，凭据不出会话机）
$ ssh "$LAB" 'cd /root/dsh-lab/dsh-custom-mode && DSH_HOME=/root/dsh-custom-lab ./install.sh'
    组合树 164 行，dsh-custom-mode 已就位
$ ssh "$LAB" '/root/custom-lab.sh'
dsh web: http://127.0.0.1:3082/?token=SaOzofZ2…
```

浏览器：实验机上已有 playwright 的 chromium，
`/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`，`/root/chrome-lab.sh` 把它以
`--headless=new --remote-debugging-port=9222` 拉起来：

```
$ ssh "$LAB" '/root/chrome-lab.sh'
{"Browser": "Chrome/153.0.8010.12", "Protocol-Version": "1.3", …}
```

### 14.2 验证结果：21/21

```
$ ssh "$LAB" 'cd /root/dsh-lab/dsh-custom-mode && CDP_PORT=9222 \
    node tools/browser-verify.mjs --url "http://127.0.0.1:3082/?token=…" --out /root/custom-mode-verify.png'

PASS  首启遮罩被清掉（否则下面的点击都会被拦）
PASS  能打开「自定义模式」设置页
PASS  面板里没有裸翻译键
PASS  渲染出区块标题「助手」
PASS  渲染出「新增助手」按钮
PASS  渲染出「上移」按钮
PASS  渲染出「下移」按钮
PASS  渲染出「复制一份」按钮
PASS  渲染出「导出提示词」按钮
PASS  渲染出「导入提示词」按钮
PASS  渲染出系统提示词区块
PASS  渲染出基础模式区块
PASS  渲染出插件开关区块
PASS  每个开关都有可见行标题
PASS  左侧导航项不是裸键 nav
PASS  新增后在列表里出现
PASS  删开风险确认弹窗
PASS  弹窗里有「我明白」勾选框
PASS  点「永久删除」
PASS  删除后从列表消失
PASS  页面没有报 dsh-custom-mode 的错误

结果: 21 通过, 0 失败
```

截图取回会话机后**肉眼看图核对**：左侧导航是「自定义模式」；「助手」区块、中英提示、
`自定义模式` 胶囊、铺满宽度的新建输入框 + 「+ 新增助手」；「模式名称」两个铺满的输入框；
「上移 / 下移 / 复制一份 / 删除这个助手」四个按钮（只有一个助手时上移下移正确置灰）；
「基础模式」四个胶囊 + 说明行；「插件开关」两张卡片，**开关旁边有可见行标题**
（「身份（系统提示词）」「custom_prompt 工具」）。零裸键。

### 14.3 这一轮验证脚本自己踩的两个坑（已修）

- 设置面板本身是 `[role=dialog]`，所以 `querySelector('[role=dialog]')` 拿到的是**面板**而不是
  确认弹窗 → 断言失败、勾选框被勾上、确认按钮没点到（截图正好记录了这个中间态）。
  改成**在所有 dialog 里按内容找**。
- `RiskConfirmation` 的确认按钮读 React 状态，勾选与点击必须在**两个 tick** 里做，
  否则删除不会发生。

## 15. 在 dsh `0.1.6-alpha.2` 上重新验证（从 npm 安装的版本）

以下全部在一个一次性 `DSH_HOME` 上、对着**已发布的包**做的，不是对着工作区：先把它下载下来与仓库的
`npm pack` 做过逐字节比对，一致（16 个文件，清单哈希相同）。

### 安装路径，以及它中间绕的那一下

```
$ dsh plugin --profile web add dsh-custom-mode
+ dsh-custom-mode 0.1.6-alpha.1            ← 而 registry 上 `latest` 是 0.1.6-alpha.2

$ node -p "require('$DSH_HOME/profiles/web/package.json').dependencies"
{ 'dsh-custom-mode': '0.1.6-alpha.1' }
```

这是 pnpm 的一天供应链延迟，不是 registry 的问题：pnpm ≥ 11 里 `minimumReleaseAge` 默认 `1440` 分钟，
alpha.2 发布了 13 小时，alpha.1 是 24.3 小时。装精确版本可以，并把例外记进 `pnpm-workspace.yaml`：

```
$ dsh plugin --profile web add dsh-custom-mode@0.1.6-alpha.2
$ node -p "…dependencies"                 → { 'dsh-custom-mode': '0.1.6-alpha.2' }
```

装到旧版本的现象是看得见的，而且正是播种那件工作要消除的东西：没有 `custom-mode: 已播种` 那行、没有
`$DSH_HOME/.agent-presets/`，设置页路由回 `{"ok":false,"error":"找不到组成文件：…"}`。

### 已发布的 alpha.2 上

```
custom-mode: 已播种 preset 到 …/.agent-presets/custom（新建 5 个文件: agent.cordis.yml, preset.yml,
             prompt.md, prompt-reader.mjs, prompt-tool.mjs）
GET /custom-mode          → 200 {"ok":true,"assistants":[{"id":"custom","name":"自定义模式",…}],"root":…}
GET /custom-mode（无 cookie） → 401
```

`tools/browser-verify.mjs` 对它跑：**21 通过, 0 失败** —— 页面能开、没有裸翻译键、助手区块与它的按钮都
渲染出来、三个区块都在、每个开关都有可见行标题、新增后出现在列表、删除会弹风险确认、确认后消失，页面
没有 `dsh-custom-mode` 的报错。

### 多助手（新能力）的磁盘级核对

| 步骤 | 结果 |
| --- | --- |
| `POST /custom-mode/create {"name":"writer"}` | id 为 `writer` —— 英文名直接作为目录名 |
| `POST /custom-mode/create {"name":"写作助手"}` | id 为 `custom-2` —— 不是合法 id 的名字按规则回退 |
| 每个助手的目录 | `agent.cordis.yml`、`preset.yml`、`prompt.md`、`prompt-reader.mjs`、`prompt-tool.mjs` |
| 先给 `writer` 写提示词，再给 `custom-2` 写 | `writer/prompt.md` = `WRITER-PROMPT-V2`，`custom-2/prompt.md` = `CUSTOM2-PROMPT`，`custom/prompt.md` 未被触碰 |
| 各助手的底子模式 | `writer` → `# 基础模式: standard`，`custom-2` → `# 基础模式: minimal` |
| 手写 preset（`handmade/`：无 `prompt.md`，组成也不走 `prompt-reader.mjs`） | 不在列表里；对它保存会被拒且错误可读；事后它的文件逐字节未变 |
| `POST /custom-mode/delete {"id":"writer"}` | 目录被删，列表回到两个 |
| 重启 dsh | 被删的助手**不会回来**；另外两个各自的提示词保住；`handmade/` 仍然未被触碰 |

### 这一轮暴露的两个工具 bug

- `tools/screenshots/screenshots.mjs` 还在找旧控件：开关现在是壳自己的原子组件（`[role=switch]` +
  `aria-checked`；实测 32 行、32 个开关、**0** 个 `input[type=checkbox]`），保存控件是普通 `button`
  而不是 `.cpfe-btn`。两处都改掉了，这才让四张 README 图重新可生成。
- `tools/screenshots/run-shots.sh` 在 `cd` 到 `tools/screenshots/` **之后**才解析输出目录，于是相对的
  `docs/images` 被创建在工具目录里而不是仓库里。现在先解析成绝对路径再 `cd`；用相对参数重跑验证过，
  图确实落在 `docs/images/`。

---

## 16. HTTP 路由迁移到平台的带围栏频道（0.1.6-alpha.2，一次性实例）

一次外部的批判性审阅指出：本插件把路由注册在裸 `ctx.webServer` 表上，再自己调
`ctx.connection.requestRejection`，而平台早已提供带围栏的替代。核实后成立，1.0.3 完成迁移。

### 16.1 先写探针，实测 `/api` 的真实行为（不靠读代码推断）

20 行探针插件（3 条 `/api` 路由，`methods`/`requestBody` 按官方包用法）装进一次性 `DSH_HOME`
（端口 3094）后：

```text
GET  /api/rev-probe                   未授权                → 401 unauthorized
GET  /api/rev-probe                   带会话 cookie          → 200 {"probe":"get-ok",...}
GET  /api/rev-probe?x=1&y=2           带会话（query 可见）    → {"probe":"get-ok","query":"?x=1&y=2",...}
POST /api/rev-probe-post              未授权                → 401
POST /api/rev-probe-post              带会话 + JSON body     → 200 {"probe":"post-ok","got":{"a":1}}
POST /api/rev-probe-post              带会话 + 坏 JSON       → 400（我们自己的 handler 给的消息）
GET  /api/rev-probe   Origin: https://evil.example + Sec-Fetch-Site: cross-site → 403
GET  /api/rev-probe   Host: evil.example                     → 403
POST /api/rev-probe   （该路由只声明 GET）                    → 404（根本没进 handler）
GET  /api/rev-probe/nope   未注册的子路径                     → 404
GET  /rev-probe       （旧的裸路由风格）                      → 404
```

**两条容易踩错的事实**：注册的 `path` 必须**含 `/api` 前缀**（官方包传 `/api/present.host`、
`/api/changes.summary`；类型注释那句 "below /api" 说的是 URL 空间 —— 我第一次写成 `/rev-probe`，
拿到 404）；方法未声明时平台**不分发**，返回 404 而不是 405。

### 16.2 迁移后（`/api/custom-mode*`，端口 3095）

```text
GET  /api/custom-mode                   未授权                → 401 unauthorized
POST /api/custom-mode/state             未授权（JSON body）    → 401，prompt.md md5 未变
GET  /api/custom-mode                   带会话                → 200 {"ok":true,"assistants":[…]}
GET  /api/custom-mode                   带会话 + 跨站 Origin   → 403
GET  /api/custom-mode                   Host: evil.example    → 403
GET  /custom-mode                       （旧的裸路由）          → 404
POST /api/custom-mode/state             带会话                → 200 已保存；prompt.md 与组成文件都写了
```

浏览器半（真浏览器 + CDP）：`tools/browser-verify.mjs` **21 通过 / 0 失败** —— 增删往返、风险确认弹窗、
语言与主题切换在新路径下照常。

代码侧的结构断言（`test/editor-route.test.mjs`）：5 条精确路径都注册在 `connection.fetch` 上、
`requestBody: 'buffered'`、`create`/`delete`/`reorder` 只声明 POST；源码里**不再有**
`requestRejection(` 调用与 `webServer.register(`；等不到 `connection` 时**一条也不注册**。

---

## 17. 会话内改写提示词走平台审批缝（0.1.6-alpha.2，真实会话实测）

用户提出的需求：会话内的 `custom_prompt` 工具能覆盖整个系统提示词，而调用它的可能是被注入的模型 ——
这条路径此前没有任何门。做法是注册 `tools/pre-execute`（waterfall）并在 `action === "write"` 时返回
`{kind:'ask'}`，由平台的审批策略决定后续。

### 17.1 先探针，别照类型注释猜

用一个 20 行探针插件（只注册监听、返回 `ask`）在一次性实例上跑真实会话：

```text
[ask-probe] 已注册 tools/pre-execute 监听
$ 会话里：请用 custom_prompt 工具把系统提示词改成：审批测试第一版。只用一次工具调用。
# 权限预设 = danger-full-access（approval: never）时：
工具调用Error: the user rejected tool "custom_prompt"          ← 不弹窗，直接判为拒绝
思考The user rejected the tool call. I should stop and explain.
（prompt.md 未被修改）

# 权限预设 = workspace-write（approval: ask）时：
工具调用 custom_prompt · write
等待审批
ask-probe：改系统提示词前需要你确认          ← 我们给的理由被原样呈现
[拒绝] [允许一次]
# 点「允许一次」之后：
已生效：系统提示词已改为 审批实测通过。
（磁盘：/…/.agent-presets/custom/prompt.md 内容变成 审批实测通过）
```

**两条结论**：`ask` 会不会弹窗由**审批策略**决定（`never` → 不弹、直接拒绝；`ask` → 弹面板）；
因此这条闸门的最坏情况是"改不成"，而不是"悄悄改成了"。

### 17.2 换上我们自己的闸门后复验

```text
面板文案：等待审批
          把「自定义模式」的系统提示词整体替换为 7 字符：审批实测通过。（写入 /tmp/…/prompt.md）
          [拒绝] [允许一次]
点「允许一次」 → 工具执行，磁盘变成 审批实测通过。（agent 也如实汇报了写入位置与影响范围）
点「拒绝」     → prompt.md md5 前后一致（fb6bdc8c…），文件未被修改
```

浏览器验收（`tools/browser-verify.mjs`）另有 38 项覆盖设置页侧；审批这条链路必须真会话才能验，故记录在此。

---

## 18. 模型在环深测（0.1.6-alpha.2，测试账号 token，一次性实例）

用真实模型会话（`DeepSeek-V4.1-Flash`）验证那些**只有真会话才能验**的契约。本节的结论与"未结论"分开写。

### 18.1 已验证

1. **审批闸门的三条路径**（原始输出见 §17）：策略 `ask` + 允许 → 真的写入；`ask` + 拒绝 → 文件 md5 不变；
   策略 `never` → 不弹窗、直接拒绝。闸门最坏是"改不成"，从不是"悄悄改成了"。
2. **`{{model}}` 在注入时被替换成宿主真实模型 id**：会话自述"我现在的身份要求是：作为由
   `deepseek-flash` 模型驱动的编码 agent……" —— 模板里写的是 `{{model}}`，宿主渲染成了真实 id。
   （历史上这一条最容易被写错：界面显示名 ≠ 真实 id。）
3. **未注册变量不会炸会话**：手工把 `prompt.md` 写成含 `{{nope}}` 的文本后提问，会话照常回答
   （1+1 → 2）。设置页会拒绝保存这种文本，但文件被别的途径写坏时不应该连会话一起带走。
4. **会话的 preset 归属**：新建会话取 `settings.yaml` 的 `agent-presets.default`（实测把默认改成
   `custom` 后，新会话的模式就是「自定义模式」）；而**已经出过内容的会话不能换预设**（与上游文档一致，
   也是自动化里最容易踩的坑：往旧会话里发消息，验的是别的模式）。

### 18.2 热更新契约：**成立**（而且我第一次测错了，这里记录错在哪）

**结论**：在一条**已经出过内容**的会话里改写 `prompt.md`，**下一步就生效** —— 这一条上面 §0 的承诺得到独立复现。

干净的实验（一次性实例，`0.1.6-alpha.2`，`deepseek-flash`，会话模式确认是「自定义模式」）：

```text
[轮 1] 先问一次，此时 prompt.md 里没有标记规则
  提问：5+5 等于几？
  回答：5 + 5 = 10                      ← 回答里没有标记（干净基线）

[写入规则] 把带标记的格式规则写进 prompt.md（同一个会话，不改任何别的东西）

[轮 2] 同一会话再问
  提问：6+6 等于几？
  回答：[[MARKER-7F3A]]                 ← 首行就是规则要求的标记
        6 + 6 = 12
  页面里还出现了平台自己打的标注：**「系统提示词更新」**
```

**我第一次测出来的"不生效"是测试设计的错，值得记下来**：那次的顺序是"先写入规则问一轮（回答里就有标记）→ 撤掉规则再问"，
后两轮的回答里仍有标记。我当时判断为"会话冻结在挂载时那份提示词"，但真正的原因是**模型在模仿自己上文里的
标记**（few-shot 自我模仿），与系统提示词是否更新无关。教训：验证"提示词是否变化"时，**基线那一轮里绝不能出现
要观察的特征**，否则后面看到的都可能是模仿。

另外这也解释了 `/custom_prompt` 工具的 write 为什么必须**只改草稿/落盘而不动会话**：热生效由平台在下一步重读
系统提示词来完成，插件不需要（也不应该）去插手会话状态。
