const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("worklogOverlay", {
  onQueue: (callback) => ipcRenderer.on("tracker:queue", (_event, queue) => callback(queue)),
  action: (action, id) => ipcRenderer.invoke("tracker:overlay-action", { action, id }),
});
