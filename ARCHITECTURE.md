# Project structure

```text
src/
├── main/                 
│   ├── app.js            
│   ├── windows/          
│   ├── ipc/              
│   ├── services/         
│   └── utils/           
├── renderer/            
│   ├── dashboard/      
│   └── editor/         
├── icons/              
└── imagens/            
```

Root files are intentionally limited to Electron configuration and the dashboard document:

- `index.js`: Electron entry point.
- `preload.js`: safe renderer API surface.
- `index.html`: dashboard document.
- `package.json`: scripts and packaging configuration.

When adding behavior, keep UI event handling in `src/renderer`, filesystem work in a `src/main/services` module, and expose only the needed operation through `src/main/ipc/register-handlers.js` and `preload.js`.
