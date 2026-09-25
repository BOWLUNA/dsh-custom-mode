# AGENTS.md

Instructions for coding agents working in this repository. The human-facing version is
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## What this is

A custom mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). It is
deliberately **two artifacts**, because they are mounted on different planes (see
`docs/ARCHITECTURE.md` §1):

| Artifact | What it is | Where it goes |
| --- | --- | --- |
| `preset/` | an agent preset (**a directory of files**, not an npm package) | `$DSH_HOME/.agent-presets/custom/` |
| `editor/` | the settings-page plugin (npm package + profile bundle) | `dsh plugin --profile web add ./editor` |

## Commands

```sh
node test/run.mjs                                  # 15 suites (the count is asserted by tools/verify-doc-numbers.mjs); resolves the shipped presets itself — on dsh ≥ 0.1.7 by deriving them from the host's declaration
node tools/verify-translation-pairing.mjs          # bilingual pairing + language-purity check (what CI runs)
node tools/verify-doc-numbers.mjs                  # documented counts vs the real run (what CI runs)

# 提交前把这三道守卫都跑一遍（漏一条就会在 CI 上红）：
#   1) node test/run.mjs                      —— 改了检查数量就要同步文档里的数字
#   2) node tools/verify-translation-pairing.mjs --write   —— 改了任一语言文件都要重录配对哈希
#   3) node tools/verify-doc-numbers.mjs      —— 最后再确认一次数字一致
# 本仓库真的因为"改了数字忘了重录配对哈希"而让四条 CI 矩阵全红过一次，别重复它。
bash -n install.sh && bash -n uninstall.sh         # syntax of the two scripts

# Against a real harness: always use a throwaway DSH_HOME, never the one in use
DSH_HOME=/tmp/dsh-dev ./install.sh
DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open
DSH_HOME=/tmp/dsh-dev dsh --profile web --dump-config | wc -l      # hundreds of lines = healthy

# Browser verification — the ONLY check that can see a rendered page. Needs a browser with a
# DevTools port and a running instance; see "The lab" below.
CDP_PORT=9222 node tools/browser-verify.mjs --url "http://127.0.0.1:3082/?token=…" --out shot.png

# Screenshots for the README (really clicks, saves, switches theme and language), see tools/screenshots/README.md
DSH_HOME=/tmp/dsh-dev ./tools/screenshots/run-shots.sh "http://127.0.0.1:3081/?token=…" docs/images

# The English set that GitHub and npm render (see tools/screenshots/README.md)
CDP_PORT=9222 node tools/screenshots/run-shots-en.mjs "http://127.0.0.1:3081/?token=…" docs/images
```

## What must not break

1. **Untouched rows stay byte-identical** (keeping `!!js` platform conditions and shipped `disabled`
   state). `composition.mjs` does text surgery, not a YAML round-trip — do not "simplify" it into
   parse-and-reserialise.
2. **The switch is tri-state**: untouched / explicitly on / explicitly off. `undefined` and `false`
   are two different things.
3. **HTTP routes are registered through `ctx.connection.fetch.register(...)`**, i.e. on the platform's
   shared `/api` channel, where the carrier applies the Host/Origin fence and browser auth **before**
   dispatch — and the registered paths include the `/api` prefix. Never register on the raw
   `webServer` table: it sits outside that policy, and doing so is how this plugin once let an
   unauthenticated GET read the prompt and an unauthenticated POST rewrite `prompt.md`.
   `test/editor-route.test.mjs` asserts both halves of that (the registrations, and that the source
   contains no `requestRejection(` call and no `webServer.register(`).
4. **Waiting for services belongs in a scoped `ctx.inject(deps, cb)`**, never in the row's own
   `inject`: otherwise a profile without a web server (tui) prints the same `pending` warning a
   broken installation does.
5. **The two copies of the `{{…}}` validator stay in step** (`editor/index.mjs` ↔
   `preset/prompt-tool.mjs`); a test compares their verdicts.
