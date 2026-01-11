import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  openDataFolder: (subPath?: string) =>
    ipcRenderer.invoke("open-data-folder", subPath),
  openExternal: (url: string) => ipcRenderer.invoke("open-external-link", url),
});
