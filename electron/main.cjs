const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, nativeImage, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const CAPTURE_INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_DAYS = Math.max(1, Number(process.env.WORKLOG_SCREENSHOT_RETENTION_DAYS || 60));
const APP_URL = process.env.WORKLOG_APP_URL || "http://localhost:3000";

let mainWindow;
let previewWindow;
let nextProcess;
let captureTimer;
let pending = [];
const activeSources = new Map();

function safeSegment(value) {
  return String(value || "work").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").slice(0, 80) || "work";
}

function dateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function getStorageRoot() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "WorkLog Ultra", "TaskMonitor");
  }
  return path.join(app.getPath("userData"), "TaskMonitor");
}

function getPendingDir() {
  return path.join(getStorageRoot(), ".pending");
}

function getPendingManifestPath() {
  return path.join(getPendingDir(), "queue.json");
}

async function persistPendingQueue() {
  const directory = getPendingDir();
  await fsp.mkdir(directory, { recursive: true });
  const serializable = pending.map(({ id, pendingPath, capturedAt, label, userId, taskId }) => ({
    id,
    fileName: path.basename(pendingPath),
    capturedAt,
    label,
    userId,
    taskId,
  }));
  const temporary = `${getPendingManifestPath()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(serializable, null, 2), "utf8");
  await fsp.rename(temporary, getPendingManifestPath()).catch(async () => {
    await fsp.copyFile(temporary, getPendingManifestPath());
    await fsp.unlink(temporary).catch(() => {});
  });
}

async function restorePendingQueue() {
  const raw = await fsp.readFile(getPendingManifestPath(), "utf8").catch(() => "[]");
  let entries = [];
  try {
    entries = JSON.parse(raw);
  } catch {
    entries = [];
  }
  const restored = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const fileName = path.basename(String(entry.fileName || ""));
    const pendingPath = path.join(getPendingDir(), fileName);
    const stat = await fsp.stat(pendingPath).catch(() => null);
    if (!stat?.isFile()) continue;
    const image = nativeImage.createFromPath(pendingPath);
    if (image.isEmpty()) continue;
    restored.push({
      id: String(entry.id),
      pendingPath,
      dataUrl: image.toDataURL(),
      capturedAt: String(entry.capturedAt),
      label: String(entry.label || "Recovered work"),
      userId: safeSegment(entry.userId || "unknown-user"),
      taskId: safeSegment(entry.taskId || "work"),
    });
  }
  pending = restored;
  await persistPendingQueue();
}

async function enforceRetention() {
  const root = getStorageRoot();
  const users = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const user of users) {
    if (!user.isDirectory() || user.name === ".pending") continue;
    const userDirectory = path.join(root, user.name);
    const days = await fsp.readdir(userDirectory, { withFileTypes: true }).catch(() => []);
    for (const day of days) {
      if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name)) continue;
      const timestamp = new Date(`${day.name}T00:00:00+06:00`).getTime();
      if (Number.isFinite(timestamp) && timestamp < cutoff) {
        await fsp.rm(path.join(userDirectory, day.name), { recursive: true, force: true });
      }
    }
  }
}

function isServerReady() {
  return new Promise((resolve) => {
    const request = http.get(APP_URL, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(800, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function ensureNextServer() {
  if (await isServerReady()) return;
  if (app.isPackaged) {
    const serverFile = path.join(process.resourcesPath, "standalone", "server.js");
    nextProcess = spawn(process.execPath, [serverFile], {
      cwd: path.dirname(serverFile),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", WORKLOG_DESKTOP: "1", HOSTNAME: "localhost", PORT: "3000" },
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    const isWindows = process.platform === "win32";
    const command = isWindows ? process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe" : "npm";
    const args = isWindows ? ["/d", "/s", "/c", "npm.cmd run dev"] : ["run", "dev"];
    nextProcess = spawn(command, args, {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, WORKLOG_DESKTOP: "1" },
      windowsHide: true,
      stdio: "ignore",
    });
  }

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await isServerReady()) return;
  }
  throw new Error("WorkLog web server did not start.");
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: true,
    backgroundColor: "#eef3f9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(APP_URL);
}

function createPreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) return previewWindow;
  const area = screen.getPrimaryDisplay().workArea;
  previewWindow = new BrowserWindow({
    width: 390,
    height: 360,
    x: area.x + area.width - 410,
    y: area.y + area.height - 380,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "overlay-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  previewWindow.setAlwaysOnTop(true, "floating");
  previewWindow.loadFile(path.join(__dirname, "overlay.html"));
  previewWindow.on("closed", () => { previewWindow = null; });
  return previewWindow;
}

function publishQueue() {
  const win = createPreviewWindow();
  const payload = pending.map(({ id, dataUrl, capturedAt, label }) => ({ id, dataUrl, capturedAt, label }));
  const send = () => win.webContents.send("tracker:queue", payload);
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
  if (pending.length) win.showInactive();
  else win.hide();
  mainWindow?.webContents.send("tracker:status", getStatus());
}

function getStatus() {
  return {
    running: activeSources.size > 0,
    active: [...activeSources.entries()].map(([source, item]) => ({ source, label: item.label })),
    pending: pending.length,
    intervalMinutes: 5,
    folder: getStorageRoot(),
    retentionDays: RETENTION_DAYS,
  };
}

async function captureDesktop() {
  if (!activeSources.size) return;
  const primary = screen.getPrimaryDisplay();
  const targetSize = {
    width: Math.round(primary.size.width * primary.scaleFactor),
    height: Math.round(primary.size.height * primary.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: targetSize });
  const source = sources.find((item) => String(item.display_id) === String(primary.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) return;

  const capturedAt = new Date();
  const id = `${capturedAt.getTime()}-${Math.random().toString(36).slice(2, 9)}`;
  const pendingDir = getPendingDir();
  await fsp.mkdir(pendingDir, { recursive: true });
  const pendingPath = path.join(pendingDir, `${id}.jpg`);
  const image = nativeImage.createFromBuffer(source.thumbnail.toJPEG(82));
  await fsp.writeFile(pendingPath, image.toJPEG(82));
  const active = [...activeSources.values()].at(-1) || { label: "Work session", userId: "unknown-user", taskId: "work" };
  pending.push({ id, pendingPath, dataUrl: image.toDataURL(), capturedAt: capturedAt.toISOString(), ...active });
  await persistPendingQueue();
  publishQueue();
}

function beginSchedule() {
  if (captureTimer) clearInterval(captureTimer);
  void captureDesktop();
  captureTimer = setInterval(() => void captureDesktop(), CAPTURE_INTERVAL_MS);
}

function stopScheduleIfIdle() {
  if (activeSources.size || !captureTimer) return;
  clearInterval(captureTimer);
  captureTimer = null;
}

async function submitCapture(item) {
  const dayFolder = dateKey(new Date(item.capturedAt));
  const userFolder = safeSegment(item.userId || "unknown-user");
  const taskFolder = `${safeSegment(item.taskId || "work")}--${safeSegment(item.label)}`;
  const targetDir = path.join(getStorageRoot(), userFolder, dayFolder, taskFolder);
  await fsp.mkdir(targetDir, { recursive: true });
  const time = new Date(item.capturedAt).toISOString().replace(/[:.]/g, "-");
  const target = path.join(targetDir, `${time}.jpg`);
  await fsp.rename(item.pendingPath, target).catch(async () => {
    await fsp.copyFile(item.pendingPath, target);
    await fsp.unlink(item.pendingPath).catch(() => {});
  });
  return target;
}

ipcMain.handle("tracker:start", (_event, input = {}) => {
  const source = String(input.source || "work");
  const wasIdle = activeSources.size === 0;
  const wasAlreadyActive = activeSources.has(source);
  activeSources.set(source, {
    label: String(input.label || "Work session"),
    userId: safeSegment(input.userId || "unknown-user"),
    taskId: safeSegment(input.taskId || source),
  });
  if (wasIdle) beginSchedule();
  else if (!wasAlreadyActive) void captureDesktop();
  else mainWindow?.webContents.send("tracker:status", getStatus());
  return getStatus();
});

ipcMain.handle("tracker:stop", (_event, input = {}) => {
  activeSources.delete(String(input.source || "work"));
  stopScheduleIfIdle();
  mainWindow?.webContents.send("tracker:status", getStatus());
  return getStatus();
});

ipcMain.handle("tracker:status", () => getStatus());
ipcMain.handle("tracker:open-folder", async (_event, input = {}) => {
  const folder = input.userId ? path.join(getStorageRoot(), safeSegment(input.userId)) : getStorageRoot();
  await fsp.mkdir(folder, { recursive: true });
  return shell.openPath(folder);
});
ipcMain.handle("tracker:export", async (_event, input = {}) => {
  const source = input.userId ? path.join(getStorageRoot(), safeSegment(input.userId)) : getStorageRoot();
  const stat = await fsp.stat(source).catch(() => null);
  if (!stat?.isDirectory()) return { ok: false, message: "No submitted screenshots are available to export." };
  const result = await dialog.showOpenDialog(mainWindow, { title: "Export WorkLog screenshots", properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const destination = path.join(result.filePaths[0], `WorkLog-Screenshots-${dateKey()}`);
  await fsp.cp(source, destination, { recursive: true, force: true });
  return { ok: true, destination };
});
ipcMain.handle("tracker:overlay-action", async (_event, { action, id }) => {
  const item = pending.find((entry) => entry.id === id);
  if (!item) return { ok: false };
  if (action === "edit") {
    await shell.openPath(item.pendingPath);
    return { ok: true };
  }
  if (action === "discard") await fsp.unlink(item.pendingPath).catch(() => {});
  if (action === "submit") await submitCapture(item);
  pending = pending.filter((entry) => entry.id !== id);
  await persistPendingQueue();
  publishQueue();
  return { ok: true };
});

app.whenReady().then(async () => {
  await restorePendingQueue();
  await enforceRetention();
  await ensureNextServer();
  createMainWindow();
  createPreviewWindow();
}).catch((error) => {
  console.error("WorkLog Electron startup failed:", error);
  dialog.showErrorBox("WorkLog startup failed", error instanceof Error ? error.stack || error.message : String(error));
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (captureTimer) clearInterval(captureTimer);
  if (nextProcess && !nextProcess.killed) nextProcess.kill();
});
