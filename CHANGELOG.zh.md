# 变更日志

[English](CHANGELOG.md) | 中文

版本号是本包**自己的稳定线**（`1.0.0`、`1.0.1` ……），每次发布都换一个。它支持哪些 dsh，由
`engines.dsh` 与 `@deepseek-ai/dsh` peer 范围声明，CI 断言它实际安装并测试的 dsh 版本落在这些范围内
—— 见 README「版本」。`0.1.6-alpha.*` 及更早的条目遵循旧约定（版本号镜像 DSH 版本），作为历史保留。

## [1.0.0]

### 版本策略：包走自己的线

- 包版本改为 **`1.0.0`**，不再镜像 DSH 版本。`0.1.6-alpha.2` 及之前是镜像线的最后一批；`1.0.0` 的代码
  就是那份代码加上这次版本策略调整。
- 原因：有目录与市场只对裸 `x.y.z` 自动安装 —— 其中一个桌面市场会解析 npm `latest` 并拒绝任何带预发布
  标签的版本，而镜像一个 alpha 期的 DSH 版本会让每一个版本都成为预发布版。兼容性改为写在**可校验的
  地方**：`engines.dsh` 与 peer 范围，两者都是 `>=0.1.6-alpha.1`。
- `tools/verify-version-consistency.mjs` 随之重写：不再断言版本号字符串等于 CI 钉的 DSH 版本，而是断言
  **CI 钉的 DSH 版本满足声明的范围**，并断言包版本是裸 `x.y.z`。这才是值得校验的声明；旧那条只证明了
  两个字符串一致。
- 旧的 `.revN` 后缀（包内容变了但不能重用版本号时的做法）随之取消：每次发布都递增版本号。

## [0.1.6-alpha.2]

### 版本号跟进 dsh `0.1.6-alpha.2`

- 版本号由 `0.1.6-alpha.1.rev2` 跟进到 **`0.1.6-alpha.2`**，同时把 CI 里钉定的
  `@deepseek-ai/dsh@<version>` 改成 `0.1.6-alpha.2`：`tools/verify-version-consistency.mjs` 断言这两处
  一致，防止「CI 在旧版本上通过、而发布的包声称适配了没测过的新版本」。
- 上一段（`0.1.6-alpha.1`）里的「待办：升级版本号需要改工作流文件」与「待随下一个版本号发布」两项，
  都随本次发布完成。
- 全部结论都在 dsh `0.1.6-alpha.2` 上重新实测：单测门禁，以及实验机上的**真浏览器验证**。

### 多助手：一个设置页管理多个自定义模式

- 设置页从「一个模式」升级为**助手管理器**：上方列出所有自定义模式，可**新增 / 切换 / 删除**，
  下方四个区块（模式名称、基础模式、插件开关、系统提示词）编辑当前选中的那一个。
- **每个助手的系统提示词互相独立**：一个助手 = 用户预设根目录下的一个目录，目录里的
  `prompt-reader.mjs` / `prompt-tool.mjs` 按**自己模块位置**解析 `prompt.md`，所以 N 份拷贝就是
  N 套互不干扰的提示词。`custom_prompt` 工具也只改自己那一份。
- **新增**用包内模板播种（`editor/assistants.mjs`）：一份全新的标准模式组成文件 + 默认提示词；
  名字若是合法 id（英文名）就直接当目录名，否则回落到 `custom`、`custom-2`……
- **删除**走平台的 `agentPresets.remove(id)`：出厂 preset 被平台拒绝，目录不在可写根目录下也被拒绝。
  删除只影响**新建会话**；正在使用它的会话照旧运行（组成在会话创建时已读取）。
- **只管理本工具创建的模式**：判据是目录里有 `prompt.md`，且组成文件用 `prompt-reader.mjs` 注入身份。
  手工编写的 preset 既不会被列出，更不会被改写 —— 保存会按基础模式重新生成组成文件，对手写文件做这件事
  等于毁掉它。
- **删除过的助手不会复活**：首次播种只在真正第一次运行时发生（根目录下写 `.custom-mode.json` 标记）。
  每次激活仍会对所有受管目录做一次「只补缺失文件」的修复，让「组成文件引用的模块被删掉 → 整个模式被判
  broken、从选择器消失」有救。
- 路由由一条 `exact` 变成一条 **`prefix`**，覆盖 `GET /custom-mode`（列表）、
  `GET /custom-mode/state?id=`、`POST /custom-mode/state|create|delete`；方法与子路径分开判定
  （`GET /custom-mode/create` 是 405，一个预取链接不能创建助手）。
- `custom_prompt` 的工具描述现在报出**本助手**的名字（组成文件行里的 `config.modeName`，退回读同目录的
  `preset.yml`）。旧助手里已有的旧模块会忽略这个键 —— 模块文件在用户目录里，激活时不覆盖用户的东西是
  刻意的；`./install.sh` 会刷新模块并保留 `prompt.md`。

### 界面与功效（第二轮）

- **控件改用壳自己的原子组件**：`Button` / `Input` / `Switch` / `Tag` / `Pill` /
  `RiskConfirmation` 与图标全部来自 `@deepseek-ai/dsh-client-ui-primitives`。它和 `react` 一样在壳的
  **种子表**里，直接 `require` 即可，不需要打包器、也不需要声明 `dsh.client.external`。收益是
  主题、深浅色、密度与未来改版都自动生效 —— 自己写一遍控件等于抄了一份必然过时的视觉规范。
- **降级而不是白屏**：取不到原子组件（老壳）时退回内置朴素控件，**prop 契约完全相同**；
  `RiskConfirmation` 缺失时删除退回原生 `confirm`，护栏不丢。
- **切换助手不再丢草稿**：每个助手各自保留未保存的修改（`entries[id]`），列表上用「未保存」
  标签标出来。唯一会放弃修改的是「放弃修改并重新读取」，且按钮在有草稿时就改成这个说法。
- **新增「复制一份」**：把源助手的提示词、基础模式与行开关复制到新助手，之后各改各的。
- **删除改用 `RiskConfirmation`**：不可逆地删掉用户自己写的提示词，值得一次显式勾选确认，
  而不是把它做成紧挨着主按钮的第二次点击。
- **基础模式改成胶囊选择器**（Pill），当前模式的说明单独一行。
- **组成文件有问题的助手**在列表里标红（roster 的 `broken`），不再只是一个打不开的模式。
- 路由常量加了防漂移断言（浏览器半与宿主半各写了一份路径），`client.js` 的原子组件探测
  按「壳有 / 壳没有」两条路径分别测试。

### 界面修正与功效（第三轮）

- **修掉「整页显示成 `assistant.heading` / `btn.create` 这类原始键」**（线上实测的故障）。
  根因是 dsh `0.1.6-alpha.2` 的 `settings.section` 契约里**已经没有 `locale:` 选项**，壳不再递进
  绑定到本命名空间的 `t`；而导航标签走的是自己的 `locale.bind()`，同样查不到。现在壳的 `t` 能用就用，
  同时 **bundle 自带的中英词典是地板** —— 键在表里就不可能显示成裸键；语言切换由
  `locale.subscribe()` 驱动重渲染。测试里专门造了一个「`t` 一律回显键名」的壳来跑这条路径，
  并验证过它在旧写法下会变红。
- **注册失败不再静默**：实测 `ctx.effect` 会吞掉回调里抛出的异常，所以「注册失败」与「一切正常」
  从外部完全一样（页面照常出现、控制台安静、文案全是键名）。现在注册自己 `try/catch` 并 warn 出原因，
  注册后还会回读一次，把「被拒」与「宿主查不到」两种情况分开说。
- **助手排序**：选中后「上移 / 下移」，顺序写入每个助手的 `preset.yml`（`order`，也就是 roster 自己的
  排序键），因此重启后仍生效、文件里看得见、没有第二份状态可以漂移；改名时会保留该值。
- **提示词导入 / 导出**：导出把当前文本存成 `.md`；导入把文件读进**编辑器**而非直接落盘，
  所以同样要过 `{{…}}` 校验；1MB 上限，空文件被拒。
- **界面补齐两处**：`Switch` 的 `label` 只进 `aria-label`（不渲染可见文字），行标题改为自行渲染
  —— 否则每个开关都没有名字；`Input` 的 wrap 是 `inline-flex`，输入框需要显式类名才能铺满宽度。

### 真浏览器验证（第四轮）

- **新增 `tools/browser-verify.mjs`**：对着 CDP 端口驱动真浏览器，断言面板里**没有裸翻译键**、
  文案确实被翻译、每个开关有可见行标题、导航项不是裸键，并在浏览器里跑一遍
  「新建助手 → 出现 → 风险确认 → 勾选 → 永久删除 → 消失」。
- **第一次真正看见自己渲染的页面**：在实验机（`dsh` 已升到 `0.1.6-alpha.2`）
  上跑出 **21/21 通过**，截图取回人工核对。这补上了长期以来「测试全绿但界面没人看过」的盲区
  ——`docs/ARCHITECTURE.zh.md` §15 那次整页裸键的故障，正是这个盲区的产物。
- 验证脚本自己踩的两个坑也记进了文档：设置面板本身就是 `[role=dialog]`（所以找确认弹窗必须按内容
  在所有 dialog 里找），以及 `RiskConfirmation` 的勾选与确认必须分两个 tick。
- 助手列表容器加了 `.cpfe-assistants` 类名：既让 DOM 自描述，也让验证脚本能把它与基础模式胶囊区分开。
- **工作指南**：`~/.dsh/AGENTS.md`（全局，所有会话生效）与工作区 `AGENTS.md` 记录了机器清单、
  实验机配方、dsh 升级的标签坑，以及「不要重启会话机上的 dsh」这条铁律。

### npm

`dsh-custom-mode@0.1.6-alpha.2` 已发布，`alpha` 与 `latest` **两个** tag 都指向它
（只发 `alpha` 不移 `latest` 的话，市场的一键安装会停在旧版——见 `docs/PUBLISHING.md`）。

发布后按文档验过，不是只看"发布成功"：

- 匿名 `npm pack` 取回 tarball：16 个文件与仓库**逐字节一致**（含本版新增的 `assistants.mjs`
  与更新后的 `prompt-tool.mjs`）；
- 在一次性 `DSH_HOME` 里从 registry 真装一次：解析到 `0.1.6-alpha.2`、装成真实目录（不是软链）、
  组合树里有 `custom-mode` 行；
- 启动那个实例：日志打印「已播种 preset …（新建 5 个文件）」，路由列出助手，
  `GET /custom-mode` 未授权仍是 401，本版新增的 `/reorder` 端点存在。

### 测试

十一个套件共 **520 项**（上一版为八个套件 333 项）。新增两个套件，并给三个既有套件扩了覆盖：

- `assistants`（68）—— 多助手核心：哪些目录算「本工具的」（判据窄是安全边界）、id 分配、从模板建目录、
  首次播种与收养、「删光之后重启不复活」，以及排序（含边界与拒绝路径）。
- `client-bundle`（32）—— 浏览器半的注册契约，此前零覆盖：按客户端模块加载器的方式装载 bundle、用桩
  `ctx` 跑 `apply`，断言 bundle id 等于包名、`exports.inject` 含 `slots`/`locale`、注册进
  `settings.section` 的每个字段与失败策略，并覆盖两条降级路径——「壳的词典查不到」与「壳没有共享原子组件」。
- `editor-route`（45 → 112）—— 从一条 `exact` 路由扩到五个端点（列表 / 读取 / 保存 / 新增 / 删除 / 排序），
  逐路径的方法表、浏览器半与宿主半的路由常量防漂移、复制助手，以及原有的栅栏与校验分支。
- `meta`（45 → 53）—— 增加 `order` 的往返，以及「改名必须保序」。
- `manifests`（13 → 16）—— 增加「npm 的 `files` 白名单必须覆盖运行时会 import 的模块」（这条守卫是实战
  教训：漏一个文件，本地无感，npm 装出来一激活就失败）。
## [0.1.6-alpha.1]

### 已验证兼容 dsh `0.1.6-alpha.2`（版本号暂未跟进，原因见下）

- **官方每个模式都多了一行**（`tool-plugin-manager`，即 `@deepseek-ai/dsh-plugin-manager/tools`）。
  为此**不需要改代码**：编译器运行时读出厂组成文件，重新生成时会自动带上新行——它只是缺一个显示
  标签，现已补齐中英两份。
- **新增漂移警报**：`composition.test.mjs` 断言出厂每一行都能查到 `ROW_META` 条目。以后官方
  新增行时，CI 会变红，而不是在界面上静默显示成裸 id。
- **设置页的 slot 契约未变**：`settings.section` 仍是 `kind: list`、`scope: root`，且
  `dsh-client-ui-slots@0.1.6-alpha.2` 仍然保留 `locale:` 注册选项（它提供绑定的 `t`），
  所以设置页的形态不变。
