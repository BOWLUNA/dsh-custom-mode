# dsh-custom-mode

[English](README.md) | 中文

在 DeepSeek Harness（`dsh`）里编辑助手的系统提示词、基础模式和插件开关，为不同任务保留独立助手。

<p align="center">
<img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/header.png" width="820" alt="dsh-custom-mode">
</p>

[安装](#安装并完成首次请求) · [首次使用](#验证完整路径) · [更新](#plugin-updates) · [截图](#使用截图) · [兼容](#兼容与版本) · [求助](#帮助与文档)

## 安装并完成首次请求

本说明描述版本 `2.3.0`。安装或更新前，先确认[发布版本](https://github.com/BOWLUNA/dsh-custom-mode/releases)中已有该精确版本，并核对[精确宿主结果与验收边界](docs/CURRENT_COMPATIBILITY.zh.md)。

先安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，并在宿主自己的界面中配置可用模型。用 `dsh --version` 对照兼容记录中的精确宿主版本。本插件不安装宿主，也不配置模型凭据。

### Web / CLI

钉住插件版本；只写包名可能在 pnpm 发布冷却期解析到旧版：

```sh
dsh --version
dsh plugin --profile web add dsh-custom-mode@2.3.0
```

用原有启动方式重启为该 Web profile 提供服务的进程。本地 CLI 的既有启动形式是 `dsh web --port 3081 --no-open`；选择空闲端口，打开该进程打印的地址。只重启这个实例。安装 bundle 不会刷新已经运行的宿主。

### 桌面端与 Windows

在桌面应用的 **Plugins（插件）** 页安装 `dsh-custom-mode@2.3.0`，然后重启应用。本项目脚本明确拒绝 `--profile desktop`，不要手改它的 profile 文件。Windows/Electron 与 Web 分别验收，详见兼容记录。

Windows 上可在 PowerShell 中用宿主提供的 `dsh` 执行上面的 npm 安装命令。只有可选的 clone 安装脚本需要 Git Bash，另需 Node.js 和 npm。PATH 中没有 `dsh` 时，使用宿主自带启动器，或将 `dsh` 替换为 `node "<host-install>/node_modules/@deepseek-ai/dsh/lib/bin.js"`。除非宿主确实装在本插件目录中，否则不要把这个路径指向插件目录。

### 验证完整路径

1. 打开设置 → 自定义模式，检查显示版本。页面能打开只是第一步。
2. 滚动到**页面底部的「新建助手」区**。已有内置 `custom` 助手时，该区位于编辑区之后。选择写作等起步设置，输入容易辨认的名称，再点「新增助手」；新建的助手会成为编辑对象。
3. 临时把提示词设为 `下一次就绪检查只回复 CUSTOM_MODE_READY。`，保存并等页面确认已应用。若提示文件已保存但应用失败，先点「重试生效」。
4. 新建一个**会话**，打开该会话的模式/助手选择器，明确选择刚才命名的助手。通过 DSH 中已经配置的模型发送 `就绪检查。`
5. 成功意味着助手可以选择、没有预设损坏告警，并返回预期就绪回复且不出现提示词组装错误。检查后恢复自己的提示词。失败时先看[当前自救步骤](docs/TROUBLESHOOTING.zh.md#当前自救步骤)。

## 使用截图

截图来自隔离DSH Web实例中的插件 `2.2.6`，助手内容均为合成数据。它们展示编辑页，不展示新增的更新控件。[截图来源与边界](docs/images/README.md)。

<table align="center">
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/05-assistant-manager.png" width="360" alt="新建助手"><br>新建助手</td>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/03-system-prompt.png" width="360" alt="系统提示词编辑区"><br>编辑系统提示词</td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/01-mode-switch.png" width="360" alt="基础模式选择"><br>选择基础模式</td>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/02-plugin-switches.png" width="360" alt="原生插件开关"><br>调整插件开关</td>
</tr>
</table>

[查看新会话的助手选择器](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/04-preset-picker.png)。

## 各项选择分别做什么

设置页选中的助手是**正在编辑的对象**。选中或新建它不会改变新会话使用的助手。首次激活时，插件可能把缺失的默认值补为内置 `custom`；已经存在的默认值保持不变。新建写作助手后，仍需在会话选择器中选它。

先选择新建时的起步设置；新助手以标准模式创建。创建后，可以在它的编辑区调整基础模式与各项插件开关。

| 起步设置 | 初始行为 |
| --- | --- |
| 开发 | 官方标准模式，工具按出厂设置。 |
| 写作 | 官方标准模式；终端关闭，文件工具开启。 |
| 聊天 | 官方标准模式；文件与终端关闭。 |

提示词保存在 `prompt.md`，下一步组装模型输入时会重读。历史与文件导入先载入草稿，保存才落盘。底层文件已变化时，过期保存会被拒绝。`custom_prompt` 写同一个文件前需要批准。关闭身份/persona 行也会关闭该提示词的注入。

<a id="plugin-updates"></a>

## 升级、clone 开发与卸载

页首显示**运行中的插件版本**。宿主提供DSH `0.2.2-alpha.2`的原生更新能力时，点「**检查更新**」让宿主查询可用版本。有推荐版本后，「**在插件管理中更新**」会打开官方插件详情，由它承接确认、进度与结果；自定义页不直接安装包。离开前先保存待处理草稿，并处理生效/读取告警。

`0.2.1-rc.2`、`0.2.1-rc.4`、`0.2.0-rc.2`和`0.1.7-rc.2`没有原生版本查询API，可用「**打开插件详情**」或「**更新指引**」，再按下方固定版本方式手动更新。文件、tarball与源码链接安装继续由原来源管理，不会因检查更新而悄悄转成npm。权限拒绝、网络失败、版本被筛除或结果不完整都不代表已是最新。「**磁盘安装版本**」与运行版本不同，不能据此认定新代码已运行。

通过Web宿主的原生插件页从2.2.6更新，或更新失败后恢复到2.2.6时，请重启该宿主一次，再核对运行版本与助手是否可用。旧版热停止可能留下助手注册记录。

手动更新注册表安装时，使用上面的固定版本npm命令并选择已发布版本，再重启宿主、核对运行版本。[GitHub Releases](https://github.com/BOWLUNA/dsh-custom-mode/releases)也提供插件`.tgz`、仅供预设导入的归档和`SHA256SUMS`。安装下载的归档前先核对散列；仅供预设导入的归档没有设置页。

该命令仅适用于Web/CLI。桌面用户必须使用应用实际提供的更新路径；应用没有更新入口时，不要改用Web CLI命令或手改桌面profile文件。

源码开发按[隔离准备步骤](CONTRIBUTING.zh.md#隔离开发)进行。可选的`./install.sh --profile web`保留源码链接方式，已有提示词、元数据和组成不被覆盖。本地包/代码回滚与恢复路径见[包与发布资产](docs/PUBLISHING.zh.md#包与发布资产)。

`./uninstall.sh` 移除插件但保留助手数据。`--purge` 明确删除受管助手目录及提示词，使用前请自行备份。

## 兼容与版本

声明的宿主范围：`>=0.1.5-rc.2 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0 || >=0.2.2-alpha.2 <0.3.0-0`

插件版本走独立的稳定 `x.y.z` 版本线，不镜像 DSH。2026-10-27 公开宿主标签为 `latest=0.2.1-rc.2`、`next=0.2.1-rc.4`、`alpha=0.2.2-alpha.2`。标签会移动，声明范围与已完成检查是两件事。实测范围见[精确版本、验收边界与历史证据](docs/CURRENT_COMPATIBILITY.zh.md)。

发布必须通过兼容性与浏览器工作流。单元、真实提示词组件、打包安装和浏览器检查分别覆盖不同边界。Windows/Electron、真实模型回复、GPU 执行都必须单独留证，不能从页面截图或单元计数推断。headless 不启动使用 agent preset 的会话。

## 插件市场

各目录的发现与审核规则不同。2026-10-09 的上架结果属于历史记录，不能据此保证今天每个市场都能搜索到。上面的固定版本安装仍是直接入口。[市场接口与限制](docs/MARKETPLACES.zh.md) 说明只读适配器；它不执行目录提供的 shell 命令，也不提交收录。

## 帮助与文档

- [故障排查](docs/TROUBLESHOOTING.zh.md) — 当前自救在前，历史故障在后。
- [报告故障](https://github.com/BOWLUNA/dsh-custom-mode/issues/new?template=bug_report.yml)或[建议功能](https://github.com/BOWLUNA/dsh-custom-mode/issues/new?template=feature_request.yml)。
- [安全报告](SECURITY.zh.md) — 仅公开请求私下渠道，不发布漏洞细节。
- [发布版本](https://github.com/BOWLUNA/dsh-custom-mode/releases)与[变更记录](CHANGELOG.zh.md)。
- [贡献指南](CONTRIBUTING.zh.md) — 隔离开发与检查。
- [架构](docs/ARCHITECTURE.zh.md) — 提示词读取与宿主耦合点。
- [发布](docs/PUBLISHING.zh.md) — 既有发布门禁与读回证据。
- [AGENTS.md](AGENTS.md) — 仓库代理约定。

## 许可证

[MIT](LICENSE)
