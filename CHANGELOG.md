# 变更日志

本项目的版本号**跟随所适配的 DSH 版本**：

- 只有官方 DSH 发新版本、本项目**重新适配**之后，才换版本号；
- 这中间本仓库自己的修复、新增测试、文档改动都**累积在同一个版本号下**，不单独提版本。

理由见 README「版本策略与兼容性」：这个插件深度依赖 DSH 的内部 API，决定兼容性的是那几处
API 是否还在，而不是本仓库的补丁号 —— 在这里摆一个自己的版本号只是假的精确。

## [0.1.6-alpha.1]

适配 dsh `0.1.6-alpha.1`。下面按主题分组，时间顺序不重要。

### 安全

- **修复：设置页私有路由未做鉴权。** `/custom-mode` 注册在 `ctx.webServer` 的裸 HTTP 表上，
  而平台的 Host/Origin 栅栏与浏览器会话鉴权只作用在 Connection 服务挂载的 channel（`/`、`/api`…）上。
  修复前实测：未授权 `GET` 返回整份系统提示词（200），未授权 `POST`（`content-type: text/plain`）
  可改写 `prompt.md`（200），而同进程的官方路由均为 401。因为普通表单式跨站请求不触发预检，
  用户访问的任意网页都能朝该端口 POST —— 对持有 Shell 与文件工具的 agent 而言是可远程触发的提示词注入。
  现在路由先过 `ctx.connection.requestRejection(req)`（与 `/api` 同一判定），服务不可用时**失败关闭**。
  修复后：未授权 401、跨站 403、合法会话 200。详见 [`SECURITY.md`](SECURITY.md)。

### 修复

- **修复：`install.sh` 会删掉 profile 模板自带的基础 bundle。** 全新 `DSH_HOME` 里跑一次旧脚本，
  `dsh.profile.bundles` 从 `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]` 变成
  `["dsh-custom-mode"]`——那段"清理幽灵条目"逻辑按两个硬编码路径探测依赖，而这两个包由
  dsh 自己的 install anchor 解析。后果是装完 dsh 起不来（组合树从 158 行变 1 行，只剩本插件 `pending`），
  而脚本**以 0 退出**。触发条件是"装好 dsh 后尚未启动过就装插件"。
  改为只增不删，并补三道防线：前置版本/pnpm 自检、bundle 不变量断言、安装后组合自检（组合树少于
  20 行即报错退出并给自救指引）。
- 修正 `install.sh` / `uninstall.sh` 的 `--help`：多打了一行 `set -euo pipefail`。
- 修正 `editor/package.json` 的 `scripts.test`：它指向 `editor/test/composition.test.mjs`，
  而测试在仓库根，`npm test` 会直接 `MODULE_NOT_FOUND`。
- `LICENSE` 的版权人是 `dsh-editable-prompt contributors`——一个仓库里任何地方都不存在的旧项目名，
  已改为 `BOWLUNA`。
- 删掉 `editor/client.js` 里残留的两条调试 `console.log`（发布版每次加载都往用户 Console 吐）。

### 测试

- 新增 `test/prompt-reader.test.mjs`（15 项）：整个项目的根基——"改文件后下一次求值就是新文本"——
  此前没有任何自动测试。现在直接驱动 persona section 的 `text` provider，覆盖改文件、稳态不重读、
  缺文件回退、文件被清空不得把身份变成空串、`complete: true` 时不注册 suffix。
- `test/locales.test.mjs` 新增第 6 节（60 → 65 项）：`locales.mjs` 号称单一事实来源，但浏览器半
  不能 import 它（手写 bundle、无打包器），`client.js` 里是手抄的副本，而旧测试只比对
  `locales.mjs` 自己。现在会从 `client.js` 抽出字典逐条比对（反向验证过能抓到漂移）。
- 新增 `test/run.mjs` 统一入口：自己解析出厂 preset 目录（三条回退），解析不到时打印试过哪些路。
  此前三份文档给了三套不同写法，其中两处硬编码路径在别人机器上必然不成立。
