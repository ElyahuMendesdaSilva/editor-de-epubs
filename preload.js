const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Em versões recentes do Electron, File.path não fica mais disponível
    // no renderer (mesmo com contextIsolation). webUtils.getPathForFile()
    // é a forma correta de obter o caminho real de um arquivo escolhido
    // pelo <input type="file"> ou arrastado (drag & drop).
    getPathForFile: (file) => {
        if (webUtils && typeof webUtils.getPathForFile === 'function') {
            return webUtils.getPathForFile(file);
        }
        // Fallback para versões mais antigas do Electron, onde file.path
        // ainda existia diretamente no objeto File.
        return file.path || null;
    },
    selecionarPasta: () => ipcRenderer.invoke('selecionar-pasta'),
    abrirProjeto: () => ipcRenderer.invoke('abrir-projeto'),
    obterInfoApp: () => ipcRenderer.invoke('obter-info-app'),
    criarProjeto: (projectPath) => {
        return ipcRenderer.invoke('criar-projeto', projectPath);
    },
    atualizarProjeto: (dados) => {
        return ipcRenderer.invoke('atualizar-projeto', dados);
    },
    selecionarImagens: () => ipcRenderer.invoke('selecionar-imagens'),
    copiarImagens: (dados) => ipcRenderer.invoke('copiar-imagens', dados),
    excluirImagem: (dados) => ipcRenderer.invoke('excluir-imagem', dados),
    salvarCapitulo: (dados) => ipcRenderer.invoke('salvar-capitulo', dados),
    excluirCapitulo: (dados) => ipcRenderer.invoke('excluir-capitulo', dados),
    listarProjetos: () => ipcRenderer.invoke('listar-projetos'),
    carregarProjeto: (projectPath) => ipcRenderer.invoke('carregar-projeto', projectPath),
    listarImagens: (projectPath) => ipcRenderer.invoke('listar-imagens', projectPath),
    lerCSS: (dados) => ipcRenderer.invoke('ler-css', dados),
    salvarCSS: (dados) => ipcRenderer.invoke('salvar-css', dados),
    // Aceita tanto uma string (caminho do projeto, formato clássico)
    // quanto um objeto { projectPath, format } para permitir escolher
    // entre exportar em EPUB ou PDF.
    exportarProjeto: (dados) => ipcRenderer.invoke('exportar-projeto', dados)
});