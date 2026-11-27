const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("speechOverlay", {
  submit: (text) => ipcRenderer.invoke("overlay:submit", text),
  dismiss: () => ipcRenderer.send("overlay:dismiss"),
  onOpened: (callback) => ipcRenderer.on("overlay:opened", (_event, options) => callback(options)),
  onHidden: (callback) => ipcRenderer.on("overlay:hidden", () => callback()),
  onFailed: (callback) => ipcRenderer.on("overlay:failed", (_event, result) => callback(result))
});
