# Screenshots

Five images, all **English**, and **all exactly 800x800** - one canvas, so the README 2x2 table lines up
instead of stepping up and down (a 1440x900 shot would also render as a wall of mostly-empty shell: that
is what "too big" looks like on GitHub).

```
01-mode-switch.png        800x800   Settings -> Custom mode: mode name + base mode (top of the switches)
02-plugin-switches.png    800x800   Plugin switches: flat rows, 1px dividers, tri-state badges
03-system-prompt.png      800x800   The system prompt editor + change history
04-preset-picker.png      800x800   The new-session mode picker, custom modes in the list
05-assistant-manager.png  800x800   The assistant section, assistant dropdown open, two assistants
```

None of them is hand-taken, and none of them carries anybody s private state: they are produced by
[`tools/screenshots/shoot-fresh.mjs`](../../tools/screenshots/shoot-fresh.mjs) against a **throwaway
`DSH_HOME` with no sessions**, with a fixed viewport (1440x900, device scale 1) and a fixed crop, and the
script renames the seeded assistant and creates a second one so the images match the README they illustrate:

```sh
# a throwaway home (no sessions, no records) + a CDP browser
systemd-run --unit=dsh-shots --collect -p MemoryMax=900M \
  -p WorkingDirectory=/root/dsh-lab --setenv=DSH_HOME=/tmp/dsh-shots dsh web --port 3082 --no-open
CDP_PORT=9222 node tools/screenshots/shoot-fresh.mjs "<token URL>" docs/images
```

The same run also writes `editor/assets/storefront-0{1..4}-*.png` - the four views the plugin directory
declares in `editor/screenshots.json` - from the same captures, so the storefront images cannot drift from
the README ones in content, size or language.

Two measured traps are recorded in the script, because both produced 01-04 that looked plausible and were
wrong: the settings dialog must be opened with a **real pointer** (this shell deliberately ignores synthesised
`click()` for some controls), and the first-run **Add an API key modal is also a `[role=dialog]`** - a script
that treats "a dialog exists" as "settings is open" spends the whole run looking for the sidebar inside that
modal, and every page shot silently becomes the same picture.

The rendered page is what [`tools/browser-verify.mjs`](../../tools/browser-verify.mjs) checks (65 checks,
including the official metrics these images show); `observed.json` next to the older capture script records
the state that run verified (theme, language, what the save returned, the mode list, the toggle it flipped).

One file here is **not** shown in the READMEs: `social-preview.png` (1280x640). It is the GitHub repository s
social preview image, and it can only be uploaded through the web UI (Settings -> Social preview) - the REST
API has no endpoint for it. It is generated the same way the others are: rendered in a browser and captured at
1280x640, so the source of truth stays in the repository. Verify which one is live with:

```sh
curl -sL https://github.com/BOWLUNA/dsh-custom-mode | grep -o 'og:image" content="[^"]*'
```

The READMEs reference these file names by absolute `raw.githubusercontent.com` URL (the npm storefront renders
the same files, which is why they are not relative paths), so **renaming one means updating the docs**:

```markdown
![Mode name and base mode](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/01-mode-switch.png)
```

`header.png` is the repository banner (dark, monospace) - it is rendered from `header.html` with headless
Chrome, and the same 1600x420 artwork works as the GitHub **social preview** (upload it under
Settings -> Social preview, which the API cannot set).
