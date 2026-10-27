# 贡献指南

[English](CONTRIBUTING.md) | 中文

`dsh-custom-mode` 是 DeepSeek Harness 的助手预设与设置页插件。仓库根就是包，`preset/` 是唯一预设真源；运行时继续使用普通 ES modules，无构建步骤，不增加运行时依赖。

## 报告可复现的故障

先看[当前自救步骤](docs/TROUBLESHOOTING.zh.md#当前自救步骤)。记录精确宿主/插件版本、平台、安装路径和失败步骤。页面打开、保存成功、模型请求成功是不同观察。使用合成提示词，并脱敏 token 地址、凭据与私人历史。

## 隔离开发

完整宿主/集成检查使用 Node 24，clone 安装器另需 git、npm 和 Bash。包的 Node 20 声明针对本身代码，已安装的宿主依赖可能要求更新运行时。按 [CURRENT_COMPATIBILITY.zh.md](docs/CURRENT_COMPATIBILITY.zh.md) 选择精确已验收宿主，插件与宿主版本号不必相同。

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
node test/run.mjs
node test/install-script.test.mjs
```

测试入口需要精确宿主的出厂声明，解析不到会说明原因。测试使用合成临时路径。宿主依赖装入任务专用 prefix，不改正在运行的宿主、封存 node_modules 或全局包。如果源码树依赖链接必须保持原样，在不可手改的候选快照中创建新依赖链接后测试，源工作树仍是唯一可编辑真源。

只对可丢弃的本地 Web home 执行：

```sh
DSH_HOME=/tmp/dsh-dev ./install.sh --profile web
DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open
```

选择空闲端口，只停止自己启动的进程。clone 安装器用 npm 离线打包/校验本地归档，保留用户文件与已验证的回滚证据，不下载更新的版本充当回滚包。成功安装保留源码链接，客户端可使用宿主 HMR；改宿主模块后重启那个隔离实例。桌面 profile 使用桌面应用自己的插件管理器。

## 发布前所需证据

```sh
node test/run.mjs
node tools/verify-version-consistency.mjs
node tools/verify-translation-pairing.mjs
node tools/verify-doc-numbers.mjs
node tools/verify-browser-literals.mjs
npm pack --dry-run --ignore-scripts --json
```

新增套件必须登记到 `test/run.mjs`，文档数字以真实集成运行更新。按精确受支持宿主 API 检查实际提示词组装，覆盖旧用户提示词和自定义 suffix。复现修复的失败路径，不只断言新实现长什么样。

真实 UI 改动需要对隔离精确宿主运行现有浏览器验证，以官方设置控件作参照。打包安装、预设选择、保存/应用、重启、卸载重装和首次请求边界各有证据。组件测试不代表桌面验收；复现入口与待检项见 [CURRENT_COMPATIBILITY.zh.md](docs/CURRENT_COMPATIBILITY.zh.md)。

## 不可破坏的约束

- 未动过的组成行逐字保留，包括平台条件和出厂禁用态，不把文件做 YAML 往返重写。
- 保留三态开关：未动过、显式开启、显式关闭。
- 路由注册到宿主受鉴权的共享 `/api` 通道，保留载体的 Host/Origin/认证围栏。
- 可选宿主服务在作用域注入内等待，缺少 Web 服务不能卡住整行插件。
- 页面/工具的提示词校验器、浏览器/宿主的词典保持一致。
- 提示词、元数据与组成属于用户数据，受管代码分开刷新，测试只用临时 fixture。
- 保留恢复证据，在发现助手前恢复；进程终止检查不能证明物理断电耐久性。
- 持久化修改与注册表同步串行，区分已保存未应用与完整成功，重试同步不重放变更操作。
- 使用官方原生 UI 控件与实测默认度量，不重涂禁用态、间距或字体另造一套控件。

## 两种语言权威相同

两侧文档同时编辑后，再更新配对记录：

```sh
node tools/verify-translation-pairing.mjs --write
node tools/verify-translation-pairing.mjs
```

配对哈希发现漂移，结构和语言检查发现缺节。重录哈希不能代替阅读两种文本。

## 版本与发布

每次发布使用新的裸 `x.y.z` 插件版本。宿主兼容性在 `engines.dsh` 与可选 peer 范围中声明，精确 CI 钉定必须满足两者。新 dist-tag 是调查线索，不是自动支持。按 [PUBLISHING.zh.md](docs/PUBLISHING.zh.md) 沿用既有门禁，独立审阅、远端完整 SHA 读回与分发核验分别留证；不要顺手修改发布权限或合并默认分支。

## 风格

- 普通 JavaScript ES modules，本轮修复不引入 bundler、TypeScript 迁移或新运行时依赖。
- 解释约束为什么存在，宿主行为声明有精确源码与实测输出。
- 测试绑定用户可见行为与失败恢复，使用合成数据并准确说明覆盖边界。
