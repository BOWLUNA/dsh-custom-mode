# 贡献指南

[English](CONTRIBUTING.md) | 中文

`dsh-custom-mode` 是 DeepSeek Harness 的助手预设与设置页插件。仓库根就是包，`preset/` 是唯一预设真源；运行时继续使用普通 ES modules，无构建步骤，不增加运行时依赖。

## 报告可复现的故障

先看[当前自救步骤](docs/TROUBLESHOOTING.zh.md#当前自救步骤)，再使用[故障表单](https://github.com/BOWLUNA/dsh-custom-mode/issues/new?template=bug_report.yml)。记录精确宿主/插件版本、平台、安装来源和失败步骤。页面打开、保存成功、模型请求成功是不同观察。使用合成提示词，并脱敏token地址、凭据与私人历史。安全问题按[SECURITY.zh.md](SECURITY.zh.md)处理，不公开漏洞细节。

## 隔离开发

完整宿主/集成检查使用Node 24，安装器测试另需git、npm和Bash。alpha宿主要求Node >=24.9。包的Node 20声明针对本身代码，宿主依赖可能要求更新运行时。按[CURRENT_COMPATIBILITY.zh.md](docs/CURRENT_COMPATIBILITY.zh.md)选择精确宿主，插件与宿主版本号不必相同。

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
```

在clone目录之外建立新工作区。Unix使用Bash：

```sh
DSH_CHECK_ROOT="$(mktemp -d)"
DSH_HOST_DIR="$DSH_CHECK_ROOT/host"
mkdir -p "$DSH_HOST_DIR"
printf '{"private":true}\n' > "$DSH_HOST_DIR/package.json"
```

Windows使用PowerShell时，改用下列准备步骤；安装器测试仍需安装Git Bash：

```powershell
$DSH_CHECK_ROOT = Join-Path ([IO.Path]::GetTempPath()) ('dsh-custom-dev-' + [guid]::NewGuid().ToString('N'))
$DSH_HOST_DIR = Join-Path $DSH_CHECK_ROOT 'host'
New-Item -ItemType Directory -Path $DSH_HOST_DIR | Out-Null
'{"private":true}' | Set-Content -LiteralPath "$DSH_HOST_DIR/package.json" -Encoding utf8
```

回到clone根目录，下面命令适用于上述两种准备方式。精确rc.2宿主来自现有兼容记录，仅作为示例：

```sh
npm install --prefix "$DSH_HOST_DIR" --cache "$DSH_CHECK_ROOT/npm-cache" --ignore-scripts --save-exact --no-audit --no-fund @deepseek-ai/dsh@0.2.1-rc.2
node -p "require(process.argv[1]).version" "$DSH_HOST_DIR/node_modules/@deepseek-ai/dsh/package.json"
node tools/prompt-contract-check.mjs --host-install "$DSH_HOST_DIR"
node tools/compat-check.mjs --host-install "$DSH_HOST_DIR" --out "$DSH_CHECK_ROOT/check-01" --port 32110
```

核对版本读回为`0.2.1-rc.2`。组件检查不启动模型或服务。兼容检查把源码复制到`--out/candidate`，将该候选链接到指定宿主依赖，并使用独立的合成`DSH_HOME`；它运行单元/守卫/包检查及本机回环启动检查，端口需空闲。结果保存在`check-01/report.json`及日志中。每个源码快照使用新的`--out`，不手改生成副本。

不要把`--host-install`指向使用中的安装、封存依赖树或全局包：单元入口会在该宿主node_modules下派生fixture文件。审阅证据时保留新工作区，其中是测试数据，不是真实用户home。纯文档改动先做翻译、链接和diff检查，无需先启动宿主。

可选的源码链接UI迭代使用`./install.sh --profile web`，要求精确宿主CLI在PATH中并指定可丢弃的`DSH_HOME`。[包与回滚行为](docs/PUBLISHING.zh.md#包与发布资产)有具体说明。只使用自己创建的进程与测试home；桌面profile仍由桌面应用管理。

## 发布前所需证据

以下既有门禁在准备好的候选中运行，依赖来自任务专用宿主。runtime/UI改动需要对应行为检查；纯文档PR应准确记录已检查项与不适用项，不声称完成全套运行验证。

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

更新相关改动应按实际原生能力验证，不能只看宿主版本字符串。在新的隔离profile与合成回环注册表中，检查主动查询、独立的读取/更新权限、原安装来源、草稿保护导航和官方Plugins确认/结果承接。旧宿主的详情/手动指引降级单独验证。合成注册表结果与公开注册表或桌面验收分开；不要在承载当前工作的宿主里试自身更新。

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

在可编辑源码树中同时修改两侧文档后，再更新配对记录：

```sh
node tools/verify-translation-pairing.mjs --write
node tools/verify-translation-pairing.mjs
```

配对哈希发现漂移，结构和语言检查发现缺节。重录哈希不能代替阅读两种文本。

## 版本与发布

每次发布使用新的裸 `x.y.z` 插件版本。宿主兼容性在 `engines.dsh` 与可选 peer 范围中声明，精确 CI 钉定必须满足两者。新 dist-tag 是调查线索，不是自动支持。按 [PUBLISHING.zh.md](docs/PUBLISHING.zh.md) 沿用既有门禁，独立审阅、远端完整 SHA 读回与分发核验分别留证；不要顺手修改发布权限或合并默认分支。

## 风格

- 使用普通JavaScript ES modules，避免无关bundler、语言迁移或运行时依赖。
- 解释约束为什么存在，宿主行为声明有精确源码与实测输出。
- 测试绑定用户可见行为与失败恢复，使用合成数据并准确说明覆盖边界。
