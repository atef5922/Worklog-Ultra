const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("worklogDesktop", {
  isDesktop: true,
  startTracking: (input) => ipcRenderer.invoke("tracker:start", input),
  stopTracking: (input) => ipcRenderer.invoke("tracker:stop", input),
  getTrackerStatus: () => ipcRenderer.invoke("tracker:status"),
  openTrackerFolder: (input) => ipcRenderer.invoke("tracker:open-folder", input),
  exportTrackerScreenshots: (input) => ipcRenderer.invoke("tracker:export", input),
  onTrackerStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("tracker:status", listener);
    return () => ipcRenderer.removeListener("tracker:status", listener);
  },
});
