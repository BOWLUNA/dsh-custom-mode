#!/usr/bin/env node
/**
 * Boot check — does the plugin actually install and start?
 *
 *   node tools/boot-check.mjs --port 32010
 *
 * ## Why this exists, and why `--dump-config` is not a substitute
 *
 * `--dump-config` composes configuration; it does **not** apply plugins. A patch row whose `name`
 * has drifted from the package name dumps a clean tree — exit 0, empty stderr, row still listed —
 * while a real boot dies with `ERR_MODULE_NOT_FOUND`. This repository has been on the receiving end
 * of exactly that: in `0.1.7` the preset mechanism changed, the settings page's capability gate
 * disabled the whole page, and nothing in the existing guards could see it, because none of them
 * ever *ran* the plugin.
 *
 * `dsh plugin add` is also the only place that can see a second failure class this repository has
 * hit for real: two plugins registering the same tool name. It takes the whole profile down.
 *
 * ## Why this matters more since dsh 0.2.0
 *
 * `0.2.0` turned the peer range from a warning into an **installation gate**: a package whose
 * `peerDependencies["@deepseek-ai/dsh"]` does not cover the running harness is refused outright
 * (`installation rejected`, `nothing was installed`). So "which dsh does this support" is no longer
 * a documentation claim — it decides whether a user can install at all. Assertion A is that gate,
 * exercised the way a user hits it.
 *
 * ## Why Node and not bash
 *
 * A bash guard can only run on Linux: Git Bash rewrites POSIX paths handed to a native node process
 * (`/d/a/repo` becomes `D:\d\a\repo`). A Node guard has no shell in the path, so it covers Windows
 * too — and Windows is where this repository has found its worst platform-specific defects
 * (`install.sh` MSYS paths, `rename` locking under concurrent saves, platform expressions
 * evaluating the other way).
 *
 * ## Assertions
 *
 *   A  `dsh plugin --profile web add <repo>` returns 0
 *   B  `cordis.patch.yml`'s row `name` equals `package.json`'s `name`
 *   C  `--profile web --port <N> --no-open` leaves the port answering **and it is still
 *      answering, with the process alive, `--settle` ms later**
 *   D  no **fatal** pattern appears in stderr by the time the port answers
 *
 * C is asserted on the socket, never on a printed banner: dsh `0.1.5-rc.2` boots with completely
 * empty stdout while `0.1.6-alpha.2` prints `dsh web: http://…`, and both lines are supported. An
 * assertion on the banner is red on one supported line for a difference in wording.
 *
 * The "and stays up" half of C is not belt and braces — but **what it can catch depends on the
 * platform**, and that changed under us:
 *
 *   · Measured on a sibling repository against dsh 0.1.x: with a `throw` at the top of the module
 *     the harness binds the port, serves for about 200 ms, then dies. A single connect samples that
 *     window and reports a completely broken plugin as booting — worse than having no guard.
 *   · Measured **here** against 0.2.0: the harness **tolerates** a plugin that fails to import. The
 *     port answers for the whole settle window and the process stays alive, so C passes while the
 *     plugin is entirely absent. The defect surfaces only in stderr, which is why assertion D's
 *     capture point is the end of the settle window and not the first answer — with the earlier
 *     capture point the same injection was measured going **red on one run and green on the next**.
 *
 * So on 0.2.0, D is the assertion that actually covers "host half crashed on load"; C covers
 * "the profile came up at all". They are not redundant, and neither one alone is sufficient.
 *
 * D is a whitelist of fatal patterns, not "not one byte". This plugin degrades on purpose: when a
 * line's optional capabilities are missing it prints what is missing and keeps working (measured —
 * `agentPresets.remove()` is absent on `0.2.0`, and the page still functions). Failing a boot for
 * that would train people to ignore assertion D, and a guard that gets ignored is worse than none.
 * So the rule is: a fatal pattern fails; a non-fatal one is still printed, so a degraded boot is
 * visible rather than merely tolerated.
 *
 * Exit status, deliberately three-valued so a red never leaves you guessing which of the two things
 * broke:
 *
 *   0  the plugin installed, mounted, and served
 *   1  an assertion failed — the plugin is at fault, and the failed one is named
 *   2  the environment is missing something (harness or pnpm) — **the plugin is not at fault**
 *
 * ## Harness discovery
 *
 * Never assume `dsh` is on PATH: a development box has a machine-wide install, CI has a
 * `node_modules` one. In order:
 *
 *   1. `--dsh-bin <path>`        explicit, wins over everything
 *   2. `$DSH_INSTALL`            the supported way to point at a harness
 *   3. `<repo>/node_modules/@deepseek-ai/dsh`
 *   4. `dsh` on PATH
 *   5. nothing                   exit 2, with the copy-pasteable recipe
 *
 * ## Options
 *
 *   --port <n>      port to bind                 (default 32010)
 *   --timeout <ms>  how long to wait for C       (default 60000)
 *   --settle <ms>   how long C must keep holding (default 2000)
 *   --home <dir>    throwaway DSH_HOME           (default: a fresh mkdtemp)
 *   --dsh-bin <p>   harness entry point          (see above)
 *   --profile <n>   profile to use               (default web)
 *   --keep          keep the throwaway home (for inspecting a failure)
 *   --quiet         only print the verdict
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

// ── arguments ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const PORT = Number(flag("port") ?? 32010);
const TIMEOUT = Number(flag("timeout") ?? 60_000);
const SETTLE = Number(flag("settle") ?? 2000);
const PROFILE = flag("profile") ?? "web";
const DSH_BIN = flag("dsh-bin");
const QUIET = has("quiet");
const KEEP = has("keep");

if (Number.isInteger(PORT) === false || PORT < 1 || PORT > 65535) {
  console.error(`x  --port must be a port number, got ${String(flag("port"))}`);
  process.exit(2);
}

const say = (line) => {
  if (QUIET === false) console.log(line);
};

// ── the live-home guard, deliberately the first thing that runs ──
//
// A guard that boots against the real harness home fights whatever the user is running. This is
// not hypothetical: a previous revision of the bash guard in a sibling repository was invoked
// without its `DSH_HOME` prefix, and `dsh plugin add` wrote into the live `~/.dsh/profiles/web`.
// Assert before anything else can write.
const LIVE_HOME = resolve(join(homedir(), ".dsh"));
const HOME_DIR = resolve(flag("home") ?? mkdtempSync(join(tmpdir(), "dsh-boot-")));

if (HOME_DIR === LIVE_HOME || HOME_DIR === resolve(homedir())) {
  console.error(`x  refusing to use the live harness home as a throwaway: ${HOME_DIR}`);
  console.error("   A boot against it fights the user's running sessions. Pass a fresh --home.");
  process.exit(2);
}

// Every exit path removes the throwaway home. A failure path returns early, so cleanup hung off
// the end of the happy path would leak a whole profile — and it would leak precisely on the runs
// someone is re-running while debugging. `--keep` opts out for inspection.
if (KEEP === false) {
  process.on("exit", () => {
    try {
      rmSync(HOME_DIR, { recursive: true, force: true });
    } catch {
      // Nothing useful to do at exit; a leftover temp directory is not worth masking the real
      // exit status for.
    }
  });
}

// ── harness discovery ──────────────────────────────────────────
/** The command to run `dsh` with, as an argv prefix. */
function commandFor(path) {
  if (/\.(m|c)?js$/.test(path)) return { cmd: process.execPath, args: [path] };
  return { cmd: path, args: [] };
}

