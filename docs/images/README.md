# Screenshots

> **01–04 predate the assistant manager and its UI pass.** They were captured from the single-mode
> page with hand-rolled controls; the page now opens with an assistant selector (pills) above the
> blocks they show and uses the shell's shared atoms. `tools/screenshots/screenshots.mjs` has been
> updated for the new endpoints, so re-running it regenerates them against the current UI — see
> [`../../tools/screenshots/README.md`](../../tools/screenshots/README.md).
>
> **`05-assistant-manager.png` is current.** It is not hand-taken: it is the artifact
> `tools/browser-verify.mjs` writes on every run, captured against a real instance on the lab
> (dsh 0.1.6-alpha.2) while that run's 21 assertions passed. Regenerate it with:
>
> ```sh
> CDP_PORT=9222 node tools/browser-verify.mjs --url "<token URL>" --out docs/images/05-assistant-manager.png
> ```

Four images, all captured by driving a real running instance, all **800x800 PNG** (44–76 KB each):

```
01-mode-switch.png      Settings →「自定义模式」, upper part (pre-manager: mode name + base mode)
02-plugin-switches.png  Plugin switches: group and child indentation, tri-state badges
03-system-prompt.png    The system prompt editor and the save bar
04-preset-picker.png    The new-session mode picker, with「自定义模式」in the list
05-assistant-manager.png  The CURRENT page: assistant pills, create row, both action rows, labeled switches
```

How they are captured, what they need, and how to re-run them:
[`../../tools/screenshots/README.md`](../../tools/screenshots/README.md). The
[`observed.json`](../../tools/screenshots/observed.json) written next to the capture script records
the state it verified (theme, language, what the save returned, the mode list), which is what makes
these images evidence rather than decoration.

The READMEs reference these file names, so **renaming one means updating the docs**:

```markdown
![Mode name and base mode](docs/images/01-mode-switch.png)
```