6. **The dictionary in `client.js` stays in step with `locales.mjs`**; a test extracts both and diffs them.
7. **`editor/preset/` is a packaging copy of `preset/`, not a second source.** npm can only ship
   files inside the package, so the five preset files exist twice; `test/seed.test.mjs` asserts they
   stay byte-identical. Edit `preset/`, copy, or the test fails.
8. **Seeding never overwrites user data — but it does refresh our own code modules.** User data
   (`prompt.md`, `preset.yml`, the generated `agent.cordis.yml`) is only ever filled in when missing, so a
   storefront install (`dsh plugin add <pkg>`) is complete on its own and a user's edits survive. The two
   **code** modules shipped into the assistant directory (`prompt-reader.mjs`, `prompt-tool.mjs`) are
   refreshed when they differ from the packaged ones — a fill-only policy left 1.0.x/1.1.x users running an
   approval-gate-less `prompt-tool.mjs` forever (external review, 1.9.3). Seeding must not throw either: an
   unwritable `DSH_HOME` is reported and the boot continues.
9. **`preset/prompt.md` and `preset/preset.yml` are user data.** Tests must write to temporary paths
   (`DSH_CUSTOM_PROMPT_PATH`, or copy the module into a temp directory and import it from there).
10. **支持策略：只跟两个"最新的"** —— 最新正式版与最新预览版（当前 `0.1.5-rc.3` / `0.1.7-rc.2`），
    也就是 `test.yml` 的两条腿 + `release.yml` 发布前各跑一遍的那两条。更早的预览线
    （`0.1.6-alpha.*`）与正式版共用同一套机制，peer 范围仍然接纳它，但**不为每条历史预览线加 CI 腿**：
    成本随版本数线性增长，而两条线之间的机制差异只有一次（≤0.1.6 扫描目录 / ≥0.1.7 声明式注册表）。
    换主轴版本时，两处都要改：`test.yml` 的 matrix 和 `release.yml` 的两次安装。

11. **The version number is the package's own stable line** (`1.0.0`, `1.0.1`, …) — it does not mirror
   dsh, and it must stay a bare `x.y.z` so directories and markets will auto-install it. Which dsh is
   supported is declared in `engines.dsh` + the peer range, and
   `tools/verify-version-consistency.mjs` asserts the CI-pinned dsh version falls inside them. Bump the
   version for every publish; widen the ranges when re-adapting.

12. **The change journal (`editor/journal.mjs`) has ONE writer: the host half.** The preset-side
    `prompt-tool.mjs` must not append to it — those files ship independently, so the format would end up
    with two implementations. Changes made outside the page are picked up by comparison at state-read time
    and recorded as `external`. Versions are keyed by the `n` sequence, never by timestamp (two records can
    share a millisecond), and loading a version only edits the draft.
13. **UI 必须用壳的原子，度量必须抄官方。** 两件实测过的坑：① 探测壳的组件时**不能**用
    `typeof x === "function"` —— 壳的组件是 `forwardRef`/`memo` 对象，这一条判错会让整页退化成手绘控件
    （1.9.15 之前的"廉价感"就是它）；判据是 React 能渲染（`$$typeof`）。② 我们自己的 CSS 必须抄官方设置页
    的度量：区块标题 14px/22px w500、引言 12px/18px tertiary、设置行 `padding:16px 0` + 一条 1px 分隔线、
    下拉用壳的 `Menu`。`tools/browser-verify.mjs` 里有对应的断言（含"开关是 `[role=switch]`、不许有手绘
    checkbox"），改动后必须 65/65。

14. **UI 改动必须真点一遍**：`tools/browser-verify.mjs`。这条踩过两次 —— 按钮渲染出来了但点不动
    （`draftOf` 丢字段让它一直置灰），以及真实鼠标点击落在被盖住的坐标上（同一按钮程序化点击正常）。
    凡是"点了会发生什么"的断言，都用程序化点击，并同时对**磁盘真值**断言，而不是对页面早先显示过什么。

15. **Every user-visible host result carries a `code`** (plus `params`); the page renders it from its own
    bilingual dictionary. The Chinese `note`/`error` strings stay as the HTTP API's compatibility face — but
    they must never be what the *page* shows, or the English UI turns Chinese exactly when something happens.
    `tools/browser-verify.mjs` switches the interface to English and saves once to keep this honest. Names
    inside those messages are user data and are never translated.

