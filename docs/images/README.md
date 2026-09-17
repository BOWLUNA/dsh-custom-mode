# 截图

本目录的 5 张 PNG 都由脚本驱动真实运行的实例拍摄：

```
01-mode-switch.png        设置 →「自定义模式」上段：模式名称 + 基础模式
02-plugin-switches.png    插件开关：分组与子行的缩进、三态开关的徽标
03-system-prompt.png      系统提示词文本框 + 保存栏（状态栏显示「已保存…」）
04-preset-picker.png      新建会话的模式选择器，列表里有「自定义模式」
05-hot-reload-in-session.png
                          真机会话：改 prompt.md 前后各问一句，回答从 MARK-ONE 变 MARK-TWO
                          （只给 docs/实测记录.md 用，不进 README）
```

前四张是 README 的展示图，统一 **800x800、PNG、scale 1**（约 44–76 KB 一张）。
第五张是会话截图，尺寸不同，因为它不是"页面展示"而是实验证据。

拍摄方式、依赖与如何重跑见 [`../../tools/screenshots/README.md`](../../tools/screenshots/README.md)。
同目录下的 [`observed.json`](../../tools/screenshots/observed.json) 是拍摄时脚本核对到的实际状态
（主题、语言、保存返回、模式列表等），可以当作这些图确实来自真实运行实例的证据。

README 引用这些文件名，**改名要同步改文档**：

```markdown
![基础模式与模式名称](docs/images/01-mode-switch.png)
```
