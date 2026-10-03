#!/usr/bin/env node
/**
 * Union mount check — can the union composition actually be mounted?
 *
 *   node tools/union-mount-check.mjs --port 32011
 *   DSH_INSTALL=<harness root> node tools/union-mount-check.mjs --port 32011
 *
 * ## What this covers that boot-check cannot
 *
 * `tools/boot-check.mjs` answers "does the plugin install, mount and serve". This one answers a
 * strictly later question: **is the fifth base mode (`all` — the union of the four shipped
 * compositions) a composition the host will actually accept?**
 *
 * The reason this needed its own guard is a defect that was invisible to everything else in this
 * repository. The union takes the row sets of `standard`, `ptc`, `minimal` and `cordis` together,
 * and two of those rows are **the same tool by two implementations**:
 *
 *   · `minimal` ships `persistent-shell`
 *   · `standard`/`ptc` ship `tool-bash` and `tool-pwsh`
 *
 * All three register a tool named `bash`. In `minimal` alone there is no collision, because it
 * does not also carry `tool-bash`. Union them and the host marks the whole preset **broken** —
 * and a broken preset is **silently dropped from every picker** while the settings page stays
 * entirely green. Measured 2026-10-01 on both supported lines.
 *
 * Nothing in this repository could see it. The fix is `EXCLUSIVE_ROW_SETS` plus a non-preferred
 * side being switched off during synthesis, and the regression assertion is
 * `test/composition-union.test.mjs`. But a unit test asserts what the *synthesiser* returns, and
 * the failure lives in what the **host** does with the result. `renderComposition('all')` can
 * return text that is perfectly legal YAML and still be refused at mount time.
 *
 * So: write the union composition for real, boot a real harness, and ask the running instance
 * about itself over its own API. That is the only place the answer exists.
 *
 * ## Why the assertions are on the API and not on stderr
 *
 * A quiet log does not mean the preset was accepted. This repository has recorded the opposite
 * twice: `unresolvable` and `warnings` both empty, page fully green, preset still `broken` in
 * the host. Silence was never the signal; the host's own roster is.
 *
 * ## Why this does not extend boot-check
 *
 * `boot-check.mjs` is **byte-identical across six repositories** (see the boot-check section of
 * `docs/20-conventions/04-真启动守卫.md` in the workspace ledger). Editing it to add a fifth
 * assertion would fork a shared template to fix a defect that exists in exactly one repository.
 * The four boot-check assertions are also about a different subject: the plugin, not the
 * composition it synthesises. Hence a second tool, with its own harness discovery.
 *
 * ## Assertions
 *
 *   A  all four shipped base modes resolve on this dsh line
 *   B  the synthesised union is a **superset of every base mode** and strictly larger than at
 *      least one of them — i.e. it really is their union, not a copy of the widest one
 *   C  the union composition is accepted by a running host: `broken` is null, `unresolvable` is
 *      empty, `warnings` is empty, `mode` is `all`, and the instance's own row tree serves every
 *      row we handed it
 *   D  the port answers and stays answering, and stderr carries no fatal pattern
 *
 * A and B are cheap and local, and they run first so a C failure is unambiguous. C is the
 * assertion this file exists for.
 *
 * ## Exit codes
 *
 *   0  every assertion passed
 *   1  an assertion failed — the composition is at fault, and the failed one is named
 *   2  the environment is at fault (no harness, port occupied, package manager missing)
 *
 * The split matters: a red gate that points at the wrong owner is a red gate that gets ignored.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import net from "node:net";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

// ── arguments ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const PORT = Number(flag("port") ?? 32011);
const TIMEOUT = Number(flag("timeout") ?? 60_000);
const SETTLE = Number(flag("settle") ?? 2000);
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

// ── the live-home guard, first thing that runs ────────────────
// A boot against the real harness home fights whatever the user is running, and this guard boots
// a harness for minutes rather than seconds.
const HOME_DIR = resolve(mkdtempSync(join(tmpdir(), "dsh-union-")));
if (HOME_DIR === resolve(join(homedir(), ".dsh")) || HOME_DIR === resolve(homedir())) {
  console.error(`x  refusing to use the live home as a throwaway: ${HOME_DIR}`);
  process.exit(2);
}

if (KEEP === false) {
  process.on("exit", () => {
    try {
      rmSync(HOME_DIR, { recursive: true, force: true });
    } catch {
      // A leftover temp directory is not worth masking the real exit status for.
    }
  });
}

// ── harness discovery ─────────────────────────────────────────
/** The command to run `dsh` with, as an argv prefix. */
function commandFor(path) {
  if (/\.(m|c)?js$/.test(path)) return { cmd: process.execPath, args: [path] };
  return { cmd: path, args: [] };
}

