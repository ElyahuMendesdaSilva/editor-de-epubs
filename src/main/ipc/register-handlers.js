const { dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const packageJson = require('../../../package.json');
const { buildEpub } = require('../services/epub-exporter');
const { buildPdf } = require('../services/pdf-exporter');
const { addToRegistry, getRegistryPath } = require('../services/project-registry');
const { closeVoidTags, readJSONSafe, sanitizeEntitiesForXml, sanitizeFolderName, writeJSON } = require('../utils/files');

const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const isAllowedImageExtension = (filePath) =>
    ALLOWED_IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());

function normalizeProjectTitle(title) {
    return String(title || 'Sem título')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('pt-BR');
}

function getRegisteredProjectTitles(excludedPath = null) {
    const registry = readJSONSafe(getRegistryPath(), []);
    const titles = new Set();

    for (const registeredPath of registry) {
        if (registeredPath === excludedPath) {
            continue;
        }

        const data = readJSONSafe(path.join(registeredPath, 'project.json'), null);

        if (data) {
            titles.add(normalizeProjectTitle(data.title));
        }
    }

    return titles;
}

function getAvailableProjectTitle(title, existingTitles) {
    const baseTitle = String(title || 'Sem título').trim() || 'Sem título';

    if (!existingTitles.has(normalizeProjectTitle(baseTitle))) {
        return baseTitle;
    }

    let number = 2;
    let candidate = `${baseTitle} (${number})`;

    while (existingTitles.has(normalizeProjectTitle(candidate))) {
        number += 1;
        candidate = `${baseTitle} (${number})`;
    }

    return candidate;
}

ipcMain.handle('obter-info-app', async () => {
    try {
        const repository = packageJson.repository;
        const repositoryUrl = typeof repository === 'string'
            ? repository
            : (repository && repository.url) || '';

        const dependencies = Object.keys(packageJson.dependencies || {});
        const devDependencies = Object.keys(packageJson.devDependencies || {});
        const technologies = [...dependencies, ...devDependencies];

        return {
            success: true,
            name: packageJson.productName || packageJson.name || 'Editor de eBook',
            version: packageJson.version || '',
            description: packageJson.description || '',
            author: packageJson.author && packageJson.author.name
                ? packageJson.author.name
                : (packageJson.author || ''),
            repositoryUrl: repositoryUrl.replace(/^git\+/, '').replace(/\.git$/, ''),
            technologies
        };

    } catch (error) {
        console.error('Erro ao obter informações do app:', error);
        return { success: false, error: error.message };
    }
});


ipcMain.handle('criar-projeto', async (event, dados) => {
    try {
        const { title, author, language, description, basePath, coverPath } = dados;

        if (!basePath) {
            throw new Error('Nenhuma pasta de destino foi selecionada.');
        }

        const existingTitles = getRegisteredProjectTitles();
        let finalTitle = String(title || 'Sem título').trim() || 'Sem título';
        let renamed = false;
        let originalTitle = finalTitle;

        if (existingTitles.has(normalizeProjectTitle(finalTitle))) {
            finalTitle = getAvailableProjectTitle(finalTitle, existingTitles);
            renamed = true;
        }

        // Cria uma subpasta com o nome do livro dentro da pasta escolhida
        // (ex: "C:\Documentos\eBooks\MeuLivro")
        const folderName = sanitizeFolderName(finalTitle);
        const projectDir = path.join(basePath, folderName);

        if (fsSync.existsSync(path.join(projectDir, 'project.json'))) {
            return {
                success: false,
                code: 'DUPLICATE_PROJECT_FOLDER',
                error: 'Já existe um projeto nessa pasta.'
            };
        }

        await fs.mkdir(projectDir, { recursive: true });
        await Promise.all(
            ['chapters', 'images', 'styles', 'fonts'].map(sub =>
                fs.mkdir(path.join(projectDir, sub), { recursive: true })
            )
        );

        // Copia a capa selecionada, preservando a extensão original do arquivo.
        // Só png/jpg/jpeg são aceitos; qualquer outro formato é ignorado
        // (o projeto é criado sem capa nesse caso).
        let coverFileName = null;
        if (coverPath && fsSync.existsSync(coverPath) && isAllowedImageExtension(coverPath)) {
            const ext = path.extname(coverPath).toLowerCase();
            coverFileName = `capa${ext}`;
            await fs.copyFile(coverPath, path.join(projectDir, coverFileName));
        }

        const projectData = {
            title: finalTitle || '',
            author: author || '',
            language: language || 'pt-BR',
            description: description || '',
            cover: coverFileName,
            createdAt: new Date().toISOString(),
            chapters: []
        };

        await fs.writeFile(
            path.join(projectDir, 'project.json'),
            JSON.stringify(projectData, null, 4),
            'utf-8'
        );

        await addToRegistry(projectDir);

        return {
            success: true,
            path: projectDir,
            renamed: renamed,
            originalTitle: originalTitle,
            title: finalTitle
        };

    } catch (error) {
        console.error('Erro ao criar projeto:', error);

        return {
            success: false,
            error: error.message
        };
    }
});

