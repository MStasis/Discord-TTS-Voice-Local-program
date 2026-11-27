const path = require("node:path");

class TrayController {
  constructor({ app, Tray, Menu, nativeImage, window, enabled = false }) {
    Object.assign(this, { app, Tray, Menu, nativeImage, window });
    this.quitting = false;
    this.enabled = false;
    this.setEnabled(enabled);
  }

  setEnabled(enabled) {
    if (enabled && !this.tray) {
      const icon = this.nativeImage.createFromPath(path.join(__dirname, "../assets/app-icon.png"));
      if (icon.isEmpty()) throw new Error("알림 영역 아이콘을 불러오지 못했습니다.");
      const tray = new this.Tray(icon);
      try {
        tray.setToolTip("Voiceboard");
        tray.setContextMenu(this.Menu.buildFromTemplate([
          { label: "Voiceboard 열기", click: () => this.restore() },
          { type: "separator" },
          { label: "종료", click: () => this.app.quit() }
        ]));
        tray.on("click", () => this.restore());
        tray.on("double-click", () => this.restore());
        this.tray = tray;
      } catch (error) { tray.destroy(); throw error; }
    }
    this.enabled = Boolean(enabled);
    if (!enabled && this.tray) {
      // Never leave a hidden app without a way to reach it.
      if (!this.quitting && !this.window.isDestroyed() && !this.window.isVisible()) this.restore();
      this.tray.destroy();
      this.tray = null;
    }
  }

  handleClose(event) {
    if (this.quitting || !this.enabled || !this.tray) return false;
    event.preventDefault();
    this.window.hide();
    return true;
  }

  restore() {
    if (this.quitting || this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  beginQuit() { this.quitting = true; }

  dispose() {
    this.quitting = true;
    this.tray?.destroy();
    this.tray = null;
  }
}

module.exports = { TrayController };
