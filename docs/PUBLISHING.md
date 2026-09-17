# 发布与分发

这个项目有**两个产物**，分发方式不同（原因见 [`ARCHITECTURE.md`](ARCHITECTURE.md)）：

| 产物 | 类型 | 分发方式 |
|---|---|---|
| `preset/` | agent preset（**文件目录**） | 复制到 `$DSH_HOME/.agent-presets/<id>/` |
| `editor/` | profile bundle 插件（**npm 包**） | `dsh plugin --profile <p> add <包名或路径>` |

agent preset **不是** npm 包，别指望 `npm install` 能装它——`dsh` 是从磁盘目录发现的。

## 方案一：GitHub 仓库（最省事，推荐先用这个）

别人：

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
./install.sh
```

脚本会复制 preset 并调用 `dsh plugin add ./editor`（本地路径安装，pnpm 会 link）。

## 方案二：发布 editor 到 npm

preset 仍然走 clone，editor 可以单独发 npm：

```sh
cd editor
npm publish --access public
```

别人：

```sh
dsh plugin --profile web add dsh-custom-prompt-editor
```

前提是 editor 已发布且包名未被占用。

### 发布前的自查清单

- [ ] `lib/` 或源码**随包提交**，安装时不需要构建脚本。
      否则 pnpm 的 `allowBuilds` 会拦住用户（`dsh` 自己会提示，但体验很差）。
- [ ] `dsh.bundle.patch` 指向的补丁文件在 `files` 里没被漏掉。
- [ ] `dsh.client.platform` 是 `"web"`。
- [ ] `exports["./client"]` 指向浏览器半。
- [ ] `private` 字段删掉（`editor/package.json` 里现在是 `true`，那是本地开发用的）。

`files` 白名单已经写好了，而且这件事**不能靠肉眼核对**——最容易踩的坑是"少打了文件"，
而那要等到有人装完才发现。CI（`.github/workflows/test.yml`）里有一条对着真实 packlist 的断言，
本地也可以随时跑同一件事：

```sh
cd editor
npm pack --dry-run --json | node -e '
  const files = JSON.parse(require("fs").readFileSync(0, "utf8"))[0].files.map((f) => f.path);
  const need = ["index.mjs", "client.js", "composition.mjs", "meta.mjs", "paths.mjs", "cordis.patch.yml", "package.json"];
  const missing = need.filter((name) => !files.includes(name));
  console.log(files.join(", "));
  if (missing.length > 0) { console.error("缺:", missing); process.exit(1); }
'
```

当前应输出（`locales.mjs` 是文档里那份"单一事实来源"，随包发出以免读者找不到它）：

```
client.js, composition.mjs, cordis.patch.yml, index.mjs, locales.mjs, meta.mjs, package.json, paths.mjs
```

### 三条硬经验（踩过坑，务必遵守）

**1. 不要钉死 peerDependencies 的精确版本。**

社区插件 `dsh-session-prompt` 写了：

```json
"peerDependencies": {
  "@deepseek-ai/dsh-settings": "0.1.1-rc.2"
}
```

结果它在 dsh `0.1.6-alpha.1` 上加载失败——因为它 import 的
`installSettingsSection` / `settingsNamespace` 在新宿主里**已经不存在**了。而它是
bundle 层，宿主半 import 失败会让 **boot 挂掉**，不是只坏一个功能。

建议做法：**peer 依赖写宽松范围**，或者干脆不声明你没真正使用的包。
本项目就**完全不依赖** `dsh-settings`。

**2. 不要用 `workspace:^`。**

那是 monorepo 内部写法，发布出去的包里无法解析。社区插件 Armory 就用了它，
只能靠 `npx` 安装器在安装时现场改写声明——徒增脆弱性。

**3. 不要用 `[data-slot]` 之类的 DOM 锚点做挂载。**

那是赌产品内部 DOM 不变。用**声明的插槽**（本项目用 `settings.section`）。

## 让别人更容易装：可选的一键安装器

如果以后想要 `npx dsh-custom-mode` 这种体验，做一个 `cli.cjs`：

1. 定位 `$DSH_HOME`；
2. 把 `preset/` 复制到 `.agent-presets/custom/`；
3. 跑 `dsh plugin --profile <p> add <包名>`；
4. 检查 profile 的 `dsh.profile.bundles` 是否含该包，缺了补上；
5. **提供卸载**（`npx ... uninstall`），并且卸载时要清理 bundles 列表。

第 5 点很重要：改了用户的 profile 却不给卸载路径，是很不礼貌的行为。

## 版本兼容性怎么声明

在 README 里写清**在哪个版本上验证过**，比写一个假的 semver 范围诚实得多。本项目：

> 在 dsh `0.1.6-alpha.1` 上开发并验证。

同时列出**用到了哪些 API**，这样升级 dsh 时别人能自己判断是否还兼容：

- `ctx.systemPrompt.section()` / `PromptSection.text` 支持函数
- `ctx.tools.register(definition)`
- `ctx.webServer.register({ kind, path, handler })`
- 客户端种子模块表里的 `react`

## 修改 client.js 之后

改 `editor/client.js` **不需要重启，也不需要刷新页面**：`dsh-client-hmr` 每 ~500ms stat 轮询
bundle 文件，约 1 秒后把插件原地换掉（实测证据见 [`ARCHITECTURE.md`](ARCHITECTURE.md) §10）。

只有改**宿主半**（`index.mjs`、`composition.mjs`、`meta.mjs`、`paths.mjs`）才需要重启 ——
它们是主进程里的行，只在启动装配期进入组合树。

> 这里曾写「改完 client.js 必须重启，刷新页面不够」，那是错的，跟 ARCHITECTURE §10 的实测
> 结论直接矛盾。以 §10 为准。

## GitHub 仓库本身的装修

代码之外，仓库页面上还有几处是别人第一眼会看的。这些只能在网页或 API 上设置，值先记在这里：

**About → Description**

```
DSH 自定义模式：系统提示词变成可热改的文件，逐行控制插件挂载，模式可改名
```

**About → Topics**（小写、连字符，每个不超过 50 字符）

```
dsh  deepseek-harness  agent-preset  system-prompt  cordis  plugin  prompt-engineering
```

**About → 勾选 Issues**，并把本仓库 **Pin** 到个人主页（第一个公开项目值得钉住）。
Wikis / Discussions 用不上就别开——空着的入口只会让人觉得项目烂尾。

**Social preview**：用 `docs/images/01-mode-switch.png`（Settings → Social preview 上传）。
默认的灰底卡片在分享链接时很难看。

**Release**：`v0.1.6-alpha.1`（tag 名与插件版本一致，理由见 README「版本号跟随官方」）。

```sh
git checkout main && git merge --ff-only review/2026-09-fixes
git tag -a v0.1.6-alpha.1 -m "dsh-custom-mode 0.1.6-alpha.1"
git push && git push --tags
```

Release 正文直接用 [`CHANGELOG.md`](../CHANGELOG.md) 里对应那一节，**并勾选 "Set as a pre-release"**
（这是个 alpha 版本）。如果这一版包含安全修复，正文里要**明确写出受影响版本与缓解方式**，
而不是只写"修复了一些问题"——从 `SECURITY.md` 里复制那段即可。