// Atualiza os metadados de um projeto já existente (usado pelo botão de
// editar dos cards de "Em andamento" no dashboard). Não move nem renomeia
// a pasta do projeto — só troca os campos em project.json e, se uma nova
// capa foi escolhida, substitui o arquivo de capa salvo no disco.
ipcMain.handle('atualizar-projeto', async (event, dados) => {
    try {
        const { projectPath, title, author, language, description, coverPath } = dados;

        if (!projectPath) {
            throw new Error('Nenhum projeto informado.');
        }

        const projectJsonPath = path.join(projectPath, 'project.json');
        const projectData = readJSONSafe(projectJsonPath, null);

        if (!projectData) {
            throw new Error('project.json não encontrado nessa pasta.');
        }

        if (getRegisteredProjectTitles(projectPath).has(normalizeProjectTitle(title))) {
            return {
                success: false,
                code: 'DUPLICATE_PROJECT_TITLE',
                error: 'Já existe um projeto com esse título no Dashboard.'
            };
        }

        // Só mexe na capa se uma nova imagem válida (png/jpg/jpeg) foi
        // selecionada; caso contrário mantém a capa que já estava salva.
        let coverFileName = projectData.cover || null;

        if (coverPath && fsSync.existsSync(coverPath) && isAllowedImageExtension(coverPath)) {

            // Remove a capa antiga, caso exista e tenha extensão diferente.
            if (coverFileName) {
                const oldCoverPath = path.join(projectPath, coverFileName);
                if (fsSync.existsSync(oldCoverPath)) {
                    await fs.unlink(oldCoverPath).catch(() => {});
                }
            }

            const ext = path.extname(coverPath).toLowerCase();
            coverFileName = `capa${ext}`;
            await fs.copyFile(coverPath, path.join(projectPath, coverFileName));
        }

        const updatedData = {
            ...projectData,
            title: title || projectData.title || '',
            author: author || '',
            language: language || projectData.language || 'pt-BR',
            description: description || '',
            cover: coverFileName
        };

        await fs.writeFile(
            projectJsonPath,
            JSON.stringify(updatedData, null, 4),
            'utf-8'
        );

        return { success: true, path: projectPath };

    } catch (error) {
        console.error('Erro ao atualizar projeto:', error);

        return {
            success: false,
            error: error.message
        };
    }
});


