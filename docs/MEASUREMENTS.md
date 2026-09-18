# Measurement Log

English | [中文](MEASUREMENTS.zh.md)

> The file name is English (`MEASUREMENTS.md`) because this is the default document and it matches the other files under `docs/`; the Chinese twin is `MEASUREMENTS.zh.md`.

This document records **results obtained by running things on a real machine**, not design notes. Every entry gives the command and the output at the time, so it can be re-run and checked.
Environment: dsh `0.1.6-alpha.1`, Node 24.21.0, WSL2 (mirrored networking mode), a fresh `DSH_HOME`
(the instance in use on the development machine is not touched).

For how to re-run, see the commands in each section; `$REPO` means this repository, `$H` means a separate `DSH_HOME`.

---

## 0. End to end: edit the prompt → **it takes effect on the very next step** (real session, two turns)

The whole project rests on this one sentence, and until now it had only a unit test that "the read function is re-evaluated", with no
end-to-end evidence that "the agent loop really calls it on every step". That is what this section supplies.

**Why a "marker" is used instead of asking the model to recite the system prompt**: asking the model directly to recite the system prompt is refused
(measured: `我不能复述系统提示词的内容` —— this is reasonable safety behaviour, not a bug). So instead a **format rule** is
planted in the prompt, and whether the model's actual behaviour follows the file is observed:

```
【格式规则，每次回答都必须遵守】
你的每一条回答，第一行必须正好是下面这一串字符，前后不留任何其他字符：

MARK-ONE
```

**Procedure**: open a session in a real running web instance and ask one question → after the answer, **without restarting, refreshing, or creating a new session**,
change only `MARK-ONE` in `prompt.md` to `MARK-TWO`, then ask a second question **in the same session**.

**Measured result** (same browser page, same session):

```
第 1 轮：1+1 等于几？   →  MARK-ONE  2          （用量 8.1K tok）
（把 prompt.md 改成 MARK-TWO）
第 2 轮：2+2 等于几？   →  MARK-TWO  4          （用量 9.3K tok）
```

Verdict:

```json
{
 "turn1_hasMarkOne": true,
 "turn2_hasMarkTwo": true,
 "turn2_stillOnlyMarkOne": false,
 "finalPromptMarker": "MARK-TWO"
}
```

In other words: **editing the file → the next model call uses the new text** holds; no restart is needed, and no new session is needed.
(The unit tests for `prompt-reader.mjs` also prove that in the steady state the disk is not re-read repeatedly: one `stat` plus a size comparison.)

Between the two turns, a line "**系统提示词更新**" appears in the interface —— that is marked by dsh itself, showing that it detected the system prompt changing mid-session.

The idea behind the driving script is given below: first use CDP to choose the workspace and type the question into the composer, then poll the page text until the marker appears.

> **One path that does not work, noted here so it is not tried again**: `dsh --profile headless` (the one-shot CLI) **cannot** be used to test this.
> It explicitly refuses to run a session with an agent preset, and the source says:
> `session "…" runs under agent preset "…", which the one-shot runner does not compose`.
> So end-to-end testing can only be done with a web instance.

### 0.1 Incidentally verified: `agent-presets.default` is a runtime setting, not a value in the composition

```sh
DSH_HOME=$H dsh --profile web --dump-config | grep -A3 'id: agent-presets'
#   config:
#     default: standard          ← 组合里写死的默认值
```

Whereas `agent-presets: { default: custom }` in `$H/settings.yaml` overrides it at runtime (the mode
selector on the home page then shows "自定义模式"). These two places are not the same thing, and they are easy to confuse when investigating "why hasn't the default mode changed".

---

## 1. Installing into a fresh environment: the pitfall hit with an old `install.sh`

```sh
rm -rf "$H" && mkdir -p "$H"
cp ~/.dsh/.credentials.yaml "$H/"          # 只要能启动就行，不涉及模型调用
DSH_HOME="$H" ./install.sh                  # ← 修复前的版本
```

Output before the fix:

```
==> 2/2 安装设置页插件 "dsh-custom-mode" 到 profile "web"
    已移除解析不到的残留条目: ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]
    bundle 已登记: ["dsh-custom-mode"]
安装完成。          ← 退出码 0，用户看不出任何异常
```

The bundles in `$H/profiles/web/package.json` go from
`["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]` to `["dsh-custom-mode"]`,
and therefore:

```sh
DSH_HOME="$H" dsh --profile web --dump-config
# == dsh-custom-mode
- id: custom-mode
  name: dsh-custom-mode
# ↑ 全文就这两行（正常是 158 行）

DSH_HOME="$H" dsh web --port 3081 --no-open
# dsh: warning: 1 entry did not activate
# custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
# ↑ 服务永远等不到：没有界面、没有 agent
```

**Trigger conditions** (two orders measured):

| Order | Result |
| --- | --- |
| Fresh `DSH_HOME` → `./install.sh` directly | **hit** |
| Fresh `DSH_HOME` → start `dsh web` once first → `./install.sh` | not hit: starting populates the harness dependencies into `profiles/node_modules`, so the old detection path matches |

After the fix (`==> 3/3 安装后自检`):

```
    安装前 bundles: []
    bundle 已登记: ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","dsh-custom-mode"]
==> 3/3 安装后自检（组合 profile）
    组合树 158 行，dsh-custom-mode 已就位
```

The guard itself was verified as well: manually change the profile back to its post-bug state and run it, and it exits non-zero:

```
    自检失败: 组合树只有 1 行，基础 bundle 疑似丢失（正常应有上百行）。
    当前 bundles: ["dsh-custom-mode"]
    自救: 把 profile 模板自带的 bundle 名（如 @deepseek-ai/dsh-base、
          @deepseek-ai/dsh-web-app）加回上面这个列表，见 docs/TROUBLESHOOTING.md。
```

---

## 2. Unauthorized reads and writes on the settings-page route (security)

Before the fix (the instance runs on 3081):

```sh
curl http://127.0.0.1:3081/custom-mode
# → 200 {"ok":true,…,"prompt":"You are a coding agent powered by {{model}} model.…"}

curl -X POST http://127.0.0.1:3081/custom-mode \
     -H 'content-type: text/plain' \
     --data '{"mode":"standard","overrides":{},"prompt":"PWNED-BY-UNAUTHENTICATED-POST\n"}'
# → 200 {"ok":true,"mode":"standard","note":"已保存（基础模式：standard）…"}
head -1 "$H/.agent-presets/custom/prompt.md"
# PWNED-BY-UNAUTHENTICATED-POST          ← 文件真的被改了

curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081/
# 401
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081/api/settings
# 401
```

After the fix:

| Request | Result |
| --- | --- |
| Unauthorized GET | `401 unauthorized` |
| Unauthorized POST (`text/plain`) | `401`, the file is not rewritten |
| POST + `Origin: https://evil.example` + `Sec-Fetch-Site: cross-site` | `403 forbidden` |
| With a valid `dsh-auth-*` cookie (browser session) | `200`, functionality as before |

