# AGENTS.md

给在这个仓库里工作的编码智能体的说明。人看的版本见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 这是什么

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）用的「自定义模式」。
它刻意是**两个产物**，因为能挂载它们的平面不同（原因见 `docs/ARCHITECTURE.md` §1）：

| 产物 | 是什么 | 装在哪 |
| --- | --- | --- |
| `preset/` | agent preset（**文件目录**，不是 npm 包） | `$DSH_HOME/.agent-presets/custom/` |
| `editor/` | 设置页插件（npm 包 + profile bundle） | `dsh plugin --profile web add ./editor` |

## 常用命令

```sh
node test/run.mjs                                  # 七个套件 301 项；自己解析出厂 preset 目录
node tools/verify-translation-pairing.mjs          # 双语配对一致性（CI 跑的就是它）
bash -n install.sh && bash -n uninstall.sh         # 两个脚本的语法

# 对着真实 harness 试：一定用一次性 DSH_HOME，别碰在用的那份
DSH_HOME=/tmp/dsh-dev ./install.sh
DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open
DSH_HOME=/tmp/dsh-dev dsh --profile web --dump-config | wc -l      # 上百行 = 健康

# 截图（真的会点、会保存、会切主题与语言），见 tools/screenshots/README.md
DSH_HOME=/tmp/dsh-dev ./tools/screenshots/run-shots.sh "http://127.0.0.1:3081/?token=…" docs/images
```

## 不能破坏的东西

1. **未触碰的行逐字节不变**（保留 `!!js` 平台条件与出厂 `disabled`）。`composition.mjs` 做的是
   文本手术，不是 YAML 往返 —— 别把它"简化"成解析再序列化。
2. **开关是三态**：未触碰 / 显式开 / 显式关。`undefined` 与 `false` 是两件事。
3. **设置页路由必须先过 `ctx.connection.requestRejection(req)`**，且该服务缺失时**失败关闭**。
   裸 `webServer` 注册在平台信任栅栏之外（实测：未授权可读走提示词、可改写 `prompt.md`）。
4. **等服务的写法属于作用域化 `ctx.inject(deps, cb)`**，不能写进行级 `inject`：否则没有
   `webServer` 的 profile（如 tui）会打印与"安装损坏"一字不差的 `pending` 警告。
5. **两份 `{{…}}` 校验同步**（`editor/index.mjs` ↔ `preset/prompt-tool.mjs`），有测试比对判定。
6. **`client.js` 的词典与 `locales.mjs` 同步**，有测试抽取比对。
7. **`preset/prompt.md` 与 `preset/preset.yml` 是用户数据。** 测试要写到临时目录
   （`DSH_CUSTOM_PROMPT_PATH`，或把模块复制到临时目录再 import）。
8. **版本号只跟随 DSH**：小改动不提版本，只有官方发新版并重新适配才换。

## 已知的坑（都实测过）

- `agent-presets` **只存在于 web 组合**；tui/headless 里没有，所以那里「自定义模式」选不到。
- `dsh --profile headless` 明确拒绝运行带 preset 的会话（`the one-shot runner does not compose`），
  端到端验证只能走 web 实例。
- `agent-presets.default` 在组合里写死为 `standard`，`settings.yaml` 的同名键是**运行时覆盖**。
- pnpm 可能把插件软链留在 `node_modules`（`uninstall.sh` 已专门清理）。
- WSL 下若 PATH 里是 Windows 版 pnpm，`dsh plugin add` 会以 `current dir is an absolute path with
  drive letter` panic；用 Linux 版（`corepack enable pnpm`）。

## 判断"做完没有"

- 改代码：`node test/run.mjs` 全绿；改了文档：`node tools/verify-translation-pairing.mjs` 通过
  （两侧都要改，然后 `--write` 重新记录）。
- 改行为：在一次性 `DSH_HOME` 里真跑一遍，并把观察到的输出写进 `docs/MEASUREMENTS.md` ——
  这个仓库的传统是**结论带命令与原始输出**，不是"应该没问题"。