// Remove um projeto por completo: apaga a pasta do projeto do disco e
// também o retira do registro (projects.json), usado pelo botão
// "Excluir projeto" no modal de edição do dashboard.
ipcMain.handle('excluir-projeto', async (event, projectPath) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto informado.');
        }

        const projectJsonPath = path.join(projectPath, 'project.json');

        if (!fsSync.existsSync(projectJsonPath)) {
            throw new Error('project.json não encontrado nessa pasta.');
        }

        // Remove a pasta inteira do projeto (capítulos, imagens, capa, etc.)
        await fs.rm(projectPath, { recursive: true, force: true });

        // Tira o projeto do registro de "Em andamento"
        const registryPath = getRegistryPath();
        const registry = readJSONSafe(registryPath, []);
        const updatedRegistry = registry.filter(p => p !== projectPath);
        await writeJSON(registryPath, updatedRegistry);

        return { success: true };

    } catch (error) {
        console.error('Erro ao excluir projeto:', error);
        return { success: false, error: error.message };
    }
});


ipcMain.handle('selecionar-pasta', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });

    if (result.canceled) {
        return null;
    }

    return result.filePaths[0];
});


// Abre o seletor nativo de arquivos filtrado para "project.json", usado
// pelo botão "Abrir projeto" do dashboard. Serve para trazer de volta
// para a seção "Em andamento" projetos que existem no disco mas que,
// por algum motivo (pasta movida, projects.json apagado, projeto criado
// em outra máquina etc.), não aparecem mais na lista do app.
ipcMain.handle('abrir-projeto', async () => {
    try {
        const dialogResult = await dialog.showOpenDialog({
            title: 'Selecione o arquivo project.json',
            properties: ['openFile'],
            filters: [
                { name: 'Projeto de eBook', extensions: ['json'] }
            ]
        });

        if (dialogResult.canceled || !dialogResult.filePaths[0]) {
            return { success: false, canceled: true };
        }

        const selectedFile = dialogResult.filePaths[0];

        if (path.basename(selectedFile).toLowerCase() !== 'project.json') {
            return { success: false, error: 'Selecione um arquivo "project.json" válido.' };
        }

        const projectPath = path.dirname(selectedFile);
        const projectData = readJSONSafe(selectedFile, null);

        if (!projectData) {
            return { success: false, error: 'Não foi possível ler o project.json selecionado.' };
        }

        const originalTitle = String(projectData.title || 'Sem título').trim() || 'Sem título';
        const importedTitle = getAvailableProjectTitle(
            originalTitle,
            getRegisteredProjectTitles(projectPath)
        );
        const renamed = importedTitle !== originalTitle;

        if (renamed) {
            projectData.title = importedTitle;
            await writeJSON(selectedFile, projectData);
        }

        // A adição ao registro (projects.json) acontece em "carregar-projeto",
        // que é chamado assim que o editor abre esse projeto — assim ele já
        // fica salvo em "Em andamento" sem precisar clicar em "Abrir" de novo.
        return {
            success: true,
            path: projectPath,
            renamed,
            originalTitle,
            title: importedTitle
        };

    } catch (error) {
        console.error('Erro ao abrir projeto:', error);
        return { success: false, error: error.message };
    }
});


// Abre o seletor nativo de imagens (múltipla seleção)
ipcMain.handle('selecionar-imagens', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg'] }
        ]
    });

    if (result.canceled) {
        return [];
    }

    return result.filePaths;
});


// Copia as imagens selecionadas para a pasta images/ do projeto e atualiza o manifesto.
// Só aceita png/jpg/jpeg — qualquer outro formato é ignorado (e devolvido em
// "skipped", para o renderer poder avisar o usuário quais arquivos não entraram).
ipcMain.handle('copiar-imagens', async (event, { projectPath, imagePaths }) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        const imagesDir = path.join(projectPath, 'images');
        await fs.mkdir(imagesDir, { recursive: true });

        const manifestPath = path.join(imagesDir, 'manifest.json');
        const manifest = readJSONSafe(manifestPath, []);

        const copiedImages = [];
        const skipped = [];

        for (const originalPath of (imagePaths || [])) {
            if (!fsSync.existsSync(originalPath)) {
                continue;
            }

            if (!isAllowedImageExtension(originalPath)) {
                skipped.push(path.basename(originalPath));
                continue;
            }

            const ext = path.extname(originalPath).toLowerCase();
            const id = 'img-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
            const fileName = `${id}${ext}`;

            await fs.copyFile(originalPath, path.join(imagesDir, fileName));

            const entry = {
                id,
                originalName: path.basename(originalPath),
                file: fileName
            };

            manifest.push(entry);
            copiedImages.push(entry);
        }

        await writeJSON(manifestPath, manifest);

        return { success: true, images: copiedImages, skipped };

    } catch (error) {
        console.error('Erro ao copiar imagens:', error);
        return { success: false, error: error.message };
    }
});


