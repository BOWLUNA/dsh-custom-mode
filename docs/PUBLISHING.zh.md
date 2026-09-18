# 发布与分发

[English](PUBLISHING.md) | 中文

这个项目有**两个产物**，分发方式不同（原因见 [`ARCHITECTURE.md`](ARCHITECTURE.zh.md)）：

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

## 方案二：editor 也发到 npm

preset 仍然走 clone（它不是 npm 包），editor 单独发 npm。**已发布**：
`dsh-custom-mode@0.1.6-alpha.1`（2026-09-17，tag `alpha`）、
`dsh-custom-mode@0.1.6-alpha.2`（2026-09-18，tag `alpha` 与 `latest`）。

```sh
cd editor
npm login --auth-type=web          # 首次：浏览器登录
npm publish --tag alpha            # 显式给 --tag，原因见下
```

### 发布前的自查清单

- [x] 源码**随包提交**，安装时不需要构建脚本。
      否则 pnpm 的 `allowBuilds` 会拦住用户（`dsh` 自己会提示，但体验很差）。
- [x] `dsh.bundle.patch` 指向的补丁文件在 `files` 里没被漏掉（CI 里有一条对着真实 packlist 的断言）。
- [x] `dsh.client.platform` 是 `"web"`。
- [x] `exports["./client"]` 指向浏览器半。
- [x] `private` 字段已删掉（发布前是 `true`，只用于本地开发）。
- [x] `peerDependenciesMeta` 里把不适用的 peer 标成 `optional`，否则用户装完第一眼是一条 WARN。

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

### 三个实测出来的坑

**1）`publishConfig.tag` 不被采纳，必须显式 `--tag`。**

`editor/package.json` 里声明了 `"publishConfig": { "access": "public", "tag": "alpha" }`，
但 npm 11.19.0 的 `npm publish --dry-run` 仍然打印 `with tag latest`；只有命令行显式加
`--tag alpha` 才变成 `with tag alpha`。所以**别赌 publishConfig 被读到**。

**2）首次发布时，`latest` 还是被指到了预发布版。**

实测结果：`npm view dsh-custom-mode dist-tags` →

```json
{ "alpha": "0.1.6-alpha.1", "latest": "0.1.6-alpha.1" }
```

即"预发布不该占用 `latest`"这条惯例在这里没保住（首次发布时 registry 会给它补上 `latest`）。
这在"版本号镜像 DSH"的时期是成立的：镜像一个 alpha 期的 DSH 版本，等于每个版本都是预发布，
`latest` 也就没有稳定版本可指。自 **`1.0.0`** 起包走自己的稳定线，常规语义开始成立：

- `dsh plugin --profile web add dsh-custom-mode` 装到当前版本，`latest` 指向的是一个稳定版本 ——
  这也正是目录与市场要求"裸 `x.y.z` 才自动安装"的那个条件；
- 想钉死版本就写全 `dsh-custom-mode@1.0.0`；
- `alpha` 仍指向旧镜像线的最后一个构建（`0.1.6-alpha.2`），供当初钉过它的人使用。

**3）peer 依赖要标 `optional`，否则用户装完第一眼就是一条警告。**

我们**不** import `@deepseek-ai/dsh`（设置页只用平台注入的服务与 node 内建），声明它只是为了
表达"适配哪个宿主"。不标 optional 时，从 registry 装会打印：

```
[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.
```

`editor/package.json` 里因此补了：

```json
"peerDependenciesMeta": { "@deepseek-ai/dsh": { "optional": true } }
```

> 这条修正在仓库里，但**没有**随 `0.1.6-alpha.1` 一起发出去（那个版本已经占用）。为一个元数据
> 警告去 `npm unpublish` 不划算：整包撤销会让包名被锁 24 小时。它会随下一个版本（即官方 DSH
> 更迭后）一起生效。

### 发新版本之后，`latest` 也要一起移

`npm publish --tag alpha` 只设置你给的那个 tag。市场是按包名安装的，解析的是 **`latest`**，所以只发
`alpha` 而不移 `latest`，一键安装拿到的还是上一个版本。实测：`0.1.6-alpha.1.rev1` 只以 `alpha` 发布
之后，`dsh plugin --profile web add dsh-custom-mode` 装到的仍是 `0.1.6-alpha.1` —— 也就是还没有播种
能力、装完不好用的那个版本。

```sh
npm dist-tag add dsh-custom-mode@<version> latest
```

pnpm 也会缓存解析出来的 `latest`：改动之前解析过的机器会一直装旧版本，直到元数据缓存过期。所以要在
干净缓存下验一次安装，而不是只看 tag。