function discoverHarness() {
  const tried = [];

  if (DSH_BIN !== undefined) {
    tried.push(`--dsh-bin ${DSH_BIN}`);
    if (existsSync(DSH_BIN)) return { ...commandFor(DSH_BIN), how: `--dsh-bin ${DSH_BIN}` };
  }

  const install = process.env.DSH_INSTALL;
  if (install !== undefined && install !== "") {
    tried.push(`$DSH_INSTALL=${install}`);
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
  const useShell = process.platform === "win32";
  const probe = spawnSync("dsh", ["--version"], { encoding: "utf8", shell: useShell });
  if (probe.status === 0 && (probe.stdout ?? "").trim() !== "") {
    return { cmd: "dsh", args: [], shell: useShell, how: "`dsh` on PATH" };
  }

  return { tried };
}

const harness = discoverHarness();
if (harness.cmd === undefined) {
  console.error("x  no harness found — this is an environment problem, not a composition problem.");
  console.error("   Tried, in order:");
  for (const t of harness.tried) console.error(`     - ${t}`);
  console.error("");
  console.error('     export DSH_INSTALL="<harness root>"   # the directory holding node_modules/@deepseek-ai/dsh');
  console.error("     node tools/union-mount-check.mjs --dsh-bin <path/to/@deepseek-ai/dsh/lib/bin.js>");
  console.error("");
  console.error("   No machine-specific path is baked in here on purpose: naming one developer's");
  console.error("   harness goes stale the moment that harness moves.");
  process.exit(2);
}

// ── helpers ───────────────────────────────────────────────────
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

/** Every row id in a rendered composition, children included. */
function rowIdsOf(text, collectRows) {
  const ids = [];
  const walk = (rows) => {
    for (const row of rows ?? []) {
      ids.push(row.id);
      walk(row.children);
    }
  };
  walk(collectRows(text));
  return ids;
}

// ── report header ─────────────────────────────────────────────
const pkg = (() => {
  try {
    return JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  } catch {
    return {};
  }
})();

say(`union-mount-check — ${String(pkg.name ?? "(package.json unreadable)")}`);
say(`  repo:     ${REPO}`);
say(`  harness:  ${harness.how}`);
say(
  `  version:  ${(spawnSync(harness.cmd, [...harness.args, "--version"], { encoding: "utf8", shell: harness.shell ?? false }).stdout ?? "").trim() || "(printed nothing)"}`,
);

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail });
  say(`  ${ok ? "PASS" : "FAIL"}  ${id} — ${detail}`);
  if (ok === false) process.exitCode = 1;
};

// ── the checks ────────────────────────────────────────────────
//
// ★ `pathToFileURL(...).href`, not a bare absolute path. A dynamic `import()` takes a **URL**,
// and only `file:`/`data:`/`node:` are supported. On POSIX a bare `/home/...` string happens to
// parse as a path so the mistake hides; on Windows `D:\a\...` parses as a URL with the scheme
// `d:` and the loader throws `ERR_UNSUPPORTED_ESM_URL_SCHEME` (measured on win32, node 24.20.0:
// bare -> ERR_UNSUPPORTED_ESM_URL_SCHEME, pathToFileURL -> ok). Every other dynamic import in this
// repo passes a *relative* specifier, which is why only this file was ever wrong.
const loadRepoModule = (name) => import(pathToFileURL(join(REPO, name)).href);

