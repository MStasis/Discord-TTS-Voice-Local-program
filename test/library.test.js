const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addLog,
  addPhrase,
  addSound,
  normalizeState,
  removePhrase,
  removeSound,
  safeFileName,
  toEdgePercent,
  toEdgePitch,
  updateSettings
} = require("../src/shared/library.cjs");
const { createSsmlMessage } = require("../src/main/tts");

test("normalizes damaged state into a usable library", () => {
  const state = normalizeState({
    version: 999,
    settings: {
      masterVolume: 4,
      rate: -140,
      pitch: "not-a-number",
      ttsEngine: "bad-engine",
      monitorEnabled: false,
      captureDefaultsBackup: {
        console: "console-id",
        multimedia: 123,
        communications: "communications-id"
      },
      voice: ""
    },
    phrases: [{ id: "a", label: "  Hello   there  ", text: "  hello  " }, { text: "" }],
    sounds: [{ id: "s", label: "", path: "C:/sounds/ping.mp3" }, { label: "no-path" }],
    logs: [
      { id: "l", text: "  sent text  ", createdAt: "2026-05-11T00:00:00.000Z" },
      { id: "empty", text: "" }
    ]
  });

  assert.equal(state.version, 1);
  assert.equal(state.settings.masterVolume, 1);
  assert.equal(state.settings.rate, -100);
  assert.equal(state.settings.pitch, 0);
  assert.equal(state.settings.ttsEngine, "edge");
  assert.equal(state.settings.monitorEnabled, false);
  assert.deepEqual(state.settings.captureDefaultsBackup, {
    console: "console-id",
    multimedia: "",
    communications: "communications-id"
  });
  assert.equal(state.settings.voice, "ko-KR-SunHiNeural");
  assert.deepEqual(state.phrases, [{ id: "a", label: "Hello there", text: "hello" }]);
  assert.equal(state.sounds.length, 1);
  assert.equal(state.sounds[0].label, "ping");
  assert.deepEqual(state.logs, [
    { id: "l", text: "sent text", createdAt: "2026-05-11T00:00:00.000Z" }
  ]);
});

test("adds and removes quick phrases", () => {
  const withPhrase = addPhrase(normalizeState(), {
    id: "phrase-1",
    label: "Greeting",
    text: "hello there"
  });

  assert.equal(withPhrase.phrases.length, 1);
  assert.equal(withPhrase.phrases[0].label, "Greeting");

  const removed = removePhrase(withPhrase, "phrase-1");
  assert.equal(removed.phrases.length, 0);
});

test("adds and removes soundboard entries", () => {
  const withSound = addSound(normalizeState(), {
    id: "sound-1",
    label: "Ping",
    path: "C:/sounds/ping.wav"
  });

  assert.equal(withSound.sounds.length, 1);
  assert.equal(withSound.sounds[0].label, "Ping");

  const removed = removeSound(withSound, "sound-1");
  assert.equal(removed.sounds.length, 0);
});

test("adds sent voice logs newest first and keeps the configured limit", () => {
  const initial = normalizeState({
    logs: [{ id: "old", text: "old text", createdAt: "2026-05-10T00:00:00.000Z" }]
  });
  const withLogs = addLog(
    initial,
    { id: "new", text: "  new text  ", createdAt: "2026-05-11T00:00:00.000Z" },
    2
  );
  const capped = addLog(
    withLogs,
    { id: "latest", text: "latest text", createdAt: "2026-05-12T00:00:00.000Z" },
    2
  );

  assert.deepEqual(
    capped.logs.map((log) => log.id),
    ["latest", "new"]
  );
  assert.equal(capped.logs[1].text, "new text");
});

test("formats Edge TTS controls", () => {
  const state = updateSettings(normalizeState(), {
    ttsEngine: "windows",
    rate: 15,
    pitch: -20,
    ttsVolume: 12
  });

  assert.equal(state.settings.ttsEngine, "windows");
  assert.equal(toEdgePercent(state.settings.rate), "+15%");
  assert.equal(toEdgePitch(state.settings.pitch), "-20Hz");
  assert.equal(toEdgePercent(state.settings.ttsVolume), "+12%");
});

test("sanitizes imported audio filenames", () => {
  assert.equal(safeFileName('bad:name?.mp3'), "bad-name-.mp3");
  assert.equal(safeFileName(""), "sound");
});

test("escapes TTS text when creating SSML", () => {
  const ssmlMessage = createSsmlMessage("5 < 6 & 'quote'", {
    voice: "ko-KR-SunHiNeural",
    rate: 0,
    pitch: 0,
    ttsVolume: 0
  });

  assert.match(ssmlMessage, /xml:lang='ko-KR'/);
  assert.match(ssmlMessage, /5 &lt; 6 &amp; &apos;quote&apos;/);
  assert.doesNotMatch(ssmlMessage, /5 < 6/);
});
