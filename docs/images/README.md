# Screenshots

The README and `screenshots.json` use these five files. The four settings crops are **800×400**;
the new-session picker is **800×800**. Dimensions below are read from the PNG files.

| File | Pixels | What it shows |
| --- | --- | --- |
| `01-mode-switch.png` | 800×400 | The current assistant's name and five base-mode choices. |
| `02-plugin-switches.png` | 800×400 | Native plugin switches and inherited rows. |
| `03-system-prompt.png` | 800×400 | The current assistant's prompt editor and history control. |
| `04-preset-picker.png` | 800×800 | The new-session mode menu with synthetic assistants. |
| `05-assistant-manager.png` | 800×400 | The **New assistant** section at the bottom of the page, its starting settings and next-step guidance. |

## Source and limits

These are actual browser captures of plugin `2.2.6` from the production UI at
[`b064fc1a136a22d0975c46589c3a9e1eb3934f74`](https://github.com/BOWLUNA/dsh-custom-mode/commit/b064fc1a136a22d0975c46589c3a9e1eb3934f74),
captured on 2026-10-28 UTC with an isolated Windows DSH `0.2.1-rc.2` Web host and Linux Chrome
`156.0.8078.73`. The served resource was checked against the installed `client.js` bytes.
Files 01–04 share one capture run; 05 is a separate reviewed capture of the complete creation section.
The five approved captures were copied without image editing.

The isolated test home contains only synthetic assistant names, prompts and session state.
A screenshot demonstrates the recorded appearance;
it does not establish Electron desktop behavior, a commercial model response or GPU execution.
The separate browser interaction, theme and narrow-window checks are described in
[CURRENT_COMPATIBILITY.md](../CURRENT_COMPATIBILITY.md).

## Updating the set

Use an isolated host/home with synthetic content, stage captures outside this directory, and inspect every
frame before replacing the five named paths. Check the intended panel, full controls, menu visibility,
language, theme and actual PNG dimensions. The first-run model-configuration dialog is not the settings
dialog. Keep the captured source version and served-code check with the review evidence.

The existing helpers under [`tools/screenshots/`](../../tools/screenshots/) are capture tools, not proof
that a historical crop still fits the current layout. Recheck their output rather than copying an old
recipe or assuming every frame has the same dimensions. README URLs use these canonical names on
`raw.githubusercontent.com`; renaming a file also requires updating the README and `screenshots.json`.

## Separate artwork

`header.png` is the 1280×640 repository banner, rendered from `header.html`; `header@2x.png` is its
2560×1280 version. `social-preview.png` is the separate 1280×640 GitHub social image. These three files
were retained unchanged when the five product screenshots were refreshed. Updating repository settings
or a marketplace is a separate action from changing these local files.
