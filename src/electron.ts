import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  MenuItemConstructorOptions,
  shell,
  ipcMain,
  Notification,
} from "electron";
import { startServer } from "./server";
import { autoUpdater } from "electron-updater";
import log from "electron-log";
import path from "path";

// --- Auto Updater Setup ---
log.transports.file.level = "debug";
autoUpdater.logger = log;
autoUpdater.autoDownload = false;

const SERVER_URL = "http://localhost:5432";

let isManualCheck = false;

// Events
autoUpdater.on("update-available", () => {
  log.info("Update available.");
  isManualCheck = false; // Reset flag
  dialog
    .showMessageBox({
      type: "info",
      title: "Update Available",
      message:
        "A new version of AICardArts is available. Do you want to download it now?",
      buttons: ["Yes", "No"],
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
});

autoUpdater.on("update-downloaded", () => {
  log.info("Update downloaded.");
  dialog
    .showMessageBox({
      type: "info",
      title: "Update Ready",
      message: "Install and restart now?",
      buttons: ["Yes", "Later"],
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
});

autoUpdater.on("update-not-available", () => {
  log.info("Update not available.");
  if (isManualCheck) {
    dialog.showMessageBox({
      type: "info",
      title: "No Updates",
      message: "Your application is up to date.",
      buttons: ["OK"],
    });
    isManualCheck = false;
  }
});

autoUpdater.on("error", (err) => {
  log.error("Error in auto-updater. " + err);
  if (isManualCheck) {
    dialog.showMessageBox({
      type: "error",
      title: "Update Error",
      message: "An error occurred while checking for updates.",
      buttons: ["OK"],
    });
    isManualCheck = false;
  }
});

let mainWindow: BrowserWindow | null;

function createMenu() {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    // { role: 'appMenu' }
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Check for Updates...",
                click: () => {
                  log.info("User triggered check for updates");
                  isManualCheck = true;
                  autoUpdater.checkForUpdatesAndNotify();
                },
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    // { role: 'fileMenu' }
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    // { role: 'editMenu' }
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(isMac
          ? [
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
              { role: "selectAll" },
              { type: "separator" },
              {
                label: "Speech",
                submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
              },
            ]
          : [{ role: "delete" }, { type: "separator" }, { role: "selectAll" }]),
      ],
    },
    // { role: 'viewMenu' }
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        {
          label: "Open in Browser",
          click: async () => {
            await shell.openExternal(SERVER_URL);
          },
        },
      ],
    },
    // { role: 'windowMenu' }
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ]
          : [{ role: "close" }]),
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Learn More",
          click: async () => {
            await shell.openExternal(
              "https://github.com/rundquist/ai-art-cards"
            );
          },
        },
        { type: "separator" },
        {
          label: "View Application Logs",
          click: () => {
            const logFile = log.transports.file.getFile().path;
            log.info("User requested to view logs at:", logFile);
            if (logFile) {
              shell.showItemInFolder(logFile);
            }
          },
        },
      ],
    },
  ] as MenuItemConstructorOptions[];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 960,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    title: "AICardArts",
    backgroundColor: "#1e1e1e",
    show: false, // Wait until ready-to-show
  });

  // Load the app
  // Wait for server to be ready?
  // For simplicity, we just load. server.ts starts listening immediately.
  mainWindow.loadURL(SERVER_URL);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    // Check for updates shortly after startup
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 3000);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", async () => {
  // Start backend
  console.log("Starting server...");

  app.setAboutPanelOptions({
    applicationName: "AICardArts",
    applicationVersion: app.getVersion(),
    copyright: "Copyright © 2026 Rundquist Tech LLC",
    credits: "Produced by Rundquist Tech LLC",
    authors: ["James Rundquist"],
    website: "https://github.com/jrundquist/ai-art-cards",
  });

  createMenu();

  const userDataPath = app.getPath("userData");
  console.log("Electron User Data Path:", userDataPath);

  // Use a subfolder 'server-data' to keep it clean, or just root
  const dataRoot = userDataPath; // path.join(userDataPath, "data");

  // IPC Handlers
  // IPC Handlers
  ipcMain.handle("open-data-folder", async (event, subPath?: string) => {
    // Open the dataRoot
    if (subPath) {
      // Basic security: prevent traversing up
      const safeSub = subPath.replace(/^(\.\.(\/|\\|$))+/, "");
      const target = path.join(dataRoot, safeSub);
      log.info("Opening specific folder:", target);
      // Ensure it exists? shell.openPath checks existence.
      // If it doesn't exist, we might want to try creating it?
      // Or just open parent?
      // Let's just try opening.
      const err = await shell.openPath(target);
      if (err) {
        log.warn("Failed to open specific path, falling back to root:", err);
        await shell.openPath(dataRoot);
      }
    } else {
      await shell.openPath(dataRoot);
    }
  });

  ipcMain.handle("open-external-link", async (event, url: string) => {
    log.info("Opening external link:", url);
    await shell.openExternal(url);
  });

  ipcMain.handle("show-item-in-folder", async (event, relativePath: string) => {
    if (!relativePath) return;
    // relativePath is expected to be relative to dataRoot
    // e.g. "output/project/card/image.png"
    // Security check: prevent directory traversal
    const safeSub = relativePath.replace(/^(\.\.(\/|\\|$))+/, "");
    const target = path.join(dataRoot, safeSub);
    log.info("Showing item in folder:", target);
    shell.showItemInFolder(target);
  });

  ipcMain.handle(
    "show-notification",
    async (
      event,
      title: string,
      body: string,
      projectId: string,
      cardId: string
    ) => {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title,
          body,
        });

        notification.on("click", () => {
          // Focus the app window
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();

            // Send navigation message to renderer
            mainWindow.webContents.send("navigate-to-card", projectId, cardId);
          }
        });

        notification.show();
      }
    }
  );

  await startServer(5432, dataRoot);

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});
