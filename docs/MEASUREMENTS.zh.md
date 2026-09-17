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