// Salva um capítulo como .xhtml em chapters/ e atualiza o manifesto + project.json
ipcMain.handle('salvar-capitulo', async (event, { projectPath, chapterId, title, html, order }) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        const chaptersDir = path.join(projectPath, 'chapters');
        await fs.mkdir(chaptersDir, { recursive: true });

        const fileName = `${chapterId}.xhtml`;
        const filePath = path.join(chaptersDir, fileName);

        const bodyHtml = closeVoidTags(sanitizeEntitiesForXml(html));

        const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${title || 'Capítulo'}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
${bodyHtml}
</body>
</html>
`;

        await fs.writeFile(filePath, xhtml, 'utf-8');

        // Atualiza o manifesto de capítulos (chapters/manifest.json)
        const manifestPath = path.join(chaptersDir, 'manifest.json');
        const manifest = readJSONSafe(manifestPath, []);

        const existingIndex = manifest.findIndex(item => item.id === chapterId);
        const entry = { id: chapterId, title: title || 'Capítulo', file: fileName, order: order || 0 };

        if (existingIndex >= 0) {
            manifest[existingIndex] = entry;
        } else {
            manifest.push(entry);
        }

        manifest.sort((a, b) => a.order - b.order);

        await writeJSON(manifestPath, manifest);

        // Espelha o resumo no project.json, para consulta rápida
        const projectJsonPath = path.join(projectPath, 'project.json');
        const projectData = readJSONSafe(projectJsonPath, {});
        projectData.chapters = manifest;
        await writeJSON(projectJsonPath, projectData);

        return { success: true, file: fileName };

    } catch (error) {
        console.error('Erro ao salvar capítulo:', error);
        return { success: false, error: error.message };
    }
});


// Remove o .xhtml do capítulo e atualiza os manifestos
ipcMain.handle('excluir-capitulo', async (event, { projectPath, chapterId }) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        const chaptersDir = path.join(projectPath, 'chapters');
        const manifestPath = path.join(chaptersDir, 'manifest.json');
        const manifest = readJSONSafe(manifestPath, []);

        const entry = manifest.find(item => item.id === chapterId);

        if (entry) {
            const filePath = path.join(chaptersDir, entry.file);
            if (fsSync.existsSync(filePath)) {
                await fs.unlink(filePath);
            }
        }

        const updatedManifest = manifest.filter(item => item.id !== chapterId);
        await writeJSON(manifestPath, updatedManifest);

        const projectJsonPath = path.join(projectPath, 'project.json');
        const projectData = readJSONSafe(projectJsonPath, {});
        projectData.chapters = updatedManifest;
        await writeJSON(projectJsonPath, projectData);

        return { success: true };

    } catch (error) {
        console.error('Erro ao excluir capítulo:', error);
        return { success: false, error: error.message };
    }
});


// Lista os projetos conhecidos, para os cards de "Em andamento" do dashboard
ipcMain.handle('listar-projetos', async () => {
    try {
        const registryPath = getRegistryPath();
        const registry = readJSONSafe(registryPath, []);

        const projects = [];
        let precisaAtualizarRegistro = false;

        for (const projectPath of registry) {

            const projectJsonPath = path.join(projectPath, 'project.json');

            // Pasta foi apagada/movida manualmente: remove da lista
            if (!fsSync.existsSync(projectJsonPath)) {
                precisaAtualizarRegistro = true;
                continue;
            }

            const data = readJSONSafe(projectJsonPath, {});

            let coverUrl = null;

            if (data.cover) {
                const coverPath = path.join(projectPath, data.cover);
                if (fsSync.existsSync(coverPath)) {
                    // file:// precisa de barras normais, mesmo no Windows
                    coverUrl = 'file://' + coverPath.split(path.sep).join('/');
                }
            }

            projects.push({
                path: projectPath,
                title: data.title || 'Sem título',
                author: data.author || '',
                language: data.language || 'pt-BR',
                description: data.description || '',
                cover: coverUrl
            });
        }

        if (precisaAtualizarRegistro) {
            await writeJSON(registryPath, projects.map(p => p.path));
        }

        return { success: true, projects };

    } catch (error) {
        console.error('Erro ao listar projetos:', error);
        return { success: false, error: error.message, projects: [] };
    }
});


// Carrega um projeto completo (metadados + capítulos) para montar o editor
ipcMain.handle('carregar-projeto', async (event, projectPath) => {
    try {
        if (!projectPath) {
            throw new Error('Caminho do projeto não informado.');
        }

        const projectJsonPath = path.join(projectPath, 'project.json');
        const projectData = readJSONSafe(projectJsonPath, null);

        if (!projectData) {
            throw new Error('project.json não encontrado nessa pasta.');
        }

        // Sempre que um projeto é efetivamente aberto no editor, garante que
        // ele esteja no registro (projects.json). Isso cobre tanto projetos
        // abertos manualmente via "Abrir projeto" quanto qualquer outro
        // caminho que leve até aqui, para que apareçam em "Em andamento"
        // sem o usuário precisar abrir o arquivo de novo.
        await addToRegistry(projectPath);

        const chaptersDir = path.join(projectPath, 'chapters');
        const manifestPath = path.join(chaptersDir, 'manifest.json');
        const manifest = readJSONSafe(manifestPath, []).sort(
            (a, b) => a.order - b.order
        );

        const chapters = [];

        for (const entry of manifest) {

            const filePath = path.join(chaptersDir, entry.file);
            let html = '';

            if (fsSync.existsSync(filePath)) {
                const xhtml = await fs.readFile(filePath, 'utf-8');
                const match = xhtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
                html = match ? match[1].trim() : '';
            }

            chapters.push({
                id: entry.id,
                title: entry.title,
                html
            });
        }

        return { success: true, project: projectData, chapters };

    } catch (error) {
        console.error('Erro ao carregar projeto:', error);
        return { success: false, error: error.message };
    }
});


// Lista as imagens já copiadas para dentro do projeto (manifest.json de
// images/), usadas no painel lateral de "CSS por imagem" do editor
ipcMain.handle('listar-imagens', async (event, projectPath) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        const manifestPath = path.join(projectPath, 'images', 'manifest.json');
        const manifest = readJSONSafe(manifestPath, []);

        return { success: true, images: manifest };

    } catch (error) {
        console.error('Erro ao listar imagens:', error);
        return { success: false, error: error.message, images: [] };
    }
});

// Lista os arquivos de fonte disponíveis na pasta fonts/ do projeto.
// Retorna um array com { name, file, format } para cada fonte encontrada.
ipcMain.handle('listar-fontes', async (event, projectPath) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        const fontsDir = path.join(projectPath, 'fonts');
        const fontExtensions = ['.ttf', '.otf', '.woff', '.woff2'];
        const formatMap = {
            '.ttf': 'truetype',
            '.otf': 'opentype',
            '.woff': 'woff',
            '.woff2': 'woff2'
        };

        if (!fsSync.existsSync(fontsDir)) {
            return { success: true, fonts: [] };
        }

        const files = await fs.readdir(fontsDir);
        const fonts = [];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (fontExtensions.includes(ext)) {
                // Usa o nome do arquivo sem extensão como nome da família
                const name = path.basename(file, ext)
                    .replace(/[-_]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                fonts.push({ name, file, format: formatMap[ext] });
            }
        }

        // Ordena alfabeticamente
        fonts.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

        return { success: true, fonts };

    } catch (error) {
        console.error('Erro ao listar fontes:', error);
        return { success: false, error: error.message, fonts: [] };
    }
});

// Abre o seletor nativo de fontes (ttf, otf, woff, woff2) e copia os
// arquivos selecionados para a pasta fonts/ do projeto.
ipcMain.handle('importar-fonte', async (event, projectPath) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        const dialogResult = await dialog.showOpenDialog({
            title: 'Selecionar fonte',
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Fontes', extensions: ['ttf', 'otf', 'woff', 'woff2'] }
            ]
        });

        if (dialogResult.canceled || !dialogResult.filePaths || dialogResult.filePaths.length === 0) {
            return { success: true, fonts: [], canceled: true };
        }

        const fontsDir = path.join(projectPath, 'fonts');
        await fs.mkdir(fontsDir, { recursive: true });

        const imported = [];
        const formatMap = {
            '.ttf': 'truetype',
            '.otf': 'opentype',
            '.woff': 'woff',
            '.woff2': 'woff2'
        };

        for (const sourcePath of dialogResult.filePaths) {
            const ext = path.extname(sourcePath).toLowerCase();
            const fileName = path.basename(sourcePath);
            const destPath = path.join(fontsDir, fileName);

            // Evita sobrescrever se o arquivo já existir
            if (!fsSync.existsSync(destPath)) {
                await fs.copyFile(sourcePath, destPath);
            }

            const name = path.basename(fileName, ext)
                .replace(/[-_]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            imported.push({ name, file: fileName, format: formatMap[ext] || 'truetype' });
        }

        return { success: true, fonts: imported };

    } catch (error) {
        console.error('Erro ao importar fonte:', error);
        return { success: false, error: error.message };
    }
});

// Lista as fontes empacotadas com o programa na pasta src/fonts/.
// Escaneia subpastas (cada uma com o nome da família) por arquivos
// .ttf, .otf, .woff, .woff2 e retorna { name, file, format, path }.
ipcMain.handle('listar-fontes-base', async () => {
    try {
        const baseDir = path.join(__dirname, '..', '..', '..', 'src', 'fonts');
        const fontExtensions = ['.ttf', '.otf', '.woff', '.woff2'];
        const formatMap = {
            '.ttf': 'truetype',
            '.otf': 'opentype',
            '.woff': 'woff',
            '.woff2': 'woff2'
        };

        if (!fsSync.existsSync(baseDir)) {
            return { success: true, fonts: [] };
        }

        const families = await fs.readdir(baseDir);
        const fonts = [];

        for (const family of families) {
            const familyDir = path.join(baseDir, family);
            const stat = await fs.stat(familyDir);

            if (!stat.isDirectory()) {
                continue;
            }

            const files = await fs.readdir(familyDir);

            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (fontExtensions.includes(ext)) {
                    fonts.push({
                        name: family,
                        file: file,
                        format: formatMap[ext] || 'truetype',
                        path: familyDir
                    });
                }
            }
        }

        return { success: true, fonts };

    } catch (error) {
        console.error('Erro ao listar fontes base:', error);
        return { success: false, error: error.message, fonts: [] };
    }
});

// Decide em qual arquivo .css mora o estilo pedido: 'global' (ou vazio)
// é a folha de estilo geral do livro; qualquer outro valor é tratado
// como o id de uma imagem, que tem seu próprio arquivo .css dedicado
function getCssFilePath(projectPath, target) {

    const stylesDir = path.join(projectPath, 'styles');

    if (!target || target === 'global') {
        return path.join(stylesDir, 'stylesheet.css');
    }

    const safeId = String(target).replace(/[\\/:*?"<>|]/g, '');

    return path.join(stylesDir, `${safeId}.css`);
}

ipcMain.handle('ler-css', async (event, { projectPath, target }) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        const filePath = getCssFilePath(projectPath, target);

        let content = '';

        if (fsSync.existsSync(filePath)) {
            content = await fs.readFile(filePath, 'utf-8');
        }

        return { success: true, content };

    } catch (error) {
        console.error('Erro ao ler CSS:', error);
        return { success: false, error: error.message, content: '' };
    }
});

ipcMain.handle('salvar-css', async (event, { projectPath, target, content }) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        const stylesDir = path.join(projectPath, 'styles');
        await fs.mkdir(stylesDir, { recursive: true });

        const filePath = getCssFilePath(projectPath, target);

        await fs.writeFile(filePath, content || '', 'utf-8');

        return { success: true };

    } catch (error) {
        console.error('Erro ao salvar CSS:', error);
        return { success: false, error: error.message };
    }
});


// Remove uma imagem da pasta images/ do projeto: apaga o arquivo em si,
// o registro dela no manifesto (images/manifest.json) e o CSS dedicado
// a ela (styles/<id>.css), se existir. Chamado a partir do botão de
// excluir no painel lateral "Imagens" do editor, após confirmação do
// usuário no modal.
ipcMain.handle('excluir-imagem', async (event, { projectPath, imageId }) => {
    try {
        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        if (!imageId) {
            throw new Error('Nenhuma imagem informada.');
        }

        const imagesDir = path.join(projectPath, 'images');
        const manifestPath = path.join(imagesDir, 'manifest.json');
        const manifest = readJSONSafe(manifestPath, []);

        const entry = manifest.find(item => item.id === imageId);

        if (entry) {
            const filePath = path.join(imagesDir, entry.file);
            if (fsSync.existsSync(filePath)) {
                await fs.unlink(filePath);
            }
        }

        const updatedManifest = manifest.filter(item => item.id !== imageId);
        await writeJSON(manifestPath, updatedManifest);

        const cssPath = getCssFilePath(projectPath, imageId);
        if (fsSync.existsSync(cssPath)) {
            await fs.unlink(cssPath);
        }

        return { success: true };

    } catch (error) {
        console.error('Erro ao excluir imagem:', error);
        return { success: false, error: error.message };
    }
});


// Abre o modal nativo de seleção de pasta e, se o usuário confirmar,
// gera o eBook (.epub ou .pdf, conforme o formato escolhido no editor)
// dentro dela. Aceita tanto a chamada antiga (string com o caminho do
// projeto) quanto a nova ({ projectPath, format }), para não quebrar
// nada que ainda chame esse canal do jeito anterior.
ipcMain.handle('exportar-projeto', async (event, dados) => {
    try {
        const projectPath = typeof dados === 'string' ? dados : dados && dados.projectPath;
        const format = dados && dados.format === 'pdf' ? 'pdf' : 'epub';

        console.log('[exportar-projeto] iniciado para:', projectPath, '| formato:', format);

        if (!projectPath) {
            throw new Error('Nenhum projeto aberto.');
        }

        const projectJsonPath = path.join(projectPath, 'project.json');
        const projectData = readJSONSafe(projectJsonPath, null);

        if (!projectData) {
            throw new Error('project.json não encontrado nessa pasta.');
        }

        const dialogResult = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        console.log('[exportar-projeto] resultado do diálogo:', dialogResult);

        if (dialogResult.canceled || !dialogResult.filePaths[0]) {
            return { success: false, canceled: true };
        }

        const destDir = dialogResult.filePaths[0];
        const extension = format === 'pdf' ? '.pdf' : '.epub';
        const fileName = sanitizeFolderName(projectData.title || 'ebook') + extension;
        const destPath = path.join(destDir, fileName);

        console.log(`[exportar-projeto] gerando ${format} em:`, destPath);

        const fileBuffer = format === 'pdf'
            ? await buildPdf(projectPath, projectData)
            : await buildEpub(projectPath, projectData);

        await fs.writeFile(destPath, fileBuffer);

        console.log(`[exportar-projeto] ${format} salvo com sucesso.`);

        return { success: true, path: destPath, format };

    } catch (error) {
        console.error('Erro ao exportar projeto:', error);
        return { success: false, error: error.message };
    }
});

