const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, screen, ipcMain } = require("electron");
const { SpeechOverlay } = require("../src/main/overlay");
app.disableHardwareAcceleration();

let overlay;
let qaDataPath;
const requests = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error("OVERLAY_UI_TIMEOUT"); overlay?.dispose(); app.exit(1); }, 45000);

async function screenshot(name) {
  overlay.window.webContents.invalidate();
  await delay(80);
  const image = await overlay.window.capturePage(undefined, { stayHidden: true });
  assert.equal(image.isEmpty(), false);
  assert.equal(overlay.window.isVisible(), false);
  const file = path.join(__dirname, `../.voiceboard-test/overlay-${require("../package.json").version}-${name}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, image.toPNG());
  return image;
}

async function verify() {
  qaDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "voiceboard-overlay-qa-"));
  app.setPath("userData", qaDataPath);
  await app.whenReady();
  // Deliberately never call open(), show(), focus(), or globalShortcut.register().
  overlay = new SpeechOverlay({
    BrowserWindow: class extends BrowserWindow {
      constructor(options) {
        super({ ...options, focusable: false, webPreferences: { ...options.webPreferences, offscreen: true } });
      }
    },
    screen, enabled: false,
    mainWindow: { isDestroyed: () => false, webContents: { send: (_channel, data) => requests.push(data) } }
  });
  overlay.window.setFocusable(false);
  overlay.setReady(true);
  ipcMain.handle("overlay:submit", (_event, text) => overlay.submit(text));
  ipcMain.on("overlay:dismiss", () => overlay.hide());
  await overlay.loaded;
  const web = overlay.window.webContents;
  const evaluate = (script) => web.executeJavaScript(script);
  web.debugger.attach("1.3");
  await web.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  assert.equal(await evaluate(`getComputedStyle(document.body).visibility`), "hidden");
  // Exercise renderer lifecycle IPC directly; the native window remains hidden and unfocusable.
  web.send("overlay:opened", { animate: true });
  await delay(20);
  const animation = await evaluate(`(() => {
    const a = document.body.getAnimations()[0];
    a.pause(); a.currentTime = 35;
    return { duration: a.effect.getTiming().duration, frames: a.effect.getKeyframes() };
  })()`);
  assert.equal(animation.duration, 220);
  assert.equal(animation.frames[0].transform, "translateY(100%)");
  const firstTop = await evaluate(`document.body.getBoundingClientRect().top`);
  assert.ok(firstTop > 0 && firstTop < 196);
  assert.equal(await evaluate(`scrollY`), 0);
  const slideImage = await screenshot("slide");
  await evaluate(`document.body.getAnimations()[0].currentTime = 170`);
  assert.ok(await evaluate(`document.body.getBoundingClientRect().top`) < firstTop);
  await evaluate(`document.body.getAnimations()[0].finish()`);
  const fullImage = await screenshot("desktop");
  assert.notDeepEqual(slideImage.toBitmap(), fullImage.toBitmap());
  assert.equal(await evaluate(`document.activeElement.id`), "overlayText");
  await evaluate(`document.querySelector('#overlayText').value = '유지할 초안'`);
  web.send("overlay:opened", { animate: false });
  await delay(20);
  assert.equal(await evaluate(`document.body.getAnimations().length`), 0);
  assert.equal(await evaluate(`document.querySelector('#overlayText').value`), "유지할 초안");
  web.send("overlay:hidden");
  await delay(20);
  assert.equal(await evaluate(`getComputedStyle(document.body).visibility`), "hidden");
  await web.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  web.send("overlay:opened", { animate: true });
  await delay(20);
  assert.equal(await evaluate(`document.body.getAnimations().length`), 0);
  assert.equal(await evaluate(`document.body.getBoundingClientRect().top`), 0);
  web.send("overlay:hidden");
  await web.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  web.send("overlay:opened", { animate: true });
  await delay(20);
  assert.equal(await evaluate(`document.body.getAnimations().length`), 1);
  await evaluate(`document.body.getAnimations()[0].finish()`);
  await web.executeJavaScript(`
    document.querySelector('#overlayText').value = '오버레이 테스트';
    document.querySelector('#overlayText').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  `);
  assert.equal(requests.length, 0);
  await web.executeJavaScript(`document.querySelector('#speechForm').requestSubmit()`);
  for (let i = 0; requests.length === 0 && i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].text, "오버레이 테스트");
  assert.equal(await web.executeJavaScript(`document.querySelector('#overlayText').value`), "");
  await web.executeJavaScript(`document.querySelector('#overlayText').value = '새 초안'`);
  const failureMessage = "온라인 목소리 연결 거부 (403) · 자동 전환 안 함";
  overlay.complete({ id: requests[0].id, ok: false, message: failureMessage });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await web.executeJavaScript(`document.querySelector('#overlayText').value`), "오버레이 테스트\n새 초안");
  const layout = await web.executeJavaScript(`({
    fits: document.body.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
    icons: document.querySelectorAll('svg').length,
    appIcon: document.querySelector('.app-icon').complete && document.querySelector('.app-icon').naturalWidth > 0,
    error: document.querySelector('#overlayStatus').textContent
  })`);
  assert.ok(layout.fits);
  assert.equal(layout.icons, 2);
  assert.equal(layout.appIcon, true);
  assert.equal(layout.error, failureMessage);
  assert.equal(overlay.window.isVisible(), false);
  assert.equal(BrowserWindow.getFocusedWindow(), null);
  web.send("overlay:opened", { animate: false });
  await delay(20);
  await screenshot("restored-text");
  overlay.window.setSize(390, 196);
  await delay(50);
  const compact = await evaluate(`(() => {
    const a = document.querySelector('textarea').getBoundingClientRect();
    const b = document.querySelector('#sendButton').getBoundingClientRect();
    return { fits: document.body.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
      overlap: a.right > b.left, iconWidth: document.querySelector('.app-icon').getBoundingClientRect().width };
  })()`);
  assert.equal(compact.fits, true);
  assert.equal(compact.overlap, false);
  assert.equal(compact.iconWidth, 20);
  await screenshot("compact");
  assert.equal(overlay.window.isVisible(), false);
  console.log("OVERLAY_UI_OK: matching app icon; 220ms upward slide; reduced motion; repeat opening; Enter/IME; retained drafts; desktop/compact screenshots; no visible windows or hooks");
}

verify().then(() => { clearTimeout(watchdog); overlay?.dispose(); app.quit(); }).catch((error) => {
  clearTimeout(watchdog);
  console.error(error);
  overlay?.dispose();
  app.exit(1);
});
