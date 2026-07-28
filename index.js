const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

// Informações do próprio app (nome, versão, descrição, autor, etc.),
// lidas direto do package.json — usadas na tela de Configurações do
// dashboard. Se o arquivo não existir por algum motivo, cai num
// fallback simples em vez de quebrar o app inteiro.
const packageJson = readJSONSafeSync(path.join(__dirname, 'package.json'), {
    name: 'editor-de-ebook',
    productName: 'Editor de eBook',
    version: '0.0.0',
    description: '',
    author: ''
});

function readJSONSafeSync(filePath, fallback) {
    try {
        if (fsSync.existsSync(filePath)) {
            return JSON.parse(fsSync.readFileSync(filePath, 'utf-8'));
        }
    } catch (error) {
        console.error('Erro ao ler JSON:', filePath, error);
    }
    return fallback;
}

// Remove caracteres inválidos para nome de pasta em Windows/Mac/Linux
function sanitizeFolderName(name) {
    return name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
        .replace(/[\\/:*?"<>|]/g, '')
        .trim()
        .replace(/\s+/g, ' ') || 'Meu eBook';
}

// O HTML que sai do editor (contenteditable) usa tags "vazias" no
// formato de HTML comum, tipo <img ...> ou <br>, sem barra de
// fechamento. Isso é válido em HTML, mas XHTML/EPUB exige XML
// estrito: toda tag precisa ser fechada, então <img> precisa virar
// <img ... />. Sem isso, o arquivo .xhtml fica um XML malformado e
// a maioria dos leitores de epub (KOReader incluso) para de exibir
// o conteúdo assim que encontra a primeira tag inválida.
const VOID_ELEMENTS = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

function closeVoidTags(html) {
    if (!html) {
        return html;
    }

    const pattern = new RegExp('<(' + VOID_ELEMENTS.join('|') + ')((?:[^>])*?)\\s*/?>', 'gi');

    return html.replace(pattern, (match, tag, attrs) => {
        attrs = attrs.trim().replace(/\/$/, '').trim();
        return attrs ? `<${tag} ${attrs} />` : `<${tag} />`;
    });
}

// Entidades HTML nomeadas que navegadores costumam inserir sozinhos
// (ex: &nbsp; ao digitar espaços seguidos) mas que NÃO existem em
// XML puro — só os 5 padrão (&amp; &lt; &gt; &quot; &apos;) e
// referências numéricas (&#160;) são válidos sem um DTD. Sem essa
// conversão, o arquivo .xhtml fica malformado e os leitores de epub
// param de exibir o conteúdo assim que encontram a entidade.
const HTML_ENTITY_TO_NUMERIC = {
    nbsp: '160', copy: '169', reg: '174', trade: '8482',
    hellip: '8230', mdash: '8212', ndash: '8211',
    lsquo: '8216', rsquo: '8217', ldquo: '8220', rdquo: '8221',
    laquo: '171', raquo: '187', deg: '176', sect: '167',
    para: '182', middot: '183', times: '215', divide: '247',
    plusmn: '177', euro: '8364', pound: '163', yen: '165',
    cent: '162', frac12: '189', frac14: '188', frac34: '190',
    bull: '8226', dagger: '8224', Dagger: '8225'
};

function sanitizeEntitiesForXml(html) {
    if (!html) {
        return html;
    }

    return html.replace(/&([a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9a-fA-F]+);/g, (match, entity) => {
        // Os 5 padrão do XML e referências numéricas já são válidos
        if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(entity) || entity.startsWith('#')) {
            return match;
        }

        if (HTML_ENTITY_TO_NUMERIC[entity]) {
            return `&#${HTML_ENTITY_TO_NUMERIC[entity]};`;
        }

        // Entidade desconhecida: escapa o "&" para não quebrar o XML
        return '&amp;' + entity + ';';
    });
}

// Lê um JSON do disco; se não existir ou der erro, devolve o valor padrão
function readJSONSafe(filePath, fallback) {
    try {
        if (fsSync.existsSync(filePath)) {
            return JSON.parse(fsSync.readFileSync(filePath, 'utf-8'));
        }
    } catch (error) {
        console.error('Erro ao ler JSON:', filePath, error);
    }
    return fallback;
}

async function writeJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 4), 'utf-8');
}

