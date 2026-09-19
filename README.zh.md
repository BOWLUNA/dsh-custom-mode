# dsh-custom-mode

[English](README.md) | 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）用的自定义模式。它的系统提示词是一个普通文件，可以在 Web 设置页里编辑，**改完下一步模型调用即生效** —— 不用重启，也不用新建会话。

一句话：**给 dsh 的 agent 模式用的设置页** —— 选这个模式的基础组成、逐行开关它挂载的插件、并编辑它的系统提示词；提示词每个模型调用前重新读取。可以并存多个模式（「助手」），各自的提示词互不影响。

常见的叫法：自定义模式 · 自定义提示词 · 系统提示词编辑 · 多助手／多模式 · 多个 Agent 模式。

官方四个模式（`standard` / `ptc` / `minimal` / `cordis`）不受影响。

|  |  |
| --- | --- |
| ![模式名称与基础模式](docs/images/01-mode-switch.png) | ![插件开关](docs/images/02-plugin-switches.png) |
| ![系统提示词](docs/images/03-system-prompt.png) | ![模式选择器](docs/images/04-preset-picker.png) |

多助手管理器（裁到它自己那一段；真机截图由 `tools/screenshots/run-shots.sh` 产出，`tools/browser-verify.mjs` 负责校验界面）：

![助手管理器](docs/images/05-assistant-manager.png)

## 安装

一条命令装完——设置页插件，以及它在首次激活时自动播种的 preset：

```sh
dsh plugin --profile web add dsh-custom-mode@1.7.0   # 钉版本才能确定拿到这一版
# 不带版本号会受 pnpm 的发布冷却期影响（`minimumReleaseAge`，默认一天）：发布后数小时内按名安装
# 可能**静默装到旧版** —— 实测 1.3.0 发布 38 分钟后按名安装装到了 1.0.3。用 profile 里的
# `npm ls dsh-custom-mode` 核对实际装到的版本，或像上面那样钉版本。
```

装完重启 dsh，新建会话时选「自定义模式」。preset 会被写到 `$DSH_HOME/.agent-presets/custom/`；
**那里已有的文件一律不动**，所以你自己写过的 `prompt.md` 不会被覆盖。

**平台**：测试套件每次 push 都在 Ubuntu（Node 20 与 24）**和 Windows（Node 24）**上跑 —— 加 Windows
任务是因为那个平台有自己的失败模式（`install.sh` 里的 MSYS 路径、并发保存时 `rename` 的目标锁、平台表达式
求值方向相反）。两个 shell 脚本在任何 POSIX shell 下都能用，含 Git Bash。

### 图形界面安装（不用终端）

dsh `0.1.6-alpha.2` 起有插件管理页：**侧边栏 → 插件 → 添加插件**。它接受三种输入，本插件对应如下：

| 输入 | 填什么 | 说明 |
| --- | --- | --- |
| **包名** | `dsh-custom-mode` | 最省事 |
| **GitHub 仓库地址** | `https://github.com/BOWLUNA/dsh-custom-mode` | 指向**仓库根**即可 |
| **本地插件目录** | `<你 clone 的路径>/editor` | 注意要指向 `editor/`，不是仓库根 |

三条都可用，因为**仓库根的 `package.json` 声明了指向 `editor/` 的 `dsh.bundle` / `main` / `exports["./client"]`**。
根清单与 `editor/package.json` 必须描述同一个插件，`test/manifests.test.mjs` 会断言它们的名字、版本与
声明的路径全部一致——两个清单写同一件事是漂移风险，所以用测试盯住，而不是靠记性。

