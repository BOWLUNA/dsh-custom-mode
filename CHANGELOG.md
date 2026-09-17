# 变更日志

版本号**跟随所适配的 DSH 版本**：只有官方发新版本、本项目重新适配之后才换；这中间的修复与文档
改动都累积在同一个版本号下，不单独提版本。理由见 README「版本」。

## [0.1.6-alpha.1]

适配 dsh `0.1.6-alpha.1`。按主题分组，组内不保证时间顺序。

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

七个套件共 **301 项**，多数是补"最该有、却没有"的覆盖：

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
自带的 presets 与本机逐字节相同，所以测的是真实出厂文本而非自造 fixture），跑七个套件，并检查
源文件语法、两个 shell 脚本、双语配对一致性、发布包内容。

### 文档

- 新增 `docs/TROUBLESHOOTING.md`（11 类实测复现过的失败：症状、原因、自救命令）与
  `docs/MEASUREMENTS.md`（每条结论背后的命令与原始输出）。
- `docs/ARCHITECTURE.md` 新增 §5.1（私有路由为何在平台信任栅栏之外，附 401/403 证据）与
  §12（行级 `inject` 与作用域化 `ctx.inject`）。
- 修正互相矛盾的叙述：`PUBLISHING.md` 与 `ARCHITECTURE.md` §8 都写着"改 `client.js` 必须重启"，
  与同一文件 §10 的实测（HMR 约 1 秒自更新）相反。
- 补齐 `CONTRIBUTING.md` / `.zh.md`、`AGENTS.md`、`SECURITY.md`、issue 表单与 PR 模板。

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
