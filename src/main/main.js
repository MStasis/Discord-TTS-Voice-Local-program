const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");
const { app, BrowserWindow, dialog, ipcMain, shell, screen, Tray, Menu, nativeImage, safeStorage } = require("electron");
const {
  addPhrase,
  addRecentPhrase,
  addSound,
  normalizeState,
  removePhrase,
  removeRecentPhrase,
  removeSound,
  safeFileName,
  safeLabel,
  updateSound,
  updateSettings
} = require("../shared/library.cjs");
const { LibraryStore } = require("./store");
const { AzureCredentialStore } = require("./azureCredentials");
const { checkAzureConnection } = require("./azureTts");
const { SpeechOverlay } = require("./overlay");
const { TrayController } = require("./tray");
const { applyDiscordVoiceProfile } = require("./discordVoice");
const { synthesizeTts, trimOldTtsFiles } = require("./tts");
const {
  findCableCaptureDevice,
  getCaptureSnapshot,
  restoreCaptureDefaults,
  setupCableCaptureDefaults
} = require("./windowsAudio");
const { resolveFfmpegPath, resolveYoutubeAudio, trimOldYoutubeFiles } = require("./youtube");

const execFileAsync = promisify(execFile);

let mainWindow;
let store;
let azureCredentials;
let generatedVoiceCleanupTimer;
let speechOverlay;
let trayController;
let startupWarning = "";
const isSmokeRun = process.env.VOICEBOARD_SMOKE === "1";
const screenshotPath = process.env.VOICEBOARD_SCREENSHOT || "";
const backgroundFeaturesEnabled = !isSmokeRun && !screenshotPath;
const hasInstanceLock = !backgroundFeaturesEnabled || app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on("second-instance", () => trayController?.restore());
const GENERATED_VOICE_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const GENERATED_VOICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const GENERATED_VOICE_KEEP_COUNT = 20;

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function dataPaths() {
  const root = app.getPath("userData");
  return {
    root,
    bin: path.join(root, "bin"),
    library: path.join(root, "library.json"),
    sounds: path.join(root, "sounds"),
    tts: path.join(root, "tts-cache"),
    youtube: path.join(root, "youtube-cache")
  };
}

function withMediaUrls(state) {
  const normalized = normalizeState(state);
  return {
    ...normalized,
    sounds: normalized.sounds.map((sound) => ({
      ...sound,
      fileUrl: pathToFileURL(sound.path).toString(),
      exists: fs.existsSync(sound.path)
    }))
  };
}

