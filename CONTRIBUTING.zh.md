# 参与贡献

[English](CONTRIBUTING.md) | 中文

感谢你愿意为 `dsh-custom-mode` 出力 —— 这是给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
用的一个**自定义模式**（agent preset），外加编辑它系统提示词的设置页插件。

这个项目很小，而且**刻意不引入构建步骤、不引入依赖**：浏览器半是手写的 bundle，其余都是普通的
Node ES 模块。保持这样是设计的一部分，不是巧合。

## 提 issue 之前

这里的大多数失败都是**静默**的 —— 模式就是不出现，或者保存了没生效。先看
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)：里面记的都是真机上复现过的失败，每条都有
症状、原因和出路。然后请用 issue 模板，它要的那两项信息正好区分"装上了但没生效"和"根本没装上"。

## 不写代码也能帮上忙

- 按模板要求的复现步骤报 bug。
- 告诉我们你的 DSH 版本。本插件与所适配的那个 DSH 版本绑定，所以"你用的是哪个 DSH"是任何报告的
  第一个问题。
- 如果你自己做了 DSH 插件，给仓库加上 [`dsh-plugin` 话题](https://github.com/topics/dsh-plugin)
  —— 插件就是靠它被找到的。

## 开发循环

前提：Node.js ≥ 20、`git`，以及与 `editor/package.json` 同版本的 `dsh`
（当前 `0.1.6-alpha.1`；版本不一致先看 README 的「耦合点清单」）。

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
node test/run.mjs          # 七个套件共 301 项；它会自己解析出厂 preset 目录
```

想对着真实 harness 试，请装进一个**一次性**的 `DSH_HOME`，别碰你自己的安装：

```sh
DSH_HOME=/tmp/dsh-dev ./install.sh
DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open     # 打开它打印的那个 URL
```

改 `editor/client.js` 会被客户端 HMR 在约 1 秒后接上 —— 不用重启、不用刷新。改宿主半
（`index.mjs`、`composition.mjs`、`meta.mjs`、`paths.mjs`）才需要重启。

截图是**跑出来的**，不是拍出来的：`tools/screenshots/` 用 CDP 驱动真实实例。请用它，不要手工改图。

## 不能被破坏的东西

下面这些就是测试和文档存在的理由，每一条都曾经是真 bug：

- **没碰过的行必须逐字节不变。** 编译器用文本手术改写出厂组合；用户没动过的行必须保留它的
  `!!js` 平台条件与出厂 `disabled` 状态。走一遍 YAML 解析再序列化会静默改变平台行为。
- **开关是三态的**，不是布尔：未触碰 / 显式开启 / 显式关闭。
- **设置页路由先过平台自己的检查。** 它注册在裸 `webServer` 表上，那是在浏览器信任栅栏**之外**；
  `ctx.connection.requestRejection(req)` 才是把它放回栅栏内的东西，而且该服务缺失时必须
  **失败关闭**。
- **插件行在任何 profile 都要能激活。** 等服务的写法属于作用域化的 `ctx.inject`，不能写进行级
  `inject` —— 否则没有 web 服务器的 profile 会打印出与"安装损坏"完全相同的那行警告。
- **两份 `{{…}}` 校验必须同步**（`editor/index.mjs` 与 `preset/prompt-tool.mjs`）。它们是有意重复的；
  一旦分叉，就意味着一处写入路径会接受渲染器会抛错的写法，也就是那个模式每个请求都失败。
- **`client.js` 里的词典副本必须与 `locales.mjs` 同步。** 浏览器半无法 import 它，所以有测试把两份
  抽出来逐条比对。
- **`preset/prompt.md` 是用户数据。** 测试必须写到临时路径，绝不能碰仓库里那一份。

## 两种语言权威相同

`README.md` 与 `CONTRIBUTING.md` 是英文；`README.zh.md` 与 `CONTRIBUTING.zh.md` 是中文。
两侧同等重要，所以配对关系是**被记录、被校验**的：

```sh
node tools/verify-translation-pairing.mjs           # CI 跑的就是它
node tools/verify-translation-pairing.mjs --write   # 两侧都跟上之后再重新记录
```

改了一侧忘了另一侧，CI 会直接说。只有在两侧确实说了同一件事之后才重新记录。

## 版本号

版本号镜像**本插件所适配的那个 DSH 版本**，不按改动次数递增：修复、测试、文档都累积在同一个版本号
下，直到官方发布新的 DSH 且本插件重新适配。见 README 的「版本策略与兼容性」。

## 风格

- 普通 JavaScript ES 模块 —— 不要 TypeScript、不要打包器、不要新增依赖。
- 注释解释**为什么**；实测事实胜过意见：如果你写"dsh 的行为是这样"，请说明你是怎么验的。
  这类证据放在 `docs/MEASUREMENTS.md`。
- 测试断言要精确。一个因为错误原因而通过的宽松正则比没有测试更糟 —— 本仓库里就有两个测试第一版
  写错了、后来才修正。
