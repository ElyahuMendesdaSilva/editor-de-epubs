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
└── imagens/              # README screenshots
```

Os arquivos principais são intencionalmente limitados à configuração do Electron e ao documento do painel:

- `index.js`: Ponto de entrada do Electron.
- `preload.js`: Interface de API segura do renderizador.
- `index.html`: Documento do painel.
- `package.json`: Scripts e configuração de empacotamento.

Ao adicionar comportamento, mantenha o tratamento de eventos da interface em `src/renderer`, o trabalho com o sistema de arquivos em um módulo `src/main/services`, e exponha apenas a operação necessária através de `src/main/ipc/register-handlers.js` e `preload.js`.
