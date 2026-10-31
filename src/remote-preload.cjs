const { contextBridge, ipcRenderer } = require('electron');
// This host page gets no filesystem, provider, or general-purpose IPC access.
contextBridge.exposeInMainWorld('VideoStoreConnection', {
  paired: () => ipcRenderer.invoke('primary:paired')
});