- 合计 301 项检查（63 + 26 + 15 + 37 + 45 + 50 + 65），在"本机装过 dsh"与"干净目录里 npm 装 dsh"两种布局下都验证过。

### 持续集成

- 新增 `.github/workflows/test.yml`：push/PR 时 `npm install @deepseek-ai/dsh@0.1.6-alpha.1`
  （npm 上那份自带的 presets 与本机逐字节相同，所以测的是真实出厂文本而非自造 fixture），
  跑七个套件，顺带 `node --check` 全部源文件、`bash -n` 两个脚本、双语配对一致性、`npm pack --dry-run` 校验发布包内容。

### 文档

- 新增 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)：10 类实测复现过的失败，
  每类给出症状、原因、自救命令。
- 新增 [`docs/实测记录.md`](docs/实测记录.md)：每条结论背后的命令与原始输出。
- 修正互相矛盾的叙述：`docs/PUBLISHING.md` 与 `docs/ARCHITECTURE.md` §8 都写着"改 `client.js`
  必须重启、刷新不够"，与同一文件 §10 的实测证据（HMR 约 1 秒自更新）直接相反；已统一到 §10，
  并在原处保留"这里曾写错"的说明。
- `docs/ARCHITECTURE.md` 新增 §5.1：私有 HTTP 路由不在平台信任栅栏里（附实测 401/403 证据与修法）。
- 修正 `preset/agent.cordis.yml` 中关于设置页安装位置的过期注释。
- README：加徽章、界面截图、文档导航、测试表格；兼容性 API 清单补
  `ctx.connection.requestRejection`；路线图补"安全/工程化/文档"。

### 仓库装修

- 新增 6 张界面截图与 `tools/screenshots/`（约 300 行手写 CDP 客户端，零依赖）：
  脚本会真的拨开关、真的点保存、真的切主题与语言，并把观察到的状态写进 `observed.json`，
  使截图可重跑、可核对。
- 新增 issue 表单、PR 模板、`SECURITY.md`。

### 第二轮 · 修复（实测挖出来的）

- **装进 tui / headless 之类的 profile 不再打印假警报。** 包级 `inject = ['webServer', 'agentPresets']`
  是硬依赖，而 tui 组合里这两个服务都不存在，于是每次启动都打印
  `1 entry did not activate … pending (waiting for services: webServer, agentPresets)` —— 与"装完 dsh
  变砖"的报错**完全相同**。改成作用域化的 `ctx.inject(deps, cb)` 之后，整行正常激活，只有那条路由
  等服务；实测 tui 有 TTY 启动也不再出现该警告，web 里设置页行为不变（401 / 200 照旧）。
- `install.sh` 装完会说明目标 profile 里有没有 web 服务器。实测：`agent-presets` 只在 web 组合里
  存在，所以装进 tui 时**「自定义模式」根本选不到**（不只是没有设置页）。
- **`uninstall.sh` 不再留下软链。** `dsh plugin remove` 会清掉 `package.json` 的依赖与 `bundles` 条目，
  但 pnpm 可能在 `node_modules` 里留下指向仓库的软链（pnpm 12.4.2 上复现）。它不影响装配，但
  uninstall 就该不留痕迹——尤其随后要删掉仓库时它会变成断链。

### 第二轮 · 测试

- 新增 `test/prompt-tool.test.mjs`（37 项）：`custom_prompt` 工具此前**一个测试都没有**，而它是
  没有浏览器时的**持久**编辑通道（设置页是 bundle 提供的 Web UI，进程重启后未必还在）。
  覆盖读取/写入/缺文件/空内容，以及全部 `{{…}}` 拒绝与接受分支。它还把模块复制到临时目录再
  import，因此写入落在临时目录，永不碰仓库里的 `preset/prompt.md`。
