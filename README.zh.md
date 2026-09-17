# dsh-custom-mode

[English](README.md) | 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）用的自定义模式。它的系统提示词是一个普通文件，可以在 Web 设置页里编辑，**改完下一步模型调用即生效** —— 不用重启，也不用新建会话。

官方四个模式（`standard` / `ptc` / `minimal` / `cordis`）不受影响。

|  |  |
| --- | --- |
| ![模式名称与基础模式](docs/images/01-mode-switch.png) | ![插件开关](docs/images/02-plugin-switches.png) |
| ![系统提示词](docs/images/03-system-prompt.png) | ![模式选择器](docs/images/04-preset-picker.png) |

## 安装

一条命令装完——设置页插件，以及它在首次激活时自动播种的 preset：

```sh
dsh plugin --profile web add dsh-custom-mode
```

装完重启 dsh，新建会话时选「自定义模式」。preset 会被写到 `$DSH_HOME/.agent-presets/custom/`；
**那里已有的文件一律不动**，所以你自己写过的 `prompt.md` 不会被覆盖。

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

- **设置页** —— 改模式名、选基础模式、逐行拨插件开关、编辑提示词。
- **直接对 agent 说** —— 模式自带 `custom_prompt` 工具，会话里可以读取或改写提示词。
- **直接改文件** —— `$DSH_HOME/.agent-presets/custom/prompt.md` 是唯一事实来源。

插值变量只有 `{{model}}`、`{{cwd}}`、`{{provider}}`。出现未知的 `{{…}}` 会在保存时被拒绝：渲染器对它抛错，那会让该模式每个请求都失败。

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
node test/run.mjs        # 8 个套件、333 项；自己解析出厂 preset 目录
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
