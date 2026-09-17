# 变更日志

本项目的版本号**跟随所适配的 DSH 版本**（理由见 README「版本策略与兼容性」）：
语义化版本在这里是假的精确，真正决定兼容性的是那几处内部 API 是否还在。

## [未发布] — `review/2026-09-fixes` 之后的提交

这一批不是新功能，是一次完整的审阅与收尾：修复两个必须修的问题（一个会让用户的 dsh 起不来，
一个是未授权的提示词写入通道），并在真机上把每条结论跑出来留档。

### 安全

- **修复：设置页私有路由未做鉴权。** `/custom-prompt-editor` 注册在 `ctx.webServer` 的裸 HTTP 表上，
  而平台的 Host/Origin 栅栏与浏览器会话鉴权只作用在 Connection 服务挂载的 channel（`/`、`/api`…）上。
  修复前实测：未授权 `GET` 返回整份系统提示词（200），未授权 `POST`（`content-type: text/plain`）
  可改写 `prompt.md`（200），而同进程的官方路由均为 401。因为普通表单式跨站请求不触发预检，
  用户访问的任意网页都能朝该端口 POST —— 对持有 Shell 与文件工具的 agent 而言是可远程触发的提示词注入。
  现在路由先过 `ctx.connection.requestRejection(req)`（与 `/api` 同一判定），服务不可用时**失败关闭**。
  修复后：未授权 401、跨站 403、合法会话 200。详见 [`SECURITY.md`](SECURITY.md)。

### 修复

- **修复：`install.sh` 会删掉 profile 模板自带的基础 bundle。** 全新 `DSH_HOME` 里跑一次旧脚本，
  `dsh.profile.bundles` 从 `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]` 变成
  `["dsh-custom-prompt-editor"]`——那段"清理幽灵条目"逻辑按两个硬编码路径探测依赖，而这两个包由
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
- 合计 143 项检查（63 + 15 + 65），在"本机装过 dsh"与"干净目录里 npm 装 dsh"两种布局下都验证过。

### 持续集成

- 新增 `.github/workflows/test.yml`：push/PR 时 `npm install @deepseek-ai/dsh@0.1.6-alpha.1`
  （npm 上那份自带的 presets 与本机逐字节相同，所以测的是真实出厂文本而非自造 fixture），
  跑三个套件，顺带 `node --check` 全部源文件、`bash -n` 两个脚本、`npm pack --dry-run` 校验发布包内容。

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

## [0.1.6-alpha.1] — 2026-09-17

首个版本。给 DSH 用的「自定义模式」agent preset + 设置页插件：

- **系统提示词是一个文件**（`prompt.md`），每步模型调用前重新读取 → 保存后下一步即生效，
  不需要重启、不需要新建会话（这是整个项目的根基；官方 `dsh-persona` 的 `prefix` 是挂载时
  解析的静态字符串，做不到这一点）。
- **基础模式切换**：以 `standard` / `ptc` / `minimal` / `cordis` 之一为底子，行清单按文本手术复制，
  出厂注释与 `!!js` 平台条件逐字节保留。
- **逐行插件开关**，三态语义：未触碰 = 完全原样；显式开启 = 删掉 `disabled`（含平台表达式）；
  显式关闭 = 写成 `disabled: true`。
- **模式改名**：只影响显示，内部 id 与文件路径不变。
- 中英双语、深浅色跟随、客户端 HMR 可用。
- `custom_prompt` 工具：没有浏览器时也能通过对话改提示词。
- 已知问题：设置页私有路由未做鉴权（见上方「未发布」一节，已修复待发布）；
  `install.sh` 在尚未启动过 dsh 的全新 `DSH_HOME` 上会删掉基础 bundle（同上，已修复待发布）。
