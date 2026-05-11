const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const {
  addLog,
  addPhrase,
  addSound,
  normalizeState,
  removePhrase,
  removeSound,
  safeFileName,
  safeLabel,
  updateSettings
} = require("../shared/library.cjs");
const { LibraryStore } = require("./store");
const { synthesizeTts, trimOldTtsFiles } = require("./tts");
const {
  findCableCaptureDevice,
  getCaptureSnapshot,
  restoreCaptureDefaults,
  setupCableCaptureDefaults
} = require("./windowsAudio");

let mainWindow;
let store;
const isSmokeRun = process.env.VOICEBOARD_SMOKE === "1";
const screenshotPath = process.env.VOICEBOARD_SCREENSHOT || "";

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function dataPaths() {
  const root = app.getPath("userData");
  return {
    root,
    library: path.join(root, "library.json"),
    sounds: path.join(root, "sounds"),
    tts: path.join(root, "tts-cache")
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

async function copySoundIntoLibrary(filePath) {
  const paths = dataPaths();
  await fsp.mkdir(paths.sounds, { recursive: true });

  const fileName = safeFileName(path.basename(filePath));
  const destination = path.join(
    paths.sounds,
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${fileName}`
  );

  await fsp.copyFile(filePath, destination);
  return {
    id: createId("sound"),
    label: safeLabel(path.parse(fileName).name, "Sound"),
    path: destination
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 940,
    minHeight: 680,
    show: !isSmokeRun && !screenshotPath,
    backgroundColor: "#f7f8fa",
    title: "Voiceboard",
    webPreferences: {
      preload: path.join(__dirname, "../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
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
  ipcMain.handle("library:get", () => withMediaUrls(store.read()));

  ipcMain.handle("settings:update", (_event, patch) => {
    const next = store.update((state) => updateSettings(state, patch));
    return withMediaUrls(next);
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

  ipcMain.handle("log:add", (_event, payload = {}) => {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    const next = store.update((state) =>
      addLog(state, {
        id: createId("log"),
        text,
        createdAt: new Date().toISOString()
      })
    );

    return withMediaUrls(next);
  });

  ipcMain.handle("tts:synthesize", async (_event, payload) => {
    const state = store.read();
    const settings = updateSettings(state, payload.settings || {}).settings;
    const result = await synthesizeTts({
      text: payload.text,
      settings,
      outputDir: dataPaths().tts
    });

    trimOldTtsFiles(dataPaths().tts).catch(() => {});
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

    return {
      ...result,
      state: withMediaUrls(next)
    };
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

    return {
      ...result,
      state: withMediaUrls(next)
    };
  });

  ipcMain.handle("app:open-data-folder", async () => {
    await shell.openPath(dataPaths().root);
    return dataPaths().root;
  });

  ipcMain.handle("app:open-vb-cable-download", async () => {
    await shell.openExternal("https://vb-audio.com/Cable/");
    return true;
  });
}

app.whenReady().then(() => {
  const paths = dataPaths();
  store = new LibraryStore(paths.library);
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
