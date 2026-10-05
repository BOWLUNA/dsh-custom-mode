---
name: dsh-plugin-upgrade
description: >-
  Adapt dsh-custom-mode when DeepSeek Harness (dsh) ships a new version.
  Use for peerDependencies, engines.dsh, cordis.patch.yml, composition text
  surgery, preset-backend detection, settings-page registration, or a request
  to run oh-my-dsh/dsh-plugin-upgrade-skill, plan-migration, or inject-lint.
  Read-only until the user confirms a source change. Never publish, never
  npm install -g dsh from inside a running dsh session.
---

# 把 dsh-custom-mode 接到新的 dsh 版本

上游证据库是 [oh-my-dsh/dsh-plugin-upgrade-skill](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill)（探测时的 HEAD 是 `be3b3f7`）。本技能是它在**这个仓库**里的用法，不是那 195 张卡片的副本。

先跑：

```sh
node tools/upgrade-preflight.mjs
```

它只读本仓库，不克隆上游，不改文件。

## 不做什么

- 不把 `skills/plugin-upgrade/references/` 整库拷进本仓库，也不打进 npm 包。`package.json` 的 `files` 没有 `.cursor/`。卡片大多是 draft，而且走廊到不了本插件实际跑的 `0.2.0-rc.2`。
- 不把 `inject-lint.mjs` 的 `verdict: FIX-REQUIRED` 当成缺陷。那个结论把 `cordis` peer 精确比成 `^4.0.1`。本插件不声明 cordis peer。只在你自己把上游脚本跑在 `0.1.2-alpha.2` 那条边上时，才读 `cordisOk`。
- 不把 Desktop 上 `ctx.sessions` 为空、以及 Desktop 的最小 `PATH` 找不到 `pwsh` 这两条现场记录搬进本插件。本插件不查 `ctx.sessions`，也不为用户 spawn `pwsh`。
- 不在 dsh 会话里面执行 `npm install -g @deepseek-ai/dsh`。先停掉宿主，再从外部终端钉版本安装。
- 授权改源码不等于授权 `npm publish` 或 `git push`。

## 走廊缺口

已成卡停在 `dsh-v0.2.0-rc.1`。没有卡片的边：

- `0.1.7-rc.1` → `0.1.7-rc.2`
- `0.2.0-rc.1` → `0.2.0-rc.2` 以及更新的版本

`plan-migration.mjs --from dsh-v0.1.7-rc.1 --to dsh-v0.2.0-rc.2` 退出码 2 是对的：没有路就停，不许凭记忆补迁移。本插件声明支持的 `0.1.7-rc.2` 和 `0.2.0-rc.2` 都落在缺口里。对这两条线，证据是本仓库的测试、`tools/boot-check.mjs` 和 `tools/browser-verify.mjs`，不是上游卡片。

缺边时不要为了补卡去改用户的插件。往上游仓库加卡是另一件事。

## peer 范围

`DSH-0.2.0-RC1-01`（draft）说：`^0.1.x` 在 0.2.0 宿主上会被拒；`^0.2.0` 展开后也不包含 `0.2.0-rc.1`，因为 rc 小于 `0.2.0`。失败时 stderr 是 `disabling profile plugin row`，profile 文件不变，`--dump-config` 仍会列出那一行。不要用 dump 判断插件有没有挂上。

本仓库现在的 `engines.dsh` 与 `peerDependencies["@deepseek-ai/dsh"]` 是同一串五段并集，故意包含 `0.1.7-rc.2` 和 `0.2.0-rc.2`。不要把它收成 `^0.2.0` 或 `^0.2.0-rc.1`。后一种会丢掉 0.1.7。要收窄范围时，先在将要声明的每一条线上跑 `boot-check`，再同时改 peer、`engines.dsh`、CI 矩阵和 README 里的那一串。`tools/verify-version-consistency.mjs` 要求这两处逐字相同。

## 本插件的触点

改宿主耦合之前先读 [touchpoints.md](touchpoints.md)。七类里真正会碎的是：组成文本手术、`preset-backend/detect.mjs`、`/api` 上的 `ctx.connection.fetch.register`、seed 只补不覆盖。

## 要用上游规划器时

只在目标 tag **有卡片**时克隆上游。Windows 上完整 clone 会在 `benchmark/results/` 因路径长度失败。稀疏检出，并打开 long paths：

```sh
git clone --filter=blob:none --sparse https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill.git
git -C dsh-plugin-upgrade-skill sparse-checkout set skills/plugin-upgrade
```

然后只跑只读的 `skills/plugin-upgrade/scripts/plan-migration.mjs`。不要跑 `verify-runtime.mjs`（它会真的安装并执行插件，且文档写明不是 Windows 入口）。零命中不等于只依赖公开契约。规划器退出之后，本仓库的套件、boot-check、浏览器闸门仍然要跑。