function isInsideDirectory(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function copySoundIntoLibrary(filePath, labelOverride = "") {
  const paths = dataPaths();
  await fsp.mkdir(paths.sounds, { recursive: true });

  const label = safeLabel(labelOverride || path.parse(filePath).name, "Sound");
  const fileName = safeFileName(`${label}${path.extname(filePath) || ".mp3"}`);
  const destination = path.join(
    paths.sounds,
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${fileName}`
  );

  await fsp.copyFile(filePath, destination);
  return {
    id: createId("sound"),
    label,
    path: destination
  };
}

function normalizeTrimPayload(payload = {}) {
  const startSeconds = Math.max(0, Number(payload.startSeconds) || 0);
  const durationSeconds = Number(payload.durationSeconds);

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("자를 길이는 0보다 커야 합니다.");
  }

  return {
    id: typeof payload.id === "string" ? payload.id : "",
    startSeconds,
    durationSeconds: Math.min(durationSeconds, 60 * 60)
  };
}

async function trimSoundFile({ sourcePath, label, startSeconds, durationSeconds }) {
  const paths = dataPaths();
  await fsp.mkdir(paths.sounds, { recursive: true });

  const outputName = safeFileName(`${label || "sound"}-trimmed.mp3`);
  const outputPath = path.join(
    paths.sounds,
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${outputName}`
  );
  await execFileAsync(
    resolveFfmpegPath(),
    [
      "-y",
      "-ss",
      String(startSeconds),
      "-i",
      sourcePath,
      "-t",
      String(durationSeconds),
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "2",
      outputPath
    ],
    {
      maxBuffer: 1024 * 1024 * 4,
      timeout: 120000,
      windowsHide: true
    }
  );

  return outputPath;
}

function cleanupGeneratedVoiceFiles() {
  return trimOldTtsFiles(dataPaths().tts, {
    keep: GENERATED_VOICE_KEEP_COUNT,
    maxAgeMs: GENERATED_VOICE_MAX_AGE_MS
  });
}

function startGeneratedVoiceCleanup() {
  cleanupGeneratedVoiceFiles().catch(() => {});
  generatedVoiceCleanupTimer = setInterval(() => {
    cleanupGeneratedVoiceFiles().catch(() => {});
  }, GENERATED_VOICE_CLEANUP_INTERVAL_MS);
  if (typeof generatedVoiceCleanupTimer.unref === "function") {
    generatedVoiceCleanupTimer.unref();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 800,
    minHeight: 640,
    autoHideMenuBar: true,
    show: !isSmokeRun && !screenshotPath,
    backgroundColor: "#ffffff",
    title: "Voiceboard",
    icon: path.join(__dirname, "../assets/app-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required"
    }
  });

  mainWindow.webContents.on("did-start-loading", () => speechOverlay?.setReady(false));
  mainWindow.webContents.on("render-process-gone", () => speechOverlay?.setReady(false));
  mainWindow.on("close", (event) => trayController?.handleClose(event));
  mainWindow.on("closed", () => {
    speechOverlay?.dispose();
    trayController?.dispose();
  });
  mainWindow.on("query-session-end", () => {
    trayController?.beginQuit();
    speechOverlay?.dispose();
  });

  mainWindow.webContents.once("did-finish-load", () => {
    if (screenshotPath) {
      setTimeout(async () => {
        try {
          const image = await mainWindow.capturePage();
          await fsp.mkdir(path.dirname(screenshotPath), { recursive: true });
          await fsp.writeFile(screenshotPath, image.toPNG());
          console.log(`VOICEBOARD_SCREENSHOT ${screenshotPath}`);
          if (isSmokeRun) {
            app.quit();
          }
        } catch (error) {
          console.error(error);
          app.exit(1);
        }
      }, 700);
      return;
    }

    if (isSmokeRun) {
      console.log("VOICEBOARD_SMOKE_READY");
      setTimeout(() => app.quit(), 250);
    }
  });

  mainWindow.webContents.once("did-fail-load", (_event, code, description) => {
    if (isSmokeRun) {
      console.error(`VOICEBOARD_SMOKE_FAILED ${code}: ${description}`);
      app.exit(1);
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function registerIpc() {
  ipcMain.handle("overlay:submit", (event, text) => {
    if (event.sender !== speechOverlay?.window.webContents) throw new Error("Invalid overlay sender.");
    return speechOverlay.submit(text);
  });
  ipcMain.on("overlay:dismiss", (event) => {
    if (event.sender === speechOverlay?.window.webContents) speechOverlay.hide();
  });
  ipcMain.handle("overlay:renderer-ready", async (event) => {
    if (event.sender !== mainWindow.webContents) throw new Error("Invalid playback sender.");
    speechOverlay.setReady(true);
    await speechOverlay.shortcutReady;
    return { registered: speechOverlay.registered, startupWarning };
  });
  ipcMain.on("overlay:result", (event, result) => {
    if (event.sender === mainWindow.webContents && result) speechOverlay.complete(result);
  });
  ipcMain.handle("library:get", () => withMediaUrls(store.read()));

  ipcMain.handle("settings:update", (_event, patch) => {
    const previous = store.read();
    const next = updateSettings(previous, patch);
    if (backgroundFeaturesEnabled) trayController.setEnabled(next.settings.closeToTray);
    try { return withMediaUrls(store.write(next)); }
    catch (error) {
      if (backgroundFeaturesEnabled) trayController.setEnabled(previous.settings.closeToTray);
      throw error;
    }
  });

  ipcMain.handle("phrase:add", (_event, payload) => {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    const label = safeLabel(payload.label || text.slice(0, 24), "Phrase");
    const phrase = {
      id: createId("phrase"),
      label,
      text
    };
    const next = store.update((state) => addPhrase(state, phrase));
    return withMediaUrls(next);
  });

  ipcMain.handle("phrase:delete", (_event, id) => {
    const next = store.update((state) => removePhrase(state, id));
    return withMediaUrls(next);
  });

  ipcMain.handle("recent:add", (_event, text) => {
    const next = store.update((state) => addRecentPhrase(state, {
      id: createId("recent"), text
    }));
    return next.recentPhrases;
  });

  ipcMain.handle("recent:delete", (_event, id) => {
    return store.update((state) => removeRecentPhrase(state, id)).recentPhrases;
  });

  ipcMain.handle("sound:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add soundboard audio",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Audio", extensions: ["mp3", "wav", "ogg", "m4a", "aac", "flac"] },
        { name: "All files", extensions: ["*"] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return withMediaUrls(store.read());
    }

    const imported = [];
    for (const filePath of result.filePaths) {
      imported.push(await copySoundIntoLibrary(filePath));
    }

    const next = store.update((state) =>
      imported.reduce((current, sound) => addSound(current, sound), state)
    );
    return withMediaUrls(next);
  });

  ipcMain.handle("sound:delete", async (_event, id) => {
    const current = store.read();
    const sound = current.sounds.find((item) => item.id === id);
    const next = store.update((state) => removeSound(state, id));

    if (sound && isInsideDirectory(dataPaths().sounds, sound.path)) {
      await fsp.unlink(sound.path).catch(() => {});
    }

    return withMediaUrls(next);
  });

  ipcMain.handle("sound:import-youtube", async (_event, url) => {
    const paths = dataPaths();
    const result = await resolveYoutubeAudio({
      sourceUrl: url,
      binDir: paths.bin,
      outputDir: paths.youtube
    });
    const sound = await copySoundIntoLibrary(result.filePath, result.title);
    const next = store.update((state) => addSound(state, sound));

    trimOldYoutubeFiles(paths.youtube).catch(() => {});
    return withMediaUrls(next);
  });

  ipcMain.handle("sound:trim", async (_event, payload) => {
    const { id, startSeconds, durationSeconds } = normalizeTrimPayload(payload);
    const current = store.read();
    const sound = current.sounds.find((item) => item.id === id);

    if (!sound || !fs.existsSync(sound.path)) {
      throw new Error("편집할 사운드 파일을 찾지 못했습니다.");
    }

    const nextPath = await trimSoundFile({
      sourcePath: sound.path,
      label: sound.label,
      startSeconds,
      durationSeconds
    });
    const next = store.update((state) => updateSound(state, id, { path: nextPath }));

    if (isInsideDirectory(dataPaths().sounds, sound.path) && sound.path !== nextPath) {
      await fsp.unlink(sound.path).catch(() => {});
    }

    return withMediaUrls(next);
  });

  ipcMain.handle("youtube:resolve", async (_event, url) => {
    const paths = dataPaths();
    const result = await resolveYoutubeAudio({
      sourceUrl: url,
      binDir: paths.bin,
      outputDir: paths.youtube
    });

    trimOldYoutubeFiles(paths.youtube).catch(() => {});
    return {
      ...result,
      fileUrl: pathToFileURL(result.filePath).toString()
    };
  });

  ipcMain.handle("tts:synthesize", async (event, payload) => {
    if (event.sender !== mainWindow.webContents) throw new Error("Invalid playback sender.");
    const state = store.read();
    const settings = updateSettings(state, payload.settings || {}).settings;
    const result = await synthesizeTts({
      text: payload.text,
      settings,
      outputDir: dataPaths().tts,
      azure: settings.ttsEngine === "azure" ? azureCredentials.read() : undefined
    });

    cleanupGeneratedVoiceFiles().catch(() => {});
    return {
      engine: result.engine,
      filePath: result.filePath,
      fileUrl: pathToFileURL(result.filePath).toString()
    };
  });

  ipcMain.handle("audio:setup-cable", async () => {
    const current = store.read();
    const result = await setupCableCaptureDefaults(current.settings.captureDefaultsBackup);
    const next = store.update((state) =>
      updateSettings(state, {
        captureDefaultsBackup: result.backup
      })
    );

    const discord = await applyDiscordVoiceProfile("setup");
    return { ...result, discord, state: withMediaUrls(next) };
  });

  ipcMain.handle("audio:get-cable-status", async () => {
    const snapshot = await getCaptureSnapshot();
    const captureDevice = findCableCaptureDevice(snapshot.captureDevices);

    return {
      captureInstalled: Boolean(captureDevice),
      captureDevice: captureDevice || null
    };
  });

  ipcMain.handle("audio:release-cable", async () => {
    const current = store.read();
    const result = await restoreCaptureDefaults(current.settings.captureDefaultsBackup);
    const next = store.update((state) =>
      updateSettings(state, {
        captureDefaultsBackup: {
          console: "",
          multimedia: "",
          communications: ""
        }
      })
    );

    const discord = await applyDiscordVoiceProfile("release");
    return { ...result, discord, state: withMediaUrls(next) };
  });

  ipcMain.handle("app:open-data-folder", async () => {
    await shell.openPath(dataPaths().root);
    return dataPaths().root;
  });

  const azureHandle = (channel, handler) => ipcMain.handle(channel, (event, payload) => {
    if (event.sender !== mainWindow.webContents) throw new Error("Invalid Azure settings sender.");
    return handler(payload);
  });
  azureHandle("azure:get-settings", () => azureCredentials.status());
  azureHandle("azure:save-settings", (payload) => azureCredentials.save(payload));
  azureHandle("azure:delete-settings", () => azureCredentials.clear());
  azureHandle("azure:test", (payload) => checkAzureConnection({ credentials: azureCredentials.resolve(payload) }));
  azureHandle("app:open-azure-portal", () => shell.openExternal("https://portal.azure.com/"));

  ipcMain.handle("app:open-vb-cable-download", async () => {
    await shell.openExternal("https://vb-audio.com/Cable/");
    return true;
  });
}

app.whenReady().then(() => {
  if (!hasInstanceLock) return;
  const paths = dataPaths();
  store = new LibraryStore(paths.library);
  azureCredentials = new AzureCredentialStore(path.join(paths.root, "azure-credentials.json"), safeStorage);
  store.write(store.read());
  startGeneratedVoiceCleanup();
  registerIpc();
  createWindow();
  trayController = new TrayController({ app, Tray, Menu, nativeImage, window: mainWindow });
  if (backgroundFeaturesEnabled) {
    try { trayController.setEnabled(store.read().settings.closeToTray); }
    catch (error) {
      startupWarning = "알림 영역 아이콘을 만들지 못해 백그라운드 실행을 껐습니다.";
      store.update((state) => updateSettings(state, { closeToTray: false }));
      console.warn(error.message);
    }
  }
  speechOverlay = new SpeechOverlay({
    BrowserWindow, screen, mainWindow,
    enabled: backgroundFeaturesEnabled
  });

  app.on("activate", () => {
    trayController?.restore();
  });
});

app.on("before-quit", () => {
  trayController?.beginQuit();
  // The overlay normally prevents close; destroy it before app.quit starts closing windows.
  speechOverlay?.dispose();
});
app.on("will-quit", () => {
  speechOverlay?.dispose();
  trayController?.dispose();
});

app.on("window-all-closed", () => {
  if (generatedVoiceCleanupTimer) {
    clearInterval(generatedVoiceCleanupTimer);
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
