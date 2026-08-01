const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const zlib = require('zlib');
const packageJson = require('../../../package.json');
const { closeVoidTags, sanitizeEntitiesForXml, sanitizeFolderName, writeJSON } = require('../utils/files');

/* =========================================================
   IMPORTAÇÃO DE .EPUB
   -------------------------------------------------------
   Assim como o exportador, não depende de pacotes externos:
   lê o formato ZIP "na mão" (cabeçalhos locais + diretório
   central) usando só o zlib do Node, descompacta os arquivos
   e converte o conteúdo do epub para a estrutura de pasta de
   um projeto do editor (chapters/, images/, styles/, fonts/).
========================================================= */

const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

const ALLOWED_COVER_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

function isAllowedCoverExtension(filePath) {
    return ALLOWED_COVER_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function escapeXml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[ch]));
}

// ---------- Leitura do ZIP ----------

// Lê todos os arquivos do .epub (que é um ZIP) devolvendo um Map
// com o caminho normalizado de cada entrada -> Buffer com o conteúdo.
function readZipEntries(buffer) {
    // Procura o End of Central Directory (EOCD) de trás pra frente
    let eocdIndex = -1;

    for (let i = buffer.length - 22; i >= 0; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) {
            eocdIndex = i;
            break;
        }
    }

    if (eocdIndex === -1) {
        throw new Error('O arquivo não é um ZIP/EPUB válido.');
    }

    const entryCount = buffer.readUInt16LE(eocdIndex + 10);
    const centralOffset = buffer.readUInt32LE(eocdIndex + 16);

    const entries = new Map();
    let offset = centralOffset;

    for (let i = 0; i < entryCount; i++) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error('Diretório central do ZIP inválido.');
        }

        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);

        const name = buffer.toString('utf-8', offset + 46, offset + 46 + nameLength);

        // O cabeçalho local pode ter tamanhos/extra diferentes do central;
        // o que importa é a posição dos dados, calculada pelo cabeçalho local.
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

        let data;

        if (method === 0) {
            data = compressedData;
        } else if (method === 8) {
            data = zlib.inflateRawSync(compressedData);
        } else {
            throw new Error(`Método de compressão não suportado no arquivo: ${name}`);
        }

        entries.set(name, data);
        offset += 46 + nameLength + extraLength + commentLength;
    }

    return entries;
}

// ---------- Helpers de caminho/XML ----------

function normalizeZipPath(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '');
}

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    } catch (error) {
        return value;
    }
}

function dirnamePath(value) {
    const index = value.lastIndexOf('/');
    return index === -1 ? '' : value.slice(0, index);
}

function basenamePath(value) {
    return value.slice(value.lastIndexOf('/') + 1);
}

// Junta um caminho relativo a uma base, resolvendo ".." e "."
// (ex.: "OEBPS/chapters" + "../images/capa.png" -> "OEBPS/images/capa.png")
function joinPath(base, rel) {
    const parts = [];

    for (const segment of `${base}/${rel}`.split('/')) {
        if (!segment || segment === '.') {
            continue;
        }

        if (segment === '..') {
            parts.pop();
        } else {
            parts.push(segment);
        }
    }

    return parts.join('/');
}

function extractAttr(tag, name) {
    const match = tag.match(new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
    return match ? match[2] : '';
}

function extractXml(xml, tag) {
    const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? match[1].trim() : '';
}

function extractBody(html) {
    const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return match ? match[1].trim() : html.trim();
}

function extractChapterTitle(html) {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].trim().replace(/\s+/g, ' ') : '';
}

function sanitizeCssFileName(name) {
    return sanitizeFolderName(name).replace(/\.css$/i, '') + '.css';
}

// ---------- Leitura da estrutura do EPUB ----------

