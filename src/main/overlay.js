const path = require("node:path");
const crypto = require("node:crypto");

const { SpaceEnterHotkey, OVERLAY_SHORTCUT } = require("./hotkey");

function getOverlayBounds(workArea) {
  const gapX = Math.min(16, Math.floor(workArea.width / 4));
  const gapY = Math.min(16, Math.floor(workArea.height / 4));
  const width = Math.min(620, workArea.width - gapX * 2);
  const height = Math.min(196, workArea.height - gapY * 2);
  return {
    width, height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - gapY
  };
}

class SpeechOverlay {
  constructor({ BrowserWindow, screen, mainWindow, enabled = true, createHotkey = (options) => new SpaceEnterHotkey(options) }) {
    this.screen = screen;
    this.mainWindow = mainWindow;
    this.ready = false;
    this.pending = new Map();
    this.window = new BrowserWindow({
      width: 620, height: 196, show: false, frame: false,
      resizable: false, maximizable: false, minimizable: false,
      alwaysOnTop: true, skipTaskbar: true, transparent: true, backgroundColor: "#00000000",
      icon: path.join(__dirname, "../assets/app-icon.png"),
      title: "Voiceboard - 음성 입력",
      webPreferences: {
        preload: path.join(__dirname, "../overlay-preload.cjs"),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
      }
    });
    this.loaded = this.window.loadFile(path.join(__dirname, "../renderer/overlay.html"));
    this.loaded.catch(() => {});
    this.window.on("blur", () => this.hide());
    this.window.on("close", (event) => { event.preventDefault(); this.hide(); });
    this.registered = false;
    if (enabled) {
      this.hotkey = createHotkey({
        onTrigger: () => this.open().catch(() => {}),
        onState: (registered) => {
          this.registered = registered;
          if (!mainWindow.isDestroyed()) mainWindow.webContents.send("overlay:shortcut-status", { registered });
        }
      });
    }
    this.shortcutReady = this.hotkey?.start() || Promise.resolve(false);
  }

  async open() {
    await this.loaded;
    if (this.window.isDestroyed()) return;
    // A repeated hotkey must not move the input or discard a partially typed draft.
    const opening = !this.window.isVisible();
    if (opening) {
      const { workArea } = this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
      this.window.setBounds(getOverlayBounds(workArea));
      this.window.setAlwaysOnTop(true, "screen-saver");
      this.window.show();
    }
    this.window.focus();
    this.window.webContents.send("overlay:opened", { animate: opening });
  }

  hide() {
    if (!this.window.isDestroyed()) {
      this.window.hide();
      this.window.webContents.send("overlay:hidden");
    }
  }

  submit(text) {
    const normalized = typeof text === "string" ? text.trim() : "";
    if (!normalized || normalized.length > 4000) throw new Error("1~4000자의 문장을 입력하세요.");
    if (!this.ready || this.mainWindow.isDestroyed()) throw new Error("Voiceboard가 아직 준비되지 않았습니다.");
    if (this.pending.size >= 10) throw new Error("음성 전송 대기 중입니다. 잠시 후 다시 보내세요.");
    const id = crypto.randomUUID();
    this.pending.set(id, normalized);
    this.hide();
    // The main renderer owns playback, so hiding the overlay never stops the sound.
    this.mainWindow.webContents.send("overlay:speak", { id, text: normalized });
    return { id };
  }

  complete({ id, ok, message }) {
    if (!this.pending.has(id)) return;
    const text = this.pending.get(id);
    this.pending.delete(id);
    if (!ok && !this.window.isDestroyed()) {
      // Keep failed text for the next manual opening; never interrupt the game with an error window.
      this.window.webContents.send("overlay:failed", {
        text,
        message: typeof message === "string" && message.trim()
          ? message.slice(0, 160) : "전송하지 못한 문장입니다. 다시 전송해 주세요."
      });
    }
  }

  setReady(ready) {
    this.ready = ready;
    if (!ready) {
      for (const id of this.pending.keys()) this.complete({ id, ok: false });
    }
  }

  dispose() {
    this.hotkey?.dispose();
    this.pending.clear();
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}

module.exports = { SpeechOverlay, OVERLAY_SHORTCUT, getOverlayBounds };
