import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  openDataFolder: (subPath?: string) =>
    ipcRenderer.invoke("open-data-folder", subPath),
  openExternal: (url: string) => ipcRenderer.invoke("open-external-link", url),
  showItemInFolder: (relativePath: string) =>
    ipcRenderer.invoke("show-item-in-folder", relativePath),
  showNotification: (
    title: string,
    body: string,
    projectId: string,
    cardId: string
  ) => ipcRenderer.invoke("show-notification", title, body, projectId, cardId),
  onNavigateToCard: (callback: (projectId: string, cardId: string) => void) =>
    ipcRenderer.on("navigate-to-card", (_event, projectId, cardId) =>
      callback(projectId, cardId)
    ),
});
