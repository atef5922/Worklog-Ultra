const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { createScreenshotMonitor } = require("./screenshot-monitor.cjs");

/**
 * Packaged builds are a thin client against the shared production server —
 * not a standalone app with its own database. Screenshot monitoring (and
 * every other multi-employee feature) only makes sense against one shared
 * backend that every employee's desktop app talks to; a locally bundled
 * Postgres per install was tried at one point and quietly broke exactly
 * that, since each machine ended up with its own empty, unsynced database.
 * Override with WORKLOG_APP_URL for pointing a build at a staging server.
 */
const APP_URL = process.env.WORKLOG_APP_URL || (app.isPackaged ? "https://worklog.mugnee.com" : "http://localhost:3000");
const APP_ORIGIN = new URL(APP_URL).origin;

let mainWindow;
let splashWindow;
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
    const client = APP_URL.startsWith("https:") ? https : http;
    const request = client.get(APP_URL, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(4000, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

/**
 * Dev-only: `npm run dev` isn't running yet when Electron starts against
 * localhost. Packaged builds skip this entirely — there is nothing local to
 * spawn, only the remote server's reachability to wait on.
 */
async function ensureDevServer() {
  if (app.isPackaged || (await isServerReady())) return;
  const isWindows = process.platform === "win32";
  const command = isWindows ? process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe" : "npm";
  const args = isWindows ? ["/d", "/s", "/c", "npm.cmd run dev"] : ["run", "dev"];
  nextProcess = spawn(command, args, {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, WORKLOG_DESKTOP: "1" },
    windowsHide: true,
    stdio: "ignore",
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await isServerReady()) return;
  }
  throw new Error("WorkLog dev server did not start.");
}

/**
 * Packaged builds wait on the *remote* server instead — no process to spawn,
 * just patience for a connection. Retries for up to ~2 minutes so a slow or
 * momentarily flaky connection doesn't fail startup outright; the splash
 * window is what makes that wait visible instead of a blank app.
 */
async function waitForRemoteServer() {
  if (!app.isPackaged) return;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Could not reach ${APP_URL}. Check your internet connection.`);
}

/**
 * Shown the instant Electron is ready, before the connectivity wait —
 * without it the app is a blank nothing for however long that check takes,
 * which is exactly what invites someone to double-click the icon again.
 */
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#000080",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`<!doctype html><html><head><style>
        html,body{margin:0;height:100%;background:linear-gradient(160deg,#000080 0%,#001f66 55%,#020b31 100%);
          display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;
          font-family:Segoe UI,Arial,sans-serif;color:#f8fbff;}
        .spinner{width:32px;height:32px;border-radius:50%;border:3px solid rgba(248,251,255,0.25);
          border-top-color:#35d39a;animation:spin 0.8s linear infinite;}
        @keyframes spin{to{transform:rotate(360deg);}}
        p{margin:0;font-size:13px;letter-spacing:0.02em;opacity:0.9;}
      </style></head><body>
        <div class="spinner"></div>
        <p>Starting WorkLog Ultra...</p>
      </body></html>`),
  );
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
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
  mainWindow.once("ready-to-show", () => {
    closeSplashWindow();
    mainWindow?.show();
  });
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
    closeSplashWindow();
    dialog.showErrorBox(
      "WorkLog connection failed",
      `WorkLog server-এ সংযোগ করা যায়নি। Internet connection পরীক্ষা করে app আবার চালু করুন.\n\n${error.message}`,
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
    // A relaunch during the connectivity wait lands here before mainWindow
    // exists — focusing the splash instead of doing nothing is what tells
    // the person their click registered, so they stop clicking again.
    const target = mainWindow ?? splashWindow;
    if (!target) return;
    if (mainWindow?.isMinimized()) mainWindow.restore();
    target.show();
    target.focus();
  });

  app.whenReady().then(async () => {
    writeDesktopLog("electron ready");
    app.setAppUserModelId("com.worklog.ultra");
    createSplashWindow();
    await ensureDevServer();
    await waitForRemoteServer();
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
    closeSplashWindow();
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
});
