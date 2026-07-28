const { BrowserWindow } = require('electron');
const path = require('path');

function createMainWindow() {
    const window = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 1200,
        minHeight: 800,
        autoHideMenuBar: true,
        icon: path.join(__dirname, '../../icons/logo_do_app.png'),
        webPreferences: {
            preload: path.join(__dirname, '../../../preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    window.removeMenu();
    window.loadFile(path.join(__dirname, '../../../index.html'));
}

module.exports = { createMainWindow };