function discoverHarness() {
  const tried = [];

  if (DSH_BIN !== undefined) {
    tried.push(`--dsh-bin ${DSH_BIN}`);
    if (existsSync(DSH_BIN)) {
      const r = commandFor(DSH_BIN);
      return { ...r, how: `--dsh-bin ${DSH_BIN}` };
    }
  }

  const install = process.env.DSH_INSTALL;
  if (install !== undefined && install !== "") {
    tried.push(`$DSH_INSTALL=${install}`);
    // `DSH_INSTALL` names a harness root; accept the shapes people write.
    for (const candidate of [
      join(install, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      join(install, "@deepseek-ai", "dsh", "lib", "bin.js"),
      join(install, "lib", "bin.js"),
    ]) {
      if (existsSync(candidate)) {
        return { cmd: process.execPath, args: [candidate], how: `$DSH_INSTALL (${candidate})` };
      }
    }
  }

  const local = join(REPO, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  tried.push(`<repo>/node_modules (${local})`);
  if (existsSync(local)) {
    return { cmd: process.execPath, args: [local], how: `<repo>/node_modules (${local})` };
  }

  tried.push("`dsh` on PATH");
  // `shell` only on Windows, where the shim is a `.cmd` and cannot be spawned directly. Node uses
  // cmd.exe there — this is not Git Bash and cannot rewrite a POSIX path behind our back.
  const useShell = process.platform === "win32";
  const probe = spawnSync("dsh", ["--version"], { encoding: "utf8", shell: useShell });
  if (probe.status === 0 && (probe.stdout ?? "").trim() !== "") {
    return { cmd: "dsh", args: [], shell: useShell, how: "`dsh` on PATH" };
  }

  return { tried };
}

const harness = discoverHarness();
if (harness.cmd === undefined) {
  console.error("x  no harness found — this is an environment problem, not a plugin problem.");
  console.error("   Tried, in order:");
  for (const t of harness.tried) console.error(`     - ${t}`);
  console.error("");
  console.error("   Point at one of these, then re-run:");
  console.error('     export DSH_INSTALL="<harness root>"   # the directory holding node_modules/@deepseek-ai/dsh');
  console.error("     npm install --no-save --no-audit --no-fund @deepseek-ai/dsh@0.2.0-rc.2");
  console.error("     node tools/boot-check.mjs --dsh-bin <path/to/@deepseek-ai/dsh/lib/bin.js>");
  console.error("");
  console.error("   No machine-specific path is baked in here on purpose: naming one developer's");
  console.error("   harness goes stale the moment that harness moves.");
  process.exit(2);
}

// ── helpers ────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves true when something accepts a TCP connection on the port. */
function probe(port) {
  return new Promise((resolveProbe) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (answer) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveProbe(answer);
    };
    socket.setTimeout(2000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

const run = (args, extraEnv) =>
  spawnSync(harness.cmd, [...harness.args, ...args], {
    cwd: REPO,
    encoding: "utf8",
    shell: harness.shell ?? false,
    env: { ...process.env, DSH_HOME: HOME_DIR, ...extraEnv },
  });

// ── report header ──────────────────────────────────────────────
// Deliberately forgiving: the header is diagnostic, and a manifest the guard cannot read is a
// thing assertion A/B should report, not a reason to die before naming which one failed. A crash
// here reads like a guard bug.
let pkgName = "(package.json unreadable)";
try {
  pkgName = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name ?? pkgName;
} catch {
  // reported below, and again by assertion B
}

say(`boot-check — ${pkgName}`);
say(`  repo:     ${REPO}`);
say(`  harness:  ${harness.how}`);
say(`  version:  ${(spawnSync(harness.cmd, [...harness.args, "--version"], { encoding: "utf8", shell: harness.shell ?? false }).stdout ?? "").trim() || "(printed nothing)"}`);
say(`  home:     ${HOME_DIR}`);
say(`  port:     ${PORT}`);
say("");

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail });
  say(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`);
};

justRun().catch((err) => {
  console.error(`\nx  boot-check itself threw: ${err?.stack ?? err}`);
  process.exit(1);
});

async function justRun() {
  // ── A · the profile accepts the plugin ─────────────────────
  //
  // Since dsh 0.2.0 this is also the peer-range gate: a range that does not cover the running
  // runtime is refused here with `installation rejected`. That is the user's path, so it is
  // asserted rather than assumed.
  mkdirSync(join(HOME_DIR, "profiles", PROFILE), { recursive: true });
  const add = run(["plugin", "--profile", PROFILE, "add", REPO]);
  const addOk = add.status === 0;

  // Classify "the harness cannot even run" separately from "the plugin is broken": a missing
  // package manager is an environment problem, and calling it a plugin failure is how a red gate
  // gets ignored.
  const addText = `${add.stdout ?? ""}${add.stderr ?? ""}`;
  const envish = /pnpm[^\n]*(not found|missing|not on PATH)|install pnpm/i.test(addText);
  record("A  plugin add", addOk, addOk ? "exit 0" : `exit ${String(add.status)}`);
  if (addOk === false) {
    console.error(addText.trim());
    if (envish) {
      console.error("\nx  the package manager is missing — environment, not plugin.");
      console.error("   Fix: npm install -g pnpm@12");
      process.exit(2);
    }
    process.exit(1);
  }

  // ── B · the row resolves to this package ───────────────────
  //
  // Read the two files rather than the composed tree. `--dump-config` cannot see this: a row that
  // does not resolve still appears, in an exit-0 dump with empty stderr. That is the gap assertion
  // C exists to cover.
  const patchPath = join(REPO, "cordis.patch.yml");
  // Every `name:` scalar in the patch must be the package name. This bundle declares exactly one
  // row, so a stricter reading is available than "the package appears somewhere" — and a second,
  // stale row would break the boot just as thoroughly as a wrong single one. Revisit if the
  // bundle ever declares more than one row.
  const rowNames = (existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "")
    .split("\n")
    .map((line) => /^\s*name:\s*(\S+)\s*$/.exec(line))
    .filter((m) => m !== null)
    .map((m) => m[1]);

  let bOk = false;
  let bDetail;
  try {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    bOk = typeof pkg.name === "string" && rowNames.length > 0 && rowNames.every((n) => n === pkg.name);
    bDetail = bOk
      ? `${pkg.name} (${String(rowNames.length)} row name[s])`
      : `row declares ${JSON.stringify(rowNames)}, package is ${String(pkg.name)}`;
  } catch (err) {
    bDetail = `package.json is unreadable: ${err.message}`;
  }
  record("B  row name == package name", bOk, bDetail);
  if (bOk === false) {
    console.error("\nx  The patch row's `name` must be the package name: it is resolved against the");
    console.error("   profile at boot, so a stale one produces ERR_MODULE_NOT_FOUND and a profile");
    console.error("   that will not start — while --dump-config still reports a clean tree.");
    process.exit(1);
  }

  // ── C and D · the boot ─────────────────────────────────────
  //
  // Refuse to test against a port that is already answering. A leftover listener from an earlier
  // run would make assertion C pass without the plugin ever starting — a guard that reports
  // success for the wrong reason is worse than no guard.
  if (await probe(PORT)) {
    console.error(`x  something is already listening on 127.0.0.1:${String(PORT)} — refusing to test against it.`);
    console.error("   Assertion C would pass on that listener without the plugin starting.");
    console.error("   Free the port, or pass --port with a free one.");
    process.exit(2);
  }

  const child = spawn(harness.cmd, [...harness.args, "--profile", PROFILE, "--port", String(PORT), "--no-open"], {
    cwd: REPO,
    shell: harness.shell ?? false,
    env: { ...process.env, DSH_HOME: HOME_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += String(d)));
  child.stderr.on("data", (d) => (stderr += String(d)));

  // Liveness must consider `signalCode` as well as `exitCode`. Measured on Windows: after
  // `kill("SIGTERM")` the child's `signalCode` flips to "SIGTERM" immediately while `exitCode`
  // stays `null` **forever** — so a loop watching `exitCode` alone believes a dead process is
  // still running.
  const alive = () => child.exitCode === null && child.signalCode === null;

  const deadline = Date.now() + TIMEOUT;
  let answering = false;
  let stderrAtAnswer = null;
  let exitedEarly = false;
  let diedAfterAnswering = false;
  let droppedAfterAnswering = false;

  while (Date.now() < deadline) {
    if (await probe(PORT)) {
      // Kept for the record only — assertion D evaluates the stderr captured at the **end of the
      // settle window**, not this one. See the note down there for why that distinction matters.
      stderrAtAnswer = stderr;
      answering = true;
      break;
    }
    if (alive() === false) {
      exitedEarly = true;
      break;
    }
    await sleep(250);
  }

  // ★ Assertion C is "answers **and stays** answering", not "answered once".
  //
  // Measured on a sibling repository, with a `throw` at the top of `index.js` and the row name
  // left correct: the harness binds the port, serves for about 200 ms, then dies with a 7 KB
  // stack trace. A single `net.connect` samples that window and reports a completely broken
  // plugin as booting — which is worse than having no guard at all. So after the first answer,
  // hold and require the process to still be alive, still answering, throughout.
  if (answering) {
    const settleBy = Date.now() + SETTLE;
    while (Date.now() < settleBy) {
      await sleep(200);
      if (alive() === false) {
        diedAfterAnswering = true;
        break;
      }
      if ((await probe(PORT)) === false) {
        droppedAfterAnswering = true;
        break;
      }
    }
  }

  // ★★ 断言 D 的快照点：**settle 窗口结束后**，不是"端口首次应答那一刻"。
  //
  // 这个改动来自 2026-10-01 在本仓的实测。把 `throw` 放在 `index.mjs` 最前面（host 半顶层
  // 抛错），连续跑同一条变异 —— **一次红、一次绿**：
  //
  //   第 1 次：FAIL D  * failed to import — the loader rejected an entry   → exit 1
  //   第 2 次：四条全 PASS                                                   → exit 0
  //
  // 根因：宿主在**端口开始应答之后**才完成插件树的装配，加载错误是那时才写进 stderr 的。
  // 而 dsh 0.2.0 的宿主**容错**插件加载失败（服务不死、端口全程应答），所以断言 C 那半拦不住
  // 它 —— 于是 D 成了唯一防线，而它若只快照"应答那一刻"，就是在跟加载错误**抢时间**。
  //
  // 这与本舰队记录过的「端口假应答」是同一个坑（`dsh web` 先绑端口再加载插件树），只是这一次
  // 它从 C 挪到了 D。判据一样：**同一条注入一次红一次绿 ⇒ 不是注入的问题，是断言的时机问题。**
  //
  // `stderr` 是累积串，所以它天然包含应答那一刻的内容 —— 用不着两个快照。
  const stderrAtSettleEnd = stderr;

  // SIGTERM, never SIGKILL: a SIGKILLed harness leaves its MCP children with a broken stdout, and
  // they answer with tracebacks.
  if (alive()) {
    child.kill("SIGTERM");
    const stopBy = Date.now() + 5000;
    while (alive() && Date.now() < stopBy) await sleep(100);
    if (alive()) {
      say("  (note: it ignored SIGTERM, so it had to be killed)");
      child.kill("SIGKILL");
      const killBy = Date.now() + 5000;
      while (alive() && Date.now() < killBy) await sleep(100);
    }
  }

  const cOk = answering && diedAfterAnswering === false && droppedAfterAnswering === false;
  record(
    "C  port answers and stays up",
    cOk,
    cOk
      ? `127.0.0.1:${String(PORT)} held for ${String(SETTLE)}ms`
      : answering === false
        ? exitedEarly
          ? "the process exited on its own without serving"
          : `nothing answered within ${String(TIMEOUT)}ms`
        : diedAfterAnswering
          ? "it answered, then died — the plugin failed to load"
          : "it answered, then stopped answering",
  );

  // ── assertion D: no FATAL pattern, not "not one byte" ───────
  //
  // This was `stderrAtAnswer === ""` in the first revision, and that was too coarse. See the file
  // header: this plugin degrades on purpose, and failing a boot for a declared, self-explaining
  // degradation trains people to ignore the assertion.
  //
  // So the rule is a whitelist of fatal patterns rather than silence. The whitelist is
  // deliberately short and every entry is auditable below.
  const FATAL_PATTERNS = [
    // A module could not be resolved: the plugin is not actually mounted.
    { re: /ERR_MODULE_NOT_FOUND/, why: "an import failed, so the plugin is not loaded at all" },
    { re: /Cannot find package/, why: "same failure, node's other wording for it" },
    // A loader error. `failed to prepare profile bundle` is the one this ecosystem has hit for
    // real: the row `name` and the package name drifted apart, and the whole profile refuses to
    // start.
    { re: /failed to load/i, why: "the loader rejected something" },
    { re: /failed to import/i, why: "the loader rejected an entry" },
    { re: /failed to prepare profile bundle/, why: "a row did not resolve — this has bricked a profile here" },
    // Two plugins registering the same tool name. Observed for real: it takes the entire profile
    // down, and only a real boot shows it.
    { re: /is already registered/, why: "two plugins claim one name; the profile cannot start" },
    // A schema the harness refuses. The failure mode of an out-of-range dsh.
    { re: /schema/i, why: "a tool definition was rejected by the schema DSL" },
    { re: /uncaught/i, why: "an exception escaped to the top level" },
    // ★ This plugin's own marker for the one degradation that is NOT acceptable: the settings page
    // disabling itself. Measured on a mismatched pair (0.2.0 runtime + a plugin that predates it),
    // it prints this and the plugin's only surface is dead. Missing *optional* capabilities are
    // reported on stdout and are fine; this one is fatal.
    { re: /设置页将不可用/, why: "the settings page disabled itself — the plugin's only surface is dead" },
    { re: /缺少所需 API/, why: "a required host API is absent, which is what disables the page" },
    { re: /settings page .*(unavailable|disabled)/i, why: "the settings page disabled itself" },
  ];

  /**
   * The fatal patterns a boot's stderr actually matches.
   *
   * @param text - captured stderr.
   * @returns the matching entries.
   */
  const fatalIn = (text) => FATAL_PATTERNS.filter((p) => p.re.test(text));

  const stderrAtAnswerText = stderrAtSettleEnd ?? stderrAtAnswer ?? "";
  const fatalAtAnswer = fatalIn(stderrAtAnswerText);
  const dOk = answering && fatalAtAnswer.length === 0;

  record(
    "D  no fatal pattern in stderr",
    dOk,
    answering === false
      ? "not reached"
      : fatalAtAnswer.length > 0
        ? `* ${fatalAtAnswer.map((p) => p.re.source).join(", ")} — ${fatalAtAnswer[0].why}`
        : `${String(stderrAtAnswerText.length)} bytes of stderr, none of it fatal`,
  );

  // A non-fatal warning is still printed, so a degraded boot is visible rather than merely
  // tolerated.
  if (dOk && stderrAtAnswerText.trim() !== "") {
    say(`      (non-fatal stderr, allowed by the whitelist: ${String(stderrAtAnswerText.trim().split("\n").length)} line(s))`);
  }

  if (cOk === false || dOk === false) {
    if (stdout.trim() !== "") console.error(`\n--- boot stdout ---\n${stdout.trim()}`);
    if (stderr.trim() !== "") console.error(`\n--- boot stderr ---\n${stderr.trim()}`);
  }

  // ── verdict ────────────────────────────────────────────────
  // (the throwaway home is removed by the exit hook, so a failure path — which returns early —
  // does not leak it either; --keep opts out)

  const failed = results.filter((r) => r.ok === false);
  say("");
  if (failed.length === 0) {
    say(`ok boot check passed: installed, mounted, and answered on port ${String(PORT)}`);
    process.exit(0);
  }
  console.error(`x  boot check failed on: ${failed.map((r) => r.id.trim()).join(", ")}`);
  process.exit(1);
}
