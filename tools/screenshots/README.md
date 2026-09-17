# 截图怎么来的

`docs/images/` 里的 6 张图不是手拍的，也不是拼的：它们由本目录的脚本驱动一个**真实运行的
dsh 实例**拍下来，同时把当时观察到的状态写进 [`observed.json`](observed.json)。

这样做的理由很实际：手拍的截图会随 UI 改版过期，而没人知道它是什么时候、在哪个版本上拍的。
有脚本就有一条可重跑、可核对的路径。

## 需要什么

1. 一个装好本插件、正在运行的 dsh web 实例（`DSH_HOME` 随便，本机默认 `~/.dsh`）；
2. 带 DevTools 端口启动的 Chrome/Chromium：

   ```sh
   # Linux/macOS
   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/dsh-shots about:blank
   # Windows（WSL 的 mirrored 网络模式下，WSL 里可以直接连 127.0.0.1:9222）
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new \
     --remote-debugging-port=9222 --user-data-dir=C:\tmp\dsh-shots about:blank
   ```

3. 运行实例的带 token URL（`dsh web` 启动时会在日志里打印）。

## 怎么跑

```sh
# 推荐：包装脚本会先把 preset 还原成出厂状态（若设置了 DSH_HOME），再拍照
DSH_HOME=~/.dsh ./tools/screenshots/run-shots.sh "http://127.0.0.1:3080/?token=<token>" docs/images

# 或者直接调拍照脚本（第二参是输出目录，默认 docs/images）
node tools/screenshots/screenshots.mjs "http://127.0.0.1:3080/?token=<token>" docs/images
CDP_PORT=9222 CDP_HOST=127.0.0.1 node tools/screenshots/screenshots.mjs ...   # 端口可覆盖
```

脚本做的事（全部是真实交互，没有任何 DOM 注入式伪造）：

1. 打开应用，通过**界面自己的控件**切到浅色主题；
2. 进设置 →「自定义模式」，读取插件自己的 `GET /custom-mode` 并把结果打进日志；
3. 拍 `01`、`02`；
4. **真的**把「网页检索与抓取」那一行拨掉，再**真的**点保存，读回状态栏文案；
5. 拍 `03`；
6. 通过界面自己的语言控件切 English，确认导航项变成 `Custom mode`、小节标题全变英文，拍 `06`；
7. 切回中文 + 深色，拍 `05`；
8. 关闭设置面板，打开新建会话的模式选择器，确认列表里有「自定义模式」，拍 `04`；
9. 把上面每一步观察到的值写进 `observed.json`。

要重复运行得到**同一套叙事**（"拨了一行 → 保存"），先把 preset 还原成出厂状态：

```sh
cp preset/agent.cordis.yml preset/preset.yml "$DSH_HOME/.agent-presets/custom/"
cp preset/prompt.md "$DSH_HOME/.agent-presets/custom/prompt.md"
```

`01`/`03`/`05`/`06` 是固定裁到设置弹窗，重跑应当是同一张图；`02`/`04` 取决于滚动位置与
下拉框几何，重跑可能差一两个像素——叙事一致，像素不保证完全一致。

## 另外两张「不是界面截图」的图

`live-hot-reload.mjs` 拍的是 **07-hot-reload-in-session.png**：它在真实会话里做一次
「改提示词 → 下一步生效」的实验（两轮之间改 `/custom-mode` 后端那个 `prompt.md`）。

```sh
node tools/screenshots/live-hot-reload.mjs "<带 token 的 URL>" "$DSH_HOME/.agent-presets/custom/prompt.md"
```

**注意它会花模型额度**（两个来回，实测约 17K token），并且会**覆盖那个 `prompt.md`** ——
它先把文件设成带 `MARK-ONE` 的验证提示词，中途再改成 `MARK-TWO`。只在你自己的测试实例上跑。

## 为什么不用 Playwright

本目录的 `cdp.mjs` 是一个约 300 行的手写 CDP 客户端（Node 24 自带 `WebSocket`，零依赖）。
截图这件事只需要 goto / evaluate / 鼠标事件 / captureScreenshot 四个动作，为此装一个浏览器
自动化框架（连同它自己下载的一份 Chromium）不值得。想用 Playwright 也完全可以，脚本里跟
浏览器交互的部分是独立的。
