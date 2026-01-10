import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  openDataFolder: (subPath?: string) =>
    ipcRenderer.invoke("open-data-folder", subPath),
});
