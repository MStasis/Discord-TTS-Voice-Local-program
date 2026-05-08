const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voiceboard", {
  getLibrary: () => ipcRenderer.invoke("library:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  addPhrase: (payload) => ipcRenderer.invoke("phrase:add", payload),
  deletePhrase: (id) => ipcRenderer.invoke("phrase:delete", id),
  importSounds: () => ipcRenderer.invoke("sound:import"),
  deleteSound: (id) => ipcRenderer.invoke("sound:delete", id),
  synthesizeTts: (payload) => ipcRenderer.invoke("tts:synthesize", payload),
  getCableStatus: () => ipcRenderer.invoke("audio:get-cable-status"),
  setupCableAudio: () => ipcRenderer.invoke("audio:setup-cable"),
  releaseCableAudio: () => ipcRenderer.invoke("audio:release-cable"),
  openVbCableDownload: () => ipcRenderer.invoke("app:open-vb-cable-download"),
  openDataFolder: () => ipcRenderer.invoke("app:open-data-folder")
});
