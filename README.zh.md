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
dsh plugin --profile web add dsh-custom-mode@2.2.3
```

重启为这个 profile 提供服务的进程。设置页上的版本号才是正在运行的版本。

桌面端从应用里的插件页安装。CLI 不能改 `profiles/desktop`。

在 Windows 上，`install.sh` 是 bash，而且 PATH 里要有 `dsh`。否则用 DeepSeek Harness 自带的 `dsh`，或 `node node_modules/@deepseek-ai/dsh/lib/bin.js`。

## 使用

1. 打开设置 → 自定义模式。
2. 改系统提示词。保存按钮在编辑器下面。
3. `settings.yaml` 里还没有 `agent-presets.default` 时，新会话用这个助手。已经写过的值保持原样。`agent-presets` 使用行内对象、标量或别名时也原样保留，不向里面插入 YAML。

提示词是 `prompt.md`。下一步组装模型输入时会重读这个文件。历史可以把旧稿载入编辑器；载入不落盘。打开页面之后文件被改过时，这一次保存会被拒绝。模型要改同一份文件，只能走 `custom_prompt`，并且先问过你。

页面分成两支。当前助手改的是已经打开的这一位，基础模式五档都可以点。新建助手只在点「新增助手」时写入：开发、写作、聊天可以点，工具底只有官方标准模式是亮的。其余四档是暗的，在这一支里点不了。

| 姿态 | 新建之后 |
| --- | --- |
| 开发 | 官方标准模式，工具按出厂。 |
| 写作 | 官方标准模式。终端关，文件工具开。 |
| 聊天 | 官方标准模式。文件和终端关。 |

## 边界

- 不替换标准、PTC、极简、创造。
- 不附带角色扮演预设。
- 不用 CLI 改桌面端 profile。headless 不会启动使用 agent preset 的会话。

## 兼容

声明范围：`>=0.1.5-rc.2 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0`

2026-10-09 实时核对 npm：`latest` 和 `next` 仍是 `0.2.0-rc.2`，`alpha` 是当天发布的 `0.2.1-alpha.2`。上游尚未发布去掉预发布后缀的正式稳定版。

| dsh | 通道 | 2.2.3 核对 |
| --- | --- | --- |
| `0.2.0-rc.2` | npm `latest` / `next` | 精确 npm 宿主、打包加载、API 生命周期、Windows web profile 设置页与选择器 |
| `0.2.1-alpha.2` | npm `alpha` | 同一套隔离检查，读取该宿主自己的预设声明 |
| `0.1.7-rc.2` | 先前声明支持的版本 | 保留在 CI 回归矩阵里 |

发布必须等待单元、启动和浏览器工作流通过。已有精确版本的宿主安装时，可以这样复现：

```sh
node tools/compat-check.mjs --host-install /path/to/host --out /tmp/custom-mode-check
node tools/runtime-check.mjs --host-install /path/to/host --out /tmp/custom-mode-check --browser /path/to/chrome
```

两项工具只使用新生成的 home 和普通 mock 提示词。运行检查覆盖全部五档基础模式、重复保存、卸载、重装、用户数据保留与重复安装，不需要调用模型。不宣称 VMware 或原生 Linux 桌面已通过验收。

## 插件市场

`dshmarket`、DSH Plugin Hub（`dsh-plugin`）和 DSH Plugin Store（`dshmarketplace-plugin`）使用不同目录，但安装的是同一个 profile bundle。根 npm 清单提供 `dsh.bundle.patch`、浏览器导出、公开仓库和一致的兼容范围，不需要额外的运行时适配器或构建脚本。

运行 `node tools/market-check.mjs --out /tmp/custom-mode-markets.json` 检查它们的公开发现数据。目录不可访问、条目未审核或数据过期都会明确报告。工具不执行目录提供的 shell 命令，也不提交收录。[市场接口与限制](docs/MARKETPLACES.zh.md)。

## 文档

- [docs/TROUBLESHOOTING.zh.md](docs/TROUBLESHOOTING.zh.md) — 装到旧版、基础模式不可用、升级停在半截
- [docs/ARCHITECTURE.zh.md](docs/ARCHITECTURE.zh.md) — 提示词在哪被读，依赖宿主的哪些调用
- [docs/PUBLISHING.zh.md](docs/PUBLISHING.zh.md) — tag 与发布
- [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md) — 给人看
- [AGENTS.md](AGENTS.md) — 给 agent 看

## 许可证

MIT