想同时留下源码（或者不用 npm 安装），就 clone 下来跑脚本，它把同样两件事显式做一遍：

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
./install.sh            # 复制 preset/ 到 $DSH_HOME/.agent-presets/custom/，并安装插件
./uninstall.sh          # 卸载插件；默认保留你的提示词，加 --purge 一并删除
```

模式需要带 `agent-presets` 的 profile：`web` 有，`tui` 与 `headless` 没有。

## 使用

设置页（设置 → 「自定义模式」）是一个**助手管理器**：上面列出你所有的自定义模式，可以新增、切换、删除，下面四个区块（模式名称 / 基础模式 / 插件开关 / 系统提示词）编辑的是**当前选中的那一个**。

- **排序** —— 选中助手后「上移 / 下移」，顺序写在每个助手的 `preset.yml` 里（`order`，也就是 roster 自己的排序键），所以重启后仍然生效，新建会话的选择器按这个顺序排列。
- **导入 / 导出提示词** —— 「导出提示词」把当前文本存成 `.md`；「导入提示词」把文件读进**编辑器**（不会直接落盘，仍需点保存），因此导入同样要过 `{{…}}` 校验。
- **让 agent 改自己的提示词要经过你批准** —— 会话内的 `custom_prompt` 工具走平台的审批缝
  （`tools/pre-execute` 返回 `ask`）：请求会停在「等待审批」，面板里写明**要写什么、写到哪**，你点「允许一次」
  才会执行。实测：审批策略为 `ask` 时弹面板且批准后真的写入；为 `never`（完全权限）时不弹窗、**直接拒绝**。
  所以最坏情况是"改不成"，从不是"悄悄改成了"。
- **「配置了却不生效」会被点名** —— 设置页会指出那些不生效的配置：「身份（系统提示词）」这一行关着而
  `prompt.md` 还有内容（你写的提示词被静默忽略）、`custom_prompt` 工具行关着、助手没有名字或描述
  （选择器里会显示成裸 id 或「暂无描述」）。
- **agent 能改自己的提示词，但要你批准** —— 会话内的 `custom_prompt` 工具可以读、整体替换，或者**追加**。
  追加的意义在于**不必把整段提示词重新写一遍**：想记住一条规则时，不可能因为重写而丢掉已有内容
  （实测：模型可能仍会先读一次，看看自己要加到什么内容后面）。两种写入动作都会先过平台的审批面板。
- **改动历史** —— 每次保存，以及**在设置页之外**发生的任何改动（会话内的 `custom_prompt` 工具、手工编辑 `prompt.md`），都会在提示词框下面留下一版，并标明时间与来源。载入某一版**只改草稿**：不点保存不会落盘，所以翻旧版本不会毁掉当前这版。在此之前，提示词被会话内改掉是**看不见的** —— 页面永远只显示"当前文本"。
- **恢复出厂提示词** —— 一键把**出厂模板**（新建助手时得到的那份文本）填回编辑器。它和页面上其它改动一样只改**草稿**：不点保存不会落盘，「重新读取」即可撤销。在此之前，把提示词改坏了只能删掉助手重建。
- **新增助手** —— 填个名字点「新增助手」。新助手从模板生成：标准模式的全部行 + 一份默认提示词，写好后在新建会话的选择器里就能选到它 —— **已经打开的页面里，选择器的列表是加载时的快照，要看到新助手需刷新一次（F5）**（实测；roster 本身已是最新）。
- **复制一份** —— 把当前助手的提示词、基础模式、逐行开关整个复制到新助手，之后各改各的。
- **每个助手各自独立** —— 提示词、基础模式、逐行开关都属于它自己，改一个不影响别的。
- **基础模式是"行集合"，不是提示词** —— 底子决定有哪些行、这个模式有哪些工具；本插件始终把底子的
  `persona` 行替换成自己的读取器（`complete: false`），所以底子的**提示词语义不会被继承**。最明显的是
  「极简模式」：你拿到的是极简的工具集，不是极简的提示词。
- **切换助手不会丢草稿** —— 每个助手各自留着未保存的修改，列表上用「未保存」标出来；唯一会放弃修改的是「放弃修改并重新读取」（有草稿时按钮会改名说明）。
- **删除** —— 用壳自己的风险确认弹窗，需要勾选「我明白……会被永久删除」。删除只移除磁盘上的模式目录：**正在使用它的会话不受影响**（组成在会话创建时就已读取），新建会话时不再出现。
- **直接对 agent 说** —— 每个助手都自带 `custom_prompt` 工具，会话里可以读取或改写**它自己**的提示词。
- **直接改文件** —— `$DSH_HOME/.agent-presets/<助手 id>/prompt.md` 是那个助手的唯一事实来源。

插值变量只有 `{{model}}`、`{{cwd}}`、`{{provider}}`。出现未知的 `{{…}}` 会在保存时被拒绝：渲染器对它抛错，那会让该模式每个请求都失败。

界面控件（按钮、输入框、开关、标签、确认弹窗、图标）全部来自壳自己的
`@deepseek-ai/dsh-client-ui-primitives`，因此主题、深浅色与后续改版都会自动作用到本页；老壳没有提供这组
原子组件时会退回内置的朴素控件，功能不变。

「助手」= 用户预设根目录（默认 `$DSH_HOME/.agent-presets/`）下的**一个目录**，目录名就是它的内部 id。设置页只管理**本工具创建的模式**（判据：目录里有 `prompt.md`，且组成文件用 `prompt-reader.mjs` 注入身份）。手工编写的其它 preset 不会被列进来，更不会被改写 —— 页面会按基础模式重新生成组成文件，对一份手写的组成文件做这件事等于毁掉它。

### 与官方「插件管理」页的分工

dsh `0.1.6-alpha.2` 起自带了插件管理页，可以实时启用/停用插件。它和本模式的逐行开关**管的是不同层级**：

| | 官方插件管理页 | 本模式的逐行开关 |
| --- | --- | --- |
| 作用范围 | **这套 profile**：这台机器装了哪些插件 | **这一个 agent 模式**：它的组成文件里挂哪些行 |
| 典型用法 | 全局关掉某个插件 | 让标准模式全开，而这个模式只留必要行 |

两者并存，不冲突：官方决定「这台机器有什么」，本模式决定「这个模式用其中的哪些」。

而且界限是**官方划的**：插件管理页的说明写着它管理「本 profile 的 bundle 与其中可寻址的行」，并明确
**agent-preset 行保持只读**。也就是说**官方管不到 preset 这一层**——本模式补的正是这一块。

一个可以当场演示的例子：`tool-plugin-manager`（模型侧的插件安装/启停工具）在**标准模式与 PTC 模式里
出厂就是关闭的**（只有创造模式默认打开）。官方模式不给你改它的入口，而在这里**拨一下就能打开**。

## 工作原理

dsh 的系统提示词通常来自 preset 的 YAML，而官方 `@deepseek-ai/dsh-persona` 的 `prefix` 只在挂载时解析一次。本 preset 注册同名的 `deployment:persona-prefix` section，但把 `text` 写成**函数**，agent loop 在每次模型调用前都会调它。

因此两件事的生效时机不同：

- **提示词文本**每步重新读取，所以改动对**正在运行**的会话立即生效。
- **开关与基础模式**会重写组成文件。`agent-presets` 在该文件的 `mtimeMs` 与 `size` 变化时重新挂载，所以由**新会话**生效；已开着的会话保持它启动时的配置 —— 这是刻意的，中途换工具集会出问题。

行开关是三态。没碰过的行与出厂行逐字节相同，包括 `!!js` 平台条件与出厂 `disabled`；显式开或关才会把那个条件替换成布尔值。平台表达式在宿主端求值，所以页面显示的是这台机器上实际生效的状态，而不是"有没有这个键"。

多助手不需要机制上的新能力：`dsh-agent-presets` 本来就会扫描用户预设根目录下的**每一个**目录，而且每次读 roster 都重新扫盘，所以一个刚建的目录在下一次选会话时就可见。每个助手的 `prompt-reader.mjs` / `prompt-tool.mjs` 都是按**自己模块位置**解析 `prompt.md` 的，N 份拷贝等于 N 套互不干扰的提示词。新增用包内模板播种，删除交给平台的 `agentPresets.remove()`（它会拒绝删出厂 preset，并再确认目录确实在可写根目录下）。

## 版本

**同时支持两条 dsh 线：最新稳定版（`0.1.5-rc.2`）与最新预览版（`0.1.6-alpha.2`）** —— 声明为
`>=0.1.5-rc.2 <0.2.0-0`，CI 会**两条线各装一次**并各跑一遍完整测试。`0.1.5-rc.2` 实测：安装、组合树、
`/api` 围栏、`state`/`history`/`warnings` 与浏览器 38 项全过；审批缝依赖的 `tools/pre-execute` 与路由
依赖的 `connection.fetch.register` 在稳定版里同样存在。

包版本走**自己的线** —— `1.0.0`、`1.0.1` …… 它不镜像 DSH 的版本号。本插件支持哪些 dsh，由
`editor/package.json` 的 `engines.dsh` 与 `@deepseek-ai/dsh` peer 范围声明，并由
`tools/verify-version-consistency.mjs`（CI 里执行）断言"CI 实际安装并测试的 dsh 版本落在这些范围内"。

拆开有两个原因。一是目录与市场要求裸 `x.y.z` 才自动安装 —— 有的会解析 npm `latest` 并拒绝任何带
预发布标签的版本；二是版本号字符串本来就不是一个可校验的声明，声明式的范围才是，而且它才是官方改动时
会过期的那一个。实际决定兼容性的仍然是下面这些 API 是否还在 —— 那些范围就是为它们写的。

<details>
<summary>耦合点清单（升级 dsh 时逐个核对）</summary>

| 依赖 | 变化后的后果 |
| --- | --- |
| `ctx.systemPrompt.section()` 且 `text` 支持**函数** | 提示词不再热更新 —— 整个项目的立足点 |
| `agentPresets` 依据组成文件的 `mtimeMs`+`size` 重挂载 | 开关要重启进程才生效 |
| `ctx.tools.register()` | 失去 `custom_prompt` 工具 |
| `ctx.connection.fetch.register({ path, methods, requestBody, fetch })` | 设置页 404 —— 什么都没注册 |
| `kind: 'prefix'` 同时匹配 `path` 与 `path/…` | 只有列表能打开，`/state`、`/create`、`/delete` 全部 404 |
| `agentPresets.list()` 行里有 `id` / `trust` / `path`，`preset.yml` 提供 `name` / `description` | 助手列表为空或认不出助手 |
| `agentPresets.remove(id)`，且拒绝 `trust: 'system'` | 删除失败（页面会显示平台给的原因） |
| `ctx.connection.requestRejection(req)` | 设置页失败关闭（503），不再提供服务 |
| `ctx.inject(deps, cb)`（作用域化等待） | 在没有 web 服务器的 profile 里，整行会停在 `pending` |
| `dsh.client` + `exports["./client"]`，且客户端 bundle id 等于包名 | 浏览器半不会被发现 |
| `settings.section` 插槽（`id` / `order` / `label`） | 设置项位置与标签 |
| **`settings.section` 不再提供 `locale:`**（0.1.6-alpha.2 起） | 壳不会递进绑定到本命名空间的 `t`；页面自带词典兜底，见 ARCHITECTURE §15 |
| `preset.yml` 的 `order` 参与 roster 排序 | 「上移 / 下移」不生效 |
| `ctx.locale.register/bind` | 回退中文 |
| 出厂布局 `<presets>/<id>/agent.cordis.yml` 与行的文本形状 | 基础模式切换失效 |
| `!!js` 平台表达式 | 平台行显示错误状态 |

</details>

## 文档

- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.zh.md) —— 在真机上复现过的失败，含症状、原因与自救方法。
- [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.zh.md) —— 每条结论背后的命令与原始输出。
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.zh.md) —— 为什么必须是两个产物，以及依赖了哪些宿主 API。
- [`docs/PUBLISHING.md`](docs/PUBLISHING.zh.md) —— npm 包的发布方式。
- [`AGENTS.md`](AGENTS.md) —— 给 agent 的工作说明，含「实验机上做真浏览器验证」的完整配方（`tools/browser-verify.mjs`）。
- [`CHANGELOG.md`](CHANGELOG.zh.md) · [`SECURITY.md`](SECURITY.zh.md) · [`CONTRIBUTING.zh.md`](CONTRIBUTING.zh.md)

## 开发

```sh
node test/run.mjs        # 13 个套件；自己解析出厂 preset 目录
```

改 `editor/client.js` 会被 `@deepseek-ai/dsh-client-hmr` 在约 1 秒后热替换；改宿主半（`index.mjs`、`composition.mjs`、`meta.mjs`、`paths.mjs`）需要重启。每个套件在防什么见 [`test/README.md`](test/README.zh.md)，改行为之前先读 [`CONTRIBUTING.zh.md`](CONTRIBUTING.zh.md)。

## License

MIT

---

## 构建环境

| | |
| --- | --- |
| 模型 | DeepSeek V4.1 Flash（`deepseek-v4-flash`，provider `deepseek-official`） |
| 运行时 | DeepSeek Harness **0.1.6-alpha.2**（`@deepseek-ai/dsh`，预览版） |
| 未缓存输入 | 224,058 tok |
| 缓存读取 | 125,638,016 tok |
| 输出 | 425,539 tok |

整个项目（含调研与返工）由 DSH 客户端统计：**126,287,613 tok**，缓存命中率 **99.8%**

### 评审驱动的迭代轮次花了多少

四份外部审阅变成了 `1.4.0` … `1.9.0` 这些版本（稳定线选择器修复、Windows 写入竞争、i18n 泄漏、可移植性修复、
两轮 UI 改动）。同一个客户端里的实测：

| | |
| --- | --- |
| 未缓存输入 | 3,973,904 tok |
| 缓存读取 | 711,962,624 tok |
| 输出 | 1,559,791 tok |

合计 **717,496,319 tokens**（3,973,904 + 711,962,624 + 1,559,791），缓存命中率 **99.4%**
（711,962,624 ÷ 715,936,528）。连同第一遍一起，项目累计 **843,783,932 tokens**，缓存命中 **99.5%**
（837,600,640 ÷ 841,798,602）。
（缓存读取 ÷ 全部输入 125,862,074）。
