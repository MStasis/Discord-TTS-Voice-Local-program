const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeAzureCredentials, synthesizeAzureAudio, checkAzureConnection } = require("../src/main/azureTts");
const { AzureCredentialStore } = require("../src/main/azureCredentials");
const { normalizeState, updateSettings } = require("../src/shared/library.cjs");
const credentials = { key: "fake-key-only-used-in-isolated-tests", region: "koreacentral" };

test("Azure settings survive normalization while old engine selections are preserved", () => {
  assert.equal(normalizeState().settings.ttsEngine, "azure");
  for (const engine of ["edge", "windows", "azure"]) {
    assert.equal(normalizeState({ settings: { ttsEngine: engine } }).settings.ttsEngine, engine);
  }
  const state = updateSettings(normalizeState(), { ttsEngine: "azure", voice: "ko-KR-JiMinNeural", apiKey: credentials.key });
  assert.equal(state.settings.voice, "ko-KR-JiMinNeural");
  assert.equal(JSON.stringify(state).includes(credentials.key), false);
});

test("Azure credentials cannot redirect keys to arbitrary hosts or inject headers", () => {
  assert.deepEqual(normalizeAzureCredentials({ ...credentials, region: " KoreaCentral " }), credentials);
  assert.throws(() => normalizeAzureCredentials(null), { code: "AZURE_NOT_CONFIGURED" });
  for (const region of ["https://example.org", "koreacentral.evil", "eastus/../../", ""]) {
    assert.throws(() => normalizeAzureCredentials({ ...credentials, region }), { code: "AZURE_INVALID_REGION" });
  }
  assert.throws(() => normalizeAzureCredentials({ ...credentials, key: "secret\r\nX-Evil: yes" }), { code: "AZURE_INVALID_KEY" });
});

test("Azure REST sends authenticated SSML only to the configured HTTPS region", async () => {
  const ssml = "<speak>test</speak>";
  let called = false;
  const audio = await synthesizeAzureAudio({ credentials, ssml, fetchImpl: async (url, options) => {
    called = true;
    assert.equal(url, "https://koreacentral.tts.speech.microsoft.com/cognitiveservices/v1");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["Ocp-Apim-Subscription-Key"], credentials.key);
    assert.equal(options.headers["Content-Type"], "application/ssml+xml");
    assert.equal(options.headers["X-Microsoft-OutputFormat"], "audio-24khz-96kbitrate-mono-mp3");
    assert.equal(options.body, ssml);
    assert.ok(options.signal);
    return new Response(Buffer.from("ID3audio"), { headers: { "content-type": "audio/mpeg" } });
  } });
  assert.equal(called, true);
  assert.equal(audio.toString(), "ID3audio");
});

test("Azure connection check requests a voice list rather than synthesizing paid text", async () => {
  const result = await checkAzureConnection({ credentials, ssml: "ignored", fetchImpl: async (url, options) => {
    assert.ok(url.endsWith("/cognitiveservices/voices/list"));
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    return new Response(JSON.stringify([{ ShortName: "ko-KR-SunHiNeural", Locale: "ko-KR" }]));
  } });
  assert.deepEqual(result, { ok: true, koreanVoices: 1 });
});

test("missing credentials make zero network calls", async () => {
  let calls = 0;
  await assert.rejects(synthesizeAzureAudio({ ssml: "<speak/>", fetchImpl: () => { calls++; } }), { code: "AZURE_NOT_CONFIGURED" });
  assert.equal(calls, 0);
});

test("Azure HTTP failures expose useful codes without echoing secrets or server bodies", async () => {
  for (const [status, code] of [[400, "AZURE_BAD_REQUEST"], [401, "AZURE_AUTH_FAILED"], [403, "AZURE_AUTH_FAILED"], [429, "AZURE_RATE_LIMIT"], [503, "AZURE_UNAVAILABLE"], [302, "AZURE_UNAVAILABLE"]]) {
    await assert.rejects(synthesizeAzureAudio({ credentials, ssml: "<speak/>", fetchImpl: async () => new Response(credentials.key, { status }) }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(credentials.key), false);
      return true;
    });
  }
});

test("Azure timeout and transport failures never leak raw exceptions", async () => {
  for (const [name, code] of [["TimeoutError", "AZURE_TIMEOUT"], ["Error", "AZURE_NETWORK_ERROR"]]) {
    await assert.rejects(synthesizeAzureAudio({ credentials, ssml: "<speak/>", fetchImpl: async () => {
      throw Object.assign(new Error(credentials.key), { name });
    } }), (error) => error.code === code && !error.message.includes(credentials.key));
  }
});

test("Azure rejects empty, invalid MP3, non-audio, and oversized responses", async () => {
  for (const [body, type, code] of [
    ["", "audio/mpeg", "AZURE_INVALID_AUDIO"],
    ["not-mp3", "audio/mpeg", "AZURE_INVALID_AUDIO"],
    ["ID3audio", "application/json", "AZURE_INVALID_AUDIO"],
    [Buffer.alloc(8 * 1024 * 1024 + 1), "audio/mpeg", "AZURE_RESPONSE_TOO_LARGE"]
  ]) {
    await assert.rejects(synthesizeAzureAudio({ credentials, ssml: "<speak/>", fetchImpl: async () => new Response(body, { headers: { "content-type": type } }) }), { code });
  }
  await assert.rejects(checkAzureConnection({ credentials, fetchImpl: async () => new Response('{"not":"voices"}') }), { code: "AZURE_INVALID_RESPONSE" });
});

function secretFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voiceboard-azure-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("voiceboard-azure-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const secret = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", secret, iv);
      const result = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), result]);
    },
    decryptString(data) {
      const decipher = crypto.createDecipheriv("aes-256-gcm", secret, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
    }
  };
  return { dir, safeStorage, store: new AzureCredentialStore(path.join(dir, "azure-credentials.json"), safeStorage) };
}

test("Azure keys are encrypted separately and never returned through settings status", (t) => {
  const { store, dir, safeStorage } = secretFixture(t);
  const status = store.save(credentials);
  assert.deepEqual(status, { configured: true, region: "koreacentral" });
  assert.equal(JSON.stringify(status).includes(credentials.key), false);
  assert.equal(fs.readFileSync(store.filePath, "utf8").includes(credentials.key), false);
  assert.deepEqual(new AzureCredentialStore(store.filePath, safeStorage).read(), credentials);
  store.save({ key: "", region: "japaneast" });
  assert.equal(store.read().key, credentials.key);
  assert.equal(store.read().region, "japaneast");
  fs.writeFileSync(path.join(dir, "library.json"), "untouched");
  assert.deepEqual(store.clear(), { configured: false, region: "" });
  assert.equal(fs.readFileSync(path.join(dir, "library.json"), "utf8"), "untouched");
});

test("unavailable secure storage never writes plaintext and corrupt keys can be replaced", (t) => {
  const { store, safeStorage } = secretFixture(t);
  safeStorage.isEncryptionAvailable = () => false;
  assert.throws(() => store.save(credentials), { code: "AZURE_SECURE_STORAGE_UNAVAILABLE" });
  assert.equal(fs.existsSync(store.filePath), false);
  safeStorage.isEncryptionAvailable = () => true;
  fs.writeFileSync(store.filePath, '{"version":1,"encryptedKey":"corrupt"}');
  assert.equal(store.status().configured, false);
  assert.throws(() => store.read(), { code: "AZURE_CREDENTIALS_UNREADABLE" });
  store.save(credentials);
  assert.deepEqual(store.read(), credentials);
});
