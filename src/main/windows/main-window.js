const { BrowserWindow, shell } = require('electron');
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

    // Links com target="_blank" (ex.: GitHub nas Configurações) abrem
    // no navegador padrão do sistema em vez de criar uma janela do app.
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            shell.openExternal(url);
        }

        return { action: 'deny' };
    });

    // Se algo tentar navegar a própria janela para uma URL externa,
    // abre no navegador do sistema e cancela a navegação interna.
    window.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });
}

module.exports = { createMainWindow };
