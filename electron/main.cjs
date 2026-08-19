const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, nativeImage, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const CAPTURE_INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_DAYS = Math.max(1, Number(process.env.WORKLOG_SCREENSHOT_RETENTION_DAYS || 60));
const APP_PORT = 3210;
const DATABASE_PORT = 55432;
const APP_URL = process.env.WORKLOG_APP_URL || (app.isPackaged ? `http://127.0.0.1:${APP_PORT}` : "http://localhost:3000");
const APP_ORIGIN = new URL(APP_URL).origin;

let mainWindow;
let previewWindow;
let nextProcess;
let captureTimer;
let pending = [];
const activeSources = new Map();

function writeDesktopLog(message) {
  try {
    const directory = app.getPath("userData");
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, "desktop.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Logging must never prevent the application from opening.
  }
}

function isTrustedAppUrl(value) {
  try {
    return new URL(value).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function openExternalHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") void shell.openExternal(url.href);
  } catch {
    // Ignore malformed navigation targets.
  }
}

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

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { capture = true, ...spawnOptions } = options;
    const child = spawn(command, args, {
      ...spawnOptions,
      windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} failed (${code}): ${stderr || stdout}`));
    });
  });
}

function getPostgresPaths() {
  const root = path.join(process.resourcesPath, "postgres");
  return {
    bin: path.join(root, "bin"),
    data: path.join(app.getPath("userData"), "database"),
    initdb: path.join(root, "bin", "initdb.exe"),
    pgCtl: path.join(root, "bin", "pg_ctl.exe"),
    psql: path.join(root, "bin", "psql.exe"),
    createdb: path.join(root, "bin", "createdb.exe"),
    schema: path.join(process.resourcesPath, "database-schema.sql"),
  };
}

function getPostgresEnvironment(paths) {
  return {
    ...process.env,
    PATH: `${paths.bin};${process.env.PATH || ""}`,
    PGHOST: "127.0.0.1",
    PGPORT: String(DATABASE_PORT),
    PGUSER: "postgres",
  };
}

async function ensurePostgres() {
  if (!app.isPackaged) return;
  const paths = getPostgresPaths();
  const env = getPostgresEnvironment(paths);
  await fsp.mkdir(paths.data, { recursive: true });

  if (!fs.existsSync(path.join(paths.data, "PG_VERSION"))) {
    writeDesktopLog("initializing private PostgreSQL database");
    await runProcess(paths.initdb, ["-D", paths.data, "-U", "postgres", "-A", "trust", "--encoding=UTF8", "--no-locale"], { env });
  }

  const status = await runProcess(paths.pgCtl, ["status", "-D", paths.data], { env }).then(() => true).catch(() => false);
  if (!status) {
    await runProcess(paths.pgCtl, ["start", "-D", paths.data, "-l", path.join(paths.data, "postgres.log"), "-o", `-p ${DATABASE_PORT} -h 127.0.0.1`, "-w"], { env, capture: false });
  }

  const databaseExists = await runProcess(paths.psql, ["-d", "postgres", "-tAc", "SELECT 1 FROM pg_database WHERE datname='worklog_ultra'"], { env })
    .then(({ stdout }) => stdout.trim() === "1");
  if (!databaseExists) await runProcess(paths.createdb, ["worklog_ultra"], { env });

  const schemaMarker = path.join(paths.data, "worklog-schema-v1.ready");
  if (!fs.existsSync(schemaMarker)) {
    await runProcess(paths.psql, ["-d", "worklog_ultra", "-v", "ON_ERROR_STOP=1", "-f", paths.schema], { env });
    await fsp.writeFile(schemaMarker, new Date().toISOString(), "utf8");
  }
  writeDesktopLog("private PostgreSQL database ready");
}

function getDesktopRuntimeRoot() {
  return path.join(app.getPath("userData"), `app-runtime-${app.getVersion()}`);
}

async function ensureDesktopRuntime() {
  if (!app.isPackaged) return;
  const runtimeRoot = getDesktopRuntimeRoot();
  if (fs.existsSync(path.join(runtimeRoot, "server.js")) && fs.existsSync(path.join(runtimeRoot, "node_modules", "next"))) return;

  writeDesktopLog(`extracting latest UI runtime ${app.getVersion()}`);
  await fsp.rm(runtimeRoot, { recursive: true, force: true });
  await fsp.mkdir(runtimeRoot, { recursive: true });
  await runProcess(
    path.join(process.resourcesPath, "7za.exe"),
    ["x", path.join(process.resourcesPath, "app-runtime.7z"), `-o${runtimeRoot}`, "-y"],
  );
  if (!fs.existsSync(path.join(runtimeRoot, "server.js"))) throw new Error("Latest UI runtime extraction failed.");
  writeDesktopLog("latest UI runtime ready");
}

async function ensureDesktopUploads() {
  if (!app.isPackaged) return;
  const publicUploads = path.join(getDesktopRuntimeRoot(), "public", "uploads");
  const userUploads = path.join(app.getPath("userData"), "uploads");
  await fsp.mkdir(path.dirname(publicUploads), { recursive: true });
  await fsp.mkdir(userUploads, { recursive: true });
  const existing = await fsp.lstat(publicUploads).catch(() => null);
  if (existing?.isSymbolicLink()) return;
  if (existing) await fsp.rm(publicUploads, { recursive: true, force: true });
  await fsp.symlink(userUploads, publicUploads, "junction");
}

async function ensureNextServer() {
  if (await isServerReady()) return;
  if (app.isPackaged) {
    const serverFile = path.join(getDesktopRuntimeRoot(), "server.js");
    const serverLog = fs.openSync(path.join(app.getPath("userData"), "next-server.log"), "a");
    nextProcess = spawn(process.execPath, [serverFile], {
      cwd: path.dirname(serverFile),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        WORKLOG_DESKTOP: "1",
        HOSTNAME: "127.0.0.1",
        PORT: String(APP_PORT),
        DATABASE_URL: `postgresql://postgres@127.0.0.1:${DATABASE_PORT}/worklog_ultra`,
        APP_BASE_URL: APP_URL,
        AUTH_EMAIL_REDIRECT_TO: APP_URL,
      },
      windowsHide: true,
      stdio: ["ignore", serverLog, serverLog],
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
    show: false,
    backgroundColor: "#eef3f9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedAppUrl(url)) return { action: "allow" };
    openExternalHttpUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedAppUrl(url)) return;
    event.preventDefault();
    openExternalHttpUrl(url);
  });
  mainWindow.loadURL(APP_URL).catch((error) => {
    dialog.showErrorBox(
      "WorkLog connection failed",
      `WorkLog server-এ সংযোগ করা যায়নি। Internet connection পরীক্ষা করে app আবার চালু করুন.\n\n${error.message}`,
    );
  });
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();
writeDesktopLog(`startup packaged=${app.isPackaged} url=${APP_URL} singleInstance=${hasSingleInstanceLock}`);
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    writeDesktopLog("electron ready");
    app.setAppUserModelId("com.worklog.ultra");
    await ensurePostgres();
    await ensureDesktopRuntime();
    await ensureDesktopUploads();
    await restorePendingQueue();
    await enforceRetention();
    await ensureNextServer();
    createMainWindow();
    createPreviewWindow();
  }).catch((error) => {
    writeDesktopLog(`startup failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    console.error("WorkLog Electron startup failed:", error);
    dialog.showErrorBox("WorkLog startup failed", error instanceof Error ? error.stack || error.message : String(error));
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (captureTimer) clearInterval(captureTimer);
  if (nextProcess && !nextProcess.killed) nextProcess.kill();
  // Signal the renderer to stop any running timers before app closes
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:quit");
  }
  if (app.isPackaged) {
    const paths = getPostgresPaths();
    const child = spawn(paths.pgCtl, ["stop", "-D", paths.data, "-m", "fast", "-w"], {
      env: getPostgresEnvironment(paths),
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
});
