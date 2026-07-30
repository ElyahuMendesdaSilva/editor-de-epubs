// Electron entry point. Application startup is kept deliberately small;
// IPC handlers, domain services and window creation live under src/main.
require('./src/main/app');