- 八个套件在 `0.1.6-alpha.2` 的 preset 上**全部通过**。
- **`test/seed.test.mjs` 不再用 `chmod 0o500` 伪造不可写目录**。root 会绕过权限位，导致三条断言
  在 CI 上绿、在本地以 root 跑时红——一个「结果取决于谁在跑」的测试。现在改用普通文件阻断路径，
  任何用户下都返回 `ENOTDIR`。
- **通过「GitHub 仓库地址」安装曾经是静默空转**。新的插件管理页接受包名、仓库地址或本地目录三种输入；
  粘贴仓库地址会把整个仓库装进来，而**根清单里根本没有 `dsh` 字段**——于是 pnpm 报成功、却没有任何
  bundle 行被插入、宿主半也不会运行，安装等于什么都没发生。现在根清单声明了指向 `editor/` 的
  `main`、`exports["./client"]` 与 `dsh.bundle.patch`，三种输入都可用了；
  `test/manifests.test.mjs` 断言两个清单在名字、版本与每一处声明路径上完全一致。修复前实测：两份
  清单的版本**早已漂移**（`0.1.6-alpha.1` vs `0.1.6-alpha.1.rev2`）而无人察觉。
- **新行在 `standard`/`ptc` 里出厂即关闭**（只有 `cordis` 默认开），所以既有的「出厂关闭的行未触碰时
  必须仍然关闭」这条测试现在也覆盖了它；而官方把 agent-preset 行留为只读，因此**在基于标准模式的模式里
  打开它，只有本模式的逐行开关能做到**。
- **新增 `tools/sync-client-dictionaries.mjs`**：从 `locales.mjs` 重新生成 `client.js` 里内联的
  词典（支持 `--check`）。bundle 不能 import，所以那两份是手抄的——这正是本次新增词条一开始没进
  bundle 的原因。

### 待办：升级版本号需要改工作流文件

要升到 `0.1.6-alpha.2`，必须**在同一个提交里**同时改 `editor/package.json` 与
`.github/workflows/test.yml` 里钉住的 `@deepseek-ai/dsh@…`；只改一处会被
`tools/verify-version-consistency.mjs` 拦下。该工作流文件需要 `workflow` 权限，所以这一步留给
持有该权限的人。在那之前项目停在 `0.1.6-alpha.1`。面向 `0.1.6-alpha.2` 的完整耦合点核对（本项目依赖的每一处声明，逐条与新版包比对）记录在 `docs/MEASUREMENTS.md` 第 10 节，同时附有「两个版本的出厂 preset 下测试均通过」的结果。

适配 dsh `0.1.6-alpha.1`。按主题分组，组内不保证时间顺序。

### 生态上架准备

- **npm 包现在自带 preset，宿主半在首次激活时把它播种到磁盘上。** 市场的安装是一条命令，而那条命令
  能带上的只有这个包：在此之前，`dsh plugin --profile web add dsh-custom-mode` 装出来的设置页找不到
  组成文件，页面打不开，模式也根本选不到。
- 播种**绝不覆盖**：已存在的 `prompt.md`（用户自己的文本）与 `agent.cordis.yml`（设置页生成过的）
  原样保留；重复激活不写任何东西；`DSH_HOME` 不可写时只在日志里报告，不影响 dsh 启动。
- 包内那份 preset 放在 `editor/preset/`；`test/seed.test.mjs` 断言它与 `preset/` 逐字节一致 ——
  同一份文件的两份拷贝最会分叉。
- `engines.dsh` 给市场声明适配的宿主版本；peer 范围补上了显式的预发布比较符 —— 没有它，
  node-semver 会静默排除全部 `0.1.6-*` 构建。
- 包版本为 `0.1.6-alpha.1.rev1`：适配的 DSH 版本没变，修订后缀是因为包内容变了而要重发，而 npm
  不允许同版本重发。
- `tools/verify-version-consistency.mjs` 接进了 CI（此前存在但没人调用），并接受 `<DSH 版本>.revN`
  这类后缀，同时仍然拒绝偏离已测 DSH 版本的版本号。
- `tools/screenshots` 遇到 `Page.captureScreenshot` 卡住时会重试一次，而不是让整次拍摄失败。
- **以 `0.1.6-alpha.1.rev1` 发布，并把 `latest` 一并移了过去。** 只以 `alpha` 发布的修订会让市场安装
  （按 `latest` 解析）停在上一版，也就是没有播种能力的那个。已记入 `docs/PUBLISHING.md`。

### 新增

