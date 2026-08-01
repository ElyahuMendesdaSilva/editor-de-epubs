# Architecture

## Estrutura do projeto

```text
├── index.js                  # Ponto de entrada do Electron (→ src/main/app.js)
├── preload.js                # Interface de API segura do renderizador (contextBridge)
├── index.html                # Documento do Dashboard (HTML principal)
├── package.json              # Scripts, dependências e configuração de empacotamento
├── scripts/
│   └── check-syntax.js       # Verificação de sintaxe em todos os arquivos .js
├── build/
│   ├── icon.ico              # Ícone para empacotamento Windows
│   └── icon.png              # Ícone para empacotamento Linux
├── src/
│   ├── main/                 # Processo principal (Electron main process)
│   │   ├── app.js            # Inicialização do app e ciclo de vida
│   │   ├── windows/
│   │   │   └── main-window.js    # Criação e configuração da janela principal
│   │   ├── ipc/
│   │   │   └── register-handlers.js  # Todos os handlers IPC do Electron
│   │   ├── services/
│   │   │   ├── epub-exporter.js     # Geração do arquivo .epub (ZIP nativo com zlib)
│   │   │   ├── pdf-exporter.js      # Geração do arquivo .pdf (HTML → impressão)
│   │   │   └── project-registry.js  # Registro de projetos no userData
│   │   └── utils/
│   │       └── files.js             # Utilitários de arquivo/JSON/XML
│   ├── renderer/             # Processo renderizador (front-end)
│   │   ├── dashboard/
│   │   │   ├── dashboard.js     # Lógica do dashboard (projetos, configurações, tema)
│   │   │   └── dashboard.css    # Estilos do dashboard
│   │   └── editor/
│   │       ├── editor.js        # Lógica do editor de texto rico
│   │       ├── editor.html      # Estrutura HTML do editor (carregado via fetch)
│   │       └── editor.css       # Estilos do editor
│   ├── fonts/                # Fontes nativas inclusas para exportação
│   │   ├── Arial/
│   │   ├── Georgia/
│   │   ├── Inter/
│   │   └── TimesNewRoman/
│   ├── icons/                # Ícones do aplicativo
│   │   ├── logo_do_app.ico
│   │   ├── logo_do_app.png
│   │   ├── chatgpt.png
│   │   └── claude_code_icon.png
│   └── imagens/              # Screenshots para o README
│       ├── Dashboard.png
│       ├── NovoProjeto.png
│       ├── Configurações.png
│       └── Editor.png
└── LICENSE                   # GNU General Public License v3.0
```

## Fluxo de comunicação

```
renderer (dashboard.js / editor.js)
       │
       │  window.electronAPI.* (contextBridge)
       │
       ▼
preload.js
       │
       │  ipcRenderer.invoke()
       │
       ▼
src/main/ipc/register-handlers.js
       │
       ├──► src/main/services/epub-exporter.js
       ├──► src/main/services/pdf-exporter.js
       ├──► src/main/services/project-registry.js
       └──► src/main/utils/files.js
```

## Camadas

### 1. Ponto de entrada (`index.js`)
Redireciona para `src/main/app.js`. Mantido propositalmente enxuto — toda a lógica de inicialização vive em `src/main/`.

### 2. Main process (`src/main/`)
- **`app.js`** — ciclo de vida do Electron (`ready`, `window-all-closed`, `activate`).
- **`windows/main-window.js`** — cria a `BrowserWindow` com `contextIsolation: true`, `nodeIntegration: false` e carrega `index.html`.
- **`ipc/register-handlers.js`** — registra todos os handlers IPC. Cada handler é uma função que acessa o sistema de arquivos ou serviços e retorna dados serializáveis. Canais implementados:
  - `selecionar-pasta`, `abrir-projeto`, `criar-projeto`, `atualizar-projeto`
  - `listar-projetos`, `carregar-projeto`, `excluir-projeto`
  - `salvar-capitulo`, `excluir-capitulo`, `listar-capitulos`
  - `selecionar-imagens`, `copiar-imagens`, `listar-imagens`, `excluir-imagem`
  - `verificar-uso-imagens` — informa quais imagens do projeto não estão sendo usadas em capítulos ou CSS (ícone vermelho no painel de imagens)
  - `ler-css`, `salvar-css`
  - `listar-fontes`, `listar-fontes-base`, `importar-fonte`
  - `exportar-projeto` (EPUB ou PDF)
  - `estimar-tamanho-exportacao` — gera o arquivo em memória e devolve o tamanho aproximado (barra de status do editor)
  - `obter-info-app`
