const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow, nativeImage, screen } = require("electron");
const { TrayController } = require("../src/main/tray");
const { SpeechOverlay } = require("../src/main/overlay");
let window, overlay, controller;
class InvisibleTray extends EventEmitter {
  setToolTip() {}
  setContextMenu() {}
  destroy() { this.destroyed = true; }
}
app.on("window-all-closed", () => {});
async function verify() {
  app.setPath("userData", await fs.mkdtemp(path.join(os.tmpdir(), "voiceboard-tray-qa-")));
  await app.whenReady();
  // Real BrowserWindow close lifecycle, but no real tray icons, hooks, visible windows, or user profile.
  window = new BrowserWindow({ show: false, focusable: false });
  await window.loadURL("data:text/html,<textarea id='draft'>retained draft</textarea>");
  overlay = new SpeechOverlay({ BrowserWindow, screen, mainWindow: window, enabled: false });
  overlay.window.setFocusable(false);
  await overlay.loaded;
  controller = new TrayController({ app, window, nativeImage, Tray: InvisibleTray, Menu: { buildFromTemplate: (items) => items }, enabled: true });
  window.on("close", (event) => controller.handleClose(event));
  window.close();
  assert.equal(window.isDestroyed(), false);
  assert.equal(window.isVisible(), false);
  assert.equal(overlay.window.isDestroyed(), false);
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#draft').value"), "retained draft");
  const tray = controller.tray;
  controller.beginQuit();
  overlay.dispose();
  const closed = once(window, "closed");
  window.close();
  await closed;
  controller.dispose();
  assert.equal(window.isDestroyed(), true);
  assert.equal(overlay.window.isDestroyed(), true);
  assert.equal(tray.destroyed, true);
  assert.equal(BrowserWindow.getFocusedWindow(), null);
  console.log("TRAY_UI_OK: close preserves renderer; explicit quit destroys main, overlay, and tray; no visible UI or hooks");
}
verify().then(() => app.quit()).catch((error) => { console.error(error); overlay?.dispose(); controller?.dispose(); window?.destroy(); app.exit(1); });
