const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { normalizeState } = require("../src/shared/library.cjs");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createElement() {
  return {
    value: "", options: [], classList: { toggle() {} }, listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    append() {}, focus() {}, setAttribute() {}, querySelector: () => createElement()
  };
}

async function setup() {
  const pending = deferred();
  const elements = new Map();
  const sent = [];
  const document = {
    querySelector(id) {
      if (!elements.has(id)) elements.set(id, createElement());
      return elements.get(id);
    },
    createElement
  };
  const context = vm.createContext({
    document, console: { error() {} }, navigator: {}, Option: function () {},
    Audio: class {
      addEventListener() {}
      play() { return Promise.resolve(); }
    },
    window: { voiceboard: {
      getLibrary: async () => normalizeState(),
      getCableStatus: async () => ({ captureInstalled: false }),
      synthesizeTts: () => pending.promise,
      addRecentPhrase: async (text) => { sent.push(text); return []; }
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  return { pending, context, sent, composer: document.querySelector("#ttsText") };
}

test("clears the accepted submission immediately and keeps a new draft, even when identical", async () => {
  const { pending, context, composer, sent } = await setup();
  composer.value = "first message";
  const task = vm.runInContext("speakFromComposer()", context);
  assert.equal(composer.value, "");
  composer.value = "first message";
  pending.resolve({ fileUrl: "file:///test.mp3", engine: "edge" });
  await task;
  assert.equal(composer.value, "first message");
  assert.deepEqual(sent, ["first message"]);
});

test("failed synthesis preserves both the submitted message and a new draft", async () => {
  const { pending, context, composer, sent } = await setup();
  composer.value = "submitted";
  const task = vm.runInContext("speakFromComposer()", context);
  composer.value = "new draft";
  pending.reject(new Error("network unavailable"));
  await task;
  assert.equal(composer.value, "submitted\nnew draft");
  assert.deepEqual(sent, []);
});

test("busy submissions and IME confirmation do not discard input", async () => {
  const { pending, context, composer } = await setup();
  composer.value = "first";
  const task = vm.runInContext("speakFromComposer()", context);
  composer.value = "next";
  await vm.runInContext("speakFromComposer()", context);
  assert.equal(composer.value, "next");
  pending.resolve({ fileUrl: "file:///test.mp3", engine: "edge" });
  await task;
  composer.listeners.keydown({ key: "Enter", isComposing: true });
  assert.equal(composer.value, "next");
  composer.listeners.keydown({ key: "Enter", keyCode: 229 });
  assert.equal(composer.value, "next");
});
