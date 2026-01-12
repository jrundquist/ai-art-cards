import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  MenuItemConstructorOptions,
  shell,
  ipcMain,
  Notification,
  Tray,
  nativeImage,
} from "electron";
import { startServer } from "./server";
import { exiftool } from "exiftool-vendored";
import { autoUpdater } from "electron-updater";
import path from "path";
import fs from "fs";
import { logger, configureLogger } from "./lib/logger";
import log from "electron-log";

// --- Auto Updater Setup ---
const logFile = log.transports.file.getFile().path;
configureLogger(logFile);

autoUpdater.logger = log;
autoUpdater.autoDownload = false;

const SERVER_URL = "http://localhost:5432";

let isManualCheck = false;
let tray: Tray | null = null;

// Events
autoUpdater.on("update-available", () => {
  logger.info("Update available.");
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
  logger.info("Update downloaded.");
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
  logger.info("Update not available.");
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
  logger.error("Error in auto-updater. " + err);
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
                  logger.info("User triggered check for updates");
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
            logger.info("User requested to view logs at:", logFile);
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
  logger.info("Starting server...");

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
  logger.info("Electron User Data Path:", userDataPath);

  // Use a subfolder 'data' to keep it clean
  const dataRoot = path.join(userDataPath, "data");
  if (!fs.existsSync(dataRoot)) {
    fs.mkdirSync(dataRoot, { recursive: true });
  }

  // IPC Handlers
  // IPC Handlers
  ipcMain.handle("open-data-folder", async (event, subPath?: string) => {
    // Open the dataRoot
    if (subPath) {
      // Basic security: prevent traversing up
      const safeSub = subPath.replace(/^(\.\.(\/|\\|$))+/, "");
      const target = path.join(dataRoot, safeSub);
      logger.info("Opening specific folder:", target);
      // Ensure it exists? shell.openPath checks existence.
      // If it doesn't exist, we might want to try creating it?
      // Or just open parent?
      // Let's just try opening.
      const err = await shell.openPath(target);
      if (err) {
        logger.warn("Failed to open specific path, falling back to root:", err);
        await shell.openPath(dataRoot);
      }
    } else {
      await shell.openPath(dataRoot);
    }
  });

  ipcMain.handle("open-external-link", async (event, url: string) => {
    logger.info("Opening external link:", url);
    await shell.openExternal(url);
  });

  ipcMain.handle("show-item-in-folder", async (event, relativePath: string) => {
    if (!relativePath) return;
    // relativePath is expected to be relative to dataRoot
    // e.g. "output/project/card/image.png"
    // Security check: prevent directory traversal
    const safeSub = relativePath.replace(/^(\.\.(\/|\\|$))+/, "");
    const target = path.join(dataRoot, safeSub);
    logger.info("Showing item in folder:", target);
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

  await startServer(5432, dataRoot, logFile);

  createTray();
  setupDockMenu();

  createWindow();
});

function createTray() {
  try {
    const iconPath = path.join(__dirname, "..", "assets", "trayTemplate.png");
    let icon = nativeImage.createFromPath(iconPath);

    if (icon.isEmpty()) {
      logger.error("Tray icon image is empty! Check path:", iconPath);
      return;
    }

    // Resize for tray - standard macOS tray icon height is 22px
    icon = icon.resize({ height: 22 });
    icon.setTemplateImage(true);

    tray = new Tray(icon);
    tray.setToolTip("AICardArts");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open AICardArts",
        click: () => {
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      {
        label: "Open in Browser",
        click: async () => {
          await shell.openExternal(SERVER_URL);
        },
      },
      { type: "separator" },
      {
        label: "Open Data Folder",
        click: async () => {
          const dataPath = path.join(app.getPath("userData"), "data");
          await shell.openPath(dataPath);
        },
      },
      {
        label: "View Application Logs",
        click: () => {
          const logFile = log.transports.file.getFile().path;
          if (logFile) {
            shell.showItemInFolder(logFile);
          }
        },
      },
      {
        label: "Check for Updates...",
        click: () => {
          autoUpdater.checkForUpdatesAndNotify();
        },
      },
      { type: "separator" },
      { role: "quit" },
    ]);

    tray.setContextMenu(contextMenu);
  } catch (err) {
    logger.error("Error creating tray:", err);
  }
}

function setupDockMenu() {
  if (process.platform === "darwin" && app.dock) {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: "Open in Browser",
        click: async () => {
          await shell.openExternal(SERVER_URL);
        },
      },
      {
        label: "Open Data Folder",
        click: async () => {
          const dataPath = path.join(app.getPath("userData"), "data");
          await shell.openPath(dataPath);
        },
      },
      {
        label: "Check for Updates...",
        click: () => {
          autoUpdater.checkForUpdatesAndNotify();
        },
      },
    ]);
    app.dock.setMenu(dockMenu);
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  // Clean up exiftool process
  logger.info("Shutting down exiftool...");
  await exiftool.end();
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});