- **系统提示词是一个文件**（`prompt.md`），每次模型调用前重新读取，所以保存后**下一步**即生效，
  不需要重启或新建会话。官方 `@deepseek-ai/dsh-persona` 的 `prefix` 在挂载时解析一次，做不到这点。
- **基础模式切换**：以 `standard` / `ptc` / `minimal` / `cordis` 之一为底子，用**文本手术**复制行
  —— 逐字节保留出厂注释与 `!!js` 平台条件。走 YAML 解析再序列化会丢掉它们，而平台条件丢失是
  **静默**的行为变化。
- **逐行插件开关**，三态：未触碰 = 原样；显式开 = 删掉 `disabled`（含平台表达式）；显式关 = 写成
  `disabled: true`。平台表达式在宿主端真实求值，页面显示这台机器上实际生效的状态。
- **模式改名**：只影响显示，内部 id 与文件路径不变。
- **`custom_prompt` 工具**：没有浏览器时的编辑通道；设置页是 bundle 提供的 Web UI，进程重启后
  未必在场，而这个工具随 preset 常驻。
- 中英双语、深浅色跟随、客户端 HMR。

### 安全

- **修复：设置页私有路由未做鉴权。** `/custom-mode` 注册在 `ctx.webServer` 的裸 HTTP 表上，而平台的
  Host/Origin 栅栏与会话鉴权只作用在 Connection 服务挂载的 channel 上。修复前实测：未授权 `GET`
  返回整份系统提示词（200），未授权 `POST`（`text/plain`）可改写 `prompt.md`（200），而同进程的
  官方路由均为 401。表单式跨站请求不触发预检，因此用户浏览器里的任意页面都能朝该端口 POST ——
  对持有 Shell 与文件工具的 agent 而言是可远程触发的提示词注入。现在路由先过
  `ctx.connection.requestRejection(req)`（与 `/api` 同一判定），服务不可用时**失败关闭**。

### 修复

- **`install.sh` 会删掉 profile 模板自带的基础 bundle。** 全新 `DSH_HOME` 里，`dsh.profile.bundles`
  从 `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]` 变成只剩本插件：那段"清理幽灵条目"
  逻辑按两个硬编码路径探测依赖，而这两个包由 dsh 自己的 install anchor 解析。后果是装完 dsh 起不来
  （组合树 158 行 → 1 行），而脚本**以 0 退出**。触发条件是"装好 dsh 后尚未启动过就装插件"。
  改为只增不删，并补三道防线：版本/pnpm 前置自检、bundle 不变量断言、安装后组合自检。
- **装进没有 web 服务器的 profile 不再打印假警报。** 行级 `inject` 是硬依赖，tui 里两个服务都不存在，
  于是每次启动都打印 `1 entry did not activate … pending` —— 与"装完变砖"的报错一字不差。
  改用作用域化的 `ctx.inject(deps, cb)`：整行正常激活，只有那条路由等服务。
- `install.sh` 现在会说明目标 profile 有没有 web 服务器。`agent-presets` 只存在于 web 组合，所以装进
  tui 时「自定义模式」根本选不到（不只是没有设置页）。
- `uninstall.sh` 清掉 pnpm 遗留在 `node_modules` 里的软链（pnpm 12.4.2 上复现）。
- `connection` 缺失时返回 503，响应体原先写 `forbidden`，改为按状态给出
  `unauthorized` / `forbidden` / `unavailable`。
- 两个脚本的 `--help` 多打了一行 `set -euo pipefail`；`npm test` 指向不存在的路径；
  `LICENSE` 的版权人是仓库里不存在的旧项目名；`client.js` 里残留两条调试 `console.log`。

### 测试

八个套件共 **333 项**，多数是补"最该有、却没有"的覆盖：

- `editor-route`（50）—— 宿主半 HTTP 路由，即安全修复所在的那半边，此前零测试。断言栅栏**先于**
  任何方法分发，以及每条分支（401/403/503、GET、POST、405、坏 JSON、坏模式、被拒插值、超大请求体）。
- `composition-edge`（26）—— 出厂文件今天没有、但手工编辑或未来版本可能出现的输入：CRLF、
  末行无换行、缺 `name:` 的行、更深缩进、重复 id。其中两条容易想当然写反，值得记下：
  未触碰的行连 `\r` 一起保留（因此输出**不保证全是 LF**）；"显式打开一个在本平台本来就启用的行"
  是**无操作**，反推开关时不记为 override —— 三态语义的必然结果。