16. **Where a base composition comes from is the THIRD thing the two dsh lines disagree about.** That is what
    `editor/base-composition.mjs` exists for. Legacy lines (≤ 0.1.6) ship
    `@deepseek-ai/dsh-agent-presets/presets/<mode>/agent.cordis.yml`; 0.1.7+ publishes no such package and the
    host hands the declaration over through `agentPresets.readDocument(<mode>).content` — the entry-list YAML,
    `isolate` groups and `!!js` included (the flattened `compositionInventory()` cannot be used: the groups
    are gone, measured). Two rules follow, and 1.9.12's P0 is what breaking them looks like:
    **a)** no caller may reach for the filesystem on its own, and **b)** when no route yields text the page must
    **degrade**, not throw — `readState` returns a state with `baseUnavailable` plus the prompt, and
    `saveState` / `savePromptOnly` save the prompt while **refusing** (with a typed code) any switch change.
    `test/base-composition.test.mjs` pins the route order, the typed failure and the degraded save.

17. **「删除助手」在两条线上都必须真的删掉。** 声明式线（0.1.7+）没有 `agentPresets.remove()` —— 注销只有
    `register()` 返回的 disposer 一条路 —— 所以删除由声明式后端自己做：**先注销、再删目录**。找不到目录时
    返回类型化的 `noDirectory`，**不许**报告"已删除"却把目录留在磁盘上：下次同步会把它挂回来，用户看到的
    是"删了又回来了"。宿主那半按后端选删除入口（`presetRemover()`），只有两套都没有时才可以回
    `noRemoveApi`。`test/preset-backend.test.mjs` 钉住两半；`tools/browser-verify.mjs` 的删除断言对
    **API 真值**（磁盘）断言，并覆盖**两条确认路径**（壳内 `RiskConfirmation` / 原生 `confirm`）。
    1.9.14 之前这条线根本删不掉，而它正是官方桌面端跑的那条。

## Known traps (all measured)

- `agent-presets` exists **only in the web profile composition**; tui and headless do not have it, so
  the custom mode cannot even be selected there.
- `dsh --profile headless` refuses to run a session that uses an agent preset
  (`the one-shot runner does not compose`), so end-to-end verification has to go through a web instance.
- `agent-presets.default` is hard-coded to `standard` in the composition; the same key in
  `settings.yaml` is a **runtime override**. They are not the same thing.
- pnpm can leave the plugin symlink behind in `node_modules` (`uninstall.sh` cleans it up).
- **CI's fixture step must not install the 0.1.6 presets package on a 0.1.7 tree.** It fails with
  `ERESOLVE`, and under GitHub's `bash -e` that is a failed *step* — which is how all three 0.1.7 legs stayed
  red from 1.9.10 to 1.9.12 while the release gate (older dsh line only) stayed green. `test/run.mjs` derives
  the fixture from the installed host's declaration instead; the materialized directory must stay under the
  repository's `node_modules` (see the comment in `test/run.mjs`).
- Under WSL, if the `pnpm` on PATH is the Windows build, `dsh plugin add` panics with
  `current dir is an absolute path with drive letter`; use the Linux build (`corepack enable pnpm`).

## The lab (browser verification)

Unit tests here are blind to the last mile: they prove the host answers and the bundle registers,
but not what the page *renders*. That gap shipped a real bug — a page of raw keys
(`assistant.heading`) that every suite passed through. So a UI change is not verified until
`tools/browser-verify.mjs` has run against a real instance.

The lab is any second machine you can reboot freely (`$LAB` below); the machine running the harness
is **never** a test target — its `dsh web` serves the user and hosts the running agent, so restarting
it kills the session. Concrete hosts, addresses and launcher scripts belong in the operator's own
`~/.dsh/AGENTS.md`, which is not part of this repository.

