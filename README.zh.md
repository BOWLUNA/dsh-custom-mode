# dsh-custom-mode

[English](README.md) | 中文

在 DeepSeek Harness（`dsh`）里改自定义模式的系统提示词、基础模式和插件开关。可以有多个助手。custom mode、system prompt、prompt editor。

<p align="center">
<img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/header.png" width="820" alt="dsh-custom-mode">
</p>

<table align="center">
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/05-assistant-manager.png" width="360" alt="助手"></td>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/03-system-prompt.png" width="360" alt="系统提示词"></td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/01-mode-switch.png" width="360" alt="基础模式"></td>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/02-plugin-switches.png" width="360" alt="插件开关"></td>
</tr>
</table>

## 安装

钉版本。只写包名时，pnpm 的发布冷却期可能装到旧版。细节见 [docs/TROUBLESHOOTING.zh.md](docs/TROUBLESHOOTING.zh.md)。

```sh
dsh plugin --profile web add dsh-custom-mode@2.2.1
```

重启为这个 profile 提供服务的进程。设置页上的版本号才是正在运行的版本。

桌面端从应用里的插件页安装。CLI 不能改 `profiles/desktop`。

在 Windows 上，`install.sh` 是 bash，而且 PATH 里要有 `dsh`。否则用 DeepSeek Harness 自带的 `dsh`，或 `node node_modules/@deepseek-ai/dsh/lib/bin.js`。

## 使用

1. 打开设置 → 自定义模式。
2. 改系统提示词。保存按钮在编辑器下面。
3. `settings.yaml` 里还没有 `agent-presets.default` 时，新会话用这个助手。已经写过的值保持原样。

提示词是 `prompt.md`。下一步组装模型输入时会重读这个文件。历史可以把旧稿载入编辑器；载入不落盘。打开页面之后文件被改过时，这一次保存会被拒绝。模型要改同一份文件，只能走 `custom_prompt`，并且先问过你。

新建助手时选一种姿态。它只影响下一次新建。

| 姿态 | 新建之后 |
| --- | --- |
| 开发 | 内置标准模式的工具集。 |
| 写作 | 终端关，文件工具开。 |
| 聊天 | 文件和终端关。 |

## 边界

- 不替换标准、PTC、极简、创造。
- 不附带角色扮演预设。
- 不用 CLI 改桌面端 profile。headless 不会启动使用 agent preset 的会话。

## 兼容

声明范围：`>=0.1.5-rc.2 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0`

| dsh | 声明 | 2.2.1 核对 |
| --- | --- | --- |
| `0.2.0-rc.2` | 声明支持 | 本版发布前的 Windows web profile |
| `0.2.1-alpha.1` | 声明支持，CI 有这条腿 | 本版没有重跑 |
| `0.1.7-rc.2` | 声明支持，CI 有这条腿 | 本版没有重跑 |

单元套件在 WSL2 Ubuntu 26.04 下也通过了（只有 Node，没有 dsh 进程，没有浏览器）。这不是 Linux 桌面的结果。

## 文档

- [docs/TROUBLESHOOTING.zh.md](docs/TROUBLESHOOTING.zh.md) — 装到旧版、基础模式不可用、升级停在半截
- [docs/ARCHITECTURE.zh.md](docs/ARCHITECTURE.zh.md) — 提示词在哪被读，依赖宿主的哪些调用
- [docs/PUBLISHING.zh.md](docs/PUBLISHING.zh.md) — tag 与发布
- [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md) — 给人看
- [AGENTS.md](AGENTS.md) — 给 agent 看

## 许可证

MIT