/* =========================================================
   EXPORTAÇÃO PARA .EPUB
   -------------------------------------------------------
   Não depende de nenhum pacote externo (tipo archiver ou
   jszip): monta o .epub "na mão", escrevendo o formato ZIP
   diretamente com zlib (que já vem no Node). Isso evita ter
   que instalar/empacotar dependências extras junto do app.
========================================================= */

// Implementação padrão de CRC-32, exigida pelo formato ZIP
// para cada arquivo dentro do pacote.
function crc32(buffer) {
    let crc = ~0;

    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
        }
    }

    return (~crc) >>> 0;
}

// Escritor de arquivo ZIP mínimo, o suficiente para gerar um
// .epub válido (cabeçalho local + diretório central + EOCD).
class ZipWriter {
    constructor() {
        this.chunks = [];
        this.offset = 0;
        this.entries = [];
    }

    _dosDateTime() {
        const now = new Date();
        const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
        const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
        return { dosTime, dosDate };
    }

    // "store: true" grava sem compressão — usado só para o
    // arquivo "mimetype", que o padrão EPUB exige que fique
    // não comprimido e seja o primeiro item do zip.
    addFile(name, data, { store = false } = {}) {
        const nameBuf = Buffer.from(name, 'utf-8');
        const crc = crc32(data);
        const method = store ? 0 : 8;
        const compressedData = store ? data : zlib.deflateRawSync(data);
        const { dosTime, dosDate } = this._dosDateTime();
        const localOffset = this.offset;

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6); // nomes em UTF-8
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(dosTime, 10);
        localHeader.writeUInt16LE(dosDate, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compressedData.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);

        this.chunks.push(localHeader, nameBuf, compressedData);
        this.offset += localHeader.length + nameBuf.length + compressedData.length;

        this.entries.push({
            nameBuf, crc, method, dosTime, dosDate,
            compressedSize: compressedData.length,
            size: data.length,
            offset: localOffset
        });
    }

    finalize() {
        const centralChunks = [];
        let centralSize = 0;

        for (const entry of this.entries) {
            const central = Buffer.alloc(46);
            central.writeUInt32LE(0x02014b50, 0);
            central.writeUInt16LE(20, 4);
            central.writeUInt16LE(20, 6);
            central.writeUInt16LE(0x0800, 8);
            central.writeUInt16LE(entry.method, 10);
            central.writeUInt16LE(entry.dosTime, 12);
            central.writeUInt16LE(entry.dosDate, 14);
            central.writeUInt32LE(entry.crc, 16);
            central.writeUInt32LE(entry.compressedSize, 20);
            central.writeUInt32LE(entry.size, 24);
            central.writeUInt16LE(entry.nameBuf.length, 28);
            central.writeUInt16LE(0, 30);
            central.writeUInt16LE(0, 32);
            central.writeUInt16LE(0, 34);
            central.writeUInt16LE(0, 36);
            central.writeUInt32LE(0, 38);
            central.writeUInt32LE(entry.offset, 42);

            centralChunks.push(central, entry.nameBuf);
            centralSize += central.length + entry.nameBuf.length;
        }

        const centralOffset = this.offset;

        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(0, 4);
        end.writeUInt16LE(0, 6);
        end.writeUInt16LE(this.entries.length, 8);
        end.writeUInt16LE(this.entries.length, 10);
        end.writeUInt32LE(centralSize, 12);
        end.writeUInt32LE(centralOffset, 16);
        end.writeUInt16LE(0, 20);

        return Buffer.concat([...this.chunks, ...centralChunks, end]);
    }
}

const IMAGE_MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
};

// Formatos aceitos ao IMPORTAR uma nova imagem (capa ou imagem de
// capítulo), seja por diálogo de seleção ou por arrastar-e-soltar.
// Não afeta imagens .gif/.webp/.svg já existentes em projetos antigos
// (IMAGE_MIME_BY_EXT acima continua reconhecendo essas extensões na
// hora de gerar o epub/pdf) — só bloqueia a entrada de arquivos novos.
const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

function isAllowedImageExtension(filePath) {
    return ALLOWED_IMAGE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function escapeXml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[ch]));
}

