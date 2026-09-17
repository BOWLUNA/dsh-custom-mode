# dsh-custom-mode

[![test](https://github.com/BOWLUNA/dsh-custom-mode/actions/workflows/test.yml/badge.svg)](https://github.com/BOWLUNA/dsh-custom-mode/actions/workflows/test.yml)
![DSH](https://img.shields.io/badge/dsh-0.1.6--alpha.1-blue)
![license](https://img.shields.io/badge/license-MIT-green)

中文说明 · [English](README.en.md)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）用的「**自定义模式**」：一个能力等同标准模式的 agent 模式，**系统提示词是一个普通文件，可以在 Web 设置页里随时改、保存后下一步就生效**。

> 官方四个模式（标准 / ptc / minimal / cordis）完全不受影响——本模式是一个独立的 agent preset。

![设置 → 自定义模式：模式名称与基础模式](docs/images/01-mode-switch.png)

<sub>上面的界面截图由 `tools/screenshots/` 里的脚本驱动真实运行的实例自动拍摄并核对，不是手绘或拼的图。</sub>

## 界面

设置面板里多出一节「自定义模式」，四块内容：

|  |  |
| --- | --- |
| ![基础模式](docs/images/01-mode-switch.png) | ![插件开关](docs/images/02-plugin-switches.png) |
| **模式名称 + 基础模式**：改显示名，选标准 / PTC / 极简 / Cordis 作底子 | **插件开关**：一行一个三态开关；分组（含 `isolate realm`）带子行缩进，未触碰的行标「跟随平台」 |
| ![系统提示词](docs/images/03-system-prompt.png) | ![模式选择器](docs/images/04-preset-picker.png) |
| **系统提示词**：底部状态栏说明何时生效、写进了哪个文件 | **新建会话**：它在模式选择器里是一个真实存在的模式 |

深浅色与中英双语都是实测过的（全部走官方主题 token 与 `locale` 服务）：

|  |  |
| --- | --- |
| ![深色模式](docs/images/05-dark.png) | ![English](docs/images/06-english.png) |
| 深色模式 | English 界面（导航项会跟随语言） |

## 它解决什么问题

dsh 的系统提示词在 preset 的 `cordis.yml` 里写死，改它要编辑 YAML 并重启。而官方 `@deepseek-ai/dsh-persona` 的 `prefix` 是**挂载时解析的静态字符串**，所以哪怕你改了文件也不会重新读取。

本项目的做法是：注册同名的 `deployment:persona-prefix` section，但把 `text` 写成**函数**。dsh 的 agent loop 在**每一步模型调用前**都会重新拼装系统提示词，于是——**编辑文件 → 下一步生效**，不需要重启、不需要新建会话。

## 结构

```
dsh-custom-mode/
├── preset/                      # agent preset（文件产物，复制到 dsh home 即可）
│   ├── agent.cordis.yml         # 标准模式全部行 + 替换后的 persona 行
│   ├── preset.yml               # 显示名「自定义模式」
│   ├── prompt.md                # ★ 提示词本体（唯一事实来源）
│   ├── prompt-reader.mjs        # 读文件 → 注册为身份段
│   └── prompt-tool.mjs          # custom_prompt 工具（无浏览器时的编辑通道）
├── editor/                      # 设置页插件（npm 包 + profile bundle）
│   ├── index.mjs                # 宿主半：私有路由 /custom-prompt-editor（带平台鉴权栅栏）
│   ├── client.js                # 浏览器半：设置页（手写 bundle，无打包器）
│   ├── composition.mjs          # 组成文件编译器（文本手术，保留 !!js 与出厂注释）
│   ├── locales.mjs              # 中英词典（单一事实来源；client.js 里是它的副本）
│   ├── meta.mjs / paths.mjs     # preset.yml 读写 / 路径解析
│   ├── cordis.patch.yml         # bundle 补丁：insert 插件行
│   └── package.json             # 含 files 白名单（CI 会断言打包内容）
├── test/                        # 三个套件共 143 项，用 node test/run.mjs 跑
│   ├── composition.test.mjs     # 63 项：文本手术是否无损、开关语义、平台条件
│   ├── prompt-reader.test.mjs   # 15 项：热更新契约
│   └── locales.test.mjs         # 65 项：双语键集 + client.js 副本不漂移
├── tools/screenshots/           # 截图的拍摄脚本（手写 CDP 客户端，零依赖）
├── install.sh                   # 安装 preset + 插件（含前置自检与安装后自检）
├── uninstall.sh
├── .github/                     # CI + issue 表单 + PR 模板
└── docs/
    ├── ARCHITECTURE.md          # 为什么必须拆成两个产物（踩坑记录）
    ├── TROUBLESHOOTING.md       # 10 类实测复现过的失败 + 自救命令
    ├── 实测记录.md               # 每条结论背后的命令与原始输出
    └── PUBLISHING.md            # 发布到 npm / 别人怎么装
```

## 安装

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
./install.sh
```

脚本做两件事：

1. 把 `preset/` 复制到 `$DSH_HOME/.agent-presets/custom/`（agent preset 是**文件**，不是 npm 包）；
2. 用 `dsh plugin --profile <profile> add ./editor` 把设置页插件装进你的 profile。

**然后重启 dsh web**（bundle 插件只在启动装配期生效）。刷新页面后，设置面板里会出现「系统提示词」。

## 使用

- **图形化**：设置 → 「系统提示词」→ 编辑 → 保存。当前会话下一步即生效。
- **直接说**：切到「自定义模式」后说「把系统提示词改成……」，agent 会用 `custom_prompt` 工具改写。
- **直接编辑文件**：`$DSH_HOME/.agent-presets/custom/prompt.md`（唯一事实来源）。

可用插值变量只有三个：`{{model}}`、`{{cwd}}`、`{{provider}}`。

### 保存校验

渲染器对 `{{…}}` 做**严格插值**：未知变量或畸形分组会让渲染**抛错**，也就是让该模式的**每个请求都失败**。所以两条写入路径（设置页、`custom_prompt` 工具）都会**先校验再落盘**：

| 文本 | 结果 |
|---|---|
| 纯文本 | 接受 |
| `{{model}}` / `{{cwd}}` / `{{provider}}` | 接受 |
| 不闭合的单个 `{{` | 接受（渲染器视为字面量） |
| `{{}}`、`{{ model }}`、`{{Model}}`、`{{foo}}` | **拒绝并说明原因** |

## 卸载

```sh
./uninstall.sh
```

或手动：`dsh plugin --profile <profile> remove dsh-custom-prompt-editor`，并删除 `$DSH_HOME/.agent-presets/custom/`。

## 兼容性

在 **dsh `0.1.6-alpha.1`** 上开发并验证。只使用该版本确实存在的 API：

- `ctx.systemPrompt.section()`，且 `text` 支持函数（这是热更新的根基）
- `ctx.tools.register()`（`@deepseek-ai/dsh-tools`）
- `ctx.webServer.register({ kind, path, handler })`
- `ctx.connection.requestRejection(req)`（`@deepseek-ai/dsh-client-connection`）—— 设置页路由的 Host/Origin 栅栏与浏览器鉴权
- 客户端种子模块表里的 `react`

**不依赖** `dsh-settings` 的 `installSettingsSection` / `settingsNamespace`——那两个函数在 0.1.6 里**不存在**，而社区某些插件正是因为 import 它们而在新宿主上加载失败。

## License

MIT

---

# 功能全貌（当前版本）

设置面板里的「自定义模式」页由三部分组成。

## 1. 模式名称

改显示名与描述。**只影响显示**：内部 id（`.agent-presets/custom`）不变，所以已有会话不受影响，`prompt.md` / `agent.cordis.yml` 的路径也不变。

- 生效时机：`agent-presets` 每次读 roster 都重扫磁盘 → **新建会话**即见新名字，**不用重启**。
- 导航项会**跟随语言**：名字是任一语言的默认值时，导航显示当前语言的翻译；你改成别的名字后原样显示。
- YAML 安全：值一律双引号包裹 + 反斜杠转义，换行压平。`preset.yml` 写坏会让模式**从选择器里消失**，所以这里必须转义，且有往返测试。

## 2. 基础模式

在 `standard` / `ptc` / `minimal` / `cordis` 之间切换，作为下面逐行微调的底子。

实现上不是"继承"，而是**把那套行清单原样复制过来**再改。所以：

- 出厂注释、`!!js` 平台条件**逐字节保留**（文本手术，不是 YAML 解析重写）；
- `persona` 行会被**强制替换**成本项目的 `./prompt-reader.mjs`——否则从官方模式重新生成会让静态 persona 回来，自定义提示词**静默失效**；
- `custom-prompt-tool` 永远追加在末尾，避免重新生成时丢掉。

## 3. 插件开关（一行一个）

逐行控制挂载哪些插件，与官方插件列表一样铺开；分组（带 `isolate realm`）跨列显示，子行缩进。

**开关是三态，不是布尔**——这是正确性的核心：

| 状态 | 行为 |
| --- | --- |
| 未触碰 | **完全原样**，保留 `!!js` 平台表达式与出厂默认关闭状态 |
| 显式开启 | 删掉 `disabled`，**包括平台表达式**（显式选择优先） |
| 显式关闭 | 写成 `disabled: true`，替换平台表达式 |

平台表达式会在**宿主端真实求值**（`new Function` 跑 `process.platform === 'win32'`），所以页面显示的是**这台机器上实际生效的状态**，而不是"有没有这个键"。不这么做的话，Linux 上每个平台行都会显示成"已停用"，而且你对它的改动也**不会被记录**。

## 生效机制

`agent-presets` 在**每次会话挂载时**比对组成文件的 `mtimeMs` + `size`，不一致就重新挂载 preset。所以：

- **保存 → 新建会话即生效，不需要重启进程**；
- 已开着的会话保持旧配置（正确行为——中途换工具集会乱）；
- 生成的文件永远带时间戳注释，确保 `size` 一定变化（否则内容长度恰好相同时不会触发）。

## 双语

用官方 `locale` 服务：`ctx.locale.register(ns, { zh, en })`，插槽注册带 `locale: NS`，组件从 `props.t` 取翻译函数（与官方 settings 插件同一契约）。

- 行标签用**按 id 生成的键**（`row.<id>.label`）→ `composition.mjs` 不用动，官方新增插件行也不需要改词典（缺键回退到出厂中文，最差回退到裸 id）。
- `test/locales.test.mjs` 断言中英**键集完全一致**：某个键只在一侧存在时，那个语言下会**静默显示成裸键名**，只有切语言的人才会发现——所以必须有测试。

## 测试

```sh
node test/run.mjs
```

一个入口跑三个套件，并自己解析「出厂 preset 目录」（三条回退，解析不到会打印试过哪些路）：

| 套件 | 项数 | 测什么 |
| --- | --- | --- |
| `test/composition.test.mjs` | 63 | 组成文件编译器：文本手术是否无损、开关语义、平台条件、分组缩进 |
| `test/prompt-reader.test.mjs` | 15 | 热更新契约：改文件后下一次求值必须是新文本、读失败不得把身份变成空串 |
| `test/locales.test.mjs` | 65 | 中英键集一致 + `client.js` 里那份**手抄字典**与 `locales.mjs` 不漂移 |

编译器那 63 项测的是**属性不是字节**（出厂文本会随 dsh 版本变，但"什么都不改就什么都不变"必须永远成立）。开发过程中它抓到了 6 个真 bug，其中 3 个会导致静默错误行为（平台条件丢失、关闭分组无效、开关语义反向）。

CI（`.github/workflows/test.yml`）在每次 push 时先 `npm install @deepseek-ai/dsh@0.1.6-alpha.1`，
再跑这三个套件 —— 测的是**真实的出厂文本**，不是自造的 fixture。

## 文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) —— 为什么必须拆成两个产物；`dsh.client.inject` 为什么必须声明；私有 HTTP 路由为什么**必须**过平台鉴权（含实测证据）。
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) —— 实测复现过的失败：装完 dsh 起不来、WSL 下 pnpm panic、页面不出现、模式不见了、保存被拒。
- [`docs/实测记录.md`](docs/实测记录.md) —— 每条结论背后的命令与原始输出（安装、安全、保存链路、热更新、双语、测试）。
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md) —— 发布到 npm、别人如何安装。
- [`CHANGELOG.md`](CHANGELOG.md) —— 版本变更；[`SECURITY.md`](SECURITY.md) —— 已知安全问题与报告渠道。

# 路线图

- [x] 功能：基础模式切换 + 逐行插件开关 + 提示词编辑 + 模式改名
- [x] 兼容：双语（中/英）
- [x] 兼容：深浅色（全部使用官方主题 token，无硬编码色值）
- [x] 兼容：客户端 HMR（实测可用：改界面约 1 秒后页面自更新，无需重启/刷新）
- [x] 兼容：别人改过 UI 布局/装饰时的兜底（不假定 DOM 结构，只用声明式插槽；窄面板自适应；三条回退解析）
- [x] 安全：设置页路由过平台的 Host/Origin 栅栏与浏览器鉴权（修复前的未授权读写见 `docs/TROUBLESHOOTING.md` §9）
- [x] 工程化：CI（三个套件对着真实出厂 preset 跑）+ 统一测试入口 + 安装后自检
- [x] 文档：中英文说明书 + 界面截图 + 故障排查
- [ ] 工程化：发布到 npm（`editor/` 已备好元数据，删掉 `private: true` 即可）

# 版本策略与兼容性

## 版本号跟随官方

本插件的版本号**与所适配的 DSH 版本一致**（当前 `0.1.6-alpha.1`）。官方发新版时：

1. 把 `editor/package.json` 的 `version` 改成官方版本号；
2. 跑两个测试（见下方「测试」）；
3. 按下面的**耦合点清单**逐个核对是否仍然存在；
4. 在真机上切一次模式、关几行、保存、新建会话验证。

这样做的理由：本插件深度依赖 DSH 内部 API（下面列了全部），**语义化版本在这里是假的精确**——真正决定兼容性的是那几处 API 是否还在，而不是补丁号。版本号对齐官方，至少让「我这份是给哪个 DSH 用的」一眼可见。

## 耦合点清单（升级 DSH 时逐个核对）

| 依赖 | 用途 | 断裂后果 |
| --- | --- | --- |
| `ctx.agentPresets.list()` | 定位出厂预设目录（读 `trust: 'system'` 行的 `path`） | 找不到基础模式 |
| `ctx.systemPrompt.section()` 且 `text` 支持**函数** | 每步重新读取提示词 | 提示词不再热更新（这是整个功能的根基） |
| `ctx.tools.register(definition)` | `custom_prompt` 工具 | 失去无浏览器时的编辑通道 |
| `ctx.webServer.register({kind,path,handler})` | 设置页的私有路由 | 设置页空白 |
| `dsh.client` + `exports["./client"]` | 浏览器半被发现 | 设置页不出现 |
| 客户端插槽 `settings.section`，注册项支持 `locale` | 页面位置与取翻译函数 | 页面位置丢失 / 显示裸键名 |
| `ctx.locale.register/bind` | 双语 | 回退中文（不崩） |
| 官方 preset 目录布局 `<presets>/<id>/agent.cordis.yml` | 复制行清单 | 基础模式切换失效 |
| 行格式：`- id:` / `   name:` / 分组 `group: true` + `config:` | 文本手术 | 开关改写错位 |
| `!!js` 平台条件表达式 | 求值显示真实状态 | 平台行显示错误 |
| 组合文件的 `mtimeMs`+`size` 触发重挂载 | 保存后新会话生效 | 需要重启才生效 |

## 已有的兜底

- **出厂目录解析有三条路**：`DSH_SHIPPED_PRESETS_DIR` 环境变量 → `agentPresets` 的 system 行 → Node 解析 / profile 的 `node_modules`。任一条失效都还有后备，且失败时报出**已尝试过什么**。
- **API 护栏**：`apply` 时检查 `agentPresets.list` 与 `webServer.register`，缺失时打印明确的版本不匹配诊断，而不是让每个请求返回 500。
- **客户端软回退**：`props.t` 不存在时回退到中文词典（绝不显示裸键名）；`locale` 服务缺失时页面照常工作。
- **不假设 DOM 结构**：只用声明式插槽 `slots.inject`/`slots.register`，不查询 `[data-slot]` 锚点，也不改页面其它区域。
- **主题全程用官方 token**，无硬编码颜色，深浅色跟随。
- **布局自适应**：卡片网格用 `repeat(auto-fill, minmax(...))`，面板变窄时自动降为单列。

---

# 项目信息

## 构建环境

| 项目 | 值 |
| --- | --- |
| 模型 | DeepSeek V4.1 Flash（`deepseek-v4-flash`，provider `deepseek-official`） |
| 运行时 | DeepSeek Harness **0.1.6-alpha.1**（`@deepseek-ai/dsh`，预览版） |
| 适配版本 | 与上面一致；版本号跟随官方，见「版本策略与兼容性」 |

## 开发过程统计

本项目从零到可用，由 DSH 客户端报告的实际消耗如下（含全部调研、实测、踩坑与返工）：

| 指标 | 数值 |
| --- | --- |
| Token 总量 | **111,406,700** |
| 缓存命中率 | **98%** |
| 未缓存输入 | 2,603,266 |
| 缓存读取 | 108,497,408 |
| 输出 | 306,026 |

单看输出只有 30 万 token，但为了这 30 万，读进去了一亿多——**其中 98% 命中缓存**。这个比例也说明了项目里那些"看起来多余的"实测步骤（跑测试、读运行时源码、对着文档核对 API）其实是省钱的：它们避免了把错误结论当成事实继续往下写。
