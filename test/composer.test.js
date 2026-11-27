const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { normalizeState, updateSettings } = require("../src/shared/library.cjs");

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

async function setup({ autoEnd = true, settings = {} } = {}) {
  const pending = deferred();
  const elements = new Map();
  const sent = [];
  const players = [];
  const syntheses = [];
  const synthesisSettings = [];
  let overlaySpeak;
  const overlayResults = [];
  let savedState = normalizeState({ settings });
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
      constructor() { this.events = {}; players.push(this); }
      addEventListener(name, callback) { this.events[name] = callback; }
      setSinkId(deviceId) { this.sinkId = deviceId; return Promise.resolve(); }
      play() { if (autoEnd) queueMicrotask(() => this.events.ended()); return Promise.resolve(); }
      pause() {}
    },
    window: { voiceboard: {
      getLibrary: async () => savedState,
      updateSettings: async (patch) => { savedState = updateSettings(savedState, patch); return savedState; },
      getCableStatus: async () => ({ captureInstalled: false }),
      synthesizeTts: ({ text, settings }) => { syntheses.push(text); synthesisSettings.push(settings); return pending.promise; },
      onOverlaySpeak: (handler) => { overlaySpeak = handler; },
      overlayResult: (result) => overlayResults.push(result),
      addRecentPhrase: async (text) => { sent.push(text); return []; }
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  return { pending, context, sent, players, syntheses, synthesisSettings, overlaySpeak, overlayResults, elements, getSavedState: () => savedState, composer: document.querySelector("#ttsText") };
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

test("quick chat reports the unavailable voice without playing or adding recent speech", async () => {
  const { pending, overlaySpeak, overlayResults, players, sent } = await setup();
  const task = overlaySpeak({ id: "request-1", text: "same selected voice" });
  pending.reject(new Error("Error invoking remote method 'tts:synthesize': Error: TTS_VOICE_UNAVAILABLE: Selected online voice is unavailable (HTTP 403)."));
  await task;
  assert.equal(players.length, 0);
  assert.deepEqual(sent, []);
  assert.equal(overlayResults[0].ok, false);
  assert.equal(overlayResults[0].id, "request-1");
  assert.match(overlayResults[0].message, /403/);
  assert.match(overlayResults[0].message, /자동 전환 안 함/);
});

test("quick chat returns actionable Azure errors without playback or changing the draft", async () => {
  const { pending, overlaySpeak, overlayResults, players, sent, composer } = await setup();
  composer.value = "main draft";
  const task = overlaySpeak({ id: "azure-request", text: "quick speech" });
  pending.reject(new Error("Error invoking remote method 'tts:synthesize': Error: AZURE_NOT_CONFIGURED: 설정에서 Azure 키와 지역을 저장해 주세요."));
  await task;
  assert.equal(players.length, 0);
  assert.deepEqual(sent, []);
  assert.equal(composer.value, "main draft");
  assert.equal(overlayResults[0].ok, false);
  assert.equal(overlayResults[0].message, "설정에서 Azure 키와 지역을 저장해 주세요.");
});

test("main composer and quick chat submit the same selected Azure voice and controls", async () => {
  const { pending, context, composer, overlaySpeak, synthesisSettings } = await setup();
  vm.runInContext("state.settings = { ...state.settings, ttsEngine: 'azure', voice: 'ko-KR-SeoHyeonNeural', rate: -15, pitch: 5 }", context);
  composer.value = "main message";
  const main = vm.runInContext("speakFromComposer()", context);
  pending.resolve({ fileUrl: "file:///azure.mp3", engine: "azure" });
  await main;
  await overlaySpeak({ id: "quick-azure", text: "quick message" });
  assert.equal(synthesisSettings.length, 2);
  for (const settings of synthesisSettings) {
    assert.equal(settings.ttsEngine, "azure");
    assert.equal(settings.voice, "ko-KR-SeoHyeonNeural");
    assert.equal(settings.rate, -15);
    assert.equal(settings.pitch, 5);
  }
});

test("queued submissions wait for playback and IME confirmation never submits", async () => {
  const { pending, context, composer, syntheses, players } = await setup({ autoEnd: false });
  composer.value = "first";
  const task = vm.runInContext("speakFromComposer()", context);
  composer.value = "next";
  const second = vm.runInContext("speakFromComposer()", context);
  assert.equal(composer.value, "");
  pending.resolve({ fileUrl: "file:///test.mp3", engine: "edge" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(syntheses, ["first"]);
  players[0].events.ended();
  await task;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(syntheses, ["first", "next"]);
  players[1].events.ended();
  await second;
  composer.value = "composing";
  composer.listeners.keydown({ key: "Enter", isComposing: true });
  assert.equal(composer.value, "composing");
  composer.listeners.keydown({ key: "Enter", keyCode: 229 });
  assert.equal(composer.value, "composing");
});

test("stop cancels pending synthesis and queued speech without delayed playback", async () => {
  const { pending, context, players, syntheses } = await setup();
  const first = vm.runInContext("speakText('first')", context);
  const second = vm.runInContext("speakText('second')", context);
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext("stopAll()", context);
  pending.resolve({ fileUrl: "file:///test.mp3", engine: "edge" });
  assert.equal((await first).ok, false);
  assert.equal((await second).ok, false);
  assert.equal(players.length, 0);
  assert.deepEqual(syntheses, ["first"]);
});

test("sound and TTS playback have independent send and feedback gains, including live changes", async () => {
  const { context, players, elements, getSavedState } = await setup({
    autoEnd: false, settings: { outputDeviceId: "qa-cable", masterVolume: 0.3, monitorVolume: 0.7 }
  });
  await vm.runInContext("playUrl('file:///sound.mp3', { kind: 'sound' })", context);
  assert.equal(players.length, 2);
  assert.equal(players[0].sinkId, "qa-cable");
  assert.equal(players[0].volume, 0.3);
  assert.equal(players[1].sinkId, undefined);
  assert.equal(players[1].volume, 0.7);

  const send = elements.get("#masterVolumeInput");
  const monitor = elements.get("#monitorVolumeInput");
  send.value = "0";
  await send.listeners.input();
  assert.equal(players[0].volume, 0);
  assert.equal(players[1].volume, 0.7);
  monitor.value = "0.25";
  await monitor.listeners.input();
  assert.equal(players[0].volume, 0);
  assert.equal(players[1].volume, 0.25);
  send.value = "1";
  await send.listeners.input();
  monitor.value = "0";
  await monitor.listeners.input();
  assert.equal(players[0].volume, 1);
  assert.equal(players[1].volume, 0);
  assert.equal(getSavedState().settings.masterVolume, 1);
  assert.equal(getSavedState().settings.monitorVolume, 0);

  await vm.runInContext("playUrl('file:///speech.mp3', { kind: 'tts' })", context);
  assert.equal(players[2].volume, 1);
  assert.equal(players[3].volume, 0);
  monitor.value = "0.4";
  await monitor.listeners.input();
  assert.deepEqual(players.map((player) => player.volume), [1, 0.4, 1, 0.4]);
  vm.runInContext("stopAll()", context);
});

test("feedback toggle mutes only existing feedback and preserves its chosen gain", async () => {
  const { context, players, elements, getSavedState } = await setup({
    autoEnd: false, settings: { outputDeviceId: "qa-cable", masterVolume: 0.8, monitorVolume: 0.35 }
  });
  await vm.runInContext("playUrl('file:///sound.mp3')", context);
  const toggle = elements.get("#monitorEnabledInput");
  toggle.checked = false;
  await toggle.listeners.change();
  assert.equal(players[0].volume, 0.8);
  assert.equal(players[1].volume, 0);
  assert.equal(elements.get("#monitorVolumeInput").disabled, true);
  assert.equal(getSavedState().settings.monitorVolume, 0.35);
  toggle.checked = true;
  await toggle.listeners.change();
  assert.equal(players[1].volume, 0.35);
  assert.equal(elements.get("#monitorVolumeInput").disabled, false);
  vm.runInContext("stopAll()", context);
});

test("disabled feedback and default-only output do not create duplicate players", async () => {
  for (const settings of [
    { outputDeviceId: "qa-cable", monitorEnabled: false, monitorVolume: 0.2 },
    { outputDeviceId: "", monitorEnabled: true, monitorVolume: 0.2 }
  ]) {
    const { context, players } = await setup({ settings, autoEnd: false });
    await vm.runInContext("playUrl('file:///sound.mp3')", context);
    assert.equal(players.length, 1);
    assert.equal(players[0].volume, 0.95);
    vm.runInContext("stopAll()", context);
  }
});