async function main() {
  const { renderComposition, collectRows, UNION_MODE_ID } = await loadRepoModule("composition.mjs");
  const { BASE_MODE_IDS, isBaseCompositionUnavailable } = await loadRepoModule("base-composition.mjs");

  // ── A · every shipped base mode resolves on this line ──────
  //
  // The union is synthesised from these four, so a line where one of them cannot be resolved
  // would produce a union that is quietly narrower than it should be. That is a real failure
  // mode, not a hypothetical one: on 0.1.7 before the `readDocument` route existed, every read
  // threw and the settings page answered 500.
  //
  // ★ "Cannot read the shipped composition" has two owners and this guard must not mix them up.
  // `BaseCompositionUnavailableError` means every route was tried and none answered — the
  // harness/preset tree is not where it should be, i.e. an **environment** problem (exit 2).
  // Any other throw is our own composition code misbehaving, i.e. a **product** problem (exit 1).
  // A red gate that points at the wrong owner is a red gate that gets ignored, which is the
  // whole reason this guard has three exit codes instead of one.
  const baseIds = new Map();
  const unresolved = [];
  const unavailable = [];
  for (const mode of BASE_MODE_IDS) {
    try {
      const text = renderComposition(mode, new Map(), { modeName: mode, assistantId: "custom" });
      baseIds.set(mode, new Set(rowIdsOf(text, collectRows)));
    } catch (error) {
      const line = `${mode}: ${error instanceof Error ? error.message : String(error)}`;
      if (isBaseCompositionUnavailable(error)) unavailable.push(line);
      else unresolved.push(line);
    }
  }
  if (unavailable.length > 0) {
    record("A  all four base modes resolve", false, unavailable.join("; "));
    console.error("");
    console.error("   The shipped base composition could not be read at all — that is the harness");
    console.error("   not serving presets, not a composition bug. Re-run with --keep and inspect");
    console.error("   DSH_HOME if you need to see the tree.");
    process.exit(2);
  }
  const aOk = unresolved.length === 0;
  record(
    "A  all four base modes resolve",
    aOk,
    aOk
      ? [...baseIds.entries()].map(([m, s]) => `${m}=${String(s.size)}`).join(" · ")
      : unresolved.join("; "),
  );
  if (aOk === false) process.exit(1);

  // ── B · the union really is the union ─────────────────────
  //
  // Without this, assertion C could pass on a composition that had degenerated into a copy of
  // `standard` — a green result for a composition nobody asked about.
  //
  // ★ The test is **containment**, not "rows nobody else has". The first revision of this file
  // asserted `union > every base` and failed on a *correct* union (41 rows vs a widest base of
  // 34): a union of four sets contains nothing that is outside all four, so `union-only` is empty
  // **by definition**. An assertion that contradicts the definition of the thing it protects is
  // worse than no assertion — it trains people to "fix" working code.
  //
  // What actually distinguishes a real union from a copy is that it is a **superset** of every
  // base, and **strictly larger than at least one of them**. Measured on both supported lines:
  // standard 33 · ptc 34 · minimal 8 · cordis 34 · union 41 — the union-only-in-practice rows
  // are `tool-cordis`, `tool-presentation` and the `persistent-shell` group, which reach the
  // union because *other* bases carry them.
  const unionText = renderComposition(UNION_MODE_ID, new Map(), { modeName: "union", assistantId: "custom" });
  const unionIds = rowIdsOf(unionText, collectRows);
  const unionSet = new Set(unionIds);
  const missing = [];
  for (const [mode, ids] of baseIds) {
    for (const id of ids) if (unionSet.has(id) === false) missing.push(`${mode}/${id}`);
  }
  const widest = Math.max(...[...baseIds.values()].map((s) => s.size));
  const bOk = missing.length === 0 && unionSet.size > widest;
  record(
    "B  union contains every base mode",
    bOk,
    bOk
      ? `${String(unionSet.size)} rows ⊇ all four bases (widest ${String(widest)}); ${String(unionSet.size - widest)} beyond it`
      : missing.length > 0
        ? `union is missing ${String(missing.length)} row(s) its bases carry: ${missing.slice(0, 8).join(", ")}`
        : `union has ${String(unionSet.size)} rows, no base has more than ${String(widest)} — this is a copy, not a union`,
  );
  if (bOk === false) {
    console.error("\nx  A union must contain every base mode's rows and add at least one more.");
    console.error("   Otherwise assertion C is validating a composition nobody asked about.");
    process.exit(1);
  }
  // What the union adds on top of the widest base — the concrete evidence that this is a union
  // and not a copy. Recorded, not asserted: "41 rows" on its own does not say what they are.
  // (The rows in *no single base* are 0 **by definition** and carry no information, so they are
  // deliberately not printed — see the ★ note above.)
  const widestSet = [...baseIds.entries()].sort((a, b) => b[1].size - a[1].size)[0][1];
  const beyondWidest = [...unionSet].filter((id) => widestSet.has(id) === false);
  say(`  the ${String(beyondWidest.length)} row(s) beyond the widest base: ${beyondWidest.slice(0, 10).join(", ")}`);

  // ── install, then write the union for real ─────────────────
  mkdirSync(join(HOME_DIR, "profiles", "web"), { recursive: true });
  const add = run(["plugin", "--profile", "web", "add", REPO]);
  const addText = `${add.stdout ?? ""}${add.stderr ?? ""}`;
  if (add.status !== 0) {
    console.error(addText.trim());
    const envish =
      /pnpm[^\n]*(not found|missing|not on PATH)|pnpm'? is not recognized|is not recognized[^\n]*pnpm|install pnpm/i.test(
        addText,
      );
    if (envish) {
      console.error("\nx  the package manager is missing — environment, not composition.");
      console.error("   Fix: npm install -g pnpm@12");
      process.exit(2);
    }
    process.exit(1);
  }

  const presetDir = join(HOME_DIR, ".agent-presets", "custom");
  mkdirSync(presetDir, { recursive: true });
  writeFileSync(join(presetDir, "agent.cordis.yml"), unionText, "utf8");
  say(`  wrote union composition: ${String(unionText.length)} bytes / ${String(unionIds.length)} rows`);

  // ── boot ───────────────────────────────────────────────────
  if (await probe(PORT)) {
    console.error(`x  something is already listening on 127.0.0.1:${String(PORT)} — refusing to test against it.`);
    process.exit(2);
  }

  const child = spawn(harness.cmd, [...harness.args, "web", "--port", String(PORT), "--no-open"], {
    cwd: REPO,
    shell: harness.shell ?? false,
    env: { ...process.env, DSH_HOME: HOME_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += String(d)));
  child.stderr.on("data", (d) => (stderr += String(d)));

  const alive = () => child.exitCode === null && child.signalCode === null;

  const deadline = Date.now() + TIMEOUT;
  let answering = false;
  let exitedEarly = false;
  let diedAfterAnswering = false;
  let droppedAfterAnswering = false;

  while (Date.now() < deadline) {
    if (await probe(PORT)) {
      answering = true;
      break;
    }
    if (alive() === false) {
      exitedEarly = true;
      break;
    }
    await sleep(250);
  }

  // "Answers **and stays** answering" — a single connect samples the ~200 ms window in which a
  // plugin that fails to load still serves, which reports a broken plugin as booting.
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

  const stderrAtSettleEnd = stderr;

  // ── C · ask the running instance about itself ──────────────
  //
  // The token is printed in the boot banner; exchanging it for a cookie is how a browser gets
  // in, and it is the only credential path that does not depend on an API shape.
  let cDetail = "not reached";
  let cOk = false;
  if (answering) {
    const token = /token=([A-Za-z0-9_-]+)/.exec(stdout)?.[1] ?? null;
    if (token === null) {
      cDetail = "no token in the boot output — cannot authenticate against the instance";
    } else {
      const jar = [];
      try {
        const seed = await fetch(`http://127.0.0.1:${String(PORT)}/?token=${token}`, { redirect: "manual" });
        for (const raw of seed.headers.getSetCookie?.() ?? []) jar.push(raw.split(";")[0]);
        const cookie = jar.join("; ");
        const res = await fetch(
          `http://127.0.0.1:${String(PORT)}/api/custom-mode/state?id=custom`,
          { headers: { accept: "application/json", cookie } },
        );
        const body = await res.text();
        if (res.status !== 200) {
          cDetail = `state endpoint answered HTTP ${String(res.status)} (${String(body.length)} bytes)`;
        } else {
          const state = JSON.parse(body);
          const problems = [];
          if (state.mode !== UNION_MODE_ID) problems.push(`mode=${String(state.mode)}`);
          if (state.broken !== null && state.broken !== undefined) {
            problems.push(`host says broken: ${String(state.broken)}`);
          }
          const unresolvable = (state.unresolvable ?? []).map((r) => r.id);
          if (unresolvable.length > 0) problems.push(`unresolvable: ${unresolvable.join(", ")}`);
          if ((state.warnings ?? []).length > 0) problems.push(`warnings: ${state.warnings.join(", ")}`);
          // The instance must serve the union we handed it — read back from its own row tree, so a
          // composition that was quietly rewritten on the way in is visible here.
          const served = new Set();
          const walkServed = (rows) => {
            for (const row of rows ?? []) {
              served.add(row.id);
              walkServed(row.children);
            }
          };
          walkServed(state.rows);
          const lost = [...unionSet].filter((id) => served.has(id) === false);
          if (lost.length > 0) problems.push(`the instance is not serving ${String(lost.length)} row(s): ${lost.slice(0, 6).join(", ")}`);
          cOk = problems.length === 0;
          cDetail = cOk
            ? `host accepted it: broken=null, unresolvable=[], warnings=[], mode=${String(state.mode)}, ${String(served.size)} rows served`
            : problems.join("; ");
        }
      } catch (error) {
        cDetail = `could not read the instance: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  } else {
    cDetail = exitedEarly ? "the process exited on its own without serving" : `nothing answered within ${String(TIMEOUT)}ms`;
  }
  record("C  host accepts the union composition", cOk, cDetail);

  // ── D · the boot itself ────────────────────────────────────
  const FATAL_PATTERNS = [
    { re: /ERR_MODULE_NOT_FOUND/, why: "an import failed, so the plugin is not loaded at all" },
    { re: /Cannot find package/, why: "same failure, node's other wording" },
    { re: /failed to load/i, why: "the loader rejected something" },
    { re: /failed to import/i, why: "the loader rejected an entry" },
    { re: /failed to prepare profile bundle/, why: "a row did not resolve" },
    { re: /is already registered/, why: "two rows claim one tool name — this is what a naive union does" },
    { re: /schema/i, why: "a row definition was rejected by the schema DSL" },
    { re: /uncaught/i, why: "an exception escaped to the top level" },
    { re: /设置页将不可用/, why: "the settings page disabled itself" },
    { re: /缺少所需 API/, why: "a required host API is absent" },
    { re: /settings page .*(unavailable|disabled)/i, why: "the settings page disabled itself" },
  ];
  const fatal = FATAL_PATTERNS.filter((p) => p.re.test(stderrAtSettleEnd));
  const dOk = answering && fatal.length === 0;
  record(
    "D  boot is clean",
    dOk,
    answering === false
      ? "not reached"
      : fatal.length > 0
        ? `${fatal.map((p) => p.re.source).join(", ")} — ${fatal[0].why}`
        : `${String(stderrAtSettleEnd.length)} bytes of stderr, none of them fatal`,
  );

  if (alive()) {
    child.kill("SIGTERM");
    const stopBy = Date.now() + 5000;
    while (alive() && Date.now() < stopBy) await sleep(100);
    if (alive()) child.kill("SIGKILL");
  }

  // ── verdict ────────────────────────────────────────────────
  const failed = results.filter((r) => r.ok === false);
  say("");
  if (failed.length === 0) {
    say(`ok union mount check passed: the host accepted a real union composition (${String(unionSet.size)} rows)`);
    process.exit(0);
  }
  if (stdout.trim() !== "") console.error(`\n--- boot stdout ---\n${stdout.trim()}`);
  if (stderr.trim() !== "") console.error(`\n--- boot stderr ---\n${stderr.trim()}`);
  console.error(`x  union mount check failed on: ${failed.map((r) => r.id.trim()).join(", ")}`);
  if (cOk === false) {
    console.error("");
    console.error("   A broken preset is dropped from every picker while the settings page stays");
    console.error("   green. If the host says `broken`, the mode is already gone — the page will");
    console.error("   not tell you. Check EXCLUSIVE_ROW_SETS and the non-preferred side of each");
    console.error("   set being switched off during synthesis.");
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(`x  union mount check crashed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
