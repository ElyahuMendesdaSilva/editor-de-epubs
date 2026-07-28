const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { closeVoidTags, readJSONSafe, sanitizeEntitiesForXml } = require('../utils/files');

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

module.exports = { buildEpub };

// Monta um único documento HTML com todos os capítulos (na ordem certa,
// separados por quebra de página), a folha de estilo do projeto e uma
// página de rosto simples com título/autor. É esse HTML que a janela
// oculta do Electron carrega para gerar o PDF em buildPdf().
