const { app } = require('electron');
const { createMainWindow } = require('./windows/main-window');

require('./ipc/register-handlers');

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (require('electron').BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
