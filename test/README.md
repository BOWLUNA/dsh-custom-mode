# 测试

```sh
node test/run.mjs
```

一个入口跑五个套件，并自己解析「出厂 preset 目录」（本仓库里没有它，它来自已安装的
`@deepseek-ai/dsh-agent-presets`）：

```
出厂 preset 目录: /…/dsh-agent-presets/presets
（来源：$DSH_HOME/profiles/node_modules）
──────── composition.test.mjs ────────
… 结果: 63 通过, 0 失败
──────── prompt-reader.test.mjs ────────
… 结果: 15 通过, 0 失败
──────── prompt-tool.test.mjs ────────
… 结果: 37 通过, 0 失败
──────── meta.test.mjs ────────
… 结果: 45 通过, 0 失败
──────── locales.test.mjs ────────
… 结果: 65 通过, 0 失败
5 个套件全部通过（presets 来源：$DSH_HOME/profiles/node_modules）
```

合计 **225 项**。只有 `composition.test.mjs` 需要那个出厂目录，其余四个自带临时目录与桩，
可以直接单独跑。

解析链有三条，任一条命中即可：`DSH_SHIPPED_PRESETS_DIR` 环境变量 → 从本文件做 Node 解析
（CI 里 npm 装的 dsh 走这条）→ `$DSH_HOME/profiles/node_modules`（本机装了 dsh 走这条）。
三条全断时它会打印**试过哪些路**，而不是丢一个 `ENOENT`。手工指定：

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
