const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { SpeechOverlay, OVERLAY_SHORTCUT, getOverlayBounds } = require("../src/main/overlay");

function fixture(enabled = true) {
  const log = [];
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = false; this.destroyed = false;
      this.webContents = { send: (name, data) => log.push({ name, data }) };
    }
    loadFile() { return Promise.resolve(); }
    isVisible() { return this.visible; }
    isDestroyed() { return this.destroyed; }
    setBounds(bounds) { this.bounds = bounds; }
    setAlwaysOnTop() {}
    show() { this.visible = true; log.push({ name: "show" }); }
    hide() { this.visible = false; log.push({ name: "hide" }); }
    focus() { log.push({ name: "focus" }); }
    destroy() { this.destroyed = true; }
  }
  const shortcuts = new Map();
  const mainWindow = new FakeWindow({});
  const overlay = new SpeechOverlay({
    BrowserWindow: FakeWindow, mainWindow, enabled,
    createHotkey: ({ onTrigger, onState }) => ({
      start: () => { shortcuts.set(OVERLAY_SHORTCUT, onTrigger); return Promise.resolve(true); },
      dispose: () => { shortcuts.delete(OVERLAY_SHORTCUT); onState(false); }
    }),
    screen: {
      getCursorScreenPoint: () => ({ x: -100, y: 10 }),
      getDisplayNearestPoint: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1040 } })
    }
  });
  return { overlay, log, shortcuts };
}

test("overlay is hidden on startup, binds Space+Enter, and hides before sending", async () => {
  const { overlay, log, shortcuts } = fixture();
  assert.equal(overlay.window.options.show, false);
  assert.equal(log.length, 0);
  assert.ok(shortcuts.has(OVERLAY_SHORTCUT));
  await overlay.open();
  assert.deepEqual(overlay.window.bounds, { x: -1270, y: 828, width: 620, height: 196 });
  assert.equal(overlay.window.options.transparent, true);
  assert.ok(overlay.window.options.icon.endsWith("app-icon.png"));
  assert.deepEqual(log.at(-1), { name: "overlay:opened", data: { animate: true } });
  overlay.setReady(true);
  log.length = 0;
  const { id } = overlay.submit("hello");
  assert.deepEqual(log.map((entry) => entry.name), ["hide", "overlay:hidden", "overlay:speak"]);
  assert.equal(log[2].data.text, "hello");
  overlay.complete({ id, ok: true });
  assert.equal(overlay.pending.size, 0);
  overlay.dispose();
  assert.equal(shortcuts.size, 0);
  assert.equal(overlay.window.isDestroyed(), true);
});

test("overlay stays centered above the taskbar for offset monitors and small work areas", () => {
  for (const area of [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1280, y: -120, width: 1280, height: 984 },
    { x: 2560, y: 50, width: 390, height: 800 },
    { x: 0, y: 0, width: 320, height: 150 }
  ]) {
    const bounds = getOverlayBounds(area);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - (area.x + area.width / 2)) <= 0.5);
    assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width);
    assert.ok(bounds.y >= area.y && bounds.y + bounds.height < area.y + area.height);
  }
});

test("repeated hotkeys do not move or replay a visible input, but reopening animates again", async () => {
  const { overlay, log } = fixture(false);
  await overlay.open();
  const bounds = overlay.window.bounds;
  log.length = 0;
  await overlay.open();
  assert.equal(overlay.window.bounds, bounds);
  assert.deepEqual(log, [{ name: "focus" }, { name: "overlay:opened", data: { animate: false } }]);
  overlay.hide();
  assert.equal(log.at(-1).name, "overlay:hidden");
  await overlay.open();
  assert.equal(log.at(-1).data.animate, true);
  overlay.dispose();
});

test("failures are retained without showing or focusing the overlay", () => {
  const { overlay, log } = fixture();
  overlay.setReady(true);
  const { id } = overlay.submit("retain this");
  log.length = 0;
  overlay.complete({ id, ok: false });
  assert.deepEqual(log.map((entry) => entry.name), ["overlay:failed"]);
  assert.equal(log[0].data.text, "retain this");
  overlay.complete({ id, ok: false });
  assert.equal(log.length, 1);
  overlay.dispose();
});

test("quick chat retains the voice failure reason without reopening the window", () => {
  const { overlay, log } = fixture(false);
  overlay.setReady(true);
  const { id } = overlay.submit("retain original voice");
  log.length = 0;
  const message = "온라인 목소리 연결 거부 (403) · 자동 전환 안 함";
  overlay.complete({ id, ok: false, message });
  assert.deepEqual(log, [{ name: "overlay:failed", data: { text: "retain original voice", message } }]);
  assert.equal(overlay.window.isVisible(), false);
  overlay.dispose();
});

test("unready playback rejects without hiding; reload returns pending text; tests claim no shortcut", () => {
  const { overlay, log, shortcuts } = fixture(false);
  assert.equal(shortcuts.size, 0);
  assert.throws(() => overlay.submit("hello"));
  assert.equal(log.length, 0);
  overlay.setReady(true);
  overlay.submit("pending");
  overlay.setReady(false);
  assert.equal(overlay.pending.size, 0);
  assert.equal(log.at(-1).name, "overlay:failed");
  overlay.dispose();
});