- **`services/epub-exporter.js`** — monta a estrutura completa do EPUB (mimetype, META-INF, OEBPS, content.opf, toc.ncx, capítulos XHTML) e compacta em ZIP usando apenas `zlib` nativo do Node — sem dependências externas.
- **`services/pdf-exporter.js`** — monta um HTML único com CSS embutido e fontes em base64, renderiza em uma `BrowserWindow` oculta e gera o PDF via `webContents.printToPDF()`.
- **`services/project-registry.js`** — mantém um arquivo JSON em `app.getPath('userData')/projects.json` com a lista de caminhos dos projetos criados, usado para popular a seção "Em andamento" do dashboard.
- **`utils/files.js`** — funções utilitárias: leitura/escrita de JSON, saneamento de nomes de pasta, fechamento de tags void HTML para XHTML, conversão de entidades HTML nomeadas para referências numéricas XML.

### 3. Preload (`preload.js`)
Expõe a API via `contextBridge.exposeInMainWorld('electronAPI', { ... })`. Usa `webUtils.getPathForFile()` para obter o caminho real de arquivos selecionados via `<input type="file">` ou drag & drop (necessário em versões recentes do Electron onde `File.path` não está mais disponível no renderer).

### 4. Renderer — Dashboard (`src/renderer/dashboard/`)
- **`dashboard.js`** — lida com criação/abertura/edição/exclusão de projetos, preview de capa (drag & drop), seção "Em andamento", toggle de tema (claro/escuro), tela de configurações com dados do package.json e preferências do editor (ex: exibir o tamanho aproximado do arquivo de exportação na barra de status).
- **`dashboard.css`** — estilos do dashboard com variáveis CSS para tema claro/escuro.

### 5. Renderer — Editor (`src/renderer/editor/`)
- **`editor.html`** — carregado via `fetch()` a partir do dashboard. Contém a estrutura da toolbar de texto e da toolbar de propriedades de imagem, sidebar (capítulos + imagens), painel de código e área de edição.
- **`editor.js`** — lógica completa do editor:
  - Formatação de texto (negrito, itálico, títulos, listas, etc.)
  - Barra de busca com contagem e navegação
  - Seletor de fonte/tamanho/entrelinha
  - Gerenciamento de capítulos (criar, renomear, reordenar, excluir)
  - Gerenciamento de imagens (inserir, estilizar, excluir)
  - Seleção de imagem no documento — troca a toolbar de texto pela de propriedades da imagem (largura, alinhamento, remover, tela cheia, página inteira), no estilo do Google Docs
  - Indicador de imagens não usadas — ícone vermelho nas miniaturas que não aparecem em nenhum capítulo ou folha de estilo
  - Barra lateral redimensionável — divisor de largura na borda da sidebar (miniaturas crescem junto) e divisor vertical entre Capítulos e Imagens para ajustar a altura da lista de imagens
  - Zoom do visualizador — redimensiona a folha/página inteira (não apenas o texto), com porcentagem sincronizada na barra de status
  - Tamanho aproximado do arquivo de exportação na barra de status, exibido quando ativado nas Configurações
  - Painel de código XHTML com edição inline e salvamento
  - Exportação (dropdown EPUB/PDF com seleção de pasta)
  - Indicador de salvamento automático
- **`editor.css`** — estilos do editor.

## Convenções

- **Eventos da interface** → `src/renderer/` (dashboard.js ou editor.js)
- **Operações de sistema de arquivos** → handler IPC em `register-handlers.js`, que delega para `src/main/services/`
- **Exposição ao renderer** → apenas o necessário via `preload.js`
- **Separação de responsabilidades**: o renderer nunca acessa o sistema de arquivos diretamente; tudo passa por IPC.

## Empacotamento

O projeto usa `electron-builder` para gerar distribuições:

```bash
npm run dist:win      # Windows: NSIS installer + portable (.exe)
npm run dist:linux    # Linux: AppImage + deb
```

A configuração está em `package.json` na seção `"build"`. O ícone usado é `build/icon.png` (Linux) e `build/icon.ico` (Windows).
