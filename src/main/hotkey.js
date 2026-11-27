const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");

const OVERLAY_SHORTCUT = "Space+Enter";

class SpaceEnterHotkey {
  constructor({ onTrigger, onState = () => {}, spawnProcess = spawn, platform = process.platform, timeoutMs = 15000 }) {
    Object.assign(this, { onTrigger, onState, spawnProcess, platform, timeoutMs });
    this.registered = false;
    this.disposed = false;
  }

  start() {
    if (this.started) return this.started;
    if (this.disposed || this.platform !== "win32") return Promise.resolve(false);
    this.started = new Promise((resolve) => {
      this.resolveReady = resolve;
      try {
        const source = fs.readFileSync(path.join(__dirname, "spaceEnterHook.cs"), "utf8");
        this.child = this.spawnProcess("powershell.exe", [
          "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
          "$ErrorActionPreference = 'Stop'; Add-Type -TypeDefinition $env:VOICEBOARD_HOTKEY_SOURCE; [VoiceboardHotkey]::Run([int]$env:VOICEBOARD_PARENT_PID)"
        ], {
          env: { ...process.env, VOICEBOARD_HOTKEY_SOURCE: source, VOICEBOARD_PARENT_PID: String(process.pid) },
          windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
        });
        this.lines = createInterface({ input: this.child.stdout });
        this.lines.on("line", (line) => {
          if (this.disposed) return;
          if (line.trim() === "READY") {
            clearTimeout(this.timer);
            this.registered = true;
            this.onState(true);
            resolve(true);
          } else if (line.trim() === "OPEN" && this.registered) this.onTrigger();
        });
        this.child.stderr.resume();
        this.child.on("error", () => this.dispose());
        this.child.on("exit", () => this.dispose());
        this.timer = setTimeout(() => this.dispose(), this.timeoutMs);
        this.timer.unref?.();
      } catch { this.dispose(); }
    });
    return this.started;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.registered = false;
    this.resolveReady?.(false);
    this.lines?.close();
    this.child?.kill();
    this.onState(false);
  }
}

module.exports = { SpaceEnterHotkey, OVERLAY_SHORTCUT };
