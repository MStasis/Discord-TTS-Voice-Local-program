const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const { normalizeState } = require("../src/shared/library.cjs");
const { AzureCredentialStore } = require("../src/main/azureCredentials");
app.disableHardwareAcceleration();

let window;
const watchdog = setTimeout(() => { console.error("MAIN_UI_TIMEOUT"); window?.destroy(); app.exit(1); }, 60000);
const errors = [];
const calls = [];
let qaCredentials;
let library = normalizeState({
  settings: { outputDeviceId: "qa-cable", monitorEnabled: true },
  recentPhrases: ["잠깐만 기다려줘", "같이 가자", "수고했어"].map((text, i) => ({ id: `r${i}`, label: text, text })),
  sounds: Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, label: ["알림", "박수", "짧은 효과음", "긴 이름의 사운드 파일 테스트입니다", "종소리", "시작"][i % 6] + ` ${i + 1}`, path: "qa.mp3" }))
});
library.sounds = library.sounds.map((sound) => ({ ...sound, exists: true, fileUrl: "file:///qa-silent.mp3" }));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (script) => window.webContents.executeJavaScript(script);
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

function fakeIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_event, payload) => {
    calls.push({ channel, payload });
    return fn(payload);
  });
  handle("library:get", () => library);
  handle("settings:update", (patch) => { Object.assign(library.settings, patch); return library; });
  handle("azure:get-settings", () => qaCredentials.status());
  handle("azure:save-settings", (payload) => qaCredentials.save(payload));
  handle("azure:delete-settings", () => qaCredentials.clear());
  handle("azure:test", (payload) => {
    qaCredentials.resolve(payload);
    return { ok: true, koreanVoices: 5 };
  });
  handle("app:open-azure-portal", () => true);
  handle("overlay:renderer-ready", () => ({ registered: true }));
  handle("audio:get-cable-status", () => ({ captureInstalled: true }));
  handle("tts:synthesize", () => ({ fileUrl: "file:///qa-silent.mp3", engine: "edge" }));
  handle("recent:add", (text) => {
    library.recentPhrases = [{ id: `r-${Date.now()}`, label: text, text }, ...library.recentPhrases.filter((p) => p.text !== text)].slice(0, 3);
    return library.recentPhrases;
  });
  handle("recent:delete", (id) => { library.recentPhrases = library.recentPhrases.filter((p) => p.id !== id); return library.recentPhrases; });
  handle("sound:delete", (id) => { library.sounds = library.sounds.filter((p) => p.id !== id); return library; });
  handle("sound:trim", () => library);
  handle("sound:import", () => library);
  handle("sound:import-youtube", () => library);
  handle("youtube:resolve", () => ({ title: "QA", fileUrl: "file:///qa-silent.mp3" }));
  handle("app:open-data-folder", () => true);
  handle("audio:setup-cable", () => ({ state: library, discord: { applied: true } }));
  handle("audio:release-cable", () => ({ state: library, restored: true, discord: { applied: true } }));
}

async function assertLayout(name) {
  const result = await evaluate(`(() => {
    const visible = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]');
    const bad = [...document.querySelectorAll('button, input, select, textarea, .composer-toolbar, .drawer-content, .statusbar')]
      .filter(visible).filter(e => {
        const r = e.getBoundingClientRect();
        return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
      }).map(e => e.id || e.className);
    const overflow = ['.workspace', '.drawer-content', '.drawer-panel:not([hidden])'].flatMap(s => {
      const e = document.querySelector(s);
      return e && visible(e) && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) ? [s] : [];
    });
    const input = document.querySelector('#ttsText').getBoundingClientRect();
    const toolbar = document.querySelector('.composer-toolbar').getBoundingClientRect();
    const drawer = document.querySelector('#drawer');
    const drawerShown = !drawer.inert;
    const renderedDrawer = !drawerShown || (drawer.getBoundingClientRect().height > 200 && getComputedStyle(drawer).visibility === 'visible' && Number(getComputedStyle(drawer).opacity) > .99);
    return { bad, overflow, renderedDrawer, overlap: input.bottom > toolbar.top + 1, bodyFits: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth };
  })()`);
  assert.deepEqual(result.bad, [], `${name}: offscreen controls`);
  assert.deepEqual(result.overflow, [], `${name}: overflowing panels`);
  assert.equal(result.overlap, false, `${name}: composer overlaps toolbar`);
  assert.equal(result.bodyFits, true, `${name}: page scroll`);
  assert.equal(result.renderedDrawer, true, `${name}: drawer must actually be visible`);
  assert.equal(window.isVisible(), false);
  assert.equal(BrowserWindow.getFocusedWindow(), null);
}