- 这条套件带一个**漂移守卫**：`{{变量}}` 校验在 `editor/index.mjs`（设置页写入）与
  `preset/prompt-tool.mjs`（工具写入）里各有一份（有意重复）。它会从后者源码里抽出函数，对同一张
  18 项输入表比对两边判定——分叉意味着一条路径会接受渲染器会抛错的写法，也就是那个模式**每个请求
  都失败**。这和 `client.js` 的词典漂移是同一类风险，后果更重。
- 新增 `test/meta.test.mjs`（45 项）：README 一直写着 `preset.yml`「**且有往返测试**」，但没有任何
  测试 import 过 `meta.mjs`。现在覆盖引号、反斜杠、冒号、井号、前导短横、换行压平、emoji、
  `"true"`/`"null"` 这类 YAML 字面量、空名字拒绝，以及文件缺失/只有单个键时的读取行为。
  写入位置用 `DSH_CUSTOM_PROMPT_PATH` 重定向到临时目录。
- 合计 **225 项**（63 + 15 + 37 + 45 + 65），全部通过。

### 第二轮 · 实测

- **端到端验证了项目的核心主张**「编辑文件 → 下一步生效，不需要重启、不需要新建会话」：
  在提示词里植入格式规则（第一行必须是 `MARK-ONE`），在真实 web 会话里问一句；**不重启、不刷新、
  不新建会话**，只把文件改成 `MARK-TWO`，再在同一个会话里问第二句 —— 回答变成 `MARK-TWO`。
  此前只有"读取函数会被重新求值"的单元测试，没有"agent loop 每一步真的会调它"的证据。
  命令与原始输出见 `docs/实测记录.md` §0。
- 记录两条**走不通的路**，省得再试：`dsh --profile headless`（单轮 CLI）明确拒绝运行带 agent preset
  的会话（源码：`the one-shot runner does not compose`）；`agent-presets.default` 在组合里是写死的
  `standard`，`settings.yaml` 的同名键是运行时覆盖，两者不是一回事。
- 安装/卸载往返、二次安装幂等性、tui 安装、非 web profile 的行为，逐条实测并留档
  （`docs/实测记录.md` §7 §8）。

### 第三轮 · 仓库形态与工程化

- **README 改成与官方仓库一致的形态**：`README.md` 是英文、`README.zh.md` 是中文，
  两份**权威相同**，并用 `README.i18n.yaml` 记录两侧在"上次确认一致"时的 git blob 哈希。
  新增 `tools/verify-translation-pairing.mjs`（CI 会跑），改了一侧忘了另一侧就直接失败。
  同一套机制用在 `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` 上。徽章行去掉——官方仓库没有。
- **版本策略写清楚**：版本号只跟随所适配的 DSH 版本，**小改动不提版本**；只有官方发新版并
  重新适配才换。`CHANGELOG.md` 因此通常只有一个版本段落（本文件现在就是这个形态）。
- 新增 `.editorconfig`、`.gitattributes`、`AGENTS.md`（给编码智能体的仓库说明）、
  根 `package.json`（`npm test` / `npm run verify-translation-pairing`）。
- **新增两个测试套件（+76 项）**：
  - `test/editor-route.test.mjs`（50 项）—— 宿主半的 HTTP 路由，也就是安全修复所在的那半边。
    此前它**一个测试都没有**：修复是用 curl 手工验的，那只证明"当时修对了"，挡不住以后有人
    把栅栏挪位置或重新排序。现在断言栅栏**先于任何方法分发**执行、`connection` 缺失时**失败关闭**，
    以及每条分支（401/403/503、GET、POST、405、坏 JSON、坏模式、空提示词、被拒插值、超大请求体）。
  - `test/composition-edge.test.mjs`（26 项）—— 编译器面对出厂文件今天没有、但手工编辑或未来
    版本可能出现的输入：CRLF、末行无换行、缺 `name:` 的行、更深缩进、重复 id、只有前导注释。
    其中两条断言在写的时候是**错的**，改正后顺便把两个此前没写下的事实固化了下来：
    未触碰的行连 `\r` 一起保留（与"逐字节不变"一致，输出不保证全 LF）；以及"显式打开一个在
    本平台本来就启用的行"是**无操作**，反推时不该被记成 override——这正是三态语义。
