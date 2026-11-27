const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { TrayController } = require("../src/main/tray");
const { normalizeState, updateSettings } = require("../src/shared/library.cjs");

function fixture(emptyIcon = false) {
  const trays = [];
  const iconPaths = [];
  const app = { quits: 0, quit() { this.quits++; } };
  const window = { visible: true, destroyed: false, minimized: false, focusCalls: 0,
    isVisible() { return this.visible; }, isDestroyed() { return this.destroyed; }, isMinimized() { return this.minimized; },
    hide() { this.visible = false; }, show() { this.visible = true; }, focus() { this.focusCalls++; }, restore() { this.minimized = false; }
  };
  class Tray extends EventEmitter {
    constructor() { super(); trays.push(this); }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const controller = new TrayController({ app, window, Tray, Menu: { buildFromTemplate: (items) => items }, nativeImage: { createFromPath: (file) => { iconPaths.push(file); return { isEmpty: () => emptyIcon }; } } });
  return { controller, trays, app, window, iconPaths };
}

test("background setting is opt-in, normalized strictly, and retained with other settings", () => {
  assert.equal(normalizeState().settings.closeToTray, false);
  assert.equal(normalizeState({ settings: { closeToTray: "true" } }).settings.closeToTray, false);
  const state = updateSettings(normalizeState(), { closeToTray: true });
  assert.equal(updateSettings(state, { rate: 15 }).settings.closeToTray, true);
  assert.equal(normalizeState(JSON.parse(JSON.stringify(state))).settings.closeToTray, true);
});

test("close-to-tray is opt-in, hides without destroying playback, and restores from the tray", () => {
  const { controller, trays, window, app, iconPaths } = fixture();
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  assert.equal(controller.handleClose(event), false);
  assert.equal(prevented, false);
  assert.equal(trays.length, 0);
  controller.setEnabled(true);
  controller.setEnabled(true);
  assert.equal(trays.length, 1);
  assert.ok(iconPaths[0].endsWith("app-icon.png"));
  assert.equal(controller.handleClose(event), true);
  assert.equal(prevented, true);
  assert.equal(window.visible, false);
  assert.equal(window.destroyed, false);
  trays[0].emit("click");
  assert.equal(window.visible, true);
  assert.equal(window.focusCalls, 1);
  window.minimized = true;
  trays[0].menu[0].click();
  assert.equal(window.minimized, false);
  trays[0].menu[2].click();
  assert.equal(app.quits, 1);
  controller.beginQuit();
  assert.equal(controller.handleClose(event), false);
  controller.dispose();
  assert.equal(trays[0].destroyed, true);
});

test("turning off background mode cannot strand a hidden app; invalid icon cannot trap close", () => {
  const { controller, window, trays } = fixture();
  controller.setEnabled(true);
  window.visible = false;
  controller.setEnabled(false);
  assert.equal(window.visible, true);
  assert.equal(trays[0].destroyed, true);
  assert.equal(controller.handleClose({ preventDefault() { throw new Error("must close"); } }), false);
  const broken = fixture(true);
  assert.throws(() => broken.controller.setEnabled(true));
  assert.equal(broken.controller.enabled, false);
  assert.equal(broken.controller.handleClose({}), false);
});