- `prompt-tool`（37）与 `meta`（45）—— 无浏览器时的编辑通道；`preset.yml` 往返（引号、反斜杠、
  冒号、换行压平、emoji、`"true"`/`"null"` 这类字面量、空名字拒绝）。两者都把写入重定向到临时目录。
- `prompt-reader`（15）—— 热更新契约：改文件后下一次求值必须是新文本；读失败不得把身份变成空串。
- `locales`（65）—— 中英键集一致，以及 `client.js` 里那份手抄字典与 `locales.mjs` 不漂移。
- `composition`（63）—— 文本手术无损、开关语义、平台条件、分组缩进。
- 另有 `test/run.mjs` 统一入口：自己解析出厂 preset 目录（三条回退），失败时打印试过的路径。

### 持续集成

`.github/workflows/test.yml`：push/PR 时 `npm install @deepseek-ai/dsh@0.1.6-alpha.1`（npm 上那份
自带的 presets 与本机逐字节相同，所以测的是真实出厂文本而非自造 fixture），跑八个套件，并检查
源文件语法、两个 shell 脚本、双语配对一致性、发布包内容。

### 文档

- 新增 `docs/TROUBLESHOOTING.md`（11 类实测复现过的失败：症状、原因、自救命令）与
  `docs/MEASUREMENTS.md`（每条结论背后的命令与原始输出）。
- `docs/ARCHITECTURE.md` 新增 §5.1（私有路由为何在平台信任栅栏之外，附 401/403 证据）与
  §12（行级 `inject` 与作用域化 `ctx.inject`）。
- 修正互相矛盾的叙述：`PUBLISHING.md` 与 `ARCHITECTURE.md` §8 都写着"改 `client.js` 必须重启"，
  与同一文件 §10 的实测（HMR 约 1 秒自更新）相反。
- 补齐 `CONTRIBUTING.md` / `.zh.md`、`AGENTS.md`、`SECURITY.md`、issue 表单与 PR 模板。

- 每份文档都有中英两份：英文用默认文件名（`docs/ARCHITECTURE.md`、`SECURITY.md`、`CHANGELOG.md`、
  `test/README.md`），中文为同名 `.zh.md`，旁边放一份 `*.i18n.yaml` 记录两侧的 git blob 哈希。
  CI 里的 `tools/verify-translation-pairing.mjs` 覆盖九对文档，只改一侧会直接失败。
- issue 表单、PR 模板与 `AGENTS.md` 用英文，并在 issue 入口里给出中文文档的链接。

### 截图

- `tools/screenshots/`：手写 CDP 客户端（零依赖）。脚本会真的拨开关、真的点保存、真的切主题与语言，
  并把观察到的状态写进 `observed.json`，使截图可重跑、可核对。
- 四张展示图统一 **800x800**、scale 1。GitHub 会把正文里的图缩到栏宽，2 倍图只会让体积翻两番：
  同样四张从约 750 KB 降到约 223 KB，而 800 宽按原尺寸显示，字更清楚。
- 深色与英文界面仍会切换并断言（观察值进 `observed.json`），只是不再各存一张重复画面。

### npm

- 发布 **`dsh-custom-mode@0.1.6-alpha.1`**（dist-tag `alpha`）。包名与仓库名一致：客户端 bundle 的 id
  必须等于包名（官方设置页插件同样如此），bundle 行名要能被解析，因此包名、`client.js` 的 load id、
  `cordis.patch.yml` 的行名一起改，内部短名统一为 `custom-mode`。
- 发布过程中实测到三件事，详见 `docs/PUBLISHING.md`：`publishConfig.tag` 不被采纳（必须显式
  `--tag`）；首次发布时 registry 仍把 `latest` 指向预发布版（本项目接受，因为每个版本都是预发布）；
  不 import 的 peer 依赖要标 `optional`，否则用户装完第一眼是一条 WARN。
- 发布后的验证不只看"发布成功"：匿名下载 tarball，并在一次性 `DSH_HOME` 里从 registry 真装一次。

### 待随下一个版本号发布

npm 上的 `0.1.6-alpha.1` 不可变，以下改动已在仓库里，需等官方 DSH 更迭后一起发：

- `editor/README.md`（包页面此前只有元数据）；
- `peerDependenciesMeta` 把 `@deepseek-ai/dsh` 标成 `optional`；
- `editor/package.json` 的 `description` 改成英文。
