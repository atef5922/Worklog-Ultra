const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { createScreenshotMonitor } = require("./screenshot-monitor.cjs");

const APP_PORT = 3210;
const DATABASE_PORT = 55432;
const APP_URL = process.env.WORKLOG_APP_URL || (app.isPackaged ? `http://127.0.0.1:${APP_PORT}` : "http://localhost:3000");
const APP_ORIGIN = new URL(APP_URL).origin;

let mainWindow;
let nextProcess;
let screenshotMonitor;

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

function getStorageRoot() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "WorkLog Ultra", "TaskMonitor");
  }
  return path.join(app.getPath("userData"), "TaskMonitor");
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

function createScreenshotMonitorInstance() {
  return createScreenshotMonitor({
    appUrl: APP_URL,
    storageRoot: getStorageRoot(),
    log: (message) => writeDesktopLog(`[monitor] ${message}`),
    onStatusChange: (status) => mainWindow?.webContents.send("screenshot:status", status),
  });
}

/**
 * Monitoring is driven only by attendance. Task timers (`source: "task:*"`)
 * still fire the same renderer event for backwards compatibility with the
 * per-task UI, but must never start or stop the screenshot scheduler — the
 * backend only ever accepts uploads while a work session (attendance) is
 * open, so gating capture on anything narrower than that just produced
 * screenshots the server would reject.
 */
const IDLE_STATUS = { state: "STOPPED", running: false, paused: false, userId: null, label: null, pending: 0, intervalMinutes: 5, nextCaptureAt: null };

ipcMain.handle("screenshot:start", (_event, input = {}) => {
  if (!screenshotMonitor || String(input.source) !== "attendance") return screenshotMonitor?.getStatus() ?? IDLE_STATUS;
  return screenshotMonitor.start({ userId: String(input.userId || ""), label: String(input.label || "Attendance") });
});

ipcMain.handle("screenshot:stop", (_event, input = {}) => {
  if (!screenshotMonitor || String(input.source) !== "attendance") return screenshotMonitor?.getStatus() ?? IDLE_STATUS;
  return screenshotMonitor.stop();
});

ipcMain.handle("screenshot:pause", () => screenshotMonitor?.pause() ?? IDLE_STATUS);
ipcMain.handle("screenshot:resume", () => screenshotMonitor?.resume() ?? IDLE_STATUS);
ipcMain.handle("screenshot:status", () => screenshotMonitor?.getStatus() ?? IDLE_STATUS);

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
    await ensureNextServer();
    createMainWindow();
    screenshotMonitor = createScreenshotMonitorInstance();
    // Backend is authoritative: this is what restores monitoring after a
    // restart while attendance is still active, and what makes the agent
    // self-heal if it ever missed a stop signal — never trust renderer state
    // alone for whether capture should be running.
    await screenshotMonitor.init();
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
  screenshotMonitor?.shutdown();
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
