# 测试

```sh
node test/run.mjs
```

一个入口跑两个套件，并自己解析「出厂 preset 目录」（本仓库里没有它，它来自已安装的
`@deepseek-ai/dsh-agent-presets`）：

```
出厂 preset 目录: /…/dsh-agent-presets/presets
（来源：$DSH_HOME/profiles/node_modules）
──────── composition.test.mjs ────────
… 结果: 63 通过, 0 失败
──────── locales.test.mjs ────────
… 结果: 65 通过, 0 失败
```

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
