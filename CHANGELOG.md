# 变更日志

本项目的版本号**跟随所适配的 DSH 版本**：

- 只有官方 DSH 发新版本、本项目**重新适配**之后，才换版本号；
- 这中间本仓库的修复、新增测试、文档改动都**累积在同一个版本号下**，不单独提版本。

理由见 README「版本策略与兼容性」：本项目深度依赖 DSH 的内部 API，决定兼容性的是那几处 API
是否还在，而不是本仓库的补丁号 —— 在这里摆一个自己的版本号只是假的精确。

## [0.1.6-alpha.1]

适配 dsh `0.1.6-alpha.1`。下面按主题分组，组内不保证时间顺序。

### 新增

- **系统提示词是一个文件**（`prompt.md`）：每次模型调用前重新读取，因此**保存后下一步即生效**，
  不需要重启、不需要新建会话。官方 `@deepseek-ai/dsh-persona` 的 `prefix` 是挂载时解析的静态
  字符串，做不到这一点；本模式改为注册同名 section、但把 `text` 写成函数。
- **基础模式切换**：以 `standard` / `ptc` / `minimal` / `cordis` 之一为底子。实现是**文本手术**
  （逐字节复制出厂行，只改写 `disabled`）。不能用 YAML 解析再序列化：那样会丢掉出厂注释与
  `!!js` 平台条件，而平台条件一旦丢失就是**静默**的行为变化。
- **逐行插件开关**，三态语义：未触碰 = 完全原样；显式开启 = 删掉 `disabled`（含平台表达式）；
  显式关闭 = 写成 `disabled: true`。平台表达式在**宿主端真实求值**，页面显示的是这台机器上
  实际生效的状态，而不是"有没有这个键"。
- **模式改名**：只影响显示，内部 id 与文件路径不变，已有会话不受影响。
- **`custom_prompt` 工具**：没有浏览器时的编辑通道。设置页是 bundle 提供的 Web UI，进程重启后
  未必在场，而这个工具随 preset 一起常驻。
- 中英双语、深浅色跟随、客户端 HMR 可用。

### 安全

- **修复：设置页私有路由未做鉴权。** `/custom-mode` 注册在 `ctx.webServer` 的裸 HTTP 表上，
  而平台的 Host/Origin 栅栏与浏览器会话鉴权只作用在 Connection 服务挂载的 channel
  （`/`、`/api`…）上。修复前实测：未授权 `GET` 返回整份系统提示词（200），未授权 `POST`
  （`content-type: text/plain`）可改写 `prompt.md`（200），而同进程的官方路由均为 401。
  因为普通表单式跨站请求不触发预检，用户浏览器里的**任意页面**都能朝该端口 POST；对持有 Shell
  与文件工具的 agent 而言，这是可远程触发的提示词注入。现在路由先过
  `ctx.connection.requestRejection(req)`（与 `/api` 同一判定），该服务不可用时**失败关闭**。
  修复后：未授权 401、跨站 403、合法会话 200。详见 [`SECURITY.md`](SECURITY.md)。

### 修复

- **`install.sh` 会删掉 profile 模板自带的基础 bundle。** 全新 `DSH_HOME` 里跑一次旧脚本，
  `dsh.profile.bundles` 从 `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]` 变成
  `["dsh-custom-mode"]`：那段"清理幽灵条目"逻辑按两个硬编码路径探测依赖，而这两个包由 dsh
  自己的 install anchor 解析。后果是装完 dsh 起不来（组合树从 158 行变 1 行，只剩本插件
  `pending`），而脚本**以 0 退出**。触发条件是"装好 dsh 后尚未启动过就装插件"。
  改为只增不删，并补三道防线：前置版本/pnpm 自检、bundle 不变量断言、安装后组合自检
  （组合树少于 20 行即报错退出并给出自救方法）。
- **装进 tui / headless 之类的 profile 不再打印假警报。** 行级 `inject` 是硬依赖，而 tui 组合里
  `webServer` 与 `agentPresets` 都不存在，于是每次启动都打印
  `1 entry did not activate … pending (waiting for services: webServer, agentPresets)` ——
  与"装完 dsh 变砖"的报错**完全相同**，等于教人忽略唯一重要的那条警告。改成作用域化的
  `ctx.inject(deps, cb)` 之后整行正常激活，只有那条路由等服务；实测 tui 有 TTY 启动也不再出现
  该警告，web 里设置页行为不变（401 / 200 照旧）。
- **`uninstall.sh` 不再留下软链。** `dsh plugin remove` 会清掉 `package.json` 的依赖与 `bundles`
  条目，但 pnpm 可能在 `node_modules` 里留下指向仓库的软链（pnpm 12.4.2 上复现）。它不影响装配，
  但 uninstall 就该不留痕迹：随后删掉仓库时它会变成断链。
- 宿主半一处措辞：`connection` 缺失时返回 503，响应体原本写成 `forbidden`，既不是未授权也不是
  被禁止，会误导排查的人；现在按 401/403/503 分别给 `unauthorized` / `forbidden` / `unavailable`。
- `install.sh` 装完会说明目标 profile 里有没有 web 服务器。`agent-presets` 只存在于 web 组合，
  所以装进 tui 时「自定义模式」根本选不到（不只是没有设置页），收尾说明也随之分档。
- 修正 `install.sh` / `uninstall.sh` 的 `--help`：多打了一行 `set -euo pipefail`。
- 修正 `editor/package.json` 的 `scripts.test`：它指向 `editor/test/composition.test.mjs`，而测试
  在仓库根，`npm test` 会直接 `MODULE_NOT_FOUND`。
- `LICENSE` 的版权人是一个仓库里任何地方都不存在的旧项目名，已改为 `BOWLUNA`。
- 删掉 `editor/client.js` 里残留的两条调试 `console.log`（发布版每次加载都往用户 Console 吐）。

### 测试

- 新增 `test/prompt-reader.test.mjs`（15 项）：整个项目的根基——"改文件后下一次求值就是新文本"
  ——此前没有任何自动测试。直接驱动 persona section 的 `text` provider，覆盖改文件、稳态不重读、
  缺文件回退、文件被清空不得把身份变成空串、`complete: true` 时不注册 suffix。
- 新增 `test/prompt-tool.test.mjs`（37 项）：`custom_prompt` 工具。把模块复制到临时目录再 import，
  因此写入落在临时目录，永不碰仓库里的 `preset/prompt.md`。
- 新增 `test/meta.test.mjs`（45 项）：`preset.yml` 往返。README 一直写着它「有往返测试」，但此前
  没有任何测试 import 过 `meta.mjs`。覆盖引号、反斜杠、冒号、井号、前导短横、换行压平、emoji、
  `"true"`/`"null"` 这类 YAML 字面量、空名字拒绝、以及文件缺失或只有单个键时的读取。
- 新增 `test/editor-route.test.mjs`（50 项）：宿主半的 HTTP 路由，也就是安全修复所在的那半边。
  此前它一个测试都没有（修复是靠 curl 手工验的，那只证明"当时对了"，挡不住以后有人把栅栏挪到
  方法分发之后、或忘记失败关闭）。断言的第一条是**被拒的请求不能产生任何副作用**。
- 新增 `test/composition-edge.test.mjs`（26 项）：编译器面对出厂文件今天没有、但手工编辑或未来
  版本可能出现的输入——CRLF、末行无换行、缺 `name:` 的行、更深缩进、重复 id、只有前导注释。
  这条套件固化下两个容易漏掉的事实：
  - 未触碰的行连 `\r` 一起保留（与"逐字节不变"是同一件事），因此**输出不保证全是 LF**；
  - "显式打开一个在本平台本来就启用的行"是**无操作**，反推时不记为 override —— 三态语义的必然结果。
- `test/locales.test.mjs` 新增第 6 节（60 → 65 项）：`locales.mjs` 是文案的单一事实来源，但浏览器半
  不能 import 它（手写 bundle、无打包器），`client.js` 里是手抄的副本，而旧测试只比对
  `locales.mjs` 自己。现在从 `client.js` 抽出字典逐条比对。
- 新增 `test/run.mjs` 统一入口：自己解析出厂 preset 目录（三条回退），解析不到时打印试过哪些路。
  此前三份文档给了三套不同写法，其中两处硬编码路径在别的机器上必然不成立。
- 合计 **301 项**（63 + 26 + 15 + 37 + 45 + 50 + 65），在"本机装过 dsh"与"干净目录里 npm 装 dsh"
  两种布局下都验证过。

### 持续集成

- 新增 `.github/workflows/test.yml`：push/PR 时 `npm install @deepseek-ai/dsh@0.1.6-alpha.1`
  （npm 上那份自带的 presets 与本机逐字节相同，所以测的是真实出厂文本，而不是自造 fixture），
  跑七个套件，并顺带检查：全部源文件语法、两个 shell 脚本、双语配对一致性、发布包内容。

### 文档

- 新增 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)：10 类实测复现过的失败，每类给出
  症状、原因与自救命令。
- 新增 [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md)：每条结论背后的命令与原始输出。
- 修正互相矛盾的叙述：`docs/PUBLISHING.md` 与 `docs/ARCHITECTURE.md` §8 都写着"改 `client.js`
  必须重启、刷新不够"，与同一文件 §10 的实测（HMR 约 1 秒自更新）直接相反；已统一到 §10。
- `docs/ARCHITECTURE.md` 新增 §5.1（私有 HTTP 路由不在平台信任栅栏里，附实测 401/403 证据）
  与 §12（行级 `inject` 与作用域化 `ctx.inject` 的区别）。
- 修正 `preset/agent.cordis.yml` 中关于设置页安装位置的过期注释。
- README：补界面截图、文档导航与测试表格；兼容性 API 清单补 `ctx.connection.requestRejection`
  与 `ctx.inject`；路线图补"安全 / 工程化 / 文档"。

### 截图与素材

- 新增 `tools/screenshots/`（约 300 行手写 CDP 客户端，零依赖）：拍摄脚本会真的拨开关、真的点
  保存、真的切主题与语言，并把观察到的状态写进 `observed.json`，使截图可重跑、可核对。
- 四张 README 展示图统一为 **800x800**，拍摄用 scale 1：GitHub 会把正文里的图缩到栏宽，2 倍图
  只会让体积翻两番。实测同样四张图从约 750 KB 降到约 223 KB，而 800 宽按原尺寸显示，字更清楚。
- 深色与英文界面仍然真的切换并断言（观察值进 `observed.json`），但不再各存一张重复画面的图。
- 真机会话那张实证图（改提示词 → 下一轮回答变化）放在 `docs/MEASUREMENTS.md` §0：它是实验证据，
  不是页面展示。

### 仓库结构

- README 采用与官方仓库一致的形态：`README.md` 是英文、`README.zh.md` 是中文，两份**权威相同**，
  并用 `README.i18n.yaml` 记录两侧在"上次确认一致"时的 git blob 哈希。
  `tools/verify-translation-pairing.mjs` 在 CI 里执行这条检查——只改一侧就直接失败。同一套机制
  也用在 `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` 上。
- 新增 `CONTRIBUTING.md` + `.zh.md`（含"不能被破坏的东西"清单）、`AGENTS.md`（给编码智能体的
  仓库说明）、`SECURITY.md`、issue 表单与 PR 模板、`.editorconfig`、`.gitattributes`。
- 新增根 `package.json`：`npm test` 与 `npm run verify-translation-pairing`。

### npm 发布

- 发布 **`dsh-custom-mode@0.1.6-alpha.1`**（dist-tag `alpha`）。包名与仓库名一致：客户端 bundle 的
  id 必须等于包名（官方设置页插件也是这个约定），bundle 行名要能被解析，因此包名、`client.js`
  的 load id、`cordis.patch.yml` 的行名是一起改的，内部短名也统一为 `custom-mode`。
- 发布过程中实测出三件事，详见 [`docs/PUBLISHING.md`](docs/PUBLISHING.md)：
  1. `publishConfig.tag` 不被采纳，必须显式 `--tag alpha`；
  2. **首次发布时 registry 仍会把 `latest` 指向预发布版**。本项目接受这一状态：版本号策略决定了
     每个版本都是预发布，不存在稳定版可供 `latest` 指向；
  3. 不 import 的 peer 依赖要标 `optional`，否则用户从 registry 装完第一眼是一条
     `[WARN] Issues with peer dependencies found`。
- 发布后的验证不只看"发布成功"：匿名下载 tarball、在一次性 `DSH_HOME` 里从 registry 真装一次，
  确认依赖里是真实版本号、`node_modules` 里是真目录、组合树出现
  `id: custom-mode` / `name: dsh-custom-mode`。

### 待随下一个版本号发布

npm 上的 `0.1.6-alpha.1` 不可变（同一个版本号不能重发），下面这些改动已在仓库里，需等官方 DSH
更迭、版本号跟着换过之后再发出去：

- `editor/README.md`——发布包里原本没有 README，所以 npm 页面只有元数据。
- `peerDependenciesMeta` 把 `@deepseek-ai/dsh` 标成 `optional`（见上）。
- `editor/package.json` 的 `description` 改成英文。

判断"该发新版了"的信号只有一个：**官方 DSH 发新版本**（见 README「版本策略」）。
