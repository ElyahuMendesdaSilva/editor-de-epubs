const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { pathToFileURL } = require('url');
const { readJSONSafe } = require('../utils/files');

const FONT_FORMAT_BY_EXT = {
    '.ttf': 'truetype',
    '.otf': 'opentype',
    '.woff': 'woff',
    '.woff2': 'woff2'
};

function escapeXml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[character]));
}

// Escapa um texto para uso seguro dentro de uma regra CSS (aspas simples/barra)
function escapeCss(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toFileUrl(absolutePath) {
    return pathToFileURL(absolutePath).href;
}

// Monta as regras @font-face usadas pelo editor:
// 1) fontes do projeto (projectPath/fonts/) — têm prioridade;
// 2) fontes empacotadas com o app (src/fonts/<família>/...).
// Uma regra por família (primeiro arquivo), igual ao editor faz.
async function collectFontFaces(projectPath) {
    const fonts = [];

    const projectFontsDir = path.join(projectPath, 'fonts');
    if (fsSync.existsSync(projectFontsDir)) {
        const files = await fs.readdir(projectFontsDir);

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            const format = FONT_FORMAT_BY_EXT[ext];

            if (!format) {
                continue;
            }

            const name = path.basename(file, ext)
                .replace(/[-_]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            fonts.push({ name, url: toFileUrl(path.join(projectFontsDir, file)), format });
        }
    }

    const builtinBaseDir = path.join(__dirname, '..', '..', '..', 'src', 'fonts');
    if (fsSync.existsSync(builtinBaseDir)) {
        const families = await fs.readdir(builtinBaseDir);

        for (const family of families) {
            const familyDir = path.join(builtinBaseDir, family);
            let stat;

            try {
                stat = await fs.stat(familyDir);
            } catch (error) {
                continue;
            }

            if (!stat.isDirectory()) {
                continue;
            }

            const files = await fs.readdir(familyDir);

            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                const format = FONT_FORMAT_BY_EXT[ext];

                if (!format) {
                    continue;
                }

                fonts.push({ name: family, url: toFileUrl(path.join(familyDir, file)), format });
            }
        }
    }

    const seen = new Set();
    const unique = [];

    for (const font of fonts) {
        const key = font.name.toLowerCase();

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        unique.push(font);
    }

    return unique.map(font =>
        `@font-face {\n` +
        `    font-family: '${escapeCss(font.name)}';\n` +
        `    src: url('${font.url}') format('${font.format}');\n` +
        `    font-display: block;\n` +
        `}`
    ).join('\n\n');
}

// CSS aplicado apenas na hora de imprimir/exportar. Vem depois da folha de
// estilo do projeto, então pode ajustar a tipografia para o papel sem
// apagar o que o escritor configurou (fonte, cores, espaçamentos etc.).
const PRINT_CSS = `
.pdf-cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 90vh;
    text-align: center;
    page-break-after: always;
}
.pdf-cover h1 { font-size: 30pt; margin-bottom: 12pt; }
.pdf-cover p { font-size: 16pt; color: #555; }
.pdf-cover-image { height: 100vh; }
.pdf-cover-image img { max-width: 100%; max-height: 100%; object-fit: contain; }
.pdf-chapter { page-break-before: always; }
.pdf-chapter:first-of-type { page-break-before: avoid; }
.pdf-chapter-title { margin-bottom: 1em; }

/* Tipografia de impressão: texto legível, próximo do que é visto no editor */
html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
}
body {
    font-size: 13pt;
    line-height: 1.7;
    text-align: justify;
}
p { margin: 0 0 0.7em; }
h1 { font-size: 26pt; line-height: 1.3; }
h2 { font-size: 20pt; line-height: 1.3; }
h3 { font-size: 16pt; }
h4, h5, h6 { font-size: 14pt; }
blockquote { margin: 1em 2em; font-style: italic; }
ul, ol { margin: 0.5em 0 0.8em 1.5em; padding: 0; }
li { margin: 0.2em 0; }

/* Imagens: nunca maiores que a página e sem cortar no meio */
img {
    max-width: 100%;
    height: auto;
    page-break-inside: avoid;
}

/* Mapeia os tamanhos legados <font size="1..7"> (usados pelo editor)
   para tamanhos de impressão proporcionais e legíveis */
font[size="1"] { font-size: 9.5pt; }
font[size="2"] { font-size: 11pt; }
font[size="3"] { font-size: 13pt; }
font[size="4"] { font-size: 14.5pt; }
font[size="5"] { font-size: 17pt; }
font[size="6"] { font-size: 21pt; }
font[size="7"] { font-size: 26pt; }

hr.page-break { border: 0; height: 0; margin: 0; page-break-after: always; }
`;

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

    // ---------- Fontes (projeto + embutidas no app) ----------
    const fontFaces = await collectFontFaces(projectPath);

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
${fontFaces}

${projectCss}

/* ---- Ajustes específicos da exportação em PDF ---- */
${PRINT_CSS}
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

        // Espera as fontes embutidas terminarem de carregar antes de
        // gerar o PDF, para não capturar o texto com fonte de substituição.
        await Promise.race([
            printWindow.webContents.executeJavaScript(
                'document.fonts.ready.then(function () { return true; })'
            ),
            new Promise(resolve => setTimeout(resolve, 8000))
        ]).catch(() => {});

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

module.exports = { buildPdf };