- 顺手修了宿主半一处措辞：`connection` 缺失时返回 503，响应体原本写成 `forbidden`，
  既不是未授权也不是被禁止，会误导排查的人；现在按 401/403/503 分别给
  `unauthorized` / `forbidden` / `unavailable`。
- **发布到 npm**：包名按你的要求与 GitHub 仓库一致 —— **`dsh-custom-mode`**（原名
  `dsh-custom-prompt-editor` 在发布前改掉；客户端 bundle 的 id、bundle 行名与路由都要跟着
  包名走，官方插件也是这个约定）。已发布 `dsh-custom-mode@0.1.6-alpha.1`（tag `alpha`）。
- npm 发布过程中实测出三个坑，都写进了 `docs/PUBLISHING.md`：
  1. `publishConfig.tag` 不被采纳，必须显式 `--tag alpha`（不加时提示 `with tag latest`）；
  2. **首次发布时 registry 仍会把 `latest` 指向预发布版**（`dist-tags` 里 alpha 与 latest 同时
     存在）。本项目接受这个状态并写清了理由：版本号策略决定了每个版本都是预发布，没有稳定版
     可供 `latest` 指向；
  3. 不 import 的 peer 依赖要标 `optional`，否则用户从 registry 装完第一眼是一条
     `[WARN] Issues with peer dependencies found`。这条修正**没有**随 `0.1.6-alpha.1` 发出
     （同一个版本号不能重发，为一个元数据警告去 `npm unpublish` 会让包名被锁 24 小时），
     随下一个版本生效。
- 发布后的验证不是"看它说成功"：在一次性 `DSH_HOME` 里从 registry 真装了一次，确认
  `dependencies` 里是真实版本号、`node_modules` 里是真目录（不是软链）、组合树里出现
  `id: custom-mode` / `name: dsh-custom-mode` 两行、8 个发布文件齐全。

### 已就绪、待随下一个版本发布

npm 上的 `0.1.6-alpha.1` 是**不可变**的（同一个版本号不能重发），下面这些改动已经在本仓库里，
但要等官方 DSH 更迭、版本号跟着换过之后再发出去：

- `editor/README.md` —— 发布包里原本没有 README，所以 npm 页面只有元数据。这份 README 是包的
  落地页：说明这个包**只是设置页那一半**、preset 来自仓库、以及怎么装。
- `peerDependenciesMeta` 把 `@deepseek-ai/dsh` 标成 `optional` —— 否则用户从 registry 装完，
  第一眼是一条 `[WARN] Issues with peer dependencies found`。
- `editor/package.json` 的 `description` 改成英文，与英文为主的仓库一致。

判断"该发新版了"的信号只有一个：**官方 DSH 发新版本**（见 README「版本策略」）。

### 功能

- **系统提示词是一个文件**（`prompt.md`），每步模型调用前重新读取 → 保存后下一步即生效，
  不需要重启、不需要新建会话（这是整个项目的根基；官方 `dsh-persona` 的 `prefix` 是挂载时
  解析的静态字符串，做不到这一点）。真机会话的实证见 `docs/实测记录.md` §0。
- **基础模式切换**：以 `standard` / `ptc` / `minimal` / `cordis` 之一为底子，行清单按文本手术复制，
  出厂注释与 `!!js` 平台条件逐字节保留。
- **逐行插件开关**，三态语义：未触碰 = 完全原样；显式开启 = 删掉 `disabled`（含平台表达式）；
  显式关闭 = 写成 `disabled: true`。
- **模式改名**：只影响显示，内部 id 与文件路径不变。
- 中英双语、深浅色跟随、客户端 HMR 可用。
- `custom_prompt` 工具：没有浏览器时也能通过对话改提示词。
