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

## 安装并完成首次请求

本说明适用于版本 `2.2.6`。安装或更新前，先核对[精确宿主结果与验收边界](docs/CURRENT_COMPATIBILITY.zh.md)。

先安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并在宿主自己的界面中配置可用模型。用 `dsh --version` 对照兼容记录中的精确宿主版本。本插件不安装宿主，也不配置模型凭据。

### Web / CLI

钉住插件版本；只写包名可能在 pnpm 发布冷却期解析到旧版：

```sh
dsh --version
dsh plugin --profile web add dsh-custom-mode@2.2.6
```

用原有启动方式重启为该 Web profile 提供服务的进程。本地 CLI 的既有启动形式是 `dsh web --port 3081 --no-open`；选择空闲端口，打开该进程打印的地址。只重启这个实例。安装 bundle 不会刷新已经运行的宿主。

### 桌面端与 Windows

在桌面应用的 **Plugins（插件）** 页安装 `dsh-custom-mode@2.2.6`，然后重启应用。本项目脚本明确拒绝 `--profile desktop`，不要手改它的 profile 文件。Windows/Electron 与 Web 分别验收，详见兼容记录。

Windows 上可在 PowerShell 中用宿主提供的 `dsh` 执行上面的 npm 安装命令。只有可选的 clone 安装脚本需要 Git Bash，另需 Node.js 和 npm。PATH 中没有 `dsh` 时，使用宿主自带启动器，或将 `dsh` 替换为 `node "<host-install>/node_modules/@deepseek-ai/dsh/lib/bin.js"`。除非宿主确实装在本插件目录中，否则不要把这个路径指向插件目录。

### 验证完整路径

1. 打开设置 → 自定义模式，检查显示版本。页面能打开只是第一步。
2. 滚动到**页面底部的「新建助手」区**。已有内置 `custom` 助手时，该区位于编辑区之后。选择写作等起步设置，输入容易辨认的名称，再点「新增助手」；新建的助手会成为编辑对象。
3. 临时把提示词设为 `下一次就绪检查只回复 CUSTOM_MODE_READY。`，保存并等页面确认已应用。若提示文件已保存但应用失败，先点「重试生效」。
4. 新建一个**会话**，打开该会话的模式/助手选择器，明确选择刚才命名的助手。通过 DSH 中已经配置的模型发送 `就绪检查。`
5. 成功意味着助手可以选择、没有预设损坏告警，并返回预期就绪回复且不出现提示词组装错误。检查后恢复自己的提示词。失败时先看[当前自救步骤](docs/TROUBLESHOOTING.zh.md#当前自救步骤)。

## 各项选择分别做什么

设置页选中的助手是**正在编辑的对象**。选中或新建它不会改变新会话使用的助手。首次激活时，插件可能把缺失的默认值补为内置 `custom`；已经存在的默认值保持不变。新建写作助手后，仍需在会话选择器中选它。

先选择新建时的起步设置；新助手以标准模式创建。创建后，可以在它的编辑区调整基础模式与各项插件开关。

| 起步设置 | 初始行为 |
| --- | --- |
| 开发 | 官方标准模式，工具按出厂设置。 |
| 写作 | 官方标准模式；终端关闭，文件工具开启。 |
| 聊天 | 官方标准模式；文件与终端关闭。 |

提示词保存在 `prompt.md`，下一步组装模型输入时会重读。历史与文件导入先载入草稿，保存才落盘。底层文件已变化时，过期保存会被拒绝。`custom_prompt` 写同一个文件前需要批准。关闭身份/persona 行也会关闭该提示词的注入。

## 升级、clone 开发与卸载

上面的固定版本 npm 命令是普通安装入口。发布完成后，Release 还会提供 `dsh-custom-mode-2.2.6.tgz`、仅供预设导入的归档和 `SHA256SUMS`。安装下载的归档前先核对散列；仅供预设导入的归档没有设置页。

clone 后可用 `./install.sh --profile web` 保留源码链接的开发方式，需要 Node.js、npm、Bash 和宿主 CLI。它在改动 profile 前，通过离线 `npm pack --ignore-scripts` 准备新包，并归档**实际已安装的旧包**。已有提示词、元数据与组成保持原样，安装自检通过后才刷新受管代码。替换失败时，用本地旧归档重新安装并恢复已刷新的代码；本次新建文件在回滚时留有恢复副本，路径会打印。回滚未验证则报错，并在打印的事务目录保留旧包和日志。旧安装损坏、无法归档时，脚本在替换前中止。这个脚本不能代替桌面应用的插件管理器。

`./uninstall.sh` 移除插件但保留助手数据。`--purge` 明确删除受管助手目录及提示词，使用前请自行备份。

## 兼容与版本

声明的宿主范围：`>=0.1.5-rc.2 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0 || >=0.2.2-alpha.2 <0.3.0-0`

插件版本走独立的稳定 `x.y.z` 版本线，不镜像 DSH。2026-10-27 公开宿主标签为 `latest=0.2.1-rc.2`、`next=0.2.1-rc.4`、`alpha=0.2.2-alpha.2`。标签会移动，声明范围与已完成检查是两件事。实测范围见[精确版本、验收边界与历史证据](docs/CURRENT_COMPATIBILITY.zh.md)。

发布必须通过兼容性与浏览器工作流。单元、真实提示词组件、打包安装和浏览器检查分别覆盖不同边界。Windows/Electron、真实模型回复、GPU 执行都必须单独留证，不能从页面截图或单元计数推断。headless 不启动使用 agent preset 的会话。

## 插件市场

各目录的发现与审核规则不同。2026-10-09 的上架结果属于历史记录，不能据此保证今天每个市场都能搜索到。上面的固定版本安装仍是直接入口。[市场接口与限制](docs/MARKETPLACES.zh.md) 说明只读适配器；它不执行目录提供的 shell 命令，也不提交收录。

## 文档

- [故障排查](docs/TROUBLESHOOTING.zh.md) — 当前自救在前，历史故障在后。
- [架构](docs/ARCHITECTURE.zh.md) — 提示词读取与宿主耦合点。
- [发布](docs/PUBLISHING.zh.md) — 既有发布门禁与读回证据。
- [贡献指南](CONTRIBUTING.zh.md) — 隔离开发与检查。
- [AGENTS.md](AGENTS.md) — 仓库代理约定。

## 许可证

MIT
