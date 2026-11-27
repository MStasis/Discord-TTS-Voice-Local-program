const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

function fixture({ azureError } = {}) {
  const sockets = [];
  const writes = [];
  const windowsCalls = [];
  const timers = new Set();
  const azureCalls = [];
  class FakeSocket extends EventEmitter {
    constructor() { super(); sockets.push(this); this.terminated = false; }
    send(_message, _options, callback) { callback(); }
    close() { this.emit("close"); }
    terminate() { this.terminated = true; this.emit("close"); }
  }
  const module = { exports: {} };
  const context = vm.createContext({
    module, Buffer, process,
    setTimeout(callback) { timers.add(callback); return callback; },
    clearTimeout(callback) { timers.delete(callback); },
    require(name) {
      if (name === "./azureTts") return {
        synthesizeAzureAudio: async (options) => {
          azureCalls.push(options);
          if (azureError) throw azureError;
          return Buffer.from("ID3mock");
        }
      };
      if (name === "ws") return { WebSocket: FakeSocket };
      if (name === "node:fs/promises") return {
        mkdir: async () => {},
        writeFile: async (file, data) => writes.push({ file, data })
      };
      if (name === "node:child_process") return {
        execFile(file, args, options, callback) {
          windowsCalls.push({ file, args, options });
          callback(null, "", "");
        }
      };
      if (name === "../shared/library.cjs") return require("../src/shared/library.cjs");
      return require(name);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/main/tts.js"), "utf8"), context);
  return {
    ...module.exports, sockets, writes, windowsCalls, timers, azureCalls,
    async socket() {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(sockets.length, 1);
      return sockets[0];
    }
  };
}

function audioFrame() {
  const headers = Buffer.from("Path:audio\r\nContent-Type:audio/mpeg\r\n");
  const size = Buffer.alloc(2);
  size.writeUInt16BE(headers.length);
  return Buffer.concat([size, headers, Buffer.from([1, 2, 3])]);
}

const request = {
  text: "test speech", outputDir: path.join(__dirname, "fake-cache"),
  settings: { ttsEngine: "edge", voice: "ko-KR-SunHiNeural", rate: -15, pitch: 0, ttsVolume: 50 }
};

test("Azure synthesis uses the selected voice and never opens the old Edge socket or SAPI", async () => {
  const f = fixture();
  const azure = { key: "fake-key-only-for-testing", region: "koreacentral" };
  const result = await f.synthesizeTts({ ...request, settings: { ...request.settings, ttsEngine: "azure", voice: "ko-KR-SeoHyeonNeural" }, azure });
  assert.equal(result.engine, "azure");
  assert.match(result.filePath, /\.mp3$/);
  assert.equal(f.azureCalls[0].credentials, azure);
  assert.match(f.azureCalls[0].ssml, /ko-KR-SeoHyeonNeural/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.sockets.length, 0);
  assert.equal(f.windowsCalls.length, 0);
});

test("failed Azure synthesis never writes audio or changes to another engine", async () => {
  const error = Object.assign(new Error("AZURE_AUTH_FAILED: Invalid credentials"), { code: "AZURE_AUTH_FAILED" });
  const f = fixture({ azureError: error });
  await assert.rejects(f.synthesizeTts({ ...request, settings: { ...request.settings, ttsEngine: "azure" } }), { code: "AZURE_AUTH_FAILED" });
  assert.equal(f.writes.length, 0);
  assert.equal(f.sockets.length, 0);
  assert.equal(f.windowsCalls.length, 0);
});

test("online success keeps the selected engine and saves only the completed MP3", async () => {
  const f = fixture();
  const task = f.synthesizeTts(request);
  const socket = await f.socket();
  socket.emit("open");
  socket.emit("message", audioFrame(), true);
  socket.emit("message", Buffer.from("Path:turn.end\r\n\r\n"), false);
  const result = await task;
  assert.equal(result.engine, "edge");
  assert.match(result.filePath, /\.mp3$/);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].data, Buffer.from([1, 2, 3]));
  assert.equal(f.windowsCalls.length, 0);
  assert.equal(f.timers.size, 0);
});

test("HTTP 403 never silently changes the selected online voice to SAPI", async () => {
  const f = fixture();
  const task = f.synthesizeTts(request);
  const rejection = assert.rejects(task, (error) => {
    assert.equal(error.code, "TTS_VOICE_UNAVAILABLE");
    assert.match(error.message, /HTTP 403/);
    assert.equal(error.cause.statusCode, 403);
    return true;
  });
  const socket = await f.socket();
  let resumed = false;
  socket.emit("unexpected-response", {}, { statusCode: 403, resume() { resumed = true; } });
  await rejection;
  assert.equal(resumed, true);
  assert.equal(socket.terminated, true);
  assert.equal(f.windowsCalls.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.timers.size, 0);
});

test("network errors and timeouts preserve the voice without spawning PowerShell", async () => {
  for (const failure of ["network", "timeout"]) {
    const f = fixture();
    const task = f.synthesizeTts(request);
    const rejection = assert.rejects(task, { code: "TTS_VOICE_UNAVAILABLE" });
    const socket = await f.socket();
    if (failure === "network") socket.emit("error", new Error("network unavailable"));
    else [...f.timers][0]();
    await rejection;
    assert.equal(socket.terminated, true);
    assert.equal(f.windowsCalls.length, 0);
    assert.equal(f.writes.length, 0);
    assert.equal(f.timers.size, 0);
  }
});

test("partial audio and malformed frames fail without saving truncated speech or hanging", async () => {
  for (const failure of ["partial", "malformed"]) {
    const f = fixture();
    const task = f.synthesizeTts(request);
    const rejection = assert.rejects(task, { code: "TTS_VOICE_UNAVAILABLE" });
    const socket = await f.socket();
    if (failure === "partial") {
      socket.emit("message", audioFrame(), true);
      socket.emit("close");
    } else {
      socket.emit("message", Buffer.from([0, 30]), true);
    }
    await rejection;
    assert.equal(f.writes.length, 0);
    assert.equal(f.windowsCalls.length, 0);
    assert.equal(f.timers.size, 0);
  }
});

test("Windows Local still uses SAPI only when explicitly selected", async () => {
  const f = fixture();
  const result = await f.synthesizeTts({ ...request, settings: { ...request.settings, ttsEngine: "windows" } });
  assert.equal(result.engine, "windows");
  assert.match(result.filePath, /\.wav$/);
  assert.equal(f.sockets.length, 0);
  assert.equal(f.windowsCalls.length, 1);
  assert.equal(f.windowsCalls[0].options.windowsHide, true);
});
