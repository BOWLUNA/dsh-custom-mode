# Screenshots

Every image in `docs/images/` is captured by driving a **real running dsh instance** — none of them is
hand-drawn or stitched together. This script produces `01`–`04`; `05` is the screenshot
[`../browser-verify.mjs`](../browser-verify.mjs) writes at the end of its assertions, so it is evidence
of a passing run rather than a separate capture session. The script also writes down the state it observed, into
[`observed.json`](observed.json).

That is the point: a hand-taken screenshot silently goes stale, and nobody can tell when or on which
version it was taken. A script gives a path that can be re-run and checked.

## What you need

1. A running dsh web instance with this plugin installed (`DSH_HOME` does not matter; the default
   `~/.dsh` is fine).
2. Chrome/Chromium started with a DevTools port:

   ```sh
   # Linux/macOS
   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/dsh-shots about:blank
   # Windows (under WSL with mirrored networking, WSL can reach 127.0.0.1:9222 directly)
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new \
     --remote-debugging-port=9222 --user-data-dir=C:\tmp\dsh-shots about:blank
   ```

3. The instance's token URL (`dsh web` prints it in its log when it starts).

## Running it

```sh
# Recommended: the wrapper restores the preset to its shipped state first (when DSH_HOME is set)
DSH_HOME=~/.dsh ./tools/screenshots/run-shots.sh "http://127.0.0.1:3080/?token=<token>" docs/images

# Or call the capture script directly (second argument is the output directory)
node tools/screenshots/screenshots.mjs "http://127.0.0.1:3080/?token=<token>" docs/images
CDP_PORT=9222 CDP_HOST=127.0.0.1 node tools/screenshots/screenshots.mjs ...   # port overrides
```

What the script does — every step is a real interaction, nothing is faked by touching the DOM:

1. Opens the app and switches to the light theme **through the app's own control**.
2. Opens Settings →「自定义模式」and reads the plugin's own `GET /custom-mode`, logging the result.
3. Captures `01` and `02`.
4. **Really** flips the「网页检索与抓取」row off and **really** clicks save, then reads the status line back.
5. Captures `03`.
6. Switches the UI to English through the app's language control and asserts the nav entry becomes
   `Custom mode` and the section headings turn English.
7. Switches to dark and asserts the theme change.
8. Closes the panel, opens the new-session mode picker, confirms「自定义模式」is in the list, captures `04`.
9. Writes every observed value into `observed.json`.

To get the **same narrative** on a re-run ("toggled a row → saved"), restore the preset first:

```sh
cp preset/agent.cordis.yml preset/preset.yml "$DSH_HOME/.agent-presets/custom/"
cp preset/prompt.md "$DSH_HOME/.agent-presets/custom/prompt.md"
```

## Image conventions

The four README images are **800x800, PNG, scale 1**, for three reasons:

- **Uniform**: each is cropped to the settings dialog, which is exactly 800x800 at a 1440x900
  viewport, so the README grid lines up instead of mixing tall and wide images.
- **Small**: scale 1 rather than 2. GitHub scales images down to the content column, so a 2x capture
  only multiplies the file size — measured, the same four images went from ~750 KB to ~223 KB, and an
  800px-wide image is displayed at its native size, so the text is if anything clearer.
- **Few**: it captures only the four images the README uses (`05` is the verifier's own artifact). The dark theme and the English UI are
  still switched to and asserted (the observations go into `observed.json`) but they are not saved as
  separate pictures — that would be a duplicate screen, not worth several hundred KB of downloads.

On a re-run, `01`/`03` are fixed crops and should come out identical; `02`/`04` depend on scroll
position and dropdown geometry and may differ by a pixel or two.

## The one image that is not a UI screenshot

`live-hot-reload.mjs` runs the "edit the prompt → it takes effect on the next step" experiment against
a real session (it rewrites the backend `prompt.md` between the two turns) and captures the final
screen to a path of your choice. It does **not** produce the four repository images, and that session
screenshot is **not shipped with the repository** — the commands and raw output are in
`docs/MEASUREMENTS.md` §0, which is enough to reproduce it.

```sh
node tools/screenshots/live-hot-reload.mjs "<token URL>" "$DSH_HOME/.agent-presets/custom/prompt.md"
```

**It spends model quota** (two turns, about 17K tokens in practice) and it **overwrites that
`prompt.md`**: it first writes a verification prompt containing `MARK-ONE`, then changes it to
`MARK-TWO`. Run it only against your own test instance.

## Why not Playwright

`cdp.mjs` in this directory is a ~300-line hand-written CDP client (Node 24 ships a global
`WebSocket`, so it has no dependencies). Taking a screenshot needs four actions — goto, evaluate, a
mouse event, captureScreenshot — and installing a browser-automation framework (plus its own
downloaded Chromium) for that is not worth it. Playwright would work just as well; the part of the
script that talks to the browser is self-contained.
