/**
 * Minimal Chrome DevTools Protocol driver — no dependencies.
 *
 * Why hand-rolled: this only exists to take screenshots of the local DSH GUI, and the
 * only browser available here is the Windows-side Chrome reached over WSL's mirrored
 * localhost. Node 24 ships a global WebSocket, so a CDP client is ~100 lines and no
 * package install is needed.
 *
 * Usage:
 *   import { connect } from './cdp.mjs'
 *   const session = await connect()             // attaches to the first page target
 *   await session.setViewport(1600, 1000, 2)
 *   await session.goto('http://127.0.0.1:3081/?token=...')
 *   await session.clickText('设置')
 *   await session.screenshot('/path/out.png')
 *   await session.close()
 */

const DEBUG_HOST = process.env.CDP_HOST ?? '127.0.0.1'
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9222)

/** Fetch the browser-level WebSocket URL from the DevTools HTTP endpoint. */
async function browserWebSocketUrl() {
  const response = await fetch(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`)
  if (!response.ok) throw new Error(`DevTools endpoint answered ${response.status}`)
  const body = await response.json()
  if (typeof body.webSocketDebuggerUrl !== 'string') throw new Error('no webSocketDebuggerUrl in /json/version')
  return body.webSocketDebuggerUrl
}

/** One CDP connection with one flat session attached to one page target. */
class Session {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = []
    this.sessionId = undefined
    /**
     * Native JS dialogs seen on this session, oldest first.
     *
     * They are not a detail: window.confirm **blocks the renderer synchronously**, and a
     * headless browser has nobody to click it — every following CDP command just times out
     * (CDP timeout: Input.dispatchMouseEvent), which reads as "the browser wedged" when the
     * real cause is a dialog. Measured on dsh 0.1.7-rc.2: the plugin's delete goes through
     * window.confirm (that shell's client seed table only hands a third-party plugin
     * Button/Input/Switch/Tag/Pill), the page froze at CPU 0%, and dismissing the dialog over
     * CDP brought it back immediately.
     */
    this.dialogs = []
    /** 'accept' | 'dismiss' — set CDP_DIALOG=dismiss to decline every dialog instead. */
    this.dialogPolicy = process.env.CDP_DIALOG === 'dismiss' ? 'dismiss' : 'accept'
    socket.addEventListener('message', (event) => this.onMessage(String(event.data)))
  }

  onMessage(raw) {
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error !== undefined) reject(new Error(`${message.error.message} (${JSON.stringify(message.error.data ?? '')})`))
      else resolve(message.result)
      return
    }
    for (const listener of this.listeners) listener(message)
  }

  /** Send one command, optionally to the attached session. */
  send(method, params = {}, sessionId = this.sessionId) {
    const id = this.nextId
    this.nextId += 1
    const payload = { id, method, params }
    if (sessionId !== undefined) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify(payload))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`))
      }, 60_000)
    })
  }

  /** Resolve on the next matching CDP event. */
  once(method, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${method} event within ${timeoutMs}ms`)), timeoutMs)
      const listener = (message) => {
        if (message.method !== method) return
        clearTimeout(timer)
        this.listeners = this.listeners.filter((entry) => entry !== listener)
        resolve(message.params)
      }
      this.listeners.push(listener)
    })
  }

  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
    this.sessionId = sessionId
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    // 接管原生对话框：不问就没人问，页面会一直冻着（headless 下没有可点的按钮）。
    this.listeners.push((message) => {
      if (message.method !== 'Page.javascriptDialogOpening') return
      const params = message.params ?? {}
      const accept = this.dialogPolicy === 'accept'
      this.dialogs.push({ type: params.type, message: params.message, accepted: accept, at: new Date().toISOString() })
      this.send('Page.handleJavaScriptDialog', { accept }).catch(() => undefined)
      console.error(`[cdp] 自动${accept ? '接受' : '取消'}原生对话框 ${params.type}: ${String(params.message).slice(0, 90)}`)
    })
    return this
  }

  /** Create a fresh page target (about:blank) and attach to it. */
  async newPage() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' })
    return this.attach(targetId)
  }

  async setViewport(width, height, scale = 2) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: false,
    })
  }

  /** Emulate the OS/browser colour scheme the app reads for its light/dark theme. */
  async setColorScheme(scheme) {
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
  }

  async goto(url, { waitMs = 2500 } = {}) {
    const loaded = this.once('Page.loadEventFired', 20_000).catch(() => undefined)
    await this.send('Page.navigate', { url })
    await loaded
    await this.sleep(waitMs)
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** Evaluate an expression in the page, awaiting promises; throws on page exceptions. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page exception: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result?.value
  }

  /** Poll an expression until it is truthy. */
  async waitFor(expression, { timeoutMs = 20_000, intervalMs = 250, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      let value
      try {
        value = await this.evaluate(expression)
      } catch {
        value = undefined
      }
      if (value) return value
      if (Date.now() > deadline) throw new Error(`waitFor timed out: ${label}`)
      await this.sleep(intervalMs)
    }
  }

  /** All visible text of the page, for discovering the DOM without DevTools. */
  async visibleText() {
    return this.evaluate(`document.body ? document.body.innerText : ''`)
  }

  /**
   * Click the smallest element whose trimmed text equals (or contains) `text`.
   *
   * A synthetic click is used rather than Input.dispatchMouseEvent because it does not
   * depend on coordinates, which keeps the driver working when the layout shifts.
   */
  async clickText(text, { exact = false, index = 0 } = {}) {
    const hit = await this.evaluate(`(() => {
      const wanted = ${JSON.stringify(text)};
      const exact = ${exact};
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
      };
      const candidates = [...document.querySelectorAll('button, a, [role="tab"], [role="button"], [role="radio"], label, li, div, span')]
        .filter((el) => {
          if (!isVisible(el)) return false;
          const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
          const full = (el.textContent || '').trim();
          if (exact) return own === wanted || full === wanted;
          return own.includes(wanted) || full.includes(wanted);
        });
      if (candidates.length === 0) return { ok: false, reason: 'no element matched' };
      // Smallest match wins: the innermost element that carries the text.
      candidates.sort((a, b) => a.textContent.length - b.textContent.length);
      const target = candidates[${index}] ?? candidates[0];
      const clickable = target.closest('button, a, [role="tab"], [role="button"], [role="radio"], label') ?? target;
      clickable.scrollIntoView({ block: 'center' });
      clickable.click();
      return { ok: true, tag: clickable.tagName, text: (clickable.textContent || '').trim().slice(0, 60) };
    })()`)
    if (hit?.ok !== true) throw new Error(`clickText(${JSON.stringify(text)}) failed: ${hit?.reason}`)
    return hit
  }

  /** Type into the first textarea / input matching a selector, replacing its content. */
  async fill(selector, value) {
    const ok = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
    if (ok !== true) throw new Error(`fill(${selector}) found nothing`)
  }

  /**
   * Real mouse click at viewport coordinates.
   *
   * Preferred over `element.click()` for this app: a synthetic click is enough for a
   * plain React onClick, but it carries no default action, so anything relying on real
   * pointer/focus semantics (or on `pointerdown`) ignores it.
   */
  async clickAt(x, y) {
    const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, button: 'none' })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
    await this.sleep(120)
  }

  /** Centre of the first element matching a selector, in viewport coordinates. */
  async centreOf(selector) {
    const point = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return null;
      el.scrollIntoView({ block: 'center' });
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`)
    if (point === null) throw new Error(`centreOf(${selector}) found nothing visible`)
    return point
  }

  /**
   * Find an element by its own text and click it with a real mouse event.
   *
   * `tag` narrows the search (e.g. 'button'); `exact` requires the element's own text to
   * equal the wanted string rather than contain it.
   */
  async clickTextReal(text, { tag = '*', exact = false, index = 0 } = {}) {
    const point = await this.evaluate(`(() => {
      const wanted = ${JSON.stringify(text)};
      const exact = ${exact};
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none';
      };
      const all = [...document.querySelectorAll(${JSON.stringify(tag)})].filter((el) => {
        if (!isVisible(el)) return false;
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        if (exact) return own === wanted;
        return own.includes(wanted);
      });
      if (all.length === 0) return null;
      const target = all[${index}] ?? all[0];
      target.scrollIntoView({ block: 'center' });
      const rect = target.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: target.tagName, cls: String(target.className).slice(0, 40) };
    })()`)
    if (point === null) throw new Error(`clickTextReal(${JSON.stringify(text)}, ${tag}) found nothing`)
    await this.clickAt(point.x, point.y)
    return point
  }

  /** Press Escape (dismisses a modal / dropdown). */
  async pressEscape() {
    for (const type of ['keyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', {
        type,
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      })
    }
    await this.sleep(400)
  }

  /** Capture a PNG to a local path (data comes back over CDP, so no shared filesystem needed). */
  async screenshot(file, { fullPage = false } = {}) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: fullPage,
      optimizeForSpeed: false,
    })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, Buffer.from(result.data, 'base64'))
    return file
  }

  /**
   * Capture just one element's box (plus an optional margin).
   *
   * Used to frame a modal dialog tightly: a full-viewport shot of a centred 800px
   * dialog is mostly empty shell, which reads badly at README size.
   *
   * `bottomInset` trims pixels off the bottom — e.g. to drop a line that carries this
   * machine's absolute paths, which has no business in a public screenshot.
   */
  async screenshotElement(selector, file, { margin = 0, bottomInset = 0 } = {}) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`)
    if (box === null) throw new Error(`screenshotElement(${selector}) found nothing`)
    return this.screenshotBox(file, {
      x: box.x - margin,
      y: box.y - margin,
      width: box.width + margin * 2,
      height: box.height + margin * 2 - bottomInset,
    })
  }

  /**
   * Capture an arbitrary viewport-relative box.
   *
   * A long-lived headless browser occasionally stalls on `Page.captureScreenshot` (seen on a
   * Chrome instance that had been open for a while and accumulated page targets). Retrying
   * once is enough in practice and keeps a screenshot run from dying at the last step.
   */
  async screenshotBox(file, box) {
    const clip = {
      x: Math.max(0, Math.round(box.x)),
      y: Math.max(0, Math.round(box.y)),
      width: Math.round(box.width),
      height: Math.round(box.height),
      scale: 1,
    }
    let result
    for (let attempt = 1; ; attempt += 1) {
      try {
        result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip })
        break
      } catch (error) {
        if (attempt >= 3) throw error
        console.warn(`  （截图失败，重试 ${attempt}/2: ${String((error && error.message) || error)}）`)
        await this.sleep(2000)
      }
    }
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, Buffer.from(result.data, 'base64'))
    return file
  }

  close() {
    try {
      this.socket.close()
    } catch {
      /* already gone */
    }
  }
}

/** Open the browser socket and attach to the first existing page, creating one if needed. */
export async function connect() {
  const url = await browserWebSocketUrl()
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('DevTools WebSocket failed to open')), { once: true })
  })
  const session = new Session(socket)
  const { targetInfos } = await session.send('Target.getTargets')
  const page = targetInfos.find((info) => info.type === 'page')
  if (page !== undefined) return session.attach(page.targetId)
  return session.newPage()
}

export { Session }
