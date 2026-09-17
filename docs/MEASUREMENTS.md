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
DSH_SHIPPED_PRESETS_DIR=<0.1.6-alpha.1 presets> node test/run.mjs   → 8 suites, all pass
DSH_SHIPPED_PRESETS_DIR=<0.1.6-alpha.2 presets> node test/run.mjs   → 8 suites, all pass
```

### Side finding: `chmod` cannot fake an unwritable directory as root

`test/seed.test.mjs` used `chmod 0o500` on the parent directory to exercise the seeding failure
path. Measured: **root bypasses permission bits**, so seeding succeeded and three assertions flipped
to red. They were green on CI (a non-root runner) and red for anyone running the suite as root — a
test whose outcome depended on who ran it. Blocking the path with a regular file instead fails with
`ENOTDIR` for every user, and the assertions now mean the same thing everywhere.
