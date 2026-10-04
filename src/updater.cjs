const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

let status = { state: 'idle' };
function send(next) {
  status = next;
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('update:status', status);
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = app.getVersion().includes('-');
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', info => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'current' }));
  autoUpdater.on('download-progress', progress => send({ state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', info => send({ state: 'ready', version: info.version }));
  autoUpdater.on('error', error => send({ state: 'error', message: error.message }));

  ipcMain.handle('update:status', () => status);
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return send({ state: 'unsupported', message: 'Updates are only available in installed release builds.' });
    if (process.platform === 'linux' && !process.env.APPIMAGE) return send({ state: 'unsupported', message: 'Use the AppImage for in-app updates; .deb updates belong to the package manager.' });
    try { await autoUpdater.checkForUpdates(); }
    catch (error) { send({ state: 'error', message: error.message }); }
  });
  ipcMain.handle('update:download', async () => {
    if (status.state !== 'available') throw new Error('No update is ready to download');
    try { send({ ...status, state: 'downloading', percent: 0 }); await autoUpdater.downloadUpdate(); }
    catch (error) { send({ state: 'error', message: error.message }); }
  });
  ipcMain.handle('update:restart', () => {
    if (status.state !== 'ready') throw new Error('No downloaded update is ready');
    autoUpdater.quitAndInstall(true, true);
  });
}

module.exports = { configureUpdater };