**另外要预期 pnpm ≥ 11 的一天延迟。** `minimumReleaseAge` 默认 `1440` 分钟，所以发布后的头一天里，
**按包名**安装会一直解析到上一个版本 —— registry 没有任何问题，`npm view` 也会正常显示新的 `latest`。
对这个包实测：`0.1.6-alpha.2` 发布 13 小时后，`dsh plugin --profile web add dsh-custom-mode` 装到的
是 `0.1.6-alpha.1`；而显式给出精确版本时立刻就装到了 alpha.2。如果有用户说"它装的是旧版本"，原因就是
这个；排查方法与两条出路见 `docs/TROUBLESHOOTING.zh.md` 的 §17。

### 版本号，以及"支持哪个 DSH"现在写在哪（2026-09-18 起）

npm 要求每次发布的版本号唯一，而本包的版本号现在是自己的稳定线（`1.0.0`、`1.0.1` ……），两者不再冲突：

- **每次发布都递增版本号。** 旧的 `.revN` 后缀（版本号必须镜像 DSH、而重打包又不能重用版本号时的产物）
  取消。
- **兼容性是"声明"出来的，不是编码在版本号里的。** 支持哪些 DSH，写在 `editor/package.json` 的
  `engines.dsh` 与 `@deepseek-ai/dsh` peer 范围里；`tools/verify-version-consistency.mjs`（CI 执行）
  断言 CI 实际安装并测试的 DSH 版本落在这些范围内。重新适配到更新的 DSH 时，把范围放宽并同步 CI 里钉的
  版本。
- **同一个版本号仍然不能重发**：`npm publish` 会拒绝 `EPUBLISHCONFLICT`。

### 2FA

账号若开了 auth-and-writes，网页登录拿到的 token **不能**发布，会返回：

```
403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

两条路：`npm publish --otp=123456`（30 秒一换），或建一个勾了 "bypass 2FA" 的 granular access
token 并在临时 userconfig 里用它（不发到 `~/.npmrc`，用完即撤）：

```sh
umask 077
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > /tmp/npmrc-publish
npm publish --userconfig /tmp/npmrc-publish --tag alpha
rm -f /tmp/npmrc-publish
```

### 发布后怎么验证（别只看"发布成功"）

```sh
npm view dsh-custom-mode dist-tags versions

