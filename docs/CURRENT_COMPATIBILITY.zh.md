# 当前兼容性检查

[English](CURRENT_COMPATIBILITY.md) | 中文

2026-10-09，使用以下精确官方 npm 宿主测试了 `2.2.3` 候选。默认通道仍为候选版，不宣称 DSH 已有正式稳定版。

| 宿主 | 打包和单元检查 | 真实浏览器检查 | 运行检查 |
| --- | --- | --- | --- |
| `0.2.0-rc.2`（`latest` / `next`） | 15 个套件、934 项检查；打包和启动通过 | 74 项通过；模式选择器通过 | 20 项通过 |
| `0.2.1-alpha.2`（`alpha`） | 15 个套件、934 项检查；打包和启动通过 | 74 项通过；模式选择器通过 | 20 项通过 |

这些是在独立测试 home 中的真实 Windows Web-profile 安装，复用此前已有宿主。修订后的 UI 使用原生 Input、Button 组件和 Menu 浮层；文档输入沿用原生 InlineEditor 的表面与字体。浏览器检查把控件外观与原生默认值直接比较。两个通道的截图都已查看。运行检查覆盖认证路由、全部五档基础模式、保存、重复安装、移除、重装、数据保留和真实删除助手。测试正文是普通样本，没有调用模型。

dshmarket 和 DSH Plugin Hub 的真实市场 UI 来源安装现已通过；Store 受上游条目筛选阻塞（见[市场 UI 结果](MARKETPLACES.zh.md)）。VMware/Electron 桌面、指定 Linux 服务器和历史加载性能仍是独立且未验收的覆盖。本包明确面向 Web profile；当前 npm 发布工作流并未将桌面或虚拟机覆盖设为门槛。

## 发布就绪情况

Web 包在两个精确宿主通道的技术检查均通过。发布工作流要求可复用兼容性和浏览器作业全部通过、标签与包版本完全一致，以及现有 npm 发布身份。npm 发布管道现已启用 `pipefail`，避免 `tee` 掩盖 E403 或 OTP 失败；通过模拟验证了 E403、OTP、成功和已发布版本冲突的结果，没有写入 registry。

最近成功的 `2.2.2` 发布使用现有 `NPM_TOKEN` secret，身份检查返回发布者 `bowluna`；历史成功不代表凭据当前仍有效或具备写权限。在候选分支手动运行 `workflow_dispatch` 会重跑发布门槛并核对现有 token 身份，但不会发布。缺少 token 时则走工作流的 OIDC 分支，需要 npm 已配置的可信发布者；空操作的身份步骤不能证明该配置有效。

发布审核前保留草稿 PR #13 和 npm `latest` 的 `2.2.2`。最短发布路径是检查现有身份，在最终已验证提交上完成接受的合并和标签，然后运行标签触发的现有工作流。发布后核对 registry 产物和 `latest`，并用全新缓存安装精确版本。若需要 npm OTP 或批准，必须由人完成，不创建新凭据或持久权限。

复现时使用已有精确宿主及源码树之外的新证据目录：

```sh
node tools/compat-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --port 32110
node tools/runtime-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --browser /path/to/chrome --port 32110 --cdp-port 9229
```

工具使用独立测试 home、普通样本和隐藏凭据的日志。不要针对用户活动中的 profile 运行，也不要把凭据、提示词或历史复制到测试证据里。