// Devolve o conteúdo do .epub já convertido para a estrutura de um
// projeto do editor (com caminhos de imagem/CSS reescritos para a
// estrutura chapters/ + images/ + styles/ + fonts/ do app).
async function parseEpub(epubPath) {
    const buffer = await fs.readFile(epubPath);
    const rawEntries = readZipEntries(buffer);

    const files = new Map();
    for (const [name, data] of rawEntries) {
        files.set(normalizeZipPath(name), data);
    }

    // container.xml aponta para o content.opf
    const container = files.get('META-INF/container.xml');
    if (!container) {
        throw new Error('O arquivo não parece ser um EPUB válido (container.xml não encontrado).');
    }

    const rootfileMatch = container.toString('utf-8')
        .match(/<rootfile\b[^>]*full-path=["']([^"']+)["']/i);
    if (!rootfileMatch) {
        throw new Error('EPUB inválido: rootfile não encontrado no container.xml.');
    }

    const opfPath = normalizeZipPath(rootfileMatch[1]);
    const opfData = files.get(opfPath);
    if (!opfData) {
        throw new Error('EPUB inválido: content.opf não encontrado.');
    }

    const opfXml = opfData.toString('utf-8');
    const opfDir = dirnamePath(opfPath);

    const title = extractXml(opfXml, 'dc:title') || 'Sem título';
    const author = extractXml(opfXml, 'dc:creator') || '';
    const language = extractXml(opfXml, 'dc:language') || 'pt-BR';
    const description = extractXml(opfXml, 'dc:description') || '';

    // Manifesto: <item id href media-type properties>
    const manifestBlock = (opfXml.match(/<manifest[\s\S]*?<\/manifest>/i) || [''])[0];
    const items = [];
    const itemRe = /<item\b[^>]*\/?>/gi;
    let match;

    while ((match = itemRe.exec(manifestBlock))) {
        const tag = match[0];
        const id = extractAttr(tag, 'id');
        const href = extractAttr(tag, 'href');

        if (!id || !href) {
            continue;
        }

        items.push({
            id,
            href: normalizeZipPath(safeDecodeURIComponent(href)),
            mediaType: extractAttr(tag, 'media-type').toLowerCase(),
            properties: extractAttr(tag, 'properties').toLowerCase()
        });
    }

    // Spine: ordem de leitura dos capítulos
    const spineBlock = (opfXml.match(/<spine[\s\S]*?<\/spine>/i) || [''])[0];
    const spineIds = [];
    const idrefRe = /<itemref\b[^>]*idref=["']([^"']+)["']/gi;

    while ((match = idrefRe.exec(spineBlock))) {
        spineIds.push(match[1]);
    }

    // Capa declarada via <meta name="cover" content="id"/>
    const coverMeta = opfXml.match(/<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i);
    const coverMetaId = coverMeta ? coverMeta[1] : '';

    // Títulos dos capítulos vindos do sumário (toc.ncx / nav.xhtml)
    const tocTitles = new Map();

    for (const [filePath, data] of files) {
        const lowerPath = filePath.toLowerCase();

        if (!lowerPath.endsWith('toc.ncx') && !lowerPath.endsWith('nav.xhtml')) {
            continue;
        }

        const text = data.toString('utf-8');

        if (lowerPath.endsWith('toc.ncx')) {
            const labelRe = /<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\b[^>]*src=["']([^"']+)["']/gi;

            while ((match = labelRe.exec(text))) {
                const href = normalizeZipPath(safeDecodeURIComponent(match[2]));
                tocTitles.set(href, match[1].trim().replace(/\s+/g, ' '));
            }
        } else {
            const linkRe = /<a\b[^>]*href=["']([^"']+)["']>([\s\S]*?)<\/a>/gi;

            while ((match = linkRe.exec(text))) {
                const href = normalizeZipPath(safeDecodeURIComponent(match[1]));
                const label = match[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
                if (label) {
                    tocTitles.set(href, label);
                }
            }
        }
    }

    // ---------- Capítulos (na ordem do spine) ----------

    const spineItems = spineIds
        .map(id => items.find(item => item.id === id))
        .filter(Boolean);

    const candidates = spineItems.length > 0 ? spineItems : items;

    const chapters = [];
    const seenChapterPaths = new Set();

    for (const item of candidates) {
        const isXhtml = item.mediaType.includes('xhtml') || /\.(xhtml|html|htm)$/i.test(item.href);

        if (!isXhtml) {
            continue;
        }

        const fullPath = joinPath(opfDir, item.href);

        if (seenChapterPaths.has(fullPath)) {
            continue;
        }

        const data = files.get(fullPath);
        if (!data) {
            continue;
        }

        seenChapterPaths.add(fullPath);

        const id = 'ch-' + (chapters.length + 1);
        const rawHtml = data.toString('utf-8');

        chapters.push({
            id,
            file: id + '.xhtml',
            href: fullPath,
            title: tocTitles.get(fullPath) || extractChapterTitle(rawHtml) || `Capítulo ${chapters.length + 1}`,
            bodyHtml: extractBody(rawHtml)
        });
    }

    // ---------- Imagens, CSS, fontes e capa ----------

    const images = [];
    const cssFiles = [];
    const fonts = [];
    let coverEntry = null;

    for (const item of items) {
        const fullPath = joinPath(opfDir, item.href);
        const data = files.get(fullPath);

        if (!data) {
            continue;
        }

        const ext = path.extname(fullPath).toLowerCase();
        const isCover = item.properties.includes('cover-image') || (coverMetaId && item.id === coverMetaId);

        if (item.mediaType.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) {
            if (isCover && !coverEntry && isAllowedCoverExtension(fullPath)) {
                coverEntry = { file: 'capa' + ext, data };
            }

            images.push({ href: fullPath, ext: ext || '.png', data });
        } else if (item.mediaType === 'text/css' || ext === '.css') {
            cssFiles.push({ href: fullPath, data: data.toString('utf-8') });
        } else if (FONT_EXTENSIONS.includes(ext) || item.mediaType.includes('font') || item.mediaType.includes('opentype')) {
            fonts.push({ href: fullPath, ext, data });
        }
    }

    // ---------- Nomes finais dentro do projeto + mapa de reescrita ----------

    const lookup = new Map();

    images.forEach((img, index) => {
        const file = `img-${index + 1}${img.ext}`;
        img.file = file;
        lookup.set(img.href, { kind: 'image', file });
    });

    const usedCssNames = new Set();

    cssFiles.forEach((css) => {
        let name = sanitizeCssFileName(basenamePath(css.href));
        let candidate = name;
        let number = 2;

        while (usedCssNames.has(candidate.toLowerCase())) {
            candidate = name.replace(/\.css$/i, '') + '-' + number + '.css';
            number += 1;
        }

        usedCssNames.add(candidate.toLowerCase());
        css.file = candidate;
        lookup.set(css.href, { kind: 'css', file: candidate });
    });

    fonts.forEach((font) => {
        const file = sanitizeFolderName(basenamePath(font.href));
        font.file = file;
        lookup.set(font.href, { kind: 'font', file });
    });

    // Reescreve src/href de cada capítulo para a estrutura do app
    // (chapters/ ../images/... ../styles/... ../fonts/...)
    function rewriteHtmlReferences(html, baseDir) {
        return html.replace(
            /(\b(?:src|href|xlink:href)=)(["'])([^"']+)\2/gi,
            (entire, prefix, quote, value) => {
                if (/^(#|https?:|data:|mailto:|file:|javascript:|blob:)/i.test(value)) {
                    return entire;
                }

                const cleanValue = value.split('#')[0];
                const resolved = joinPath(baseDir, normalizeZipPath(safeDecodeURIComponent(cleanValue)));
                const entry = lookup.get(resolved);

                if (!entry) {
                    return entire;
                }

                const target = entry.kind === 'image'
                    ? `../images/${entry.file}`
                    : entry.kind === 'css'
                        ? `../styles/${entry.file}`
                        : `../fonts/${entry.file}`;

                return `${prefix}${quote}${target}${quote}`;
            }
        );
    }

    for (const chapter of chapters) {
        chapter.bodyHtml = rewriteHtmlReferences(chapter.bodyHtml, dirnamePath(chapter.href));
    }

    // Idem para url(...) dentro das folhas de estilo
    for (const css of cssFiles) {
        css.content = css.data.replace(
            /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
            (entire, quote, value) => {
                const trimmed = value.trim();

                if (/^(https?:|data:|#)/i.test(trimmed)) {
                    return entire;
                }

                const resolved = joinPath(dirnamePath(css.href), normalizeZipPath(safeDecodeURIComponent(trimmed)));
                const entry = lookup.get(resolved);

                if (!entry) {
                    return entire;
                }

                const target = entry.kind === 'image'
                    ? `../images/${entry.file}`
                    : entry.kind === 'font'
                        ? `../fonts/${entry.file}`
                        : `../styles/${entry.file}`;

                return `url(${quote}${target}${quote})`;
            }
        );
    }

    return {
        title,
        author,
        language,
        description,
        chapters,
        images,
        cssFiles,
        fonts,
        cover: coverEntry
    };
}

// ---------- Gravação do projeto ----------

// Descompacta o .epub dentro de projectDir já no formato de projeto
// do editor (project.json, chapters/manifest.json, images/manifest.json...).
async function importEpubIntoProject(epubPath, projectDir, overrides) {
    const parsed = await parseEpub(epubPath);

    const title = String(overrides.title || '').trim() || parsed.title || 'Sem título';
    const author = String(overrides.author || '').trim() || parsed.author || '';
    const language = overrides.language || parsed.language || 'pt-BR';
    const description = String(overrides.description || '').trim() || parsed.description || '';

    await fs.mkdir(projectDir, { recursive: true });
    await Promise.all(
        ['chapters', 'images', 'styles', 'fonts'].map(sub =>
            fs.mkdir(path.join(projectDir, sub), { recursive: true })
        )
    );

    // Capa: a escolhida pelo usuário no modal tem prioridade; senão,
    // usa a capa declarada no .epub.
    let coverFileName = null;

    if (overrides.coverPath && fsSync.existsSync(overrides.coverPath) && isAllowedCoverExtension(overrides.coverPath)) {
        const ext = path.extname(overrides.coverPath).toLowerCase();
        coverFileName = `capa${ext}`;
        await fs.copyFile(overrides.coverPath, path.join(projectDir, coverFileName));
    } else if (parsed.cover) {
        coverFileName = parsed.cover.file;
        await fs.writeFile(path.join(projectDir, coverFileName), parsed.cover.data);
    }

    // Capítulos
    const chapterManifest = [];

    for (const chapter of parsed.chapters) {
        const bodyHtml = closeVoidTags(sanitizeEntitiesForXml(chapter.bodyHtml));

        const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
${bodyHtml}
</body>
</html>
`;

        await fs.writeFile(path.join(projectDir, 'chapters', chapter.file), xhtml, 'utf-8');

        chapterManifest.push({
            id: chapter.id,
            title: chapter.title,
            file: chapter.file,
            order: chapterManifest.length + 1
        });
    }

    // Sem capítulos no epub, cria um capítulo vazio para o editor
    if (chapterManifest.length === 0) {
        const emptyXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}">
<head><meta charset="utf-8" /><title>Capítulo 1</title></head>
<body></body>
</html>
`;

        await fs.writeFile(path.join(projectDir, 'chapters', 'ch-1.xhtml'), emptyXhtml, 'utf-8');
        chapterManifest.push({ id: 'ch-1', title: 'Capítulo 1', file: 'ch-1.xhtml', order: 1 });
    }

    await writeJSON(path.join(projectDir, 'chapters', 'manifest.json'), chapterManifest);

    // Imagens
    const imageManifest = [];

    for (const img of parsed.images) {
        await fs.writeFile(path.join(projectDir, 'images', img.file), img.data);
        imageManifest.push({
            id: img.file.replace(/\.[^.]+$/, ''),
            originalName: basenamePath(img.href),
            file: img.file
        });
    }

    await writeJSON(path.join(projectDir, 'images', 'manifest.json'), imageManifest);

    // Folhas de estilo
    if (parsed.cssFiles.length === 0) {
        await fs.writeFile(path.join(projectDir, 'styles', 'stylesheet.css'), '', 'utf-8');
    } else {
        for (const css of parsed.cssFiles) {
            await fs.writeFile(path.join(projectDir, 'styles', css.file), css.content, 'utf-8');
        }

        const hasStylesheet = parsed.cssFiles.some(css => css.file.toLowerCase() === 'stylesheet.css');

        if (!hasStylesheet) {
            await fs.writeFile(path.join(projectDir, 'styles', 'stylesheet.css'), '', 'utf-8');
        }
    }

    // Fontes
    for (const font of parsed.fonts) {
        await fs.writeFile(path.join(projectDir, 'fonts', font.file), font.data);
    }

    const projectData = {
        title,
        author,
        language,
        description,
        cover: coverFileName,
        appVersion: packageJson.version || '',
        createdAt: new Date().toISOString(),
        chapters: chapterManifest
    };

    await writeJSON(path.join(projectDir, 'project.json'), projectData);
}

module.exports = { parseEpub, importEpubIntoProject };