async function screenshot(name) {
  window.webContents.invalidate();
  await delay(80);
  const shot = await window.capturePage(undefined, { stayHidden: true });
  assert.equal(shot.isEmpty(), false);
  const file = path.join(__dirname, `../.voiceboard-test/main-${name}.png`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, shot.toPNG());
}

async function verify() {
  app.setPath("userData", await fs.mkdtemp(path.join(os.tmpdir(), "voiceboard-main-ui-qa-")));
  await app.whenReady();
  qaCredentials = new AzureCredentialStore(path.join(app.getPath("userData"), "azure-credentials.json"), safeStorage);
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  console.log("MAIN_UI_READY");
  fakeIpc();
  // No real windows, global hotkeys, media playback, Discord actions, or user data.
  window = new BrowserWindow({
    width: 1120, height: 720, useContentSize: true, show: false, focusable: false,
    webPreferences: { preload: path.join(__dirname, "../src/preload.cjs"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true }
  });
  const debug = window.webContents.debugger;
  await window.loadURL("about:blank");
  debug.attach("1.3");
  console.log("MAIN_UI_WINDOW_HIDDEN");
  await debug.sendCommand("Page.enable");
  console.log("MAIN_UI_DEBUG_READY");
  await debug.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__qa = { errors: [], played: 0, players: [] };
    addEventListener('error', e => __qa.errors.push(e.message));
    addEventListener('unhandledrejection', e => __qa.errors.push(String(e.reason)));
    Object.defineProperty(navigator, 'mediaDevices', { value: { enumerateDevices: async () => [{ kind: 'audiooutput', label: 'CABLE Input (VB-Audio Virtual Cable)', deviceId: 'qa-cable' }] } });
    window.Audio = class {
      constructor() { this.events = {}; __qa.players.push(this); }
      addEventListener(name, callback) { this.events[name] = callback; }
      async setSinkId() {}
      async play() { __qa.played++; setTimeout(() => this.events.ended?.(), 10); }
      pause() {}
    };
  ` });
  await window.loadFile(path.join(__dirname, "../src/renderer/index.html"));
  console.log("MAIN_UI_LOADED");
  await delay(200);
  assert.equal(await evaluate(`document.querySelector('#cableInstallModal').hidden`), true);
  assert.equal(await evaluate(`document.querySelector('#drawer').inert`), true);
  assert.equal(await evaluate(`document.querySelectorAll('i[data-lucide]').length`), 0);
  assert.equal(await evaluate(`document.querySelector('#settings-panel').hidden`), true);
  await evaluate(`document.querySelector('#ttsText').value = '다음 판도 같이 하자'`);

  for (const [name, width, height] of [["desktop",1120,720], ["minimum",800,600], ["compact",880,560], ["narrow",390,844]]) {
    console.log(`MAIN_UI_VIEWPORT ${name}`);
    window.setContentSize(width, height);
    await click("#composeNav");
    await delay(280);
    await assertLayout(`${name}/composer`);
    if (name === "desktop") await screenshot(`${name}-composer`);
    for (const panel of ["phrases", "sounds", "settings"]) {
      await click(`#${panel}Nav`);
      await delay(280);
      assert.equal(await evaluate(`document.querySelector('#${panel}Nav').getAttribute('aria-expanded')`), "true");
      assert.equal(await evaluate(`document.querySelectorAll('.drawer-panel:not([hidden])').length`), 1);
      await assertLayout(`${name}/${panel}`);
      if (panel === "settings") {
        assert.equal(await evaluate(`document.querySelector('#azureSettingsButton').hidden`), false);
        await click("#azureSettingsButton");
        await delay(60);
        assert.equal(await evaluate(`document.querySelector('#azureSettingsModal').hidden`), false);
        await assertLayout(`${name}/azure-modal`);
        await screenshot(`${name}-azure`);
        await evaluate(`document.querySelector('#azureRegionInput').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
        assert.equal(await evaluate(`document.querySelector('#azureSettingsModal').hidden`), true);
        assert.equal(await evaluate(`document.querySelector('#drawer').inert`), false);
      }
      if (name === "desktop" || name === "minimum" || name === "narrow") await screenshot(`${name}-${panel}`);
      await click("#closeDrawerButton");
      await delay(250);
      assert.equal(await evaluate(`document.querySelector('#drawer').inert`), true);
    }
  }

  window.setContentSize(1120, 720);
  await click("#soundsNav");
  await delay(280);
  assert.equal(await evaluate(`document.querySelectorAll('.sound-item').length`), 6);
  await click("#nextSoundsButton");
  assert.equal(await evaluate(`document.querySelector('#soundPageLabel').textContent`), "2 / 3");
  await click("#nextSoundsButton");
  assert.equal(await evaluate(`document.querySelectorAll('.sound-item').length`), 1);
  await click(".sound-item .danger");
  await delay(50);
  assert.equal(await evaluate(`document.querySelector('#soundPageLabel').textContent`), "2 / 2");
  await click(".sound-item [title='사운드 편집']");
  assert.equal(await evaluate(`document.querySelector('#soundEditModal').hidden`), false);
  await evaluate(`document.querySelector('#soundEditStartInput').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelector('#drawer').inert`), false);
  await click("#soundsNav");
  assert.equal(await evaluate(`document.querySelector('#drawer').inert`), true);

  await click("#settingsNav");
  await evaluate(`document.querySelector('#rateInput').value = '15'; document.querySelector('#rateInput').dispatchEvent(new Event('input'))`);
  await delay(50);
  assert.equal(library.settings.rate, 15);
  await evaluate(`document.querySelector('#masterVolumeInput').value = '0.62'; document.querySelector('#masterVolumeInput').dispatchEvent(new Event('input')); document.querySelector('#monitorVolumeInput').value = '0.28'; document.querySelector('#monitorVolumeInput').dispatchEvent(new Event('input'))`);
  await delay(70);
  assert.equal(library.settings.masterVolume, 0.62);
  assert.equal(library.settings.monitorVolume, 0.28);
  assert.equal(await evaluate(`document.querySelector('#monitorVolumeValue').textContent`), "28%");
  await click("#monitorEnabledInput");
  await delay(50);
  assert.equal(await evaluate(`document.querySelector('#monitorVolumeInput').disabled`), true);
  assert.equal(library.settings.masterVolume, 0.62);
  await click("#monitorEnabledInput");
  await delay(50);
  assert.equal(await evaluate(`document.querySelector('#monitorVolumeInput').disabled`), false);
  assert.equal(await evaluate(`document.querySelector('#monitorVolumeInput').value`), "0.28");
  await evaluate(`document.querySelector('#engineSelect').value = 'windows'; document.querySelector('#engineSelect').dispatchEvent(new Event('change'))`);
  await delay(50);
  assert.equal(await evaluate(`document.querySelector('#voiceSelect').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('#closeToTrayInput').checked`), false);
  await click("#closeToTrayInput");
  await delay(50);
  assert.equal(library.settings.closeToTray, true);
  await click("#settingsNav");
  await click("#settingsNav");
  assert.equal(await evaluate(`document.querySelector('#closeToTrayInput').checked`), true);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))`);
  assert.equal(await evaluate(`document.querySelector('#drawer').inert`), true);
  assert.equal(await evaluate(`document.querySelector('#ttsText').value`), "다음 판도 같이 하자");

  await click("#settingsNav");
  await evaluate(`document.querySelector('#engineSelect').value = 'azure'; document.querySelector('#engineSelect').dispatchEvent(new Event('change'))`);
  await delay(50);
  await click("#azureSettingsButton");
  await delay(50);
  assert.equal(await evaluate(`document.querySelector('#azureKeyInput').type`), "password");
  await evaluate(`document.querySelector('#azureKeyInput').value = 'isolated-fake-azure-key-for-ui-tests'; document.querySelector('#azureRegionInput').value = 'koreacentral'`);
  await click("#saveAzureSettingsButton");
  await delay(70);
  assert.equal(await evaluate(`document.querySelector('#azureKeyInput').value`), "");
  assert.equal(qaCredentials.status().configured, true);
  assert.equal((await fs.readFile(qaCredentials.filePath, "utf8")).includes("isolated-fake-azure-key-for-ui-tests"), false);
  await click("#testAzureConnectionButton");
  await delay(70);
  assert.match(await evaluate(`document.querySelector('#azureSettingsStatus').textContent`), /연결 확인됨/);
  await click("#closeAzureSettingsButton");
  await click("#azureSettingsButton");
  await delay(50);
  assert.equal(await evaluate(`document.querySelector('#azureKeyInput').value`), "");
  assert.equal(await evaluate(`document.querySelector('#azureKeyInput').placeholder`), "저장된 키 유지");
  await click("#deleteAzureSettingsButton");
  await delay(50);
  assert.equal(qaCredentials.status().configured, false);
  await click("#closeAzureSettingsButton");
  await evaluate(`document.querySelector('#voiceSelect').value = 'ko-KR-SeoHyeonNeural'; document.querySelector('#voiceSelect').dispatchEvent(new Event('change'))`);
  await delay(50);
  assert.equal(library.settings.voice, "ko-KR-SeoHyeonNeural");
  assert.equal(library.settings.ttsEngine, "azure");
  await click("#settingsNav");

  await click("#speakButton");
  await delay(70);
  assert.equal(await evaluate(`document.querySelector('#ttsText').value`), "");
  assert.equal(calls.filter(c => c.channel === "tts:synthesize").length, 1);
  assert.equal(calls.find(c => c.channel === "tts:synthesize").payload.settings.ttsEngine, "azure");
  assert.equal(calls.find(c => c.channel === "tts:synthesize").payload.settings.voice, "ko-KR-SeoHyeonNeural");
  assert.deepEqual(await evaluate(`__qa.players.slice(-2).map(player => player.volume)`), [0.62, 0.28]);
  await click("#phrasesNav");
  await click(".recent-play");
  await delay(70);
  assert.equal(calls.filter(c => c.channel === "tts:synthesize").length, 2);
  await click("#soundsNav");
  await click(".sound-play");
  await delay(30);
  await evaluate(`document.querySelector('#youtubeUrlInput').value = 'https://youtu.be/test'`);
  await click("#saveYoutubeButton");
  await delay(30);
  assert.ok(calls.some(c => c.channel === "sound:import-youtube"));
  assert.ok(await evaluate(`__qa.played > 0`));

  // Stress long text and empty libraries without touching a real profile.
  await evaluate(`state.recentPhrases = [{ id:'long', label:'long', text:'아주 긴 문장입니다 '.repeat(160) }]; state.sounds = []; render();`);
  await assertLayout("empty sounds");
  assert.equal(await evaluate(`document.querySelector('#emptySounds').hidden`), false);
  await click("#phrasesNav");
  await delay(280);
  await assertLayout("long recent text");
  errors.push(...await evaluate(`__qa.errors`));
  assert.deepEqual(errors, []);
  assert.equal(window.isVisible(), false);
  assert.equal(BrowserWindow.getFocusedWindow(), null);
  console.log("MAIN_UI_OK: 4 viewport sizes; Azure modal; real Windows key encryption; key clearing and deletion; voice selection; existing panels and draft retention; no visible windows, network, hooks or live audio");
}

verify().then(() => { clearTimeout(watchdog); window?.destroy(); app.quit(); }).catch((error) => {
  clearTimeout(watchdog);
  console.error(error);
  window?.destroy();
  app.exit(1);
});