// Converte um caminho absoluto do disco (Windows ou Unix) numa URL
// file:// válida. Usado para montar o HTML temporário da exportação
// em PDF, com um <base> apontando pra pasta de capítulos do projeto
// — assim os caminhos relativos de imagem ("../images/x.jpg") que já
// estão salvos nos .xhtml continuam funcionando sem precisar reescrever.
function toFileUrl(absolutePath) {
    let normalized = absolutePath.replace(/\\/g, '/');

    if (!normalized.startsWith('/')) {
        normalized = '/' + normalized;
    }

    return 'file://' + encodeURI(normalized);
}

// Monta o .epub inteiro (estrutura OEBPS + manifesto + spine + sumário)
// a partir do que já está salvo em disco na pasta do projeto.
async function buildEpub(projectPath, projectData) {
    const zip = new ZipWriter();

    // O "mimetype" precisa ser o primeiro arquivo do zip e não pode
    // estar comprimido — é assim que leitores de epub identificam o
    // formato do arquivo antes mesmo de olhar dentro dele.
    zip.addFile('mimetype', Buffer.from('application/epub+zip', 'utf-8'), { store: true });

    zip.addFile('META-INF/container.xml', Buffer.from(
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`, 'utf-8'));

    // ---------- Capítulos ----------
    const chaptersDir = path.join(projectPath, 'chapters');
    const chaptersManifest = readJSONSafe(path.join(chaptersDir, 'manifest.json'), [])
        .sort((a, b) => a.order - b.order);

    const chapterEntries = [];

    for (const entry of chaptersManifest) {
        const filePath = path.join(chaptersDir, entry.file);
        let xhtml = fsSync.existsSync(filePath) ? await fs.readFile(filePath, 'utf-8') : '';

        if (!xhtml) {
            continue;
        }

        // Segurança extra: se o arquivo em disco foi salvo antes da correção
        // que fecha tags vazias (<img>, <br>...) corretamente, conserta aqui
        // também, para não gerar um epub com XML malformado.
        xhtml = closeVoidTags(sanitizeEntitiesForXml(xhtml));

        zip.addFile(`OEBPS/chapters/${entry.file}`, Buffer.from(xhtml, 'utf-8'));

        chapterEntries.push({
            id: 'chap-' + entry.id,
            file: entry.file,
            title: entry.title || 'Capítulo'
        });
    }

    // Sem isso um projeto vazio geraria um epub sem nenhuma página
    if (chapterEntries.length === 0) {
        const fileName = 'chapter-1.xhtml';

        zip.addFile(`OEBPS/chapters/${fileName}`, Buffer.from(
`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/><title>Capítulo 1</title></head><body></body></html>
`, 'utf-8'));

        chapterEntries.push({ id: 'chap-1', file: fileName, title: 'Capítulo 1' });
    }

    // ---------- Folhas de estilo ----------
    const stylesDir = path.join(projectPath, 'styles');
    const cssFiles = [];

    if (fsSync.existsSync(stylesDir)) {
        const fileNames = await fs.readdir(stylesDir);

        for (const fileName of fileNames) {
            if (!fileName.endsWith('.css')) {
                continue;
            }

            const content = await fs.readFile(path.join(stylesDir, fileName), 'utf-8');
            zip.addFile(`OEBPS/styles/${fileName}`, Buffer.from(content, 'utf-8'));
            cssFiles.push(fileName);
        }
    }

    if (cssFiles.length === 0) {
        zip.addFile('OEBPS/styles/stylesheet.css', Buffer.from('', 'utf-8'));
        cssFiles.push('stylesheet.css');
    }

    // ---------- Imagens ----------
    const imagesDir = path.join(projectPath, 'images');
    const imageManifest = readJSONSafe(path.join(imagesDir, 'manifest.json'), []);
    const imageEntries = [];

    for (const img of imageManifest) {
        const filePath = path.join(imagesDir, img.file);

        if (!fsSync.existsSync(filePath)) {
            continue;
        }

        const data = await fs.readFile(filePath);
        zip.addFile(`OEBPS/images/${img.file}`, data);

        const ext = path.extname(img.file).toLowerCase();
        imageEntries.push({
            id: 'img-' + img.id,
            file: img.file,
            mediaType: IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream'
        });
    }

    // ---------- Capa ----------
    let coverEntry = null;

    if (projectData.cover) {
        const coverPath = path.join(projectPath, projectData.cover);

        if (fsSync.existsSync(coverPath)) {
            const data = await fs.readFile(coverPath);
            zip.addFile(`OEBPS/${projectData.cover}`, data);

            const ext = path.extname(projectData.cover).toLowerCase();
            coverEntry = {
                id: 'cover-image',
                file: projectData.cover,
                mediaType: IMAGE_MIME_BY_EXT[ext] || 'image/png'
            };
        }
    }

    // ---------- content.opf ----------
    const bookId = 'urn:uuid:' + crypto.randomUUID();
    const language = projectData.language || 'pt-BR';
    const title = projectData.title || 'Sem título';
    const author = projectData.author || '';
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const manifestItems = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        ...cssFiles.map((fileName, i) => `<item id="css-${i}" href="styles/${fileName}" media-type="text/css"/>`),
        ...chapterEntries.map(c => `<item id="${c.id}" href="chapters/${c.file}" media-type="application/xhtml+xml"/>`),
        ...imageEntries.map(img => `<item id="${img.id}" href="images/${img.file}" media-type="${img.mediaType}"/>`)
    ];

    if (coverEntry) {
        manifestItems.push(`<item id="${coverEntry.id}" href="${coverEntry.file}" media-type="${coverEntry.mediaType}" properties="cover-image"/>`);
    }

    const spineItems = chapterEntries.map(c => `<itemref idref="${c.id}"/>`);

    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>
    ${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ''}
    <meta property="dcterms:modified">${modified}</meta>
    ${coverEntry ? `<meta name="cover" content="${coverEntry.id}"/>` : ''}
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>
`;

    zip.addFile('OEBPS/content.opf', Buffer.from(opf, 'utf-8'));

    // ---------- nav.xhtml (sumário exigido pelo EPUB 3) ----------
    const navItems = chapterEntries
        .map(c => `<li><a href="chapters/${c.file}">${escapeXml(c.title)}</a></li>`)
        .join('\n        ');

    const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>Sumário</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Sumário</h1>
    <ol>
        ${navItems}
    </ol>
  </nav>
</body>
</html>
`;

    zip.addFile('OEBPS/nav.xhtml', Buffer.from(nav, 'utf-8'));

    // ---------- toc.ncx (compatibilidade com leitores EPUB 2) ----------
    const navPoints = chapterEntries.map((c, i) => `
    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="chapters/${c.file}"/>
    </navPoint>`).join('');

    const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(bookId)}"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>${navPoints}
  </navMap>
</ncx>
`;

    zip.addFile('OEBPS/toc.ncx', Buffer.from(ncx, 'utf-8'));

    return zip.finalize();
}

// Monta um único documento HTML com todos os capítulos (na ordem certa,
// separados por quebra de página), a folha de estilo do projeto e uma
// página de rosto simples com título/autor. É esse HTML que a janela
// oculta do Electron carrega para gerar o PDF em buildPdf().
async function buildPdfHtml(projectPath, projectData) {
    const chaptersDir = path.join(projectPath, 'chapters');
    const chaptersManifest = readJSONSafe(path.join(chaptersDir, 'manifest.json'), [])
        .sort((a, b) => a.order - b.order);

    const chapterSections = [];

    for (const entry of chaptersManifest) {
        const filePath = path.join(chaptersDir, entry.file);
        let xhtml = fsSync.existsSync(filePath) ? await fs.readFile(filePath, 'utf-8') : '';

        if (!xhtml) {
            continue;
        }

        const match = xhtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const bodyHtml = match ? match[1].trim() : xhtml;

        chapterSections.push(
            `<section class="pdf-chapter">` +
            `<h1 class="pdf-chapter-title">${escapeXml(entry.title || 'Capítulo')}</h1>` +
            bodyHtml +
            `</section>`
        );
    }

    if (chapterSections.length === 0) {
        chapterSections.push('<section class="pdf-chapter"></section>');
    }

    // ---------- Folhas de estilo do projeto ----------
    const stylesDir = path.join(projectPath, 'styles');
    let projectCss = '';

    if (fsSync.existsSync(stylesDir)) {
        const fileNames = await fs.readdir(stylesDir);

        for (const fileName of fileNames) {
            if (!fileName.endsWith('.css')) {
                continue;
            }

            projectCss += (await fs.readFile(path.join(stylesDir, fileName), 'utf-8')) + '\n';
        }
    }

    const chaptersDirUrl = toFileUrl(chaptersDir) + '/';
    const title = projectData.title || 'Sem título';
    const author = projectData.author || '';
    const language = projectData.language || 'pt-BR';

    // Página de rosto: mostra a imagem de capa do projeto, se houver
    // uma; caso contrário, mostra título/autor em texto simples.
    let coverSection = `<section class="pdf-cover"><h1>${escapeXml(title)}</h1>${author ? `<p>${escapeXml(author)}</p>` : ''}</section>`;

    if (projectData.cover) {
        const coverPath = path.join(projectPath, projectData.cover);

        if (fsSync.existsSync(coverPath)) {
            const coverUrl = toFileUrl(coverPath);
            coverSection = `<section class="pdf-cover pdf-cover-image"><img src="${coverUrl}" alt=""/></section>`;
        }
    }

    return `<!DOCTYPE html>
<html lang="${escapeXml(language)}">
<head>
<meta charset="utf-8"/>
<base href="${chaptersDirUrl}"/>
<title>${escapeXml(title)}</title>
<style>
${projectCss}

/* ---- Ajustes específicos da exportação em PDF ---- */
.pdf-cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 90vh;
    text-align: center;
    page-break-after: always;
}
.pdf-cover h1 { font-size: 28px; margin-bottom: 12px; }
.pdf-cover p { font-size: 16px; color: #555; }
.pdf-cover-image { height: 100vh; }
.pdf-cover-image img { max-width: 100%; max-height: 100%; object-fit: contain; }
.pdf-chapter { page-break-before: always; }
.pdf-chapter:first-of-type { page-break-before: avoid; }
.pdf-chapter-title { margin-bottom: 1em; }
hr.page-break { border: 0; height: 0; margin: 0; page-break-after: always; }
</style>
</head>
<body>
${coverSection}
${chapterSections.join('\n')}
</body>
</html>`;
}

// Gera o PDF do projeto usando o recurso nativo de impressão do
// Chromium (webContents.printToPDF), sem depender de nenhuma
// biblioteca externa: carrega o HTML montado em buildPdfHtml() numa
// janela oculta e captura o resultado como PDF.
async function buildPdf(projectPath, projectData) {
    const html = await buildPdfHtml(projectPath, projectData);

    const tmpFile = path.join(
        app.getPath('temp'),
        `ebook-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
    );

    await fs.writeFile(tmpFile, html, 'utf-8');

    const printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            sandbox: true
        }
    });

    try {
        await printWindow.loadFile(tmpFile);

        const pdfBuffer = await printWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            margins: { marginType: 'default' }
        });

        return pdfBuffer;

    } finally {
        printWindow.destroy();

        fs.unlink(tmpFile).catch(() => {});
    }
}

// Onde fica a lista de projetos conhecidos pelo app (fora da pasta de qualquer
// projeto específico, porque o dashboard precisa saber deles antes de abrir um)
function getRegistryPath() {
    return path.join(app.getPath('userData'), 'projects.json');
}

async function addToRegistry(projectPath) {
    const registryPath = getRegistryPath();
    const registry = readJSONSafe(registryPath, []);

    if (!registry.includes(projectPath)) {
        registry.push(projectPath);
        await writeJSON(registryPath, registry);
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth:1200 ,
        minHeight:800,
        autoHideMenuBar:true,
        icon: path.join(__dirname, "src/icons/logo_do_app.png"),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    win.removeMenu();
    win.loadFile('index.html');
}


// Informações do app para a tela de Configurações: nome, versão,
// descrição, autor/link do repositório e a lista de tecnologias
// (dependências) — tudo direto do package.json, sem duplicar dados
// manualmente em outro lugar.
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

        // Cria uma subpasta com o nome do livro dentro da pasta escolhida
        // (ex: "C:\Documentos\eBooks\MeuLivro")
        const folderName = sanitizeFolderName(title);
        const projectDir = path.join(basePath, folderName);

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
            title: title || '',
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
            path: projectDir
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

        // A adição ao registro (projects.json) acontece em "carregar-projeto",
        // que é chamado assim que o editor abre esse projeto — assim ele já
        // fica salvo em "Em andamento" sem precisar clicar em "Abrir" de novo.
        return { success: true, path: projectPath };

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


app.whenReady().then(createWindow);