const fs = require('fs/promises');
const fsSync = require('fs');

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

module.exports = {
    closeVoidTags,
    readJSONSafe,
    readJSONSafeSync,
    sanitizeEntitiesForXml,
    sanitizeFolderName,
    writeJSON
};
