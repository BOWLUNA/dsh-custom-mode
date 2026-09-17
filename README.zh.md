# dsh-custom-mode

[English](README.md) | 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）用的自定义模式。它的系统提示词是一个普通文件，可以在 Web 设置页里编辑，**改完下一步模型调用即生效** —— 不用重启，也不用新建会话。

官方四个模式（`standard` / `ptc` / `minimal` / `cordis`）不受影响。

|  |  |
| --- | --- |
| ![模式名称与基础模式](docs/images/01-mode-switch.png) | ![插件开关](docs/images/02-plugin-switches.png) |
| ![系统提示词](docs/images/03-system-prompt.png) | ![模式选择器](docs/images/04-preset-picker.png) |

## 安装

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
./install.sh
```

`install.sh` 把 `preset/` 复制到 `$DSH_HOME/.agent-presets/custom/`（agent preset 是**目录**，不是 npm 包），并把设置页插件装进 `web` profile。装完重启 dsh，新建会话时选「自定义模式」。卸载用 `./uninstall.sh`（默认保留你写的提示词，`--purge` 一并删除）。

设置页插件也在 npm 上，可以单独更新：

```sh
dsh plugin --profile web add dsh-custom-mode
```

模式本身只在带 `agent-presets` 的 profile 里可用（`web` 有；`tui`、`headless` 没有）。

## 使用

- **设置页** —— 改模式名、选基础模式、逐行拨插件开关、编辑提示词。
- **直接对 agent 说** —— 模式自带 `custom_prompt` 工具，会话里可以读取或改写提示词。
- **直接改文件** —— `$DSH_HOME/.agent-presets/custom/prompt.md` 是唯一事实来源。

插值变量只有 `{{model}}`、`{{cwd}}`、`{{provider}}`。出现未知的 `{{…}}` 会在保存时被拒绝：渲染器对它抛错，那会让该模式每个请求都失败。

## 工作原理

dsh 的系统提示词通常来自 preset 的 YAML，而官方 `@deepseek-ai/dsh-persona` 的 `prefix` 只在挂载时解析一次。本 preset 注册同名的 `deployment:persona-prefix` section，但把 `text` 写成**函数**，agent loop 在每次模型调用前都会调它。

因此两件事的生效时机不同：

- **提示词文本**每步重新读取，所以改动对**正在运行**的会话立即生效。
- **开关与基础模式**会重写组成文件。`agent-presets` 在该文件的 `mtimeMs` 与 `size` 变化时重新挂载，所以由**新会话**生效；已开着的会话保持它启动时的配置 —— 这是刻意的，中途换工具集会出问题。

行开关是三态。没碰过的行与出厂行逐字节相同，包括 `!!js` 平台条件与出厂 `disabled`；显式开或关才会把那个条件替换成布尔值。平台表达式在宿主端求值，所以页面显示的是这台机器上实际生效的状态，而不是"有没有这个键"。

## 版本

在 dsh **`0.1.6-alpha.1`** 上开发并验证。版本号镜像所适配的 DSH 版本，**不按改动递增** —— 修复与文档都累积在同一个版本号下，直到官方发新版本、本插件重新适配。决定兼容性的是下面这些 API 是否还在，而不是本插件自己的补丁号。

<details>
<summary>耦合点清单（升级 dsh 时逐个核对）</summary>

| 依赖 | 变化后的后果 |
| --- | --- |
| `ctx.systemPrompt.section()` 且 `text` 支持**函数** | 提示词不再热更新 —— 整个项目的立足点 |
| `agentPresets` 依据组成文件的 `mtimeMs`+`size` 重挂载 | 开关要重启进程才生效 |
| `ctx.tools.register()` | 失去 `custom_prompt` 工具 |
| `ctx.webServer.register({ kind, path, handler })` | 设置页空白 |
| `ctx.connection.requestRejection(req)` | 设置页失败关闭（503），不再提供服务 |
| `ctx.inject(deps, cb)`（作用域化等待） | 在没有 web 服务器的 profile 里，整行会停在 `pending` |
| `dsh.client` + `exports["./client"]`，且客户端 bundle id 等于包名 | 浏览器半不会被发现 |
| `settings.section` 插槽与 `locale` | 页面位置 / 翻译标签 |
| `ctx.locale.register/bind` | 回退中文 |
| 出厂布局 `<presets>/<id>/agent.cordis.yml` 与行的文本形状 | 基础模式切换失效 |
| `!!js` 平台表达式 | 平台行显示错误状态 |

</details>

## 文档

- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.zh.md) —— 在真机上复现过的失败，含症状、原因与自救方法。
- [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.zh.md) —— 每条结论背后的命令与原始输出。
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.zh.md) —— 为什么必须是两个产物，以及依赖了哪些宿主 API。
- [`docs/PUBLISHING.md`](docs/PUBLISHING.zh.md) —— npm 包的发布方式。
- [`CHANGELOG.md`](CHANGELOG.zh.md) · [`SECURITY.md`](SECURITY.zh.md) · [`CONTRIBUTING.zh.md`](CONTRIBUTING.zh.md)

## 开发

```sh
node test/run.mjs        # 7 个套件、301 项；自己解析出厂 preset 目录
```

改 `editor/client.js` 会被 `@deepseek-ai/dsh-client-hmr` 在约 1 秒后热替换；改宿主半（`index.mjs`、`composition.mjs`、`meta.mjs`、`paths.mjs`）需要重启。每个套件在防什么见 [`test/README.md`](test/README.zh.md)，改行为之前先读 [`CONTRIBUTING.zh.md`](CONTRIBUTING.zh.md)。

## License

MIT

---

## 构建环境

| | |
| --- | --- |
| 模型 | DeepSeek V4.1 Flash（`deepseek-v4-flash`，provider `deepseek-official`） |
| 运行时 | DeepSeek Harness **0.1.6-alpha.1**（`@deepseek-ai/dsh`，预览版） |

整个项目（含调研与返工）由 DSH 客户端统计消耗 111,406,700 token，缓存命中率 98%，其中输出约 306k。
