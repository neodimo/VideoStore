const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('videostore', {
  list: () => ipcRenderer.invoke('library:list'),
  add: () => ipcRenderer.invoke('library:add'),
  addFolder: () => ipcRenderer.invoke('library:addFolder'),
  cancelScan: () => ipcRenderer.invoke('library:cancelScan'),
  onScanProgress: callback => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('scan:progress', handler);
    return () => ipcRenderer.removeListener('scan:progress', handler);
  },
  remove: id => ipcRenderer.invoke('library:remove', id),
  mark: (id, field, value) => ipcRenderer.invoke('library:mark', id, field, value),
  preferences: value => ipcRenderer.invoke('library:preferences', value),
  open: id => ipcRenderer.invoke('library:open', id),
  searchCatalog: query => ipcRenderer.invoke('catalog:search', query),
  getMeta: (type, id) => ipcRenderer.invoke('catalog:meta', type, id),
  providerStatus: () => ipcRenderer.invoke('provider:status'),
  configureProvider: (id, token) => ipcRenderer.invoke('provider:configure', id, token),
  configureArtwork: key => ipcRenderer.invoke('artwork:configure', key),
  posterFor: id => ipcRenderer.invoke('artwork:poster', id),
  mediaCandidates: () => ipcRenderer.invoke('media:candidates'),
  mediaPlan: ids => ipcRenderer.invoke('media:plan', ids),
  mediaSubmit: id => ipcRenderer.invoke('media:submit', id),
  mediaJobs: () => ipcRenderer.invoke('media:jobs'),
  mediaCancel: id => ipcRenderer.invoke('media:cancel', id),
  onMediaJobs: callback => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('media:jobs', handler);
    return () => ipcRenderer.removeListener('media:jobs', handler);
  },
  lanStatus: () => ipcRenderer.invoke('lan:status'),
  lanStart: () => ipcRenderer.invoke('lan:start'),
  lanStop: () => ipcRenderer.invoke('lan:stop'),
  lanPairCode: () => ipcRenderer.invoke('lan:pairCode'),
  storageList: () => ipcRenderer.invoke('storage:list'),
  storageAdd: (type, label) => ipcRenderer.invoke('storage:add', type, label),
  storageRemove: id => ipcRenderer.invoke('storage:remove', id),
  storageUpdate: (id, percent, gib) => ipcRenderer.invoke('storage:update', id, percent, gib),
  storageLayout: (id, layout) => ipcRenderer.invoke('storage:layout', id, layout),
  storagePlan: (type, fileBytes) => ipcRenderer.invoke('storage:plan', type, fileBytes),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  restartToUpdate: () => ipcRenderer.invoke('update:restart'),
  onUpdateStatus: callback => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('update:status', handler);
    return () => ipcRenderer.removeListener('update:status', handler);
  }
});
