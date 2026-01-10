import { app, BrowserWindow, dialog } from "electron";
import { startServer } from "./server";
import { autoUpdater } from "electron-updater";
import log from "electron-log";

// --- Auto Updater Setup ---
log.transports.file.level = "debug";
autoUpdater.logger = log;
autoUpdater.autoDownload = false;

// Events
autoUpdater.on("update-available", () => {
  log.info("Update available.");
  dialog
    .showMessageBox({
      type: "info",
      title: "Update Available",
      message:
        "A new version of AI Art Cards is available. Do you want to download it now?",
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

let mainWindow: BrowserWindow | null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: "AI Art Cards",
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