```sh
# 1. ship the tree (the lab has its own checkout; node_modules excluded)
tar czf - --exclude=node_modules --exclude=.git -C <repo-parent> dsh-custom-mode \
  | ssh "$LAB" 'tar xzf - -C /root/dsh-lab'

# 2. a throwaway DSH_HOME on the lab. Seed settings.yaml (onboarding version + locale + theme) so
#    the first-run modals stay away. NEVER copy ~/.dsh/.credentials.yaml — credentials stay here.
ssh "$LAB" 'mkdir -p /root/dsh-custom-lab && cd /root/dsh-lab/dsh-custom-mode \
  && DSH_HOME=/root/dsh-custom-lab ./install.sh'

# 3. boot it (a script + setsid, not a foreground ssh command) and read the token URL from the log
ssh "$LAB" '/root/custom-lab.sh && cat /root/custom-lab.log'

# 4. a browser with a DevTools port. The lab already has playwright's chromium and a launcher.
ssh "$LAB" '/root/chrome-lab.sh'          # CDP on 127.0.0.1:9222

# 5. verify the rendered page (create/delete round trip included), then look at the screenshot
ssh "$LAB" 'cd /root/dsh-lab/dsh-custom-mode && CDP_PORT=9222 \
  node tools/browser-verify.mjs --url "<token URL>" --out /root/verify.png'
scp "$LAB":/root/verify.png /tmp/verify.png               # then read the image
```

**Never `taskkill /F /IM chrome.exe` on a machine where the user browses.** Measured the hard way: that
kills the user's own browser windows too, and the symptom ("Chrome keeps dying and restarting, I never had
this before") points at the wrong culprit for a long time. Kill only the headless instance *you* started, by
matching its own profile directory:

```sh
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" |
  Where-Object { $_.CommandLine -like '*dsh-shots*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
```

Also measured: `--headless=new` over CDP from WSL wedges after a handful of runs (`CDP timeout: Page.navigate`
/ `Page.captureScreenshot`), and **reusing one profile + port across runs** is more stable than launching a
fresh `--user-data-dir` and hard-killing the previous one.

`pkill -f "some string"` over ssh matches **its own command line** and kills the session
(`exit 255`); use the `[x]` trick. Long operations (an `npm i -g`) belong in a script behind
`setsid nohup`, polled — not in a foreground `ssh`.

## Knowing when you are done

- Code: `node test/run.mjs` is green. Docs: `node tools/verify-translation-pairing.mjs` passes
  (both sides of a pair must be edited, then re-recorded with `--write`) **and**
  `node tools/verify-doc-numbers.mjs` passes — a number in a README is a claim, and that tool compares every
  one of them (suite count, check count, declared dsh range, the version in SECURITY's support table) with the
  real run. It exists because a review found three drifts in one pass that no test could see.
- **A real session's tool calls**: `node tools/session-trace.mjs [--home …] [--session …] [--summary]` reads
  `session.v3.jsonl.zstd` directly and prints the call sequence plus a per-tool tally. Session logs are
  **multi-frame** Zstandard and Node's one-shot decoder returns only the first frame *without an error*, so the
  reader scans frame magics and decodes each one (dsh's own reader uses a private stream handle; this stays on
  public API). Run it before writing any "the model did X once / twice" sentence — it has already caught one
  wrong claim of exactly that shape. It reads session *content*: prefer `--summary` (counts only) when the log
  is not yours. `--expect 'custom_prompt(read)=1'` turns such a sentence into a **check** (exit 1 on mismatch),
  and `--compare <homeA> <homeB>` answers "did this change make the agent take more or fewer steps?".
- **The mode is actually offered**: after touching seeding, composition or the dsh range, run
  `node tools/picker-probe.mjs --url "<token URL>" --expect 自定义模式`. A review found the stable line dropping
  the mode from every picker while the settings page (and therefore `tools/browser-verify.mjs`) stayed green —
  "the preset is healthy on this line" is a fact only a rendered picker can show.
- Behaviour: run it for real under a throwaway `DSH_HOME` and write the observed output into
  `docs/MEASUREMENTS.md` — this repository's convention is that a conclusion comes with the command
  and its raw output, not with "should be fine".