# 在一次性 DSH_HOME 里从 registry 真装一次，确认拿到的是真包而不是软链
H=$(mktemp -d); DSH_HOME=$H dsh plugin --profile web add dsh-custom-mode
node -p "JSON.stringify(require('$H/profiles/web/package.json').dependencies)"
ls -la "$H/profiles/web/node_modules/dsh-custom-mode"      # 应是目录，不是箭头
DSH_HOME=$H dsh --profile web --dump-config | grep -A1 'id: custom-mode'
```

### 包版本的修订后缀（`0.1.6-alpha.1.rev1`）

包版本通常是它所适配的 DSH 版本。npm 不允许同版本重发，所以**包本身**变了（`files` 里多了文件、
元数据修正）时，用 `<DSH 版本>.revN` 发出去。`tools/verify-version-consistency.mjs` 接受这个后缀、
拒绝别的写法，因此后缀不会变成偏离"CI 真正测过的版本"的缺口。

### peer 范围与预发布版本

不带显式预发布比较符的范围会静默排除 harness 的所有预发布版本：node-semver 只有在范围里某个比较符
与该版本的 `major.minor.patch` 完全一致、且自身带预发布标签时，才会放行预发布版本。

```jsonc
"peerDependencies": { "@deepseek-ai/dsh": ">=0.1.2-alpha.1" }   // 永远匹配不到 0.1.6-alpha.1
"peerDependencies": { "@deepseek-ai/dsh": ">=0.1.6-alpha.1" }   // 比较符落在 0.1.6 这个元组上
```

`engines.dsh` 用同样的形态，理由相同。

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

> 在 dsh `0.1.6-alpha.2` 上开发并验证。

同时列出**用到了哪些 API**，这样升级 dsh 时别人能自己判断是否还兼容：

- `ctx.systemPrompt.section()` / `PromptSection.text` 支持函数
- `ctx.tools.register(definition)`
- `ctx.webServer.register({ kind, path, handler })`
- 客户端种子模块表里的 `react`

## 修改 client.js 之后

改 `editor/client.js` **不需要重启，也不需要刷新页面**：`dsh-client-hmr` 每 ~500ms stat 轮询
bundle 文件，约 1 秒后把插件原地换掉（实测证据见 [`ARCHITECTURE.md`](ARCHITECTURE.zh.md) §10）。

只有改**宿主半**（`index.mjs`、`composition.mjs`、`meta.mjs`、`paths.mjs`）才需要重启 ——
它们是主进程里的行，只在启动装配期进入组合树。

> 这里曾写「改完 client.js 必须重启，刷新页面不够」，那是错的，跟 ARCHITECTURE §10 的实测
> 结论直接矛盾。以 §10 为准。

## GitHub 仓库本身的装修

### 可发现性：描述、topics、keywords、社交预览图

别人靠**搜索**找到这个插件，入口就这四个；它们都很便宜，而且**没人检查就会静默过期**：

- **仓库描述**（`gh repo edit --description`）：一句事实性的英文，带上关键词。GitHub 搜索与仓库列表显示的就是它。
- **Topics**（`gh repo edit --add-topic`）：`dsh-plugin` 是必需的（按 topic 索引的市场靠它收录）；再加上别人
  真会输入的词 —— `custom-mode`、`custom-prompt`、`prompt-editor`、`agent-modes`、`multi-mode`、
  `assistant-manager`、`system-prompt`、`deepseek-harness`……
- **npm 的 `keywords`**（写在 `editor/package.json`）：npm 搜索会读它，而且**只改元数据不会更新到 npm 上**
  —— 必须发一个新版本，npm 页面才会变。
- **社交预览图**（1280×640）：**只能在网页 UI 里设** —— Settings → Social preview。REST API 没有这个端点，
  所以这是唯一无法脚本化、也最容易被忘掉的一步。核对方式：

  ```sh
  curl -sL https://github.com/BOWLUNA/dsh-custom-mode | grep -o 'og:image" content="[^"]*'
  # 自定义 → repository-images.githubusercontent.com ；默认 → opengraph.githubassets.com
  ```

这张图也是"生成"的而不是画的：在浏览器里排版后按 1280×640 截屏，把 PNG 放进
`docs/images/social-preview.png`，让真值留在仓库里。

最后是措辞：README 首屏与 npm 落地页（`editor/README.md`）里应当出现人们会搜的说法 —— 包括同义词
（"custom prompt"、"system-prompt editor"、多助手／多模式）—— 因为在 GitHub 和 npm 上，页面文本本身就是索引。

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

**Social preview**：用 `docs/images/05-assistant-manager.png`（Settings → Social preview 上传；01–04 早于助手管理器，不再适合当门面）。
默认的灰底卡片在分享链接时很难看。

**Release**：tag 名与插件版本一致（`v1.0.0`；见 README「版本」）。

```sh
git checkout main
git tag -a v0.1.6-alpha.2 -m "dsh-custom-mode 0.1.6-alpha.2"
git push origin main && git push origin v0.1.6-alpha.2
```

**版本号与 CI 必须同改**：`editor/package.json` 的 version 一动，`.github/workflows/test.yml` 里钉定的
`@deepseek-ai/dsh@<version>` 就得跟着动，否则 `tools/verify-version-consistency.mjs` 会失败
（它防的正是「CI 在旧版本上通过，而发布的包声称适配了从未测过的新版本」）。

**正文面向访客，不要直接贴 CHANGELOG**：按已发布两版的体例写——适配的 dsh 版本 → 这一版的重点 →
安装（三条路径）→ 功能 → 正确性关键点 → 测试 → 文档 → 构建环境。如果这一版包含安全修复，正文里要
**明确写出受影响版本与缓解方式**，而不是只写"修复了一些问题"——从 `SECURITY.md` 里复制那段即可。

**不勾 pre-release**（与已发布的两版一致）：本项目的每个版本都是预览，npm 侧也刻意把 `latest` 指向最新版，
所以 GitHub 的 Latest 徽章同样跟随最新版。要改成勾选，就把已发布的版本一起改，别只改新的那个。

**附件 `.dshpreset`**（桌面端可直接导入，两版 release 都带了）：它是一个 zip，内含
`manifest.json` 与 `preset/` 下的五个文件。manifest 的字段就下面这些：

```json
{
  "format": "dsh-preset",
  "version": 1,
  "id": "custom",
  "name": "自定义模式 / Custom mode",
  "description": "一句话描述，与 README 一致",
  "sourceDshVersion": "本次适配的 dsh 版本",
  "exportedAt": "ISO 时间戳"
}
```

打包与发布（`preset/` 取自仓库当前内容，`sourceDshVersion` 填本次适配版本）：

```sh
python3 - <<'ZIP'
import json, zipfile, datetime, os
FILES = ['agent.cordis.yml', 'preset.yml', 'prompt.md', 'prompt-reader.mjs', 'prompt-tool.mjs']
manifest = {
    'format': 'dsh-preset', 'version': 1, 'id': 'custom',
    'name': '自定义模式 / Custom mode',
    'description': '<与 README 一致的一句话>',
    'sourceDshVersion': '<本次适配的 dsh 版本>',
    'exportedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
}
with zipfile.ZipFile('dsh-custom-mode.dshpreset', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    for name in FILES:
        z.write(os.path.join('preset', name), 'preset/' + name)
ZIP
gh release create v<版本> --title "v<版本>" --notes-file notes.md dsh-custom-mode.dshpreset
```

正文里要说明附件导出的宿主版本，并提示导入器可能给出兼容性警告。
