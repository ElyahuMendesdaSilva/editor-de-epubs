(function () {
    'use strict';

    /* =========================================================
       1. CONFIGURAÇÃO
    ========================================================= */

    const DEFAULT_HTML = `
<h1>Capítulo 1 — O Começo</h1>
<p>Escreva o conteúdo do seu <strong>eBook</strong> aqui, formatando com a barra de ferramentas. Nenhuma tag aparece na tela — só o efeito visual, como num editor de texto comum.</p>
<h2>Uma seção</h2>
<p>Você pode citar trechos:</p>
<blockquote><p>"A simplicidade é o último grau de sofisticação."</p></blockquote>
<ul>
    <li>Suporte a listas</li>
    <li>Imagens e links</li>
    <li>Quebras de página entre capítulos</li>
</ul>
<p>Saiba mais na <a href="https://www.w3.org/publishing/epub3/">especificação ePub</a>.</p>
`.trim();


    /* =========================================================
       2. REFERÊNCIAS DOM
    ========================================================= */

    const editor = document.getElementById('editor');
    const codeOutput = document.getElementById('codeOutput');

    const wordCount = document.getElementById('wordCount');
    const charCount = document.getElementById('charCount');

    const downloadBtn = document.getElementById('downloadBtn');

    const divider = document.getElementById('divider');
    const editorPane = document.getElementById('editorPane');
    const workspace = document.querySelector('.workspace');

    const blockStyle = document.getElementById('blockStyle');

    const fontSelect = document.querySelector('.font-select');
    const sizeSelect = document.querySelector('.size-select');

    const copyBtn = document.querySelector('.copy-btn');

    const backToDashboardBtn = document.getElementById('backToDashboardBtn');
    const editCodeBtn = document.getElementById('editCodeBtn');
    const saveCodeBtn = document.getElementById('saveCodeBtn');

    const saveStatus = document.querySelector('.save-status');

    const zoomButtons = document.querySelectorAll('.zoom-btn');
    const zoomTrack = document.querySelector('.zoom-track span');

    const chapterListEl = document.getElementById('chapterList');
    const addChapterBtn = document.getElementById('addChapterBtn');
    const documentInfoEl = document.querySelector('.document-info');
    const brandSubtitleEl = document.querySelector('.brand-info span');
    const brandTitleEl = document.getElementById('brandProjectTitle');

    const imageStyleListEl = document.getElementById('imageStyleList');
    const imageStyleEmptyEl = document.getElementById('imageStyleEmpty');
    const cssEditorEl = document.getElementById('cssEditor');
    const cssEditorLabelEl = document.getElementById('cssEditorLabel');


    /* =========================================================
       3. ESTADO
    ========================================================= */

    let isDragging = false;

    let currentZoom = 100;

    let saveTimeout = null;

    const ZOOM_MIN = 70;
    const ZOOM_MAX = 140;
    const ZOOM_STEP = 10;

    // Caminho da pasta do projeto atual, recebido pela URL (ex: ?project=C:\...\MeuLivro)
    // Sem isso, não há onde salvar — o editor continua funcionando, só sem autosave.
    const projectPath = new URLSearchParams(window.location.search).get('project');

    let autosaveTimeout = null;

    // Painel de CSS por imagem: null = editando a folha de estilo geral
    // do livro; caso contrário, guarda o id da imagem selecionada na
    // lista e o texto editado se refere só àquela imagem.
    let selectedImageId = null;
    let cssSaveTimeout = null;
    let knownImages = [];

    // Edição direta do XHTML no painel "Código gerado". Enquanto
    // isEditingCode for true, o clique fora do bloco de código (e fora
    // do botão de salvar) descarta as alterações e volta ao ícone de
    // lápis, sem tocar no conteúdo do editor.
    let isEditingCode = false;

    // Capítulos: cada um guarda seu próprio HTML. O editor sempre mostra
    // o conteúdo do capítulo ativo; trocar de capítulo salva o atual antes.
    let chapters = [
        { id: 'ch-1', title: 'Capítulo 1', html: DEFAULT_HTML }
    ];

    let activeChapterId = chapters[0].id;


    /* =========================================================
       3-B. CAMINHOS DE IMAGEM (absoluto p/ tela x relativo p/ disco)
       -------------------------------------------------------
       O HTML salvo em disco (e exportado no .xhtml) sempre usa o
       caminho relativo "../images/arquivo.jpg", que é o correto
       dentro da estrutura do eBook (chapters/ e images/ são pastas
       irmãs). Só que essa mesma string não serve para EXIBIR a
       imagem aqui dentro do editor.html, porque este arquivo não
       mora dentro da pasta do projeto (ele fica nos arquivos do
       próprio app, em outra pasta). Por isso, ao mostrar o
       conteúdo na tela convertemos para uma URL file:// absoluta
       apontando para a pasta images/ do projeto de verdade; e ao
       salvar/exportar convertemos de volta para o caminho
       relativo, que é o que precisa ir para o disco/epub.
    ========================================================= */

    function toFileUrl(absolutePath) {

        let normalized = absolutePath.replace(/\\/g, '/');

        if (!normalized.startsWith('/')) {
            normalized = '/' + normalized;
        }

        return 'file://' + encodeURI(normalized);
    }


    function getProjectImagesDirUrl() {

        if (!projectPath) {
            return null;
        }

        const normalizedProjectPath = projectPath.replace(/\\/g, '/');

        return toFileUrl(normalizedProjectPath + '/images') + '/';
    }


    // Usado ao carregar/exibir conteúdo já salvo: ../images/x.jpg -> file:///.../images/x.jpg
    function relativeToAbsoluteImages(html) {

        const imagesDirUrl = getProjectImagesDirUrl();

        if (!imagesDirUrl || !html) {
            return html;
        }

        return html.replace(
            /src="\.\.\/images\/([^"]+)"/g,
            (match, fileName) => `src="${imagesDirUrl}${encodeURIComponent(decodeURIComponent(fileName))}"`
        );
    }


    // Usado antes de salvar/exportar: file:///.../images/x.jpg -> ../images/x.jpg
    function absoluteToRelativeImages(html) {

        const imagesDirUrl = getProjectImagesDirUrl();

        if (!imagesDirUrl || !html) {
            return html;
        }

        const escapedPrefix = imagesDirUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        return html.replace(
            new RegExp('src="' + escapedPrefix + '([^"]+)"', 'g'),
            (match, fileName) => `src="../images/${decodeURIComponent(fileName)}"`
        );
    }


    /* =========================================================
       4. CONFIGURAÇÃO DO EDITOR
    ========================================================= */

    // Enter cria <p> automaticamente.
    document.execCommand(
        'defaultParagraphSeparator',
        false,
        'p'
    );


    /* =========================================================
       5. UTILITÁRIOS
    ========================================================= */

    function getSelectionNode() {

        const selection = window.getSelection();

        if (!selection.rangeCount) {
            return null;
        }

        let node = selection.anchorNode;

        if (node && node.nodeType === Node.TEXT_NODE) {
            node = node.parentElement;
        }

        return node;
    }


    function isSelectionInsideEditor() {

        const selection = window.getSelection();

        if (!selection.rangeCount) {
            return false;
        }

        return editor.contains(selection.anchorNode);
    }


    function restoreEditorFocus() {

        editor.focus();
    }


    function setCaretAfter(node) {

        const selection = window.getSelection();

        const range = document.createRange();

        range.setStartAfter(node);

        range.collapse(true);

        selection.removeAllRanges();

        selection.addRange(range);
    }


    /* =========================================================
       6-B. CAPÍTULOS (BARRA LATERAL)
    ========================================================= */

    function getActiveChapter() {

        return chapters.find(
            chapter => chapter.id === activeChapterId
        );
    }


    function generateChapterId() {

        return 'ch-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    }


    function escapeHtmlText(text) {

        const div = document.createElement('div');

        div.textContent = text;

        return div.innerHTML;
    }


    // Guarda o conteúdo atual do editor no capítulo ativo, antes de trocar
    function saveActiveChapterContent() {

        const chapter = getActiveChapter();

        if (chapter) {
            chapter.html = cleanHTML();

            // Ao trocar/criar/excluir capítulo é um bom momento para gravar
            // no disco imediatamente (sem esperar o debounce do autosave)
            persistChapter(chapter);
        }
    }


    // ---------- Persistência em disco ----------

    async function persistChapter(chapter) {

        if (!projectPath || !chapter) {
            return;
        }

        const order = chapters.findIndex(
            item => item.id === chapter.id
        );

        const result = await window.electronAPI.salvarCapitulo({
            projectPath,
            chapterId: chapter.id,
            title: chapter.title,
            html: chapter.html,
            order
        });

        if (!result || !result.success) {
            console.error('Erro ao salvar capítulo:', result && result.error);
        }
    }


    function scheduleAutosave() {

        if (!projectPath) {
            return;
        }

        clearTimeout(autosaveTimeout);

        autosaveTimeout = setTimeout(() => {

            const chapter = getActiveChapter();

            if (chapter) {
                chapter.html = cleanHTML();
                persistChapter(chapter);
            }

        }, 800);
    }


    async function deleteChapterFromDisk(chapterId) {

        if (!projectPath) {
            return;
        }

        const result = await window.electronAPI.excluirCapitulo({
            projectPath,
            chapterId
        });

        if (!result || !result.success) {
            console.error('Erro ao excluir capítulo do disco:', result && result.error);
        }
    }


    function updateChapterHeaderLabels() {

        const chapter = getActiveChapter();

        if (!chapter) {
            return;
        }

        if (documentInfoEl) {
            documentInfoEl.textContent = chapter.title;
        }

        if (brandSubtitleEl) {
            brandSubtitleEl.textContent = chapter.title;
        }
    }


    function loadChapter(id) {

        if (id === activeChapterId) {
            return;
        }

        saveActiveChapterContent();

        activeChapterId = id;

        const chapter = getActiveChapter();

        editor.innerHTML = chapter ? relativeToAbsoluteImages(chapter.html) : '';

        syncOutput();

        renderChapterList();

        updateChapterHeaderLabels();
    }


    function addChapter() {

        saveActiveChapterContent();

        const number = chapters.length + 1;

        const newChapter = {
            id: generateChapterId(),
            title: `Capítulo ${number}`,
            html: `<h1>Capítulo ${number}</h1>\n<p>Comece a escrever...</p>`
        };

        chapters.push(newChapter);

        activeChapterId = newChapter.id;

        editor.innerHTML = newChapter.html;

        syncOutput();

        renderChapterList();

        updateChapterHeaderLabels();
    }


    function deleteChapter(id) {

        // Mantém sempre ao menos 1 capítulo
        if (chapters.length <= 1) {
            return;
        }

        const index = chapters.findIndex(
            chapter => chapter.id === id
        );

        if (index === -1) {
            return;
        }

        chapters.splice(index, 1);

        deleteChapterFromDisk(id);

        if (activeChapterId === id) {

            const nextIndex = Math.max(0, index - 1);

            activeChapterId = chapters[nextIndex].id;

            editor.innerHTML = relativeToAbsoluteImages(chapters[nextIndex].html);

            syncOutput();

            updateChapterHeaderLabels();
        }

        renderChapterList();
    }


    function renameChapter(id, newTitle) {

        const chapter = chapters.find(
            chapter => chapter.id === id
        );

        if (chapter && newTitle.trim()) {
            chapter.title = newTitle.trim();
            persistChapter(chapter);
        }

        renderChapterList();

        updateChapterHeaderLabels();
    }


    function startRename(itemEl, chapter) {

        const nameSpan = itemEl.querySelector('.chapter-name');

        const input = document.createElement('input');

        input.type = 'text';
        input.className = 'chapter-name-input';
        input.value = chapter.title;

        nameSpan.replaceWith(input);

        input.focus();
        input.select();

        function commit() {
            renameChapter(chapter.id, input.value);
        }

        input.addEventListener('blur', commit);

        input.addEventListener('keydown', event => {

            if (event.key === 'Enter') {
                event.preventDefault();
                input.blur();
            }

            if (event.key === 'Escape') {
                input.value = chapter.title;
                input.blur();
            }
        });
    }


    function renderChapterList() {

        if (!chapterListEl) {
            return;
        }

        chapterListEl.innerHTML = '';

        chapters.forEach(chapter => {

            const item = document.createElement('div');

            item.className = 'chapter-item' +
                (chapter.id === activeChapterId ? ' active' : '');

            item.dataset.id = chapter.id;

            item.innerHTML = `
                <svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4"/></svg>
                <span class="chapter-name">${escapeHtmlText(chapter.title)}</span>
                <button class="chapter-delete" type="button" title="Excluir capítulo">
                    <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
                </button>
            `;

            item.addEventListener('click', event => {

                if (event.target.closest('.chapter-delete')) {
                    return;
                }

                loadChapter(chapter.id);
            });

            item.addEventListener('dblclick', event => {

                if (event.target.closest('.chapter-delete')) {
                    return;
                }

                startRename(item, chapter);
            });

            const deleteBtn = item.querySelector('.chapter-delete');

            deleteBtn.addEventListener('click', event => {
                event.stopPropagation();
                deleteChapter(chapter.id);
            });

            chapterListEl.appendChild(item);
        });
    }


    function setupChapterSidebar() {

        if (addChapterBtn) {

            addChapterBtn.addEventListener(
                'click',
                addChapter
            );
        }

        renderChapterList();

        updateChapterHeaderLabels();
    }


    /* =========================================================
       6-C. PAINEL DE CSS POR IMAGEM
       -------------------------------------------------------
       Lista as imagens já adicionadas ao projeto. Clicar em uma
       delas abre, no texteditor abaixo, o CSS específico daquela
       imagem (guardado em styles/<id-da-imagem>.css); qualquer
       edição é salva automaticamente ali. Sem nenhuma imagem
       selecionada, o texteditor mostra e edita a folha de estilo
       geral do livro (styles/stylesheet.css).
    ========================================================= */

    function renderImageStyleList() {

        if (!imageStyleListEl) {
            return;
        }

        imageStyleListEl.querySelectorAll('.image-style-item').forEach(
            item => item.remove()
        );

        if (imageStyleEmptyEl) {
            imageStyleEmptyEl.hidden = knownImages.length > 0;
        }

        const imagesDirUrl = getProjectImagesDirUrl();

        knownImages.forEach(imageInfo => {

            const item = document.createElement('div');

            item.className = 'image-style-item' +
                (imageInfo.id === selectedImageId ? ' active' : '');

            item.title = imageInfo.originalName || '';
            item.dataset.id = imageInfo.id;

            const thumb = document.createElement('img');

            thumb.src = imagesDirUrl
                ? `${imagesDirUrl}${encodeURIComponent(imageInfo.file)}`
                : '';

            thumb.alt = imageInfo.originalName || '';

            item.appendChild(thumb);

            item.addEventListener('click', () => {

                // Clicar de novo na imagem já selecionada volta para a
                // folha de estilo geral do livro.
                if (selectedImageId === imageInfo.id) {
                    selectImageForCss(null);
                } else {
                    selectImageForCss(imageInfo.id);
                }
            });

            imageStyleListEl.appendChild(item);
        });
    }


    async function loadImagesList() {

        if (!projectPath || !window.electronAPI || !window.electronAPI.listarImagens) {
            return;
        }

        const result = await window.electronAPI.listarImagens(projectPath);

        knownImages = (result && result.success) ? (result.images || []) : [];

        renderImageStyleList();
    }


    async function loadCssFor(imageId) {

        if (!projectPath || !cssEditorEl || !window.electronAPI || !window.electronAPI.lerCSS) {
            return;
        }

        const result = await window.electronAPI.lerCSS({
            projectPath,
            target: imageId || 'global'
        });

        cssEditorEl.value = (result && result.success) ? (result.content || '') : '';

        if (cssEditorLabelEl) {

            if (imageId) {

                const image = knownImages.find(item => item.id === imageId);

                cssEditorLabelEl.textContent =
                    'CSS da imagem: ' + (image ? image.originalName : imageId);

            } else {

                cssEditorLabelEl.textContent = 'CSS da folha de estilo';
            }
        }
    }


    function selectImageForCss(imageId) {

        selectedImageId = imageId;

        renderImageStyleList();

        loadCssFor(imageId);
    }


    function scheduleCssSave() {

        if (!projectPath || !window.electronAPI || !window.electronAPI.salvarCSS) {
            return;
        }

        clearTimeout(cssSaveTimeout);

        cssSaveTimeout = setTimeout(() => {

            window.electronAPI.salvarCSS({
                projectPath,
                target: selectedImageId || 'global',
                content: cssEditorEl.value
            }).then(result => {

                if (!result || !result.success) {
                    console.error('Erro ao salvar CSS:', result && result.error);
                }
            });

        }, 600);
    }


    function setupCssEditorPanel() {

        if (!cssEditorEl) {
            return;
        }

        cssEditorEl.addEventListener('input', scheduleCssSave);
    }


    /* =========================================================
       6. LIMPEZA DO HTML
    ========================================================= */

    function cleanHTML() {

        let html = editor.innerHTML;

        // Remove divs vazias geradas pelo navegador.
        html = html.replace(
            /<div><br><\/div>/g,
            ''
        );

        // Converte divs comuns em parágrafos.
        html = html.replace(
            /<div>/g,
            '<p>'
        );

        html = html.replace(
            /<\/div>/g,
            '</p>'
        );

        // Sempre devolve o HTML "portável", com caminhos relativos de
        // imagem (../images/arquivo.jpg) em vez das URLs file:// usadas
        // só para exibição em tela — é essa versão que vai para o
        // disco, para o project.json e para o .xhtml exportado.
        html = absoluteToRelativeImages(html);

        return html.trim();
    }


    /* =========================================================
       7. FORMATAÇÃO DO CÓDIGO XHTML
    ========================================================= */

    function escapeForDisplay(line) {

        return line

            .replace(
                /&/g,
                '&amp;'
            )

            .replace(
                /</g,
                '&lt;'
            )

            .replace(
                />/g,
                '&gt;'
            )

            .replace(
                /&lt;(\/?)([a-zA-Z0-9]+)/g,
                '&lt;$1<span class="tag">$2</span>'
            )

            .replace(
                /([a-zA-Z-]+)=&quot;/g,
                '<span class="attr">$1</span>=&quot;'
            );
    }


    function formatHTML(html) {

        if (!html) {
            return '';
        }

        // Cria quebras de linha entre tags.
        html = html.replace(
            />\s*</g,
            '>\n<'
        );

        const lines = html.split('\n');

        let indent = 0;

        const closingTag = /^<\/\w/;

        const selfClosingTag =
            /^<(hr|img|br)[\s>]/i;

        const openingTag =
            /^<\w[^>]*[^/]>\s*$/;

        return lines

            .map(line => {

                line = line.trim();

                if (!line) {
                    return '';
                }

                if (closingTag.test(line)) {
                    indent = Math.max(
                        0,
                        indent - 1
                    );
                }

                const output =
                    '  '.repeat(indent) +
                    escapeForDisplay(line);

                if (
                    openingTag.test(line) &&
                    !selfClosingTag.test(line)
                ) {
                    indent++;
                }

                return output;
            })

            .filter(Boolean)

            .join('\n');
    }


    // Mesma indentação de formatHTML(), mas sem os spans de realce de
    // sintaxe e sem escapar entidades — é o texto "cru" que o usuário
    // efetivamente edita dentro do bloco de código.
    function formatHTMLPlain(html) {

        if (!html) {
            return '';
        }

        html = html.replace(
            />\s*</g,
            '>\n<'
        );

        const lines = html.split('\n');

        let indent = 0;

        const closingTag = /^<\/\w/;

        const selfClosingTag =
            /^<(hr|img|br)[\s>]/i;

        const openingTag =
            /^<\w[^>]*[^/]>\s*$/;

        return lines

            .map(line => {

                line = line.trim();

                if (!line) {
                    return '';
                }

                if (closingTag.test(line)) {
                    indent = Math.max(
                        0,
                        indent - 1
                    );
                }

                const output =
                    '  '.repeat(indent) + line;

                if (
                    openingTag.test(line) &&
                    !selfClosingTag.test(line)
                ) {
                    indent++;
                }

                return output;
            })

            .filter(Boolean)

            .join('\n');
    }


    /* =========================================================
       8. CONTADORES
    ========================================================= */

    function updateCounters() {

        const plainText =
            editor.innerText.trim();

        const words = plainText
            ? plainText.split(/\s+/).length
            : 0;

        const characters =
            plainText.length;

        wordCount.textContent = words;

        charCount.textContent = characters;
    }


    /* =========================================================
       9. STATUS DE SALVAMENTO
    ========================================================= */

    function updateSaveStatus() {

        if (!saveStatus) {
            return;
        }

        saveStatus.innerHTML = `
            <span class="save-dot"></span>
            Salvando...
        `;

        clearTimeout(saveTimeout);

        saveTimeout = setTimeout(() => {

            saveStatus.innerHTML = `
                <span class="save-dot"></span>
                Salvo
            `;

        }, 500);
    }


    /* =========================================================
       10. SINCRONIZAÇÃO PRINCIPAL
    ========================================================= */

    function syncOutput() {

        const html = cleanHTML();

        codeOutput.innerHTML =
            formatHTML(html);

        updateCounters();

        updateSaveStatus();

        updateToolbarState();

        scheduleAutosave();
    }


    /* =========================================================
       11. FORMATAÇÃO DE BLOCOS
    ========================================================= */

    function formatBlock(tag) {

        restoreEditorFocus();

        document.execCommand(
            'formatBlock',
            false,
            tag
        );

        syncOutput();
    }


    /* =========================================================
       12. FORMATAÇÃO INLINE
    ========================================================= */

    function toggleInlineCommand(command) {

        restoreEditorFocus();

        document.execCommand(
            command,
            false,
            null
        );

        syncOutput();

        updateToolbarState();
    }


    /* =========================================================
       13. INSERÇÃO DE LINK
    ========================================================= */

    function insertLink() {

        if (!isSelectionInsideEditor()) {

            restoreEditorFocus();

            return;
        }

        const selection =
            window.getSelection();

        const selectedText =
            selection.toString();

        const url = prompt(
            'Digite o endereço do link:',
            'https://'
        );

        if (!url) {
            return;
        }

        if (selectedText) {

            document.execCommand(
                'createLink',
                false,
                url
            );

        } else {

            const link =
                document.createElement('a');

            link.href = url;

            link.textContent =
                'texto do link';

            const range =
                selection.getRangeAt(0);

            range.insertNode(link);

            setCaretAfter(link);
        }

        syncOutput();
    }


    /* =========================================================
       14. INSERÇÃO DE IMAGEM
    ========================================================= */

    async function insertImage() {

        if (!projectPath) {
            alert('Crie ou abra um projeto antes de inserir imagens.');
            return;
        }

        const imagePaths = await window.electronAPI.selecionarImagens();

        if (!imagePaths || imagePaths.length === 0) {
            return;
        }

        const result = await window.electronAPI.copiarImagens({
            projectPath,
            imagePaths
        });

        if (!result || !result.success) {
            alert('Não foi possível copiar as imagens: ' + (result && result.error));
            return;
        }

        const imagesDirUrl = getProjectImagesDirUrl();

        result.images.forEach(imageInfo => {

            const image =
                document.createElement('img');

            // Na tela usamos o caminho absoluto (file://) para a imagem
            // aparecer de fato, não importa em que pasta o app esteja
            // rodando. O caminho relativo "../images/arquivo.jpg" (o
            // correto para o .xhtml exportado) é reconstituído
            // automaticamente na hora de salvar/exportar — ver
            // absoluteToRelativeImages().
            image.src = imagesDirUrl
                ? `${imagesDirUrl}${encodeURIComponent(imageInfo.file)}`
                : `../images/${imageInfo.file}`;

            image.alt = imageInfo.originalName;
            image.dataset.imgId = imageInfo.id;

            insertNodeAtCursor(image);
        });

        // Atualiza a lista do painel lateral de CSS por imagem, para as
        // imagens recém-adicionadas aparecerem lá imediatamente.
        loadImagesList();
    }


    /* =========================================================
       15. INSERIR ELEMENTO NO CURSOR
    ========================================================= */

    function insertNodeAtCursor(node) {

        const selection =
            window.getSelection();

        if (
            !selection.rangeCount ||
            !editor.contains(selection.anchorNode)
        ) {

            editor.appendChild(node);

        } else {

            const range =
                selection.getRangeAt(0);

            range.deleteContents();

            range.insertNode(node);

            setCaretAfter(node);
        }

        restoreEditorFocus();

        syncOutput();
    }


    /* =========================================================
       16. LISTAS
    ========================================================= */

    function insertList(type) {

        restoreEditorFocus();

        const command =
            type === 'ul'
                ? 'insertUnorderedList'
                : 'insertOrderedList';

        document.execCommand(
            command,
            false,
            null
        );

        syncOutput();
    }


    /* =========================================================
       17. QUEBRA DE PÁGINA
    ========================================================= */

    function insertPageBreak() {

        const pageBreak =
            document.createElement('hr');

        pageBreak.className =
            'page-break';

        insertNodeAtCursor(
            pageBreak
        );
    }


    /* =========================================================
       18. DESFAZER / REFAZER
    ========================================================= */

    function undo() {

        restoreEditorFocus();

        document.execCommand(
            'undo'
        );

        syncOutput();
    }


    function redo() {

        restoreEditorFocus();

        document.execCommand(
            'redo'
        );

        syncOutput();
    }


    /* =========================================================
       19. FONTE
    ========================================================= */

    function changeFont(font) {

        if (!font) {
            return;
        }

        restoreEditorFocus();

        document.execCommand(
            'fontName',
            false,
            font
        );

        syncOutput();
    }


    /* =========================================================
       20. TAMANHO DA FONTE
    ========================================================= */

    function changeFontSize(size) {

        if (!size) {
            return;
        }

        restoreEditorFocus();

        /*
         * execCommand usa valores de 1 a 7.
         * Fazemos uma conversão aproximada
         * para os tamanhos apresentados na interface.
         */

        const sizeMap = {
            12: '2',
            14: '3',
            16: '3',
            18: '4',
            20: '4',
            24: '5',
            32: '6'
        };

        const commandSize =
            sizeMap[size] || '3';

        document.execCommand(
            'fontSize',
            false,
            commandSize
        );

        /*
         * O CSS pode controlar a aparência final.
         * O editor continua mantendo a estrutura HTML.
         */

        syncOutput();
    }


    /* =========================================================
       21. ALINHAMENTO
    ========================================================= */

    function changeAlignment(alignment) {

        restoreEditorFocus();

        const commands = {

            left:
                'justifyLeft',

            center:
                'justifyCenter',

            right:
                'justifyRight',

            justify:
                'justifyFull'
        };

        const command =
            commands[alignment];

        if (!command) {
            return;
        }

        document.execCommand(
            command,
            false,
            null
        );

        syncOutput();
    }


    /* =========================================================
       22. AÇÕES PRINCIPAIS
    ========================================================= */

    const actions = {

        h1: () =>
            formatBlock('H1'),

        h2: () =>
            formatBlock('H2'),

        p: () =>
            formatBlock('P'),

        quote: () =>
            formatBlock('BLOCKQUOTE'),

        bold: () =>
            toggleInlineCommand('bold'),

        italic: () =>
            toggleInlineCommand('italic'),

        strike: () =>
            toggleInlineCommand('strikeThrough'),

        ul: () =>
            insertList('ul'),

        ol: () =>
            insertList('ol'),

        link: () =>
            insertLink(),

        image: () =>
            insertImage(),

        pagebreak: () =>
            insertPageBreak(),

        undo: () =>
            undo(),

        redo: () =>
            redo(),

        alignLeft: () =>
            changeAlignment('left'),

        alignCenter: () =>
            changeAlignment('center'),

        alignRight: () =>
            changeAlignment('right'),

        justify: () =>
            changeAlignment('justify')
    };


    /* =========================================================
       23. BOTÕES DA TOOLBAR
    ========================================================= */

    function setupToolbarButtons() {

        const buttons =
            document.querySelectorAll(
                '.tool-btn[data-action], .tb-btn[data-action]'
            );

        buttons.forEach(button => {

            const action =
                button.dataset.action;

            if (!actions[action]) {
                return;
            }

            /*
             * mousedown evita que o clique
             * faça o editor perder a seleção.
             */

            button.addEventListener(
                'mousedown',
                event => {
                    event.preventDefault();
                }
            );

            button.addEventListener(
                'click',
                event => {

                    event.preventDefault();

                    actions[action]();
                }
            );
        });
    }


    /* =========================================================
       24. SELETOR DE ESTILO
    ========================================================= */

    function setupBlockStyle() {

        if (!blockStyle) {
            return;
        }

        blockStyle.addEventListener(
            'change',
            () => {

                const value =
                    blockStyle.value;

                const tags = {

                    p: 'P',

                    h1: 'H1',

                    h2: 'H2',

                    blockquote:
                        'BLOCKQUOTE'
                };

                if (tags[value]) {

                    formatBlock(
                        tags[value]
                    );
                }
            }
        );
    }


    /* =========================================================
       25. SELETOR DE FONTE
    ========================================================= */

    function setupFontSelector() {

        if (!fontSelect) {
            return;
        }

        fontSelect.addEventListener(
            'change',
            () => {

                changeFont(
                    fontSelect.value
                );
            }
        );
    }


    /* =========================================================
       26. SELETOR DE TAMANHO
    ========================================================= */

    function setupSizeSelector() {

        if (!sizeSelect) {
            return;
        }

        sizeSelect.addEventListener(
            'change',
            () => {

                changeFontSize(
                    sizeSelect.value
                );
            }
        );
    }


    /* =========================================================
       27. ESTADO DOS BOTÕES
    ========================================================= */

    function updateToolbarState() {

        const selection =
            window.getSelection();

        if (!selection.rangeCount) {
            return;
        }

        let node =
            selection.anchorNode;

        if (
            node &&
            node.nodeType === Node.TEXT_NODE
        ) {
            node =
                node.parentElement;
        }

        const activeTags =
            new Set();

        let current =
            node;

        while (
            current &&
            current !== editor
        ) {

            if (current.tagName) {

                activeTags.add(
                    current.tagName
                );
            }

            current =
                current.parentElement;
        }


        /*
         * Remove estados anteriores.
         */

        document
            .querySelectorAll(
                '.tool-btn[data-action], .tb-btn[data-action]'
            )
            .forEach(button => {

                button.classList.remove(
                    'active'
                );
            });


        /*
         * Mapeia tags HTML para ações.
         */

        const tagMap = {

            STRONG:
                'bold',

            B:
                'bold',

            EM:
                'italic',

            I:
                'italic',

            S:
                'strike',

            STRIKE:
                'strike',

            CODE:
                'code',

            A:
                'link',

            H1:
                'h1',

            H2:
                'h2',

            BLOCKQUOTE:
                'quote',

            UL:
                'ul',

            OL:
                'ol'
        };


        activeTags.forEach(tag => {

            const action =
                tagMap[tag];

            if (!action) {
                return;
            }

            const button =
                document.querySelector(
                    `[data-action="${action}"]`
                );

            if (button) {

                button.classList.add(
                    'active'
                );
            }
        });


        /*
         * Estado de alinhamento.
         */

        updateAlignmentState();


        /*
         * Estado do seletor de bloco.
         */

        updateBlockStyleState();
    }


    /* =========================================================
       28. ESTADO DO ALINHAMENTO
    ========================================================= */

    function updateAlignmentState() {

        const alignmentMap = {

            justifyLeft:
                'alignLeft',

            justifyCenter:
                'alignCenter',

            justifyRight:
                'alignRight',

            justifyFull:
                'justify'
        };


        Object.keys(alignmentMap)
            .forEach(command => {

                try {

                    if (
                        document.queryCommandState(
                            command
                        )
                    ) {

                        const action =
                            alignmentMap[command];

                        const button =
                            document.querySelector(
                                `[data-action="${action}"]`
                            );

                        if (button) {

                            button.classList.add(
                                'active'
                            );
                        }
                    }

                } catch (error) {

                    // Alguns navegadores
                    // podem bloquear queryCommandState.
                }
            });
    }


    /* =========================================================
       29. ESTADO DO BLOCO
    ========================================================= */

    function updateBlockStyleState() {

        if (!blockStyle) {
            return;
        }

        const node =
            getSelectionNode();

        if (!node) {
            return;
        }

        const block =
            node.closest(
                'h1, h2, blockquote, p'
            );

        if (!block) {
            return;
        }

        const tag =
            block.tagName.toLowerCase();

        if (
            ['h1', 'h2', 'blockquote', 'p']
                .includes(tag)
        ) {

            blockStyle.value =
                tag;
        }
    }


    /* =========================================================
       30. COPIAR CÓDIGO
    ========================================================= */

    function copyCode() {

        const html =
            cleanHTML();

        if (!html) {
            return;
        }

        navigator.clipboard
            .writeText(html)
            .then(() => {

                const original =
                    copyBtn.textContent;

                copyBtn.textContent =
                    'Copiado';

                setTimeout(() => {

                    copyBtn.textContent =
                        original;

                }, 1200);
            })
            .catch(() => {

                /*
                 * Fallback para navegadores
                 * que não permitem clipboard.
                 */

                const textarea =
                    document.createElement(
                        'textarea'
                    );

                textarea.value =
                    html;

                document.body.appendChild(
                    textarea
                );

                textarea.select();

                document.execCommand(
                    'copy'
                );

                document.body.removeChild(
                    textarea
                );
            });
    }


    /* =========================================================
       30-A. EDIÇÃO DIRETA DO XHTML
       -------------------------------------------------------
       Clicar no lápis transforma o bloco "Código gerado" em uma área
       editável (texto puro, sem o realce de sintaxe) e troca o ícone
       para o de salvar. Salvando, o texto digitado vira o novo
       conteúdo do capítulo ativo. Clicando fora — em qualquer lugar
       que não seja o próprio bloco de código ou o botão de salvar —
       as alterações são descartadas e tudo volta ao estado anterior.
    ========================================================= */

    function enterCodeEditMode() {

        if (!codeOutput || isEditingCode) {
            return;
        }

        const currentHtml = cleanHTML();

        codeOutput.textContent = formatHTMLPlain(currentHtml);

        codeOutput.contentEditable = 'true';

        codeOutput.classList.add('editing');

        isEditingCode = true;

        if (editCodeBtn) {
            editCodeBtn.hidden = true;
        }

        if (saveCodeBtn) {
            saveCodeBtn.hidden = false;
        }

        codeOutput.focus();

        // Coloca o cursor no início do texto.
        const range = document.createRange();
        range.selectNodeContents(codeOutput);
        range.collapse(true);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }


    function exitCodeEditMode() {

        if (!codeOutput) {
            return;
        }

        codeOutput.contentEditable = 'false';

        codeOutput.classList.remove('editing');

        isEditingCode = false;

        if (editCodeBtn) {
            editCodeBtn.hidden = false;
        }

        if (saveCodeBtn) {
            saveCodeBtn.hidden = true;
        }
    }


    // Descarta as alterações digitadas e volta a exibir o código
    // formatado a partir do conteúdo real (inalterado) do editor.
    function cancelCodeEdit() {

        exitCodeEditMode();

        syncOutput();
    }


    // Aplica o texto editado como novo conteúdo do capítulo ativo.
    function saveCodeEdit() {

        if (!codeOutput) {
            return;
        }

        const editedHtml = codeOutput.innerText;

        editor.innerHTML = relativeToAbsoluteImages(editedHtml);

        exitCodeEditMode();

        syncOutput();

        saveActiveChapterContent();
    }


    function setupCodeEditor() {

        if (!editCodeBtn || !saveCodeBtn || !codeOutput) {
            return;
        }

        editCodeBtn.addEventListener('click', enterCodeEditMode);

        saveCodeBtn.addEventListener('click', saveCodeEdit);

        // Clique fora do bloco de código (e fora do botão de salvar)
        // descarta as alterações não salvas.
        document.addEventListener('click', (event) => {

            if (!isEditingCode) {
                return;
            }

            const clickedInsideCode = codeOutput.contains(event.target);
            const clickedSaveBtn = saveCodeBtn.contains(event.target);
            const clickedEditBtn = editCodeBtn.contains(event.target);

            if (!clickedInsideCode && !clickedSaveBtn && !clickedEditBtn) {
                cancelCodeEdit();
            }
        });
    }


    /* =========================================================
       30-B. EXPORTAR PARA .EPUB
       -------------------------------------------------------
       Ao clicar em "Exportar": salva o capítulo que está aberto
       no editor (pra não exportar uma versão desatualizada) e
       pede pro processo principal abrir o modal nativo de
       seleção de pasta. O arquivo .epub é montado e gravado lá
       no main process (index.js); aqui só tratamos o resultado.
    ========================================================= */

    async function exportToEpub() {

        if (!projectPath) {
            alert('Salve o projeto antes de exportar.');
            return;
        }

        if (!window.electronAPI || !window.electronAPI.exportarProjeto) {
            return;
        }

        // Garante que o texto mais recente do capítulo ativo já está
        // gravado em disco antes de gerar o epub.
        saveActiveChapterContent();

        const originalLabel = downloadBtn.innerHTML;

        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Exportando...';

        try {

            console.log('[exportToEpub] chamando exportarProjeto para:', projectPath);

            const result = await window.electronAPI.exportarProjeto(projectPath);

            console.log('[exportToEpub] resultado recebido:', result);

            if (!result || result.canceled) {
                return;
            }

            if (!result.success) {
                alert('Não foi possível exportar o eBook: ' + result.error);
                return;
            }

            alert('eBook exportado com sucesso em:\n' + result.path);

        } catch (error) {

            console.error('Erro ao exportar epub:', error);

            alert('Não foi possível exportar o eBook.');

        } finally {

            downloadBtn.disabled = false;
            downloadBtn.innerHTML = originalLabel;
        }
    }


    /* =========================================================
       32. ZOOM
    ========================================================= */

    function updateZoom() {

        if (!editor) {
            return;
        }

        editor.style.zoom =
            `${currentZoom}%`;

        if (zoomTrack) {

            const percentage =
                (
                    (currentZoom - ZOOM_MIN) /
                    (ZOOM_MAX - ZOOM_MIN)
                ) * 100;

            zoomTrack.style.width =
                `${percentage}%`;
        }
    }


    function changeZoom(amount) {

        currentZoom += amount;

        currentZoom =
            Math.min(
                ZOOM_MAX,
                Math.max(
                    ZOOM_MIN,
                    currentZoom
                )
            );

        updateZoom();
    }


    function setupZoom() {

        if (!zoomButtons.length) {
            return;
        }

        zoomButtons.forEach(
            (button, index) => {

                button.addEventListener(
                    'click',
                    () => {

                        if (index === 0) {

                            changeZoom(
                                -ZOOM_STEP
                            );

                        } else {

                            changeZoom(
                                ZOOM_STEP
                            );
                        }
                    }
                );
            }
        );

        updateZoom();
    }


    /* =========================================================
       33. EXPORTAÇÃO XHTML
    ========================================================= */

    function exportXHTML() {

        const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Capítulo</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet.css" />
</head>
<body>
${cleanHTML()}
</body>
</html>
`;

        const blob =
            new Blob(
                [xhtml],
                {
                    type:
                        'application/xhtml+xml;charset=utf-8'
                }
            );

        const url =
            URL.createObjectURL(
                blob
            );

        const link =
            document.createElement(
                'a'
            );

        link.href =
            url;

        link.download =
            'capitulo.xhtml';

        document.body.appendChild(
            link
        );

        link.click();

        document.body.removeChild(
            link
        );

        URL.revokeObjectURL(
            url
        );
    }


    /* =========================================================
       34. DIVISOR ARRASTÁVEL
    ========================================================= */

    function setupDivider() {

        if (
            !divider ||
            !editorPane ||
            !workspace
        ) {
            return;
        }


        divider.addEventListener(
            'mousedown',
            () => {

                isDragging = true;

                divider.classList.add(
                    'dragging'
                );

                document.body.style.userSelect =
                    'none';
            }
        );


        window.addEventListener(
            'mousemove',
            event => {

                if (!isDragging) {
                    return;
                }

                const rect =
                    workspace.getBoundingClientRect();

                let percentage =
                    (
                        (event.clientX - rect.left) /
                        rect.width
                    ) * 100;


                percentage =
                    Math.min(
                        80,
                        Math.max(
                            20,
                            percentage
                        )
                    );


                editorPane.style.flex =
                    `0 0 ${percentage}%`;
            }
        );


        window.addEventListener(
            'mouseup',
            () => {

                isDragging = false;

                divider.classList.remove(
                    'dragging'
                );

                document.body.style.userSelect =
                    '';
            }
        );
    }


    /* =========================================================
       35. EVENTOS DO EDITOR
    ========================================================= */

    function setupEditorEvents() {

        editor.addEventListener(
            'input',
            syncOutput
        );

        editor.addEventListener(
            'keyup',
            updateToolbarState
        );

        editor.addEventListener(
            'mouseup',
            updateToolbarState
        );

        editor.addEventListener(
            'focus',
            updateToolbarState
        );

        editor.addEventListener(
            'click',
            updateToolbarState
        );


        /*
         * Atalhos de teclado.
         */

        editor.addEventListener(
            'keydown',
            event => {

                const modifier =
                    event.ctrlKey ||
                    event.metaKey;


                if (!modifier) {
                    return;
                }


                /*
                 * Ctrl + Z
                 */

                if (
                    event.key.toLowerCase() ===
                    'z' &&
                    !event.shiftKey
                ) {

                    event.preventDefault();

                    undo();

                    return;
                }


                /*
                 * Ctrl + Y
                 * ou Ctrl + Shift + Z
                 */

                if (
                    event.key.toLowerCase() ===
                    'y' ||
                    (
                        event.key.toLowerCase() ===
                        'z' &&
                        event.shiftKey
                    )
                ) {

                    event.preventDefault();

                    redo();

                    return;
                }


                /*
                 * Ctrl + B
                 */

                if (
                    event.key.toLowerCase() ===
                    'b'
                ) {

                    event.preventDefault();

                    toggleInlineCommand(
                        'bold'
                    );

                    return;
                }


                /*
                 * Ctrl + I
                 */

                if (
                    event.key.toLowerCase() ===
                    'i'
                ) {

                    event.preventDefault();

                    toggleInlineCommand(
                        'italic'
                    );

                    return;
                }


                /*
                 * Ctrl + U
                 */

                if (
                    event.key.toLowerCase() ===
                    'u'
                ) {

                    event.preventDefault();

                    toggleInlineCommand(
                        'underline'
                    );
                }
            }
        );
    }


    /* =========================================================
       35-B. CARREGAR PROJETO EXISTENTE DO DISCO
       -------------------------------------------------------
       Sem isso, toda vez que o editor abre (mesmo reabrindo um
       projeto já existente pelo dashboard) ele começa do zero com
       o capítulo padrão — e o autosave então grava por cima do
       capítulo "ch-1" de exemplo, dando a impressão de que nada
       do que foi escrito antes ficou salvo.
    ========================================================= */

    async function loadProjectFromDisk() {

        if (!projectPath || !window.electronAPI || !window.electronAPI.carregarProjeto) {
            return;
        }

        const result = await window.electronAPI.carregarProjeto(projectPath);

        if (!result || !result.success) {
            console.error('Erro ao carregar projeto:', result && result.error);
            return;
        }

        if (result.chapters && result.chapters.length > 0) {
            chapters = result.chapters.map(chapter => ({
                id: chapter.id,
                title: chapter.title || 'Capítulo',
                html: chapter.html || ''
            }));
        } else {
            chapters = [
                { id: generateChapterId(), title: 'Capítulo 1', html: DEFAULT_HTML }
            ];
        }

        activeChapterId = chapters[0].id;

        const activeChapter = getActiveChapter();

        editor.innerHTML = relativeToAbsoluteImages(activeChapter ? activeChapter.html : '');

        if (result.project && result.project.title) {

            document.title = result.project.title + ' | Editor de eBook';

            if (brandTitleEl) {
                brandTitleEl.textContent = result.project.title;
            }
        }

        renderChapterList();

        updateChapterHeaderLabels();

        syncOutput();

        // Painel de imagens/CSS: lista as imagens já usadas no projeto e
        // carrega a folha de estilo geral (nenhuma imagem selecionada).
        await loadImagesList();

        await loadCssFor(selectedImageId);
    }


    /* =========================================================
       36. INICIALIZAÇÃO
    ========================================================= */

    function init() {

        // Conteúdo inicial (placeholder). Se houver um projeto real
        // na URL, loadProjectFromDisk() substitui isso pelo conteúdo
        // salvo assim que a leitura do disco terminar.
        editor.innerHTML =
            DEFAULT_HTML;


        // Eventos do editor.
        setupEditorEvents();


        // Botões de formatação.
        setupToolbarButtons();


        // Seletor de estilos.
        setupBlockStyle();


        // Seletor de fontes.
        setupFontSelector();


        // Seletor de tamanho.
        setupSizeSelector();


        // Zoom.
        setupZoom();


        // Copiar código.
        if (copyBtn) {

            copyBtn.addEventListener(
                'click',
                copyCode
            );
        }


        // Edição direta do XHTML.
        setupCodeEditor();


        // Voltar para o dashboard.
        if (backToDashboardBtn) {

            backToDashboardBtn.addEventListener(
                'click',
                () => {
                    window.location.href = '../../index.html';
                }
            );
        }


        // Exportação.
        if (downloadBtn) {

            downloadBtn.addEventListener(
                'click',
                exportToEpub
            );
        }


        // Divisor.
        setupDivider();


        // Barra lateral de capítulos.
        setupChapterSidebar();


        // Painel de CSS por imagem.
        setupCssEditorPanel();


        // Primeira sincronização.
        syncOutput();


        // Zoom inicial.
        updateZoom();


        // Se a URL trouxe um projeto real (?project=...), carrega os
        // capítulos e metadados salvos, substituindo o conteúdo padrão.
        loadProjectFromDisk();
    }


    /* =========================================================
       37. EXECUTAR
    ========================================================= */
    init();

})();