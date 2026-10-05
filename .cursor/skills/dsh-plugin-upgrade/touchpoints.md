# 本插件 × 七类触点

分类来自 oh-my-dsh/dsh-plugin-upgrade-skill 的 touchpoint 1–7。下表只记**这个仓库里真实存在的命中**。扫描工具、测试和文档里的字符串不算产品触点。

| # | 类别 | 本仓库 | 升级时怎么证明没碎 |
| --- | --- | --- | --- |
| 1 | 源码 patch | `cordis.patch.yml` 是打进 profile 的 bundle patch，不是 `patch-package`，也不读 `DSH_HARNESS_SOURCE_ROOT` | `tools/boot-check.mjs` 断言行名等于包名，并且端口起来之后 stderr 没有 fatal。`--dump-config` 不能代替它 |
| 2 | 内部事件 | `preset/prompt-tool.mjs` 听 `tools/pre-execute`。没有这个事件时写 `approval-gate-missing`，不许静默 | `test/prompt-tool.test.mjs`。活体审批要在 web profile 里看一次轨迹 |
| 3 | 服务探测 | `preset-backend/detect.mjs` 区分声明式注册表和旧目录。`index.mjs` 用 `ctx.inject`，不把等待写进行自己的 `inject` | `test/preset-backend.test.mjs`、`test/base-composition.test.mjs`。拿不到出厂组成时必须降级保存提示词，而不是 500 |
| 4 | 宿主目录 | `paths.mjs` 读 `DSH_HOME`，否则 `~/.dsh`。seed 写 `.agent-presets/`。用户的 `prompt.md` 已存在则不覆盖 | `test/seed.test.mjs`。实验用一次性 `DSH_HOME`，不要碰正在使用的 home，也不要读 `.credentials.yaml` |
| 5 | UI / 工具注册 | `client.js` 是交给壳的一份包（`module.exports`，没有 ESM import）。词典在 `locales.mjs`。`preset/prompt-tool.mjs` 注册 `custom_prompt` | `node test/run.mjs` 加 `tools/browser-verify.mjs`。拆 `client.js` 会引入构建步骤，本仓库明确没有构建 |
| 6 | 自定义通道 | HTTP 只走 `ctx.connection.fetch.register`，路径带 `/api`。源码里不得出现 `webServer.register(` | `test/editor-route.test.mjs`。无 cookie 应 401，伪造 Origin / Host 应 403 |
| 7 | 子进程 | 产品代码不解析宿主 stdout。`install.sh` 调用 PATH 上的 `dsh`。`tools/boot-check.mjs` 启动一次性 web | Windows 上 PATH 经常没有 `dsh`。入口是 `node node_modules/@deepseek-ai/dsh/lib/bin.js`。不要在 dsh 会话内全局安装 dsh |

官方四个模式 `standard` / `ptc` / `minimal` / `cordis` 保持可用。合成模式的 id 是 `all`，不能是 `custom`。
