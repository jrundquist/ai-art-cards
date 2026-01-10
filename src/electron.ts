import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  MenuItemConstructorOptions,
  shell,
} from "electron";
import { startServer } from "./server";
import { autoUpdater } from "electron-updater";
import log from "electron-log";

// --- Auto Updater Setup ---
log.transports.file.level = "debug";
autoUpdater.logger = log;
autoUpdater.autoDownload = false;

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
      ],
    },
  ] as MenuItemConstructorOptions[];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: "AICardArts",
    backgroundColor: "#1e1e1e",
    show: false, // Wait until ready-to-show
  });

  // Load the app
  const url = "http://localhost:5432";

  // Wait for server to be ready?
  // For simplicity, we just load. server.ts starts listening immediately.
  mainWindow.loadURL(url);

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
  createMenu();
  await startServer();

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