Re-run:

```sh
# 未授权
curl -s -o /dev/null -w 'GET  %{http_code}\n' "http://127.0.0.1:3081/custom-mode"
curl -s -o /dev/null -w 'POST %{http_code}\n' -X POST "http://127.0.0.1:3081/custom-mode" \
  -H 'content-type: text/plain' --data '{"mode":"standard","overrides":{},"prompt":"x"}'
# 有会话（token 从 dsh web 的日志里取）
curl -s -c /tmp/cj -o /dev/null "http://127.0.0.1:3081/?token=$TOKEN"
curl -s -b /tmp/cj -o /dev/null -w 'AUTH %{http_code}\n' "http://127.0.0.1:3081/custom-mode"
```

---

## 3. Feature chain: toggle a switch → save → the actual result on disk

Toggle "网页检索与抓取" off on the settings page and click save, and the page status bar returns:

```
已保存（基础模式：standard）。新建会话即生效，当前会话保持原配置。
```

On disk (`$H/.agent-presets/custom/agent.cordis.yml`):

```yaml
# 本文件由「自定义模式」设置页生成，请勿手工编辑——下次保存会覆盖。
# 基础模式: standard
# 生成时间: 2026-09-17T10:03:12.800Z
…
- id: tool-web                    # ← 被显式关闭的行
  name: '@deepseek-ai/dsh-tool-web'
  disabled: true
…
- id: tool-bash                   # ← 没碰过的行，平台条件逐字节保留
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'
```

Two things are proved at the same time: the explicit toggle takes effect; and **untouched rows keep their factory state** (this is the core of the project's correctness,
and it is also what the 63 checks in `composition.test.mjs` guard against).

Another place on the page shows immediately that the platform expressions really are evaluated on the host side: on Linux, `Shell（pwsh）` shows
"已停用 / 跟随平台", while `Shell（bash）` shows "已启用 / 跟随平台" —— both carry a
`!!js` condition in the YAML.

---

## 4. Hot-update contract: edit the file → the next evaluation is the new text

The end-to-end demonstration in a real session requires model calls; the equivalent evidence that does not depend on a model drives `prompt-reader.mjs` directly:
fetch the persona section's `text` provider the way the registry does and call it.

```sh
node test/prompt-reader.test.mjs
```

```
PASS  prefix 的 text 是函数（每步重新求值）
PASS  改文件后下一次求值读到新文本（无需重启）
PASS  未变化时不重新读盘（删除后仍给出缓存文本）
PASS  被清空后仍给出上一版内容
PASS  complete: true 时不再注册 suffix
结果: 15 通过, 0 失败
```

---

## 5. Bilingual and dark/light

Rather than "reading the code and thinking it should be fine", the controls **of the interface itself** were used to switch, and the result checked with screenshots:

| Action | Observed result |
| --- | --- |
| Language → English | The navigation item automatically becomes `Custom mode`; the section titles become `Mode name` / `Base mode` / `Plugin switches` / `System prompt` |
| Appearance → Dark | The whole page follows (including cards, badges, input fields), with no hard-coded colour values |

These two no longer each come with an image (duplicate images are not worth making the reader download several hundred KB more): the switching was **really
performed**, and the assertions and observed values are written in `tools/screenshots/observed.json`; the capture script is in `tools/screenshots/`.

---

## 6. Tests and CI

```sh
node test/run.mjs
```

```
出厂 preset 目录: …/dsh-agent-presets/presets
（来源：$DSH_HOME/profiles/node_modules）
结果: 63 通过, 0 失败      ← 组成文件编译器
结果: 15 通过, 0 失败      ← 热更新契约
结果: 65 通过, 0 失败      ← 词典（含 client.js 手抄副本的漂移检查）
7 个套件全部通过
```

The resolution chain was verified under both layouts:

| Layout | Source matched |
| --- | --- |
| dsh installed locally | `$DSH_HOME/profiles/node_modules` |
| `npm install @deepseek-ai/dsh@0.1.6-alpha.1` in a clean directory (what CI does) | Node resolution from this file |

CI uses the presets shipped with the dsh on npm, which are byte-for-byte identical to the local ones (`diff -rq` reports no differences), so CI's conclusions are
real conclusions, not ones produced by running against a self-made fixture.

---

## 7. Installing into a non-web profile: what works and what does not (measured)

`install.sh --help` and both READMEs mention `--profile tui`, but **measurement** requires distinguishing two levels:

| profile | whether the composition has `agent-presets` | whether the composition has `webServer` | Result |
| --- | --- | --- | --- |
| `web` | yes | yes | mode selectable + settings page available (full functionality) |
| `tui` | **no** | **no** | the mode **cannot be selected**; the settings page does not exist either |
| `headless` | no (and it would still be refused even if added, see §0) | no | the same as above |

`agent-presets` appears only in the web composition (`dsh --profile web --dump-config | grep agent-presets` has output,
tui/headless are both 0 lines), and the "自定义模式" preset is exactly what it mounts —— **so in tui it is not that "the settings page
cannot see it", but that the mode does not exist at all**.

Before the fix, every tui start printed this line (identical to the "installing dsh bricks it" error in §1, purely misleading):

```
dsh: warning: 1 entry did not activate
custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
```

After the fix it is no longer pending (the plugin was changed to wait for services within a scope), and `install.sh` also **explains each profile separately** ——
deliberately not phrased as "the mode itself is still usable", because on tui that sentence does not hold:

```
    注意: profile "tui" 里这个插件只有一部分能生效。
          · 组合里没有 agent-presets：**「自定义模式」无法被选中**，
            preset 文件被复制过去了，但没有任何东西会挂载它
          · custom_prompt 工具可用（会话里直接说「把系统提示词改成……」）
          · 没有设置页：组合里没有 web 服务器
          要用完整功能（模式可选 + 图形化设置页），请装进 web profile：
            ./install.sh --profile web
```

On the web profile the same self-check prints no hint at all (measured occurrence count 0), and the closing note is given as usual:
"新会话选「自定义模式」".

---

## 8. Uninstall round trip: `uninstall.sh` used to leave a symlink behind

```sh
DSH_HOME=$H ./install.sh >/dev/null          # 装上
DSH_HOME=$H ./uninstall.sh                   # 卸掉
ls "$H/profiles/web/node_modules" | grep custom
# 修复前：dsh-custom-mode      ← 仍在（指向仓库的软链）
# 修复后：（无输出）
```

At the time, `dependencies` in `package.json` and `dsh.profile.bundles` were both already cleaned up; only the
symlink left by pnpm remained (reproduced on pnpm 12.4.2). It does not affect dsh assembly (assembly only looks at bundles), but uninstall should leave no
trace —— especially since deleting the repository afterwards turns it into a broken link. Now only this one package name is deleted.

The complete state after uninstall (measured):

