# 测试

[English](README.md) | 中文

```sh
node test/run.mjs
```

一个入口跑八个套件，并自己解析「出厂 preset 目录」（本仓库里没有它，它来自已安装的
`@deepseek-ai/dsh-agent-presets`）：

```
Shipped presets directory: /…/dsh-agent-presets/presets
(source: $DSH_HOME/profiles/node_modules)
──────── composition.test.mjs ────────
… result: N passed, 0 failed
… one such block per suite …
all 15 suites passed (presets source: $DSH_HOME/profiles/node_modules)
```

合计 **797 项**。只有 `composition.test.mjs` 需要那个出厂目录，其余十四个自带夹具、临时目录与桩，
可以直接单独跑。

解析链有四条，任一条命中即可：`DSH_SHIPPED_PRESETS_DIR` 环境变量 → 从本文件做 Node 解析
（CI 里 npm 装的 dsh 走这条）→ `$DSH_HOME/profiles/node_modules`（本机装了 dsh 走这条）→
**从宿主声明派生**（0.1.7 起不再有复数 presets 包，于是用与产品同一条代码从
`dsh-web-app/presets/<mode>.patch.yml` 抽出声明，落到仓库根的 `node_modules` 下）。
四条全断时它会打印**试过哪些路**，而不是丢一个 `ENOENT`。手工指定：

```sh
DSH_SHIPPED_PRESETS_DIR=/path/to/dsh-agent-presets/presets node test/run.mjs
```

也可以单独跑某一个：

```sh
node test/composition.test.mjs   # 需要上面那个目录能解析到
node test/locales.test.mjs       # 不需要出厂 preset，纯词典/文案
node test/prompt-reader.test.mjs # 不需要 dsh：驱动 persona section 的 text provider
node test/prompt-tool.test.mjs   # 不需要 dsh：把工具模块复制到临时目录再 import
node test/meta.test.mjs          # 不需要 dsh：用 DSH_CUSTOM_PROMPT_PATH 重定向写入位置
node test/composition-edge.test.mjs  # 不需要 dsh：出厂 preset 用自己搭的夹具
node test/editor-route.test.mjs      # 不需要 dsh：桩出 ctx / req / res，驱动真实 handler
node test/seed.test.mjs              # 不需要 dsh：自己搭源目录与目标目录
```

CI（`.github/workflows/test.yml`）在每次 push 时 `npm install @deepseek-ai/dsh@<适配版本>`，
再跑 `node test/run.mjs` —— 测的是**真实的出厂文本**，不是自造的 fixture。

## 这些测试在防什么

`composition.mjs` 做的是**文本手术**（保留出厂注释与 `!!js` 表达式），所以它的失败模式
大多是**静默错误行为**，而不是抛错。测试针对的正是这类：

- **未触碰的行必须逐字节不变**——否则会丢掉平台条件、或把出厂默认关闭的行打开。
- **`disabled` 必须定位到本行缩进**——否则关闭分组会改成子行的键，完全没有效果。
- **重新拼接必须无损**——否则注释行会与 YAML 键粘在一起，生成损坏的配置。
- **空区间必须返回空串**——否则每个分组首行前会多一个空行。

历史上这五个 bug 都真实出现过，测试是在它们出现之后补的。

`locales.test.mjs` 另外防一类**最难发现**的漂移：`editor/locales.mjs` 是文案的单一事实来源，
但浏览器半不能 import 它（手写 bundle、没有打包器），所以 `client.js` 里是**手抄的一份副本**。
它现在会从 `client.js` 里把两份字典抽出来跟 `locales.mjs` 逐条比对 —— 只改一边会在 CI 直接失败，
而不是等某个语言的用户看到旧文案。

`prompt-tool.test.mjs` 与 `meta.test.mjs` 补的是**文档声称有、实际没有**的两块：
`custom_prompt` 工具（无浏览器时的编辑通道）此前一个测试都没有；README 写着 `preset.yml`
「有往返测试」，但没有任何测试 import 过 `meta.mjs`。两份测试都把自己的写入位置重定向到临时目录
（一个靠「把模块复制过去再 import」，一个靠 `DSH_CUSTOM_PROMPT_PATH`），所以永远不会碰仓库里的
`preset/prompt.md` 与 `preset/preset.yml`。

`prompt-tool.test.mjs` 还带一条**漂移守卫**：`{{变量}}` 的校验逻辑在 `editor/index.mjs`（设置页写入
路径）与 `preset/prompt-tool.mjs`（工具写入路径）里各有一份，是有意重复的。它会从后者源码里把
函数抽出来，对同一张输入表比对两者的判定——判定分叉意味着一条路径会接受渲染器会抛错的写法，
也就是那个模式每个请求都失败。这和 `client.js` 的词典漂移是同一类风险，只是后果更重。

`editor-route.test.mjs` 是这套测试里最该存在的一个：它覆盖的 `editor/index.mjs` 正是安全修复所在的
那半边，而它此前**一个测试都没有**（修复当时是用 curl 手工验的）。手工验证证明"那一刻是对的"，
挡不住以后有人把栅栏挪到方法分发之后、或忘记失败关闭。它用桩出的 `ctx`/`req`/`res` 驱动真实的
handler，断言的第一条就是**被拒的请求不能产生任何副作用**（401 的 POST 不得改写文件）。

`composition-edge.test.mjs` 用自己搭的出厂夹具，覆盖出厂文件今天没有、但手工编辑或未来版本可能
出现的输入。其中两条断言容易被想当然地写反，值得单独记下来：

- **未触碰的行连 `\r` 一起保留**（与"逐字节不变"是同一件事），因此输出**不保证全是 LF**——
  输入是 CRLF 时输出是混合行尾；
- **"显式打开一个在本平台本来就启用的行"是无操作**，反推开关时不该记成 override ——
  这是三态语义的必然结果，不是缺陷。

`seed.test.mjs` 覆盖一键安装所依赖的 preset 播种：市场装插件只有一条命令，而那条命令能带上的只有
npm 包。它断言缺失的文件会被补上、已存在的 `prompt.md` 与设置页生成过的 `agent.cordis.yml` **绝不**
被覆盖、第二次激活不写任何东西、不可写的 home 只报告不抛异常；并且——因为包里必然存在第二份预设——
`editor/preset/` 必须与 `preset/` 逐字节一致。
