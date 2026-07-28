const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { readJSONSafe } = require('../utils/files');

function escapeXml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[character]));
}

function toFileUrl(absolutePath) {
    let normalized = absolutePath.replace(/\\/g, '/');

    if (!normalized.startsWith('/')) normalized = '/' + normalized;

    return 'file://' + encodeURI(normalized);
}

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

module.exports = { buildPdf };