```
bundles:      ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]   ← 回到模板原样
dependencies: undefined                                              ← 清空
preset 目录:  保留（提示词也保留，符合默认行为）
组合树:       157 行（= 装上时的 158 行减去本插件那一行）
```

The idempotence of a second install was verified as well: install → manually edit `prompt.md` → install again; the script keeps the user prompt and
only updates the mode file (`检测到已存在的 prompt.md，保留它（只更新模式文件）`).

---

## 9. Marketplace install: seeding a fresh `DSH_HOME`

A storefront install is one command, so the package has to be enough on its own. Measured on a fresh
`DSH_HOME` (only credentials copied), installing the packed tarball and booting:

```
$ DSH_HOME=$H dsh plugin --profile web add dsh-custom-mode-0.1.6-alpha.1.rev1.tgz
+ dsh-custom-mode file:/tmp/dsh-custom-mode-0.1.6-alpha.1.rev1.tgz

$ ls $H/.agent-presets/custom        # before boot: nothing, seeding happens on activation
  (absent)

$ DSH_HOME=$H dsh web --port 3082 --no-open
custom-mode: 已播种 preset 到 …/.agent-presets/custom（新建 5 个文件: agent.cordis.yml, preset.yml,
prompt.md, prompt-reader.mjs, prompt-tool.mjs）
dsh web: http://127.0.0.1:3082/?token=…
```

The mode is then selectable in the new-session picker (read with the same CDP driver the screenshots
use — the list contained `Standard mode / PTC mode / Minimal mode / Creator mode / 自定义模式`), and the
settings page answers with the full state:

```
GET /custom-mode (session cookie) → 200 {"ok":true,"mode":"standard",…19 rows…}
GET /custom-mode (no cookie)      → 401
```

The rest of the acceptance run:

| What | Result |
| --- | --- |
| Second boot | no `已播种` line at all — it writes nothing when the preset is complete |
| A `prompt.md` already present before boot | byte-identical afterwards (`md5` unchanged); the other four files were filled in |
| Read-only `$DSH_HOME/.agent-presets` | dsh starts normally; log: `preset 播种未完成 —— 无法创建 … EACCES`, and the settings page returns `{"ok":false,"error":"找不到组成文件：…"}` |
| Rename + switch base mode through the page's own route | `preset.yml` → `name: "My Renamed Mode"`, composition header `# 基础模式: minimal`, row count 19 → 3, prompt rewritten |
| Full UI pass on the seeded instance | the screenshot driver read the state, toggled a row, saved (`已保存（基础模式：standard）…`), switched language and theme |

## 10. Upgrade check against dsh `0.1.6-alpha.2` — coupling points verified statically

The project's versioning policy says an upstream release is checked against the coupling-point list
before the version number moves. This is that check for `0.1.6-alpha.2`, and it needed no browser:
the contracts are declarations, so the tarballs answer them.

**Method.** Download the `0.1.6-alpha.2` tarballs for `dsh-agent-presets`, `dsh-system-prompt`,
`dsh-client-locale`, `dsh-client-connection`, `dsh-tools`, `dsh-host-webserver`,
`dsh-client-ui-settings` and `dsh-client-ui-slots`; grep the declarations this project depends on out
of both that copy and the installed `0.1.6-alpha.1`; compare. Then run the full suite twice — once
against each version's shipped presets.

### Every coupling point is unchanged

| Coupling point | Where it is declared | Result |
| --- | --- | --- |
| `agentPresets.list()` return shape (`trust`, `path`) | `dsh-agent-presets` | unchanged (11 matching declarations) |
| `systemPrompt.section({ text: fn })` — text as a provider | `dsh-system-prompt` | unchanged |
| `PromptSection.complete` | `dsh-system-prompt` | unchanged |
| `locale.register` / `locale.bind` | `dsh-client-locale` | unchanged |
| `connection.requestRejection` (the fail-closed 503) | `dsh-client-connection` | unchanged |
| `tools.register(definition: ToolDefinition)` | `dsh-tools` | unchanged |
| `WebRoute { kind, path, handler }` | `dsh-host-webserver` | unchanged |
| `settings.section` slot: `kind: list`, `scope: root`, owner props | `dsh-client-ui-settings` | unchanged |
| `locale:` registration option (supplies the bound `t`) | `dsh-client-ui-slots` | still documented — "present exactly on entries whose registration declares `locale:`" |

### What did change: one new row per mode

`standard`, `ptc` and `cordis` each gained exactly one row — `tool-plugin-manager`
(`@deepseek-ai/dsh-plugin-manager/tools`); `minimal` is unchanged. **No code change was needed**:
the compiler reads the shipped composition at runtime, so a regenerated composition picks the row up
by itself. It only had no display label, which is now supplied in both languages — and
`composition.test.mjs` now asserts that every shipped row id has a `ROW_META` entry, so the next
upstream row turns CI red instead of silently rendering a bare id.

### Suite result

```
DSH_SHIPPED_PRESETS_DIR=<0.1.6-alpha.1 presets> node test/run.mjs   → 8 suites, all pass（当时的套件数；本文件保持历史记录原样）
DSH_SHIPPED_PRESETS_DIR=<0.1.6-alpha.2 presets> node test/run.mjs   → 8 suites, all pass
```

### Side finding: `chmod` cannot fake an unwritable directory as root

`test/seed.test.mjs` used `chmod 0o500` on the parent directory to exercise the seeding failure
path. Measured: **root bypasses permission bits**, so seeding succeeded and three assertions flipped
to red. They were green on CI (a non-root runner) and red for anyone running the suite as root — a
test whose outcome depended on who ran it. Blocking the path with a regular file instead fails with
`ENOTDIR` for every user, and the assertions now mean the same thing everywhere.

---

## 11. Several assistants: create, delete and switch N modes from one settings page (real instance)

Environment as in §9: a fresh `DSH_HOME=/tmp/dsh-dev`, web profile, its own port 3081 — the instance in
use on this machine was never touched.

### 11.1 Test suites

```
$ node test/run.mjs
shipped presets dir: /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets
(from: $DSH_HOME/profiles/node_modules)
…
result: 64 passed, 0 failed      composition.test.mjs
result: 26 passed, 0 failed      composition-edge.test.mjs
result: 15 passed, 0 failed      prompt-reader.test.mjs
result: 37 passed, 0 failed      prompt-tool.test.mjs
result: 45 passed, 0 failed      meta.test.mjs
result: 56 passed, 0 failed      assistants.test.mjs   ← new in this change
result: 94 passed, 0 failed      editor-route.test.mjs ← grew from one route to five endpoints
result: 31 passed, 0 failed      seed.test.mjs
result: 66 passed, 0 failed      locales.test.mjs
result: 19 passed, 0 failed      client-bundle.test.mjs ← new (the browser half's registration contract)
result: 16 passed, 0 failed      manifests.test.mjs
all 11 suites passed, 469 checks in total
```

