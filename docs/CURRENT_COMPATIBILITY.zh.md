# 当前兼容性检查

[English](CURRENT_COMPATIBILITY.md) | 中文

2026-10-09，使用以下精确官方 npm 宿主测试了 `2.2.3` 候选。默认通道仍为候选版，不宣称 DSH 已有正式稳定版。

| 宿主 | 打包和单元检查 | 真实浏览器检查 | 运行检查 |
| --- | --- | --- | --- |
| `0.2.0-rc.2`（`latest` / `next`） | 15 个套件、934 项检查；打包和启动通过 | 74 项通过；模式选择器通过 | 20 项通过 |
| `0.2.1-alpha.2`（`alpha`） | 15 个套件、934 项检查；打包和启动通过 | 74 项通过；模式选择器通过 | 20 项通过 |

这些是在独立测试 home 中的真实 Windows Web-profile 安装，复用此前已有宿主。修订后的 UI 使用原生 Input、Button 组件和 Menu 浮层；文档输入沿用原生 InlineEditor 的表面与字体。浏览器检查把控件外观与原生默认值直接比较。两个通道的截图都已查看。运行检查覆盖认证路由、全部五档基础模式、保存、重复安装、移除、重装、数据保留和真实删除助手。测试正文是普通样本，没有调用模型。

VMware/Electron 桌面端、指定 Linux 服务器、第三方市场 UI 安装及历史加载性能是独立检查，仍未验证。候选尚未发布到 npm；发布审查完成前保留草稿 PR。

复现时使用已有精确宿主及源码树之外的新证据目录：

```sh
node tools/compat-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --port 32110
node tools/runtime-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --browser /path/to/chrome --port 32110 --cdp-port 9229
```

工具使用独立测试 home、普通样本和隐藏凭据的日志。不要针对用户活动中的 profile 运行，也不要把凭据、提示词或历史复制到测试证据里。
