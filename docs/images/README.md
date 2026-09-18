# Screenshots

Five images. **01–04 are 800×800 PNG** (the README shows them as a 2×2 table, so they share one canvas);
**05 is 800×292** — it is a standalone image and is cropped to the assistant section alone, because a
full-height crop would repeat 01's mode-name and base-mode blocks and read as "the same picture twice".
None of them is hand-taken: all five are captured by `tools/screenshots/run-shots.sh` driving a real
running instance.

```
01-mode-switch.png        Settings →「自定义模式」, mode name + base mode (and the top of the switches)
02-plugin-switches.png    Plugin switches: group and child indentation, tri-state badges
03-system-prompt.png      The system prompt editor and the save bar, right after a real save
04-preset-picker.png      The new-session mode picker, with the custom modes in the list
05-assistant-manager.png  The assistant list, cropped to its own section: several modes in one page
```

`01`–`04` are shot by `tools/screenshots/screenshots.mjs`, which really clicks, toggles a row, saves,
and switches theme and language (see [`../../tools/screenshots/README.md`](../../tools/screenshots/README.md)):

```sh
DSH_HOME=<test home> ./tools/screenshots/run-shots.sh "<token URL>" docs/images
```

`05` is not a separate capture run: it is the screenshot `tools/browser-verify.mjs` writes at the end
of its 21 assertions. Two assistants are present when it is shot, so the image shows what the assistant
list is for:

```sh
CDP_PORT=9222 node tools/browser-verify.mjs --url "<token URL>" --out docs/images/05-assistant-manager.png
```

`01` shows the mode name and base mode rather than the assistant list, because that list is what `05`
is about; the two would otherwise be the same picture.

The [`observed.json`](../../tools/screenshots/observed.json) written next to the capture script records
the state it verified (theme, language, what the save returned, the mode list, the toggle it flipped),
which is what makes these images evidence rather than decoration.

One file here is **not** shown in the READMEs: `social-preview.png` (1280×640). It is the GitHub repository's
social preview image, and it can only be uploaded through the web UI (Settings → Social preview) — the REST API
has no endpoint for it. It is generated the same way the others are: rendered in a browser and captured at
1280×640, so the source of truth stays in the repository. Verify which one is live with:

```sh
curl -sL https://github.com/BOWLUNA/dsh-custom-mode | grep -o 'og:image" content="[^"]*'
```

The READMEs reference these file names, so **renaming one means updating the docs**:

```markdown
![Mode name and base mode](docs/images/01-mode-switch.png)
```