### 11.2 Install and start

```
$ DSH_HOME=/tmp/dsh-dev ./install.sh
    composition tree: 164 rows, dsh-custom-mode in place
$ DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open --host 127.0.0.1
dsh web: http://127.0.0.1:3081/?token=…
```

The token is exchanged for a browser-session cookie (`GET /?token=…` → `303` + `set-cookie: dsh-auth-…`);
every request below carries it.

### 11.3 The fence, then the list

```
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/custom-mode
401                                          ← unauthenticated (the fence still comes first)

$ curl -s -b "$JAR" http://127.0.0.1:3081/custom-mode
{"ok":true,"assistants":[{"id":"custom","name":"自定义模式","description":"完整编码能力…"}],
 "root":"/tmp/dsh-dev/.agent-presets"}
```

### 11.4 Creating two assistants (one Chinese name, one English)

```
$ curl -s -b "$JAR" -H 'content-type: application/json' \
    -d '{"name":"写作助手","description":"负责写文档与博客"}' http://127.0.0.1:3081/custom-mode/create
{"ok":true,"id":"custom-2","name":"写作助手",…}      ← Chinese slugs to nothing → custom-2

$ curl -s -b "$JAR" -H 'content-type: application/json' \
    -d '{"name":"Writer"}' http://127.0.0.1:3081/custom-mode/create
{"ok":true,"id":"writer","name":"Writer",…}          ← an English name becomes the directory name

$ ls -1 /tmp/dsh-dev/.agent-presets/
custom
custom-2
writer
```

The new directory holds the complete five-file template, with `agent.cordis.yml` regenerated from Standard:

```
$ head -3 /tmp/dsh-dev/.agent-presets/custom-2/agent.cordis.yml
# 本文件由「自定义模式」设置页生成，请勿手工编辑——下次保存会覆盖。
# 助手: 写作助手 (custom-2)
# 基础模式: minimal
$ grep -n modeName /tmp/dsh-dev/.agent-presets/custom-2/agent.cordis.yml
77:    modeName: "写作助手"
```

### 11.5 Every prompt is independent (the actual claim being verified)

```
$ curl -s -b "$JAR" -H 'content-type: application/json' \
    -d '{"id":"custom-2","mode":"minimal","overrides":{"tool-fs":false},
         "prompt":"你是写作助手，负责把要点写成清晰的文档。\n\n工作目录：{{cwd}}\n",
         "name":"写作助手","description":"负责写文档与博客"}' \
    http://127.0.0.1:3081/custom-mode/state
{"ok":true,"id":"custom-2","mode":"minimal","note":"已保存（写作助手，基础模式 minimal）。…"}

$ head -c 30 /tmp/dsh-dev/.agent-presets/custom/prompt.md   → You are a coding agent pow
$ head -c 30 /tmp/dsh-dev/.agent-presets/custom-2/prompt.md → 你是写作助手，负责把要点写成清
$ head -c 30 /tmp/dsh-dev/.agent-presets/writer/prompt.md   → You are a coding agent pow
```

Validation still guards the write path (a rejected save leaves the file untouched):

```
$ curl -s -b "$JAR" -H 'content-type: application/json' \
    -d '{"id":"custom-2","mode":"minimal","prompt":"x {{foo}} y"}' …/custom-mode/state
{"ok":false,"error":"保存被拒绝：{{foo}} 不是已注册的变量，渲染时会报错并让本模式每个请求都失败。可用：{{model}}、{{cwd}}、{{provider}}。"}
```

### 11.6 Deletion: shipped presets are refused, your own are not

`remove` goes through `scope.agentPresets.remove(id)`, so "the row really was in the roster" is itself
proof that the running process had already discovered the new directory:

```
$ curl … -d '{"id":"standard"}' …/custom-mode/delete
{"ok":false,"error":"找不到助手「standard」。设置页只管理本工具创建的模式…"}

$ curl … -d '{"id":"writer"}' …/custom-mode/delete
{"ok":true,"id":"writer","note":"已删除「writer」。正在使用它的会话不受影响；新建会话时不再出现。"}
$ ls -1 /tmp/dsh-dev/.agent-presets/
custom
custom-2
```

Methods and sub-paths (a GET must not create an assistant):

```
$ curl -s -o /dev/null -w "%{http_code}\n" -b "$JAR" …/custom-mode/create   → 405
$ curl -s -b "$JAR" …/custom-mode/nope
{"ok":false,"error":"未知的子路径：/custom-mode/nope"}
$ curl … --data-binary @4MB.json …/custom-mode/state                        → 500 (body too large)
```

### 11.7 The new assistant really is in the mode picker

The picker reads discovery, so ask discovery — against the real instance's `DSH_HOME`:

```
$ node /tmp/roster-check.mjs
custom     user    自定义模式        mountable
custom-2   user    写作助手         mountable      ← not broken: the composition loads and every row resolves
standard   system  标准模式         mountable
ptc        system  PTC 模式        mountable
minimal    system  极简模式         mountable
cordis     system  创造模式        mountable
```

The browser half is confirmed new as well (the bundle the page loads is byte-identical to the repo file,
apart from the appended `sourceMappingURL`):

```
$ curl -s -b "$JAR" '…/plugins/??dsh-custom-mode/client.js&rev=…' -o /tmp/served-client.js
http=200 bytes=44361
$ diff /tmp/served-client.js editor/client.js
874,875d873
< ;
< //# sourceMappingURL=/plugins/??dsh-custom-mode/client.js.map&rev=…
```

**One thing NOT verified**: no browser was available, so the React output itself (the assistant list and
button layout) has no screenshot check. Every other link — route, disk, roster, bundle — was exercised
on a real instance.

---

## 12. Aligning the UI with the shell's atoms (seed table measured) + duplicate (real instance)

### 12.1 The evidence that decides whether this layer is even possible: the seed table

A hand-written bundle can only `require`. So "use the official controls" depends on the shell
registering them as seed words. Searching `dsh-web-frontend/dist/assets/index-8VXBH-f-.js` (616 KB)
finds exactly that table:

```
$ python3 - <<'PY'   # search the dist for dsh-client-ui-primitives and print the context
...untime":_c,"react-dom":bc,"react-dom/client":Ic,"@deepseek-ai/cordis":ec,
"@deepseek-ai/dsh-client-store":Jc,"@deepseek-ai/dsh-client-ui-slots":ou,
"@deepseek-ai/dsh-client-ui-primitives":Cy,"@deepseek-ai/dsh-client-ui-dockkit":Xw}}var ix=class{...
```

It sits beside `react`, so any bundle can require it, and it needs **no** `dsh.client.external` (that
field serves *graph rows*, which have their own record in the boot manifest).

### 12.2 How it looks in the boot manifest (an easy misreading)

```
$ python3 … parse globalThis["__DSH_BOOT__"]
keys: ['rev', 'entries', 'batches'];  entries: 59
--- @deepseek-ai/dsh-client-ui-primitives      → (NOT A ROW)
--- @deepseek-ai/dsh-client-ui-settings-general → {"id":"…settings-general","url":"/plugins/??…&rev=b97a6adea38cd90c-20","inject":[…]}
--- dsh-custom-mode                             → {"id":"dsh-custom-mode","url":"/plugins/??dsh-custom-mode/client.js&rev=b97a6adea38cd90c-49","rev":"…-49"}
declared by @deepseek-ai/dsh-client-ui-subagent in inject
declared by @deepseek-ai/dsh-client-ui-jobs in inject
```

It is **not an entry**; it appears only in two official bundles' `inject` lists, while the official
`settings-general` requires it at runtime with no declaration — consistent with the seed table in
12.1. (Reading only the boot manifest would wrongly suggest a dependency declaration is required.)

### 12.3 Duplicating an assistant (real instance, port 3081)

```
$ curl … -d '{"id":"custom","mode":"minimal","overrides":{"tool-fs":false},
              "prompt":"原始提示词 MARK-SOURCE\n","name":"原始助手","description":"被复制的那一个"}' …/custom-mode/state
{"ok":true,…}

$ curl … -d '{"name":"副本助手","from":"custom"}' …/custom-mode/create
{"ok":true,"id":"custom-2","name":"副本助手",
 "note":"已复制出「副本助手」：提示词、基础模式与插件开关都来自「custom」，之后各改各的，互不影响。"}

$ curl … '…/custom-mode/state?id=custom-2'
{"id":"custom-2","mode":"minimal","overrides":{},"prompt":"原始提示词 MARK-SOURCE\n",
 "name":"副本助手","description":"被复制的那一个","promptPath":"/tmp/dsh-dev/.agent-presets/custom-2/prompt.md"}

$ grep -c MARK-SOURCE /tmp/dsh-dev/.agent-presets/*/prompt.md
/tmp/dsh-dev/.agent-presets/custom/prompt.md:1
/tmp/dsh-dev/.agent-presets/custom-2/prompt.md:1
```

`overrides` is `{}` rather than `{"tool-fs":false}` because the source is `{}` too — Minimal has no
`tool-fs` row, so that switch was dropped at write time. The duplicate matches the source field for
field, which is the property worth asserting.

### 12.4 Cache headers and the rev (whether users must clear their cache)

```
$ curl -D - … '/plugins/??dsh-custom-mode/client.js&rev=b97a6adea38cd90c-49'
HTTP/1.1 200 OK
cache-control: public, max-age=31536000, immutable
```

`immutable` looks alarming, but the rev is a content hash:

```
dsh-client-modules/lib/index.js:
  function artifactRevision(bundle, baseline) {
    return framedHash("plugin-artifact", [bundle, Buffer.from(String(baseline.mtimeMs))]);
  }
  const rev = artifactRevision(readFileSync(record.meta.clientPath), baseline);
```

Change the file's bytes or mtime and the rev changes, hence the URL. **An ordinary refresh after a
restart is therefore enough.**

### 12.5 Suites

```
result: 104 passed, 0 failed     editor-route.test.mjs  ← new: route-constant drift guard, duplicate
result: 26 passed, 0 failed      client-bundle.test.mjs ← new: atoms present / absent, both paths
all 11 suites passed            ← 486 checks in total
```

---

## 13. A whole page of raw keys caused by the `settings.section` contract, plus ordering measured live

### 13.1 The authoritative contract (not an inference)

The slot declaration ships inside `dsh-cordis-client-runner`, `registerOptions` and documentation included:

```
$ python3 - <<'PY'   # extract the settings.section declaration from dsh-cordis-client-runner/lib/client.js
{
  key: "settings.section", kind: "list", scope: "root",
  registerOptions: [
    { name: "id",    requirement: "required", type: "string" },
    { name: "order", requirement: "optional", type: "number" },
    { name: "label", requirement: "optional", type: "string | (() => string)" }
  ],
  ownerProps: […SettingsSectionOwnerProps…],
  standardProps: ["useResource: UseResource", "useWorkspaces: …", …]
}
```

**`locale:` is not among them.** The old code relied on it to receive the shell's bound `t`, so the body
echoed keys.

### 13.2 Boot manifest: this bundle is installed exactly once (ruling out a repeated apply)

```
$ parse globalThis["__DSH_BOOT__"]
entries: 59
occurrences of dsh-custom-mode: 1
its manifest row: [{"id":"dsh-custom-mode","url":"/plugins/??dsh-custom-mode/client.js&rev=e159d1f9c23eee42-49","rev":"e159d1f9c23eee42-49"}]
is ui-primitives an entry: False        ← it is a seed word, not a graph row
```

So "registered twice / applied twice" does not hold in this version; with the contract change above, the
raw keys are fully explained.

### 13.3 The fixed artifact and its dictionary content

```
$ curl -s '…/plugins/??dsh-custom-mode/client.js&rev=e159d1f9c23eee42-49' -o /tmp/s3.js
http=200 bytes=70019
$ node -e "…count the inlined dictionaries…"
served ZH entries: 127
contains "nav": true
contains "assistant.heading": true
```

The floor dictionaries do ship, and they carry the nav and page keys.

### 13.4 Ordering (real instance, port 3081)

```
$ create Alpha / Beta / Gamma
 created alpha Alpha / created beta Beta / created gamma Gamma

$ curl … /custom-mode            → alpha:Alpha | beta:Beta | custom:自定义模式 | gamma:Gamma
$ curl … -d '{"id":"beta","direction":"up"}' …/custom-mode/reorder
{"ok":true,"id":"beta","order":["beta","alpha","custom","gamma"],
 "note":"顺序已保存：新建会话时的模式选择器按这个顺序排列。"}
$ curl … /custom-mode            → beta:Beta | alpha:Alpha | custom:自定义模式 | gamma:Gamma

$ for d in custom alpha beta gamma; do grep ^order: /tmp/dsh-dev/.agent-presets/$d/preset.yml; done
custom   order: 3
alpha    order: 2
beta     order: 1
gamma    order: 4

$ curl … -d '{"id":"beta","direction":"up"}' …/custom-mode/reorder
{"ok":false,"error":"「Beta」已经在最前面。"}
$ curl … -d '{"id":"custom","direction":"sideways"}' …/custom-mode/reorder
{"ok":false,"error":"未知的排序方向：sideways"}
$ curl -o /dev/null -w '%{http_code}' …/custom-mode/reorder     (GET)
405
```

The order lands in `preset.yml` rather than in plugin state, so it survives a restart; `GET` cannot change it.

### 13.5 The client bundle is still content-addressed

```
cache-control: public, max-age=31536000, immutable
rev = artifactRevision(readFileSync(clientPath), { mtimeMs })
```

Change the file and the rev — hence the URL — changes. **An ordinary refresh after a restart is enough**;
no cache clearing.

---

## 14. Browser verification (lab, dsh `0.1.6-alpha.2`)

This is the first time the project has **seen** the page it renders. The machine running the harness
is the **host** and can never be a test target — restarting it kills the running session. So
verification happens on a lab machine you can reboot freely. `$LAB` below is that machine (its address
and launcher scripts live in the operator's own `~/.dsh/AGENTS.md`); a generic recipe that needs only
"a second machine and a browser" is in the repository `AGENTS.md` §"The lab".

### 14.1 Lab preparation (including the dsh upgrade)

```
$ ssh "$LAB" 'dsh --version'
0.1.6-alpha.1
$ ssh "$LAB" 'npm i -g @deepseek-ai/dsh@0.1.6-alpha.2'      # run it in the background
$ ssh "$LAB" 'dsh --version'
0.1.6-alpha.2
```

The npm tags are a trap: `latest` is the stale `0.1.5-rc.2` while new builds sit on `alpha`; and the
upgrade is slow (Tencent mirror), so it belongs in the background with polling, never a foreground ssh.

```
# isolated DSH_HOME + a settings.yaml that suppresses the first-run modals (onboarding/locale/theme
# only — credentials never leave the session machine)
$ ssh "$LAB" 'cd /root/dsh-lab/dsh-custom-mode && DSH_HOME=/root/dsh-custom-lab ./install.sh'
    composition tree: 164 rows, dsh-custom-mode in place
$ ssh "$LAB" '/root/custom-lab.sh'
dsh web: http://127.0.0.1:3082/?token=SaOzofZ2…
```

Browser: the lab already carries playwright's chromium
(`/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`); `/root/chrome-lab.sh` starts it
with `--headless=new --remote-debugging-port=9222`.

```
$ ssh "$LAB" '/root/chrome-lab.sh'
{"Browser": "Chrome/153.0.8010.12", "Protocol-Version": "1.3", …}
```

### 14.2 Result: 21/21

```
$ ssh "$LAB" 'cd /root/dsh-lab/dsh-custom-mode && CDP_PORT=9222 \
    node tools/browser-verify.mjs --url "http://127.0.0.1:3082/?token=…" --out /root/custom-mode-verify.png'

PASS  first-run overlay cleared (otherwise every click below is intercepted)
PASS  the 「自定义模式」 settings page opens
PASS  no raw translation keys in the panel
PASS  rendered the 「助手」 section heading
PASS  rendered the 「新增助手」 button
PASS  rendered the 「上移」 button
PASS  rendered the 「下移」 button
PASS  rendered the 「复制一份」 button
PASS  rendered the 「导出提示词」 button
PASS  rendered the 「导入提示词」 button
PASS  rendered the system-prompt section
PASS  rendered the base-mode section
PASS  rendered the plugin-switch section
PASS  every switch has a visible row title
PASS  the left nav entry is not the raw key nav
PASS  the new assistant appears in the list
PASS  the delete risk-confirmation opens
PASS  the confirmation has an acknowledgement checkbox
PASS  「永久删除」 clicked
PASS  the assistant is gone from the list
PASS  no dsh-custom-mode error in the page console

result: 21 passed, 0 failed
```

The screenshot was copied back and inspected **by eye**: the nav reads 「自定义模式」; the 「助手」
section has the hint text, the pill, the full-width create field and 「+ 新增助手」; 「模式名称」 has two
full-width inputs; the action row shows 「上移 / 下移 / 复制一份 / 删除这个助手」 (move buttons correctly
disabled with a single assistant); 「基础模式」 shows four pills plus the note line; 「插件开关」 shows two
cards whose switches have **visible titles** (「身份（系统提示词）」, 「custom_prompt 工具」). Zero raw keys.

### 14.3 Two traps the verifier itself hit (both fixed)

- The settings panel is itself `[role=dialog]`, so `querySelector('[role=dialog]')` returned the
  **panel**, not the confirmation — the assertion failed, the checkbox got ticked, and the confirm
  button was never clicked (the screenshot captured exactly that intermediate state). It now searches
  **all** dialogs by content.
- `RiskConfirmation`'s confirm button reads React state, so ticking and clicking must happen in **two
  ticks**, or the delete never fires.

## 15. Re-verification on dsh `0.1.6-alpha.2`, installed from npm

Everything below was run against a throwaway `DSH_HOME` and the package **as published**, not the
working tree: the tarball was first compared with `npm pack` of the repository and found byte-identical
(16 files, same list hash).

### The install path, and the detour it took

```
$ dsh plugin --profile web add dsh-custom-mode
+ dsh-custom-mode 0.1.6-alpha.1            ← the registry said `latest` = 0.1.6-alpha.2

$ node -p "require('$DSH_HOME/profiles/web/package.json').dependencies"
{ 'dsh-custom-mode': '0.1.6-alpha.1' }
```

That is pnpm's one-day supply-chain delay, not a registry problem: `minimumReleaseAge` defaults to
`1440` minutes in pnpm ≥ 11, alpha.2 was 13 hours old, alpha.1 was 24.3. Installing the exact version
works and records the exception:

```
$ dsh plugin --profile web add dsh-custom-mode@0.1.6-alpha.2
$ node -p "…dependencies"                 → { 'dsh-custom-mode': '0.1.6-alpha.2' }
```

The symptom on the older version is visible and is exactly what the seeding work removed: no
`custom-mode: 已播种` line, no `$DSH_HOME/.agent-presets/`, and the settings route answering
`{"ok":false,"error":"找不到组成文件：…"}`.

### On the published alpha.2

```
custom-mode: 已播种 preset 到 …/.agent-presets/custom（新建 5 个文件: agent.cordis.yml, preset.yml,
             prompt.md, prompt-reader.mjs, prompt-tool.mjs）
GET /custom-mode          → 200 {"ok":true,"assistants":[{"id":"custom","name":"自定义模式",…}],"root":…}
GET /custom-mode (no cookie) → 401
```

`tools/browser-verify.mjs` against it: **21 通过, 0 失败** — the page opens, no raw translation keys,
the assistant block and its buttons render, the three blocks render, every switch has a visible row
title, create puts an assistant in the list, delete opens the risk confirmation, confirming removes it,
and the page logs no `dsh-custom-mode` error.

### Several assistants (the new capability), checked on disk

| Step | Result |
| --- | --- |
| `POST /custom-mode/create {"name":"writer"}` | id `writer` — an English name becomes the directory name |
| `POST /custom-mode/create {"name":"写作助手"}` | id `custom-2` — anything that is not a legal id falls back |
| Each assistant's directory | `agent.cordis.yml`, `preset.yml`, `prompt.md`, `prompt-reader.mjs`, `prompt-tool.mjs` |
| Prompt written to `writer`, then to `custom-2` | `writer/prompt.md` = `WRITER-PROMPT-V2`, `custom-2/prompt.md` = `CUSTOM2-PROMPT`, `custom/prompt.md` untouched |
| Base mode per assistant | `writer` → `# 基础模式: standard`, `custom-2` → `# 基础模式: minimal` |
| A hand-authored preset (`handmade/`: no `prompt.md`, composition does not use `prompt-reader.mjs`) | not listed, a save for it is refused with a readable error, and its files are byte-identical afterwards |
| `POST /custom-mode/delete {"id":"writer"}` | directory removed, list back to two |
| Restart dsh | the deleted assistant does **not** come back; the other two keep their own prompts; `handmade/` is still untouched |

### Two tooling bugs this run surfaced

- `tools/screenshots/screenshots.mjs` still looked for the old controls: the switches are the shell's
  own atoms now (`[role=switch]` with `aria-checked`; measured 32 rows, 32 switches, **0**
  `input[type=checkbox]`), and the save control is a plain `button`, not `.cpfe-btn`. Both lookups were
  rewritten, which is what makes the four README images regenerable again.
- `tools/screenshots/run-shots.sh` resolved its output directory **after** changing into
  `tools/screenshots/`, so a relative `docs/images` was created inside the tool directory instead of the
  repository. It now resolves the path before the `cd`; verified by re-running with the relative
  argument and watching the images land in `docs/images/`.

---

---

## 16. The HTTP surface moved onto the platform's fenced channel (0.1.6-alpha.2, throwaway instance)

An external review pointed out that this plugin registered its routes on the bare `ctx.webServer` table and
called `ctx.connection.requestRejection` itself, while the platform ships a fenced alternative. Verified, and
`1.0.3` completed the migration.

### 16.1 Probe first: measure what `/api` really does instead of inferring it from the types

A 20-line probe plugin (three `/api` routes, `methods`/`requestBody` copied from how the official packages
register) installed into a throwaway `DSH_HOME` (port 3094):

```text
GET  /api/rev-probe                   unauthenticated           → 401 unauthorized
GET  /api/rev-probe                   session cookie            → 200 {"probe":"get-ok",...}
GET  /api/rev-probe?x=1&y=2           session (query visible)   → {"probe":"get-ok","query":"?x=1&y=2",...}
POST /api/rev-probe-post              unauthenticated           → 401
POST /api/rev-probe-post              session + JSON body       → 200 {"probe":"post-ok","got":{"a":1}}
POST /api/rev-probe-post              session + bad JSON        → 400 (the message our own handler returned)
GET  /api/rev-probe   session + Origin: https://evil.example + Sec-Fetch-Site: cross-site → 403
GET  /api/rev-probe   Host: evil.example                         → 403
POST /api/rev-probe   (that route declares GET only)             → 404 (the handler is never reached)
GET  /api/rev-probe/nope   an unregistered sub-path              → 404
GET  /rev-probe            (the old bare-route shape)            → 404
```

**Two facts that are easy to get wrong**: the registered `path` must **include the `/api` prefix** (the
official packages pass `/api/present.host`, `/api/changes.summary`; the types' "below /api" describes the URL
space — a first attempt with `/rev-probe` got 404s); and a method a route does not declare is **never
dispatched**, so it yields 404 rather than 405.

### 16.2 After the migration (`/api/custom-mode*`, port 3095)

```text
GET  /api/custom-mode                    unauthenticated         → 401 unauthorized
POST /api/custom-mode/state              unauthenticated (JSON)  → 401, prompt.md md5 unchanged
GET  /api/custom-mode                    session cookie          → 200 {"ok":true,"assistants":[…]}
GET  /api/custom-mode                    session + cross-site Origin → 403
GET  /api/custom-mode                    Host: evil.example      → 403
GET  /custom-mode                        (the old bare route)    → 404
POST /api/custom-mode/state              session cookie          → 200 saved; prompt.md and composition written
```

The browser half (real browser over CDP): `tools/browser-verify.mjs` **21 passed / 0 failed** — the
create/delete round trip, the risk-confirmation dialog and the language/theme switches all work on the new
paths.

Structural assertions on the code (`test/editor-route.test.mjs`): all five exact paths are registered on
`connection.fetch` with `requestBody: 'buffered'`; `create`/`delete`/`reorder` declare POST only; the source
contains **no** `requestRejection(` call and **no** `webServer.register(`; and when `connection` never
arrives, **nothing is registered at all**.

---

## 17. In-session prompt rewrites go through the platform's approval seam (0.1.6-alpha.2, real sessions)

The requirement: `custom_prompt`'s `write` replaces the whole system prompt, and the caller can be an injected
model — that path had no gate at all. The fix registers `tools/pre-execute` (a waterfall) and answers
`{kind:'ask'}` for the write action, leaving the outcome to the platform's approval policy.

### 17.1 Probe first: do not infer the behaviour from a type comment

A 20-line probe plugin (registers the listener only, answers `ask`) driven through a real session on a
throwaway instance:

```text
[ask-probe] tools/pre-execute listener registered
$ in the session: use the custom_prompt tool to set the system prompt to 审批测试第一版. One tool call only.
# permission preset = danger-full-access (approval: never):
工具调用Error: the user rejected tool "custom_prompt"          ← no panel; treated as a denial
思考The user rejected the tool call. I should stop and explain.
(prompt.md unchanged)

# permission preset = workspace-write (approval: ask):
工具调用 custom_prompt · write
等待审批
ask-probe：改系统提示词前需要你确认          ← the reason we passed is shown verbatim
[拒绝] [允许一次]
# after clicking 「允许一次」:
已生效：系统提示词已改为 审批实测通过。
(on disk: /…/.agent-presets/custom/prompt.md now contains 审批实测通过)
```

**Two conclusions**: whether `ask` shows a panel is decided by the **approval policy** (`never` → no panel,
straight denial; `ask` → the panel), so the worst case for this gate is "the change does not happen", never
"it happened quietly".

### 17.2 Re-checked with our own gate in place

```text
panel text: 等待审批
            把「自定义模式」的系统提示词整体替换为 7 字符：审批实测通过。（写入 /tmp/…/prompt.md）
            [拒绝] [允许一次]
click 「允许一次」 → the tool runs and the file becomes 审批实测通过 (the agent also reported where it wrote and what it affected)
click 「拒绝」     → prompt.md md5 unchanged (fb6bdc8c…), the file was not touched
```

The browser verification (`tools/browser-verify.mjs`) covers the settings-page side separately; this chain
needs a real session, which is why it is recorded here.

The sequence above was read by hand from the trajectory tab; `tools/session-trace.mjs` (added after this run)
turns the same evidence into one command — `node tools/session-trace.mjs --home <that home> [--summary]` — and
prints the per-tool tally that shows, for example, whether an agent needed one call or two.

---

## 18. Model-in-the-loop deep test (0.1.6-alpha.2, test-account token, throwaway instance)

Real model sessions (`DeepSeek-V4.1-Flash`) were used to check the contracts that **only a real session can
check**. Conclusions and non-conclusions are kept apart.

### 18.1 Verified

1. **All three paths of the approval gate** (raw output in §17): policy `ask` + allow → the write really
   happens; `ask` + deny → the file's md5 is unchanged; policy `never` → no panel, straight denial. The worst
   case is "the change does not happen", never "it happened quietly".
2. **`{{model}}` is rendered into the host's real model id**: the session described itself as "an encoding
   agent powered by the `deepseek-flash` model" — the template says `{{model}}` and the host substituted the
   real id. (This is the field most easily got wrong: the interface's display name is not the real id.)
3. **An unregistered variable does not kill the session**: with `prompt.md` hand-written to contain `{{nope}}`,
   the session still answered (1+1 → 2). The settings page refuses to save such text, but a file broken by
   another path must not take the session down with it.
4. **Preset attribution of a session**: a new session takes `agent-presets.default` from `settings.yaml`
   (measured: after setting it to `custom`, a new session's mode is 「自定义模式」); and **a session that has
   produced content cannot switch presets** (matching the upstream documentation, and the easiest trap in
   automation: sending into an old session measures a different mode).

### 18.2 The hot-reload contract: **holds** (and my first attempt got it wrong — recorded here)

**Conclusion**: rewriting `prompt.md` inside a session that **has already produced content** takes effect on
the **next step** — the promise in §0 above, independently reproduced.

The clean experiment (throwaway instance, `0.1.6-alpha.2`, `deepseek-flash`, session mode confirmed to be
「自定义模式」):

```text
[turn 1] ask once, while prompt.md has no marker rule
  ask: 5+5 等于几？
  reply: 5 + 5 = 10                     ← no marker in the reply (clean baseline)

[write the rule] put a marker format rule into prompt.md (same session, nothing else changed)

[turn 2] ask again in the same session
  ask: 6+6 等于几？
  reply: [[MARKER-7F3A]]                ← first line is exactly the marker the rule demands
         6 + 6 = 12
  the page also showed the platform's own annotation: **「系统提示词更新」**
```

**My first "it does not take effect" was a fault in the test design, and it is worth recording**: that run
went "write the rule, ask once (the reply already contains the marker) → remove the rule, ask again", and the
later replies still carried the marker. I read that as "the session is frozen on the prompt it mounted with",
but the real cause was **the model imitating its own earlier replies** (few-shot self-imitation), unrelated to
whether the system prompt was updated. The lesson: when checking whether a prompt change took effect, **the
baseline turn must not contain the feature you are about to look for**, otherwise everything you see later may
be imitation.

This also explains why the `custom_prompt` tool's write must only touch the file and not the session: the
platform re-reads the system prompt on the next step, so the plugin neither needs nor should poke at session
state.

---

## 19. From a real session to a check that can fail (0.1.6-alpha.2, real session)

The trace reader existed so that "the model called this tool once / twice" could be verified instead of
asserted. Closing that loop on reality also found a bug in the reader itself — which is the point of running it
against real logs rather than only synthetic ones.

```text
$ node tools/session-trace.mjs --home /tmp/dsh-exp-… --expect 'custom_prompt(read)=1'   # 第一次：假失败
会话 session-6f22e6f7-…：1 次工具调用
     1 × custom_prompt
  ✗ custom_prompt(read)：期望 1，实际 0

# 原因：真实日志里 data.arguments 是 **JSON 字符串**（"{\"action\": \"read\"}"），不是对象。
# 读取器只认对象 → 静默丢掉 action → 计数键退化成 custom_prompt（合成测试用的是对象，所以没暴露）。

$ node tools/session-trace.mjs --home /tmp/dsh-exp-… --expect 'custom_prompt(read)=1'   # 修好之后
会话 session-6f22e6f7-…：1 次工具调用
     1 × custom_prompt(read)
  ✓ 1 条期望都成立        （退出码 0；写错成 =2 时退出码 1）

$ node tools/session-trace.mjs --home /tmp/dsh-exp-…
工具调用（按时间）：
  t1/s1  custom_prompt {"action":"read"}
```

`--compare <A> <B>` 是同一件事的横向版本：两边各读一次，输出按 |Δ| 排序的差值表（例如换实现后
"总调用数 +0，custom_prompt(append) 1 → 1"）。

---

## 20. The mode disappeared from every picker on the stable line (reported by a review, confirmed, fixed)

**Symptom**: on `0.1.5-rc.2` (the npm `latest` line, i.e. most users' default), 「自定义模式」 did not appear in the
new-session mode picker at all. The settings page still opened and worked.

**Root cause, reproduced here**:

```text
$ grep -n -A2 "workflow-ptc" editor/preset/agent.cordis.yml     # our packaged seed template
    - id: workflow-ptc
      name: '@deepseek-ai/dsh-workflow-ptc'

$ ls /tmp/dsh-stable3/node_modules/@deepseek-ai/ | grep -c workflow-ptc
0                                                                # the stable line does not ship that package
$ grep -c workflow-ptc <preview>/presets/standard/agent.cordis.yml
2                                                                # the preview line does
```

An enabled row whose plugin cannot be resolved makes the platform's health check mark the whole preset broken,
and a broken preset is dropped from the pickers — silently, since the settings page never needs the preset to be
resolvable. Our packag seed template had been rendered from the **preview** line, so it carried that row.

**Why the double-line CI missed it** (the review's point, and it is correct): the stable job ran the suite, which
checks text surgery, routes and dictionaries — none of which ask "is this preset healthy on this line"; the UI
verification only ever ran against the preview line and only against the settings page, never the picker.

**Fix**: the seeded composition is no longer a copy of a packaged file — it is rendered from the composition the
**installed line actually ships** (`starterComposition()` in `editor/seed.mjs`), with the packaged file kept only
as a fallback when that cannot be read. `install.sh` no longer copies a composition at all, so the first
activation writes the derived one. A new check in `test/seed.test.mjs` walks every **enabled** row of the derived
composition and asserts its package resolves in this install; on the stable line it prints the template's own
problem, which is the bug it prevents:

```text
说明：包内模板在本线有 1 处不可解析（workflow-ptc → @deepseek-ai/dsh-workflow-ptc）—— 这正是播种改为"按本线派生"的原因。
```

**Verified on the stable line** (throwaway `DSH_HOME`, plugin installed from the working tree, port 3108):

```text
$ ls $DSH_HOME/.agent-presets/custom/
agent.cordis.yml  preset.yml  prompt-reader.mjs  prompt-tool.mjs  prompt.md
$ grep -c workflow-ptc $DSH_HOME/.agent-presets/custom/agent.cordis.yml
0
$ node tools/picker-probe.mjs <url>           # opens the new-session picker over CDP
  当前模式按钮: {"text":"自定义模式"}
  选择器里的模式: ["自定义模式","标准模式","PTC 模式","极简模式"]
  ✅ 稳定线上「自定义模式」出现在选择器里
```

