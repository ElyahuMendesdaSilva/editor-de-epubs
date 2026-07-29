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
    const exportBtnLabel = document.getElementById('exportBtnLabel');
    const exportDropdown = document.getElementById('exportDropdown');
    const exportCaretBtn = document.getElementById('exportCaretBtn');
    const exportMenu = document.getElementById('exportMenu');

    const divider = document.getElementById('divider');
    const editorPane = document.getElementById('editorPane');
    const workspace = document.querySelector('.workspace');

    const blockStyle = document.getElementById('blockStyle');

    const fontSelect = document.querySelector('.font-select');
    const sizeSelect = document.querySelector('.size-select');
    const lineHeightSelect = document.querySelector('.lineheight-select');

    const copyBtn = document.querySelector('.copy-btn');

    const backToDashboardBtn = document.getElementById('backToDashboardBtn');
    const editCodeBtn = document.getElementById('editCodeBtn');
    const saveCodeBtn = document.getElementById('saveCodeBtn');

    const saveStatus = document.querySelector('.save-status');
    const searchControl = document.getElementById('searchControl');
    const searchInput = document.getElementById('searchInput');
    const searchCount = document.getElementById('searchCount');
    const searchPreviousBtn = document.getElementById('searchPreviousBtn');
    const searchNextBtn = document.getElementById('searchNextBtn');

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
    const deleteImageBtn = document.getElementById('deleteImageBtn');

    const deleteImageOverlay = document.getElementById('deleteImageOverlay');
    const deleteImageModalText = document.getElementById('deleteImageModalText');
    const cancelDeleteImageBtn = document.getElementById('cancelDeleteImageBtn');
    const confirmDeleteImageBtn = document.getElementById('confirmDeleteImageBtn');


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

    // Formato escolhido no dropdown de exportação. EPUB é o padrão;
    // o usuário pode trocar para PDF pelo menu ao lado do botão.
    let exportFormat = 'epub';

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

    let searchMatches = [];
    let activeSearchMatchIndex = -1;

    const SEARCH_HIGHLIGHT_NAME = 'editor-search-match';
    const ACTIVE_SEARCH_HIGHLIGHT_NAME = 'editor-search-active';

    // Capítulos: cada um guarda seu próprio HTML. O editor sempre mostra
    // o conteúdo do capítulo ativo; trocar de capítulo salva o atual antes.
    let chapters = [
        { id: 'ch-1', title: 'Capítulo 1', html: DEFAULT_HTML }
    ];

    let activeChapterId = chapters[0].id;

    // Id do capítulo sendo arrastado na barra lateral, enquanto o
    // usuário reordena a lista arrastando pela alcinha (drag handle).
    let draggedChapterId = null;


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


    const BLOCK_SELECTOR = 'h1, h2, blockquote, p, li';

    /*
     * Retorna todos os elementos de bloco (parágrafos, títulos,
     * citações, itens de lista) que fazem parte da seleção atual —
     * um único bloco quando o cursor só está posicionado nele, ou
     * vários quando o usuário selecionou texto que atravessa mais
     * de um bloco. Usado pelo espaçamento entre linhas, já que não
     * existe um execCommand nativo equivalente ao lineHeight.
     */

    function getSelectedBlocks() {

        const selection = window.getSelection();

        if (!selection.rangeCount) {
            return [];
        }

        const range = selection.getRangeAt(0);

        const closestBlock = (node) => {

            if (!node) {
                return null;
            }

            if (node.nodeType === Node.TEXT_NODE) {
                node = node.parentElement;
            }

            return node && node.closest ?
                node.closest(BLOCK_SELECTOR) :
                null;
        };

        const startBlock = closestBlock(range.startContainer);
        const endBlock = closestBlock(range.endContainer);

        if (!startBlock) {
            return [];
        }

        if (!endBlock || startBlock === endBlock) {
            return [startBlock];
        }

        const allBlocks = Array.from(
            editor.querySelectorAll(BLOCK_SELECTOR)
        );

        const startIndex = allBlocks.indexOf(startBlock);
        const endIndex = allBlocks.indexOf(endBlock);

        if (startIndex === -1 || endIndex === -1) {
            return [startBlock];
        }

        const from = Math.min(startIndex, endIndex);
        const to = Math.max(startIndex, endIndex);

        return allBlocks.slice(from, to + 1);
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


    function reorderChapters(draggedId, targetId, insertAfter) {

        if (!draggedId || draggedId === targetId) {
            return;
        }

        const fromIndex = chapters.findIndex(
            chapter => chapter.id === draggedId
        );

        if (fromIndex === -1) {
            return;
        }

        const [draggedChapter] = chapters.splice(fromIndex, 1);

        const targetIndex = chapters.findIndex(
            chapter => chapter.id === targetId
        );

        if (targetIndex === -1) {

            chapters.push(draggedChapter);

        } else {

            const insertIndex =
                insertAfter ? targetIndex + 1 : targetIndex;

            chapters.splice(insertIndex, 0, draggedChapter);
        }

        // A ordem em disco é derivada da posição no array (ver
        // persistChapter), então regravamos todos os capítulos para
        // que a nova ordem sobreviva a um fechar/abrir do projeto.
        chapters.forEach(chapter => persistChapter(chapter));

        renderChapterList();
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
                <span class="chapter-drag-handle" title="Arrastar para reordenar">
                    <svg viewBox="0 0 24 24">
                        <circle cx="9" cy="6" r="1.6"/>
                        <circle cx="9" cy="12" r="1.6"/>
                        <circle cx="9" cy="18" r="1.6"/>
                        <circle cx="15" cy="6" r="1.6"/>
                        <circle cx="15" cy="12" r="1.6"/>
                        <circle cx="15" cy="18" r="1.6"/>
                    </svg>
                </span>
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


            /*
             * Reordenar arrastando pela alcinha.
             *
             * O item só fica arrastável (draggable) enquanto o botão
             * do mouse estiver pressionado sobre a alcinha — assim o
             * clique normal e o duplo clique (renomear) continuam
             * funcionando em qualquer outra parte do item.
             */

            const dragHandle =
                item.querySelector('.chapter-drag-handle');

            if (dragHandle) {

                dragHandle.addEventListener('mousedown', () => {
                    item.setAttribute('draggable', 'true');
                });

                dragHandle.addEventListener('mouseup', () => {

                    setTimeout(() => {

                        if (!item.classList.contains('dragging')) {
                            item.removeAttribute('draggable');
                        }
                    }, 0);
                });
            }

            item.addEventListener('dragstart', event => {

                draggedChapterId = chapter.id;

                event.dataTransfer.effectAllowed = 'move';

                try {
                    event.dataTransfer.setData('text/plain', chapter.id);
                } catch (error) {
                    // Alguns navegadores exigem tipos MIME específicos.
                }

                requestAnimationFrame(() => {
                    item.classList.add('dragging');
                });
            });

            item.addEventListener('dragend', () => {

                draggedChapterId = null;

                item.classList.remove('dragging');
                item.removeAttribute('draggable');

                chapterListEl
                    .querySelectorAll('.chapter-item')
                    .forEach(el => {
                        el.classList.remove('drag-over-top', 'drag-over-bottom');
                    });
            });

            item.addEventListener('dragover', event => {

                if (!draggedChapterId || draggedChapterId === chapter.id) {
                    return;
                }

                event.preventDefault();

                event.dataTransfer.dropEffect = 'move';

                const rect = item.getBoundingClientRect();

                const isAfter =
                    (event.clientY - rect.top) > rect.height / 2;

                item.classList.toggle('drag-over-top', !isAfter);
                item.classList.toggle('drag-over-bottom', isAfter);
            });

            item.addEventListener('dragleave', () => {

                item.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            item.addEventListener('drop', event => {

                event.preventDefault();

                const isAfter =
                    item.classList.contains('drag-over-bottom');

                item.classList.remove('drag-over-top', 'drag-over-bottom');

                if (!draggedChapterId || draggedChapterId === chapter.id) {
                    return;
                }

                reorderChapters(draggedChapterId, chapter.id, isAfter);
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


    function updateDeleteImageButtonState() {

        if (!deleteImageBtn) {
            return;
        }

        deleteImageBtn.disabled = !selectedImageId;
    }


    function selectImageForCss(imageId) {

        selectedImageId = imageId;

        renderImageStyleList();

        loadCssFor(imageId);

        updateDeleteImageButtonState();
    }


    function openDeleteImageModal() {

        if (!deleteImageOverlay || !selectedImageId) {
            return;
        }

        const image = knownImages.find(
            item => item.id === selectedImageId
        );

        if (deleteImageModalText) {

            deleteImageModalText.textContent = image && image.originalName ?
                `Tem certeza que deseja excluir "${image.originalName}"? Essa ação não pode ser desfeita.` :
                'Tem certeza que deseja excluir esta imagem? Essa ação não pode ser desfeita.';
        }

        deleteImageOverlay.classList.add('open');
    }


    function closeDeleteImageModal() {

        if (!deleteImageOverlay) {
            return;
        }

        deleteImageOverlay.classList.remove('open');
    }


    async function deleteSelectedImage() {

        if (!projectPath || !selectedImageId || !window.electronAPI || !window.electronAPI.excluirImagem) {
            closeDeleteImageModal();
            return;
        }

        const imageId = selectedImageId;

        const result = await window.electronAPI.excluirImagem({
            projectPath,
            imageId
        });

        if (!result || !result.success) {

            console.error('Erro ao excluir imagem:', result && result.error);

            closeDeleteImageModal();

            return;
        }

        knownImages = knownImages.filter(
            item => item.id !== imageId
        );

        // Volta para a folha de estilo geral, já que a imagem
        // selecionada (e o CSS dela) não existe mais.
        selectImageForCss(null);

        closeDeleteImageModal();
    }


    function setupImageDeleteModal() {

        if (deleteImageBtn) {

            deleteImageBtn.addEventListener(
                'click',
                openDeleteImageModal
            );
        }

        if (cancelDeleteImageBtn) {

            cancelDeleteImageBtn.addEventListener(
                'click',
                closeDeleteImageModal
            );
        }

        if (confirmDeleteImageBtn) {

            confirmDeleteImageBtn.addEventListener(
                'click',
                deleteSelectedImage
            );
        }

        if (deleteImageOverlay) {

            deleteImageOverlay.addEventListener(
                'click',
                event => {

                    if (event.target === deleteImageOverlay) {
                        closeDeleteImageModal();
                    }
                }
            );
        }

        document.addEventListener('keydown', event => {

            if (
                event.key === 'Escape' &&
                deleteImageOverlay &&
                deleteImageOverlay.classList.contains('open')
            ) {
                closeDeleteImageModal();
            }
        });
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

        // Um <hr> (assim como títulos, listas e citações) não pode ser
        // filho de <p> em XHTML. O navegador permite que isso aconteça ao
        // inserir um nó diretamente no Range do contenteditable, mas o
        // parser de XML usado por leitores EPUB rejeita esse documento.
        // Reinterpretar o fragmento pelo parser HTML separa esses blocos do
        // parágrafo antes que o conteúdo seja persistido/exportado.
        const container = document.createElement('div');
        container.innerHTML = html;

        // Se o conteúdo do editor começar com texto solto (fora de <p>,
        // <h1>, etc.), envolve num <p> para que o XHTML fique bem formado.
        // Isso acontece quando o usuário digita diretamente num capítulo
        // vazio e a primeira linha é armazenada como textNode avulso.
        const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                           'BLOCKQUOTE', 'UL', 'OL', 'PRE', 'HR', 'TABLE', 'DIV'];
        const nodesToWrap = [];

        for (let i = 0; i < container.childNodes.length; i++) {
            const node = container.childNodes[i];
            const isText = node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0;
            const isInlineElement = node.nodeType === Node.ELEMENT_NODE &&
                                    !blockTags.includes(node.tagName);
            if (isText || isInlineElement) {
                nodesToWrap.push(node);
            }
        }

        for (const node of nodesToWrap) {
            const p = document.createElement('p');
            node.parentNode.replaceChild(p, node);
            p.appendChild(node);
        }

        html = container.innerHTML;

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
       10-A. BUSCA NO CAPÍTULO
    ========================================================= */

    function escapeRegExp(text) {

        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }


    function clearSearchHighlights() {

        searchMatches = [];
        activeSearchMatchIndex = -1;

        if (window.CSS && CSS.highlights) {
            CSS.highlights.delete(SEARCH_HIGHLIGHT_NAME);
            CSS.highlights.delete(ACTIVE_SEARCH_HIGHLIGHT_NAME);
        }
    }


    function updateSearchControls() {

        const hasSearch = searchInput && searchInput.value.trim();
        const hasMatches = searchMatches.length > 0;

        if (searchCount) {
            searchCount.textContent = hasSearch ?
                (hasMatches ? `${activeSearchMatchIndex + 1}/${searchMatches.length}` : '0/0') :
                '';
        }

        if (searchPreviousBtn) {
            searchPreviousBtn.disabled = !hasMatches;
        }

        if (searchNextBtn) {
            searchNextBtn.disabled = !hasMatches;
        }
    }


    function refreshSearchHighlights() {

        clearSearchHighlights();

        if (!searchInput || !searchInput.value.trim()) {
            updateSearchControls();
            return;
        }

        const query = searchInput.value.trim();
        const textNodes = [];
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let node;
        let fullText = '';

        while ((node = walker.nextNode())) {
            if (!node.nodeValue) {
                continue;
            }

            textNodes.push({
                node,
                start: fullText.length,
                end: fullText.length + node.nodeValue.length
            });

            fullText += node.nodeValue;
        }

        const pattern = new RegExp(escapeRegExp(query), 'gi');
        let match;

        while ((match = pattern.exec(fullText))) {
            const matchStart = match.index;
            const matchEnd = matchStart + match[0].length;
            const start = textNodes.find(item => item.end > matchStart);
            const end = textNodes.find(item => item.end >= matchEnd);

            if (!start || !end) {
                continue;
            }

            const range = document.createRange();
            range.setStart(start.node, matchStart - start.start);
            range.setEnd(end.node, matchEnd - end.start);
            searchMatches.push(range);
        }

        if (window.CSS && CSS.highlights) {
            CSS.highlights.set(
                SEARCH_HIGHLIGHT_NAME,
                new Highlight(...searchMatches)
            );
        }

        if (searchMatches.length) {
            activeSearchMatchIndex = 0;
            updateActiveSearchMatch(false);
        } else {
            updateSearchControls();
        }
    }


    function updateActiveSearchMatch(shouldScroll = true) {

        if (!searchMatches.length) {
            updateSearchControls();
            return;
        }

        const activeRange = searchMatches[activeSearchMatchIndex];

        if (window.CSS && CSS.highlights) {
            CSS.highlights.set(
                ACTIVE_SEARCH_HIGHLIGHT_NAME,
                new Highlight(activeRange)
            );
        }

        updateSearchControls();

        if (shouldScroll) {
            const target = activeRange.startContainer.parentElement;
            if (target) {
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
    }


    function navigateSearchMatch(direction) {

        if (!searchMatches.length) {
            return;
        }

        activeSearchMatchIndex =
            (activeSearchMatchIndex + direction + searchMatches.length) % searchMatches.length;

        updateActiveSearchMatch();
    }


    function openSearch() {

        if (!searchControl || !searchInput) {
            return;
        }

        searchControl.hidden = false;
        searchInput.focus();
        searchInput.select();
        refreshSearchHighlights();
    }


    function closeSearch() {

        if (!searchControl || !searchInput) {
            return;
        }

        searchInput.value = '';
        clearSearchHighlights();
        updateSearchControls();
        searchControl.hidden = true;
        editor.focus();
    }


    function setupSearch() {

        if (!searchControl || !searchInput) {
            return;
        }

        searchInput.addEventListener('input', refreshSearchHighlights);

        searchInput.addEventListener('keydown', event => {

            if (event.key === 'Enter') {
                event.preventDefault();
                navigateSearchMatch(event.shiftKey ? -1 : 1);
            }
        });

        searchPreviousBtn.addEventListener('click', () => navigateSearchMatch(-1));
        searchNextBtn.addEventListener('click', () => navigateSearchMatch(1));

        document.addEventListener('keydown', event => {

            const modifier = event.ctrlKey || event.metaKey;

            if (modifier && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                openSearch();
                return;
            }

            if (event.key === 'Escape' && !searchControl.hidden) {
                event.preventDefault();
                closeSearch();
            }
        });

        updateSearchControls();
    }


    /* =========================================================
       10. SINCRONIZAÇÃO PRINCIPAL
    ========================================================= */

    function wrapBareTextInEditor() {

        // Verifica se há texto solto (fora de <p>, <h1>, etc.) diretamente
        // no editor e envolve em <p> para que o espaçamento visual fique
        // consistente. Preserva a posição do cursor.
        const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                           'BLOCKQUOTE', 'UL', 'OL', 'PRE', 'HR', 'TABLE', 'DIV'];
        const children = editor.childNodes;
        let needsWrap = false;

        for (let i = 0; i < children.length; i++) {
            const node = children[i];
            const isText = node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0;
            const isInlineElement = node.nodeType === Node.ELEMENT_NODE &&
                                    !blockTags.includes(node.tagName);
            if (isText || isInlineElement) {
                needsWrap = true;
                break;
            }
        }

        if (!needsWrap) {
            return;
        }

        // Salva posição do cursor
        const sel = window.getSelection();
        let savedOffset = 0;
        let savedNode = null;

        if (sel && sel.rangeCount) {
            const range = sel.getRangeAt(0);
            savedNode = range.startContainer;
            savedOffset = range.startOffset;
        }

        // Envolve nós soltos em <p>
        for (let i = children.length - 1; i >= 0; i--) {
            const node = children[i];
            const isText = node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0;
            const isInlineElement = node.nodeType === Node.ELEMENT_NODE &&
                                    !blockTags.includes(node.tagName);
            if (isText || isInlineElement) {
                const p = document.createElement('p');
                node.parentNode.replaceChild(p, node);
                p.appendChild(node);
            }
        }

        // Tenta restaurar o cursor
        if (savedNode && savedNode.parentNode) {
            try {
                const range = document.createRange();
                range.setStart(savedNode, Math.min(savedOffset, savedNode.textContent.length));
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            } catch (e) {
                // Se o nó original foi movido, tenta reposicionar no início
                try {
                    editor.focus();
                } catch (e2) {
                    // Ignora
                }
            }
        }
    }

    function syncOutput() {

        // Corrige texto solto no editor para manter espaçamento visual
        wrapBareTextInEditor();

        const html = cleanHTML();

        codeOutput.innerHTML =
            formatHTML(html);

        updateCounters();

        updateSaveStatus();

        updateToolbarState();

        scheduleAutosave();

        if (searchControl && !searchControl.hidden) {
            refreshSearchHighlights();
        }
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
       -------------------------------------------------------
       Só png/jpg/jpeg são aceitos. importAndInsertImages() é o
       ponto único que copia as imagens para o projeto e as insere
       no editor — usado tanto pelo botão "Inserir imagem" quanto
       pelo arrastar-e-soltar (ver "14-B" logo abaixo).
    ========================================================= */

    const ALLOWED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg'];

    function isAllowedImagePath(filePath) {
        if (!filePath) {
            return false;
        }

        const extension = filePath.split('.').pop().toLowerCase();

        return ALLOWED_IMAGE_EXTENSIONS.includes(extension);
    }


    async function importAndInsertImages(imagePaths) {

        if (!projectPath) {
            alert('Crie ou abra um projeto antes de inserir imagens.');
            return;
        }

        if (!imagePaths || imagePaths.length === 0) {
            return;
        }

        const allowedPaths = imagePaths.filter(isAllowedImagePath);
        const rejectedByClient = imagePaths.length - allowedPaths.length;

        if (allowedPaths.length === 0) {
            alert('Só é possível importar imagens nos formatos PNG, JPG ou JPEG.');
            return;
        }

        const result = await window.electronAPI.copiarImagens({
            projectPath,
            imagePaths: allowedPaths
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

        const rejectedByServer = (result.skipped || []).length;
        const totalRejected = rejectedByClient + rejectedByServer;

        if (totalRejected > 0) {
            alert(
                'Só é possível importar imagens nos formatos PNG, JPG ou JPEG. ' +
                totalRejected + ' arquivo(s) foram ignorados.'
            );
        }
    }


    async function insertImage() {

        if (!projectPath) {
            alert('Crie ou abra um projeto antes de inserir imagens.');
            return;
        }

        const imagePaths = await window.electronAPI.selecionarImagens();

        await importAndInsertImages(imagePaths);
    }


    /* =========================================================
       14-B. ARRASTAR E SOLTAR IMAGENS NO EDITOR
       -------------------------------------------------------
       Permite arrastar um arquivo de imagem de fora do app (do
       explorador de arquivos, por exemplo) e soltar dentro da área
       de escrita para importá-lo direto no capítulo ativo, sem
       precisar passar pelo diálogo "Inserir imagem".
    ========================================================= */

    function setupImageDragAndDrop() {

        if (!editor) {
            return;
        }

        const hasFiles = event =>
            !!event.dataTransfer &&
            Array.from(event.dataTransfer.types || []).includes('Files');

        ['dragenter', 'dragover'].forEach(eventName => {

            editor.addEventListener(eventName, event => {

                if (!hasFiles(event)) {
                    return;
                }

                event.preventDefault();

                editor.classList.add('drag-over-image');
            });
        });

        ['dragleave', 'dragend'].forEach(eventName => {

            editor.addEventListener(eventName, () => {
                editor.classList.remove('drag-over-image');
            });
        });

        editor.addEventListener('drop', async event => {

            if (!hasFiles(event)) {
                return;
            }

            event.preventDefault();

            editor.classList.remove('drag-over-image');

            if (!projectPath) {
                alert('Crie ou abra um projeto antes de inserir imagens.');
                return;
            }

            // Posiciona o cursor no ponto exato onde o arquivo foi
            // solto, quando o navegador suportar (Chromium/Electron sim).
            if (document.caretRangeFromPoint) {

                const range = document.caretRangeFromPoint(
                    event.clientX,
                    event.clientY
                );

                if (range && editor.contains(range.startContainer)) {

                    const selection = window.getSelection();

                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }

            const droppedFiles = Array.from(event.dataTransfer.files || []);

            const imagePaths = droppedFiles
                .map(file => window.electronAPI.getPathForFile(file))
                .filter(Boolean);

            await importAndInsertImages(imagePaths);
        });
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

        const selection = window.getSelection();

        if (
            !selection.rangeCount ||
            !editor.contains(selection.anchorNode)
        ) {
            insertNodeAtCursor(pageBreak);
            return;
        }

        const range = selection.getRangeAt(0);

        // Ao inserir um <hr> no meio de um parágrafo, separamos o conteúdo
        // posterior em outro <p>. Assim, o <hr> fica como filho direto do
        // editor (e, no arquivo, do <body>), nunca dentro de um <p>.
        let startNode = range.startContainer;
        if (startNode.nodeType === Node.TEXT_NODE) {
            startNode = startNode.parentElement;
        }

        const paragraph = startNode && startNode.closest ?
            startNode.closest('p') :
            null;

        if (!paragraph || !editor.contains(paragraph)) {
            insertNodeAtCursor(pageBreak);
            return;
        }

        range.deleteContents();

        const trailingRange = document.createRange();
        trailingRange.setStart(range.startContainer, range.startOffset);
        trailingRange.setEndAfter(paragraph);

        const trailingContent = trailingRange.extractContents();
        const trailingParagraph = paragraph.cloneNode(false);
        trailingParagraph.appendChild(trailingContent);

        paragraph.insertAdjacentElement('afterend', pageBreak);

        if (trailingParagraph.hasChildNodes()) {
            pageBreak.insertAdjacentElement('afterend', trailingParagraph);
        }

        if (!paragraph.hasChildNodes()) {
            paragraph.remove();
        }

        setCaretAfter(pageBreak);
        restoreEditorFocus();
        syncOutput();
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

        // Só aplica a fonte se houver uma seleção ativa dentro do editor
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
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
       20.1 ESPAÇAMENTO ENTRE LINHAS
    ========================================================= */

    function changeLineHeight(value) {

        if (!value) {
            return;
        }

        restoreEditorFocus();

        const blocks = getSelectedBlocks();

        if (!blocks.length) {
            return;
        }

        blocks.forEach(block => {

            if (value === 'default') {

                block.style.removeProperty(
                    'line-height'
                );

            } else {

                block.style.lineHeight = value;
            }
        });

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

    function loadProjectFonts() {

        if (!projectPath || !window.electronAPI || !window.electronAPI.listarFontes) {
            return Promise.resolve([]);
        }

        return window.electronAPI.listarFontes(projectPath)
            .then(result => {
                if (result && result.success && result.fonts) {
                    return result.fonts;
                }
                return [];
            })
            .catch(error => {
                console.error('Erro ao listar fontes:', error);
                return [];
            });
    }

    function getFontFileUrl(fileName) {

        if (!projectPath) {
            return '';
        }

        const normalized = projectPath.replace(/\\/g, '/') + '/fonts/' + fileName;
        return 'file://' + encodeURI(normalized.startsWith('/') ? normalized : '/' + normalized);
    }

    function getBuiltinFontFileUrl(familyPath, fileName) {

        const normalized = familyPath.replace(/\\/g, '/') + '/' + fileName;
        return 'file://' + encodeURI(normalized.startsWith('/') ? normalized : '/' + normalized);
    }

    function injectFontFaces(fonts, isBuiltin) {

        if (!fonts || fonts.length === 0) {
            return;
        }

        // Remove estilo antigo de fontes se existir
        const styleId = isBuiltin ? 'builtin-font-faces' : 'project-font-faces';
        const oldStyle = document.getElementById(styleId);
        if (oldStyle) {
            oldStyle.remove();
        }

        // Agrupa por nome de família: só injeta o primeiro arquivo
        // de cada família para evitar conflito de @font-face
        const seen = new Set();
        const unique = [];
        for (const f of fonts) {
            const key = f.name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(f);
            }
        }

        const cssRules = unique.map(f => {
            const url = isBuiltin
                ? getBuiltinFontFileUrl(f.path, f.file)
                : getFontFileUrl(f.file);
            return `@font-face {
    font-family: '${f.name}';
    src: url('${url}') format('${f.format}');
    font-display: swap;
}`;
        }).join('\n\n');

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = cssRules;
        document.head.appendChild(style);
    }

    function populateFontSelect(builtinFonts, projectFonts) {

        if (!fontSelect) {
            return;
        }

        // Guarda o valor atual para restaurar depois
        const currentValue = fontSelect.value;

        // Limpa o select
        while (fontSelect.options.length > 0) {
            fontSelect.remove(0);
        }

        // Option padrão
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Fonte...';
        fontSelect.appendChild(defaultOption);

        // Seção: Fontes do programa (src/fonts)
        if (builtinFonts.length > 0) {
            // Agrupa por nome de família (pode ter vários arquivos)
            const seen = new Set();
            builtinFonts.forEach(f => {
                if (!seen.has(f.name)) {
                    seen.add(f.name);
                    const option = document.createElement('option');
                    option.value = f.name;
                    option.textContent = f.name;
                    option.dataset.builtinFont = 'true';
                    fontSelect.appendChild(option);
                }
            });
        }

        // Seção: Fontes do projeto (fonts/)
        if (projectFonts.length > 0) {
            const groupLabel = document.createElement('option');
            groupLabel.disabled = true;
            groupLabel.textContent = '— Fontes do projeto —';
            fontSelect.appendChild(groupLabel);

            projectFonts.forEach(f => {
                const option = document.createElement('option');
                option.value = f.name;
                option.textContent = f.name;
                option.dataset.projectFont = 'true';
                fontSelect.appendChild(option);
            });
        }

        // Opção para importar fonte
        const importOption = document.createElement('option');
        importOption.value = '__import__';
        importOption.textContent = "Adicionar fonte";
        fontSelect.appendChild(importOption);

        // Tenta restaurar o valor anterior
        if (currentValue) {
            for (let i = 0; i < fontSelect.options.length; i++) {
                if (fontSelect.options[i].value === currentValue) {
                    fontSelect.value = currentValue;
                    break;
                }
            }
        }
    }

    function updateFontSelectorFromSelection() {

        if (!fontSelect) {
            return;
        }

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
            return;
        }

        const node = selection.anchorNode;
        let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

        if (!element || !editor.contains(element)) {
            return;
        }

        // Sobe até achar um elemento com font-family definida
        let fontFamily = '';
        while (element && element !== editor) {
            const computed = window.getComputedStyle(element);
            const family = computed.getPropertyValue('font-family').replace(/["']/g, '').trim();
            if (family && family !== 'serif' && family !== 'sans-serif' && family !== 'monospace') {
                // Pega o primeiro nome da lista de fallback
                fontFamily = family.split(',')[0].trim();
                break;
            }
            element = element.parentElement;
        }

        if (!fontFamily) {
            return;
        }

        // Procura a font no dropdown
        for (let i = 0; i < fontSelect.options.length; i++) {
            const opt = fontSelect.options[i];
            if (opt.value && opt.value.toLowerCase() === fontFamily.toLowerCase()) {
                if (fontSelect.value !== opt.value) {
                    fontSelect.value = opt.value;
                    fontSelect.dataset.previousValue = opt.value;
                }
                return;
            }
        }
    }

    function setupFontSelector() {

        if (!fontSelect) {
            return;
        }

        // Carrega as fontes base (src/fonts) e do projeto
        const builtinPromise = (window.electronAPI && window.electronAPI.listarFontesBase)
            ? window.electronAPI.listarFontesBase()
            : Promise.resolve({ fonts: [] });

        const projectPromise = (projectPath && window.electronAPI && window.electronAPI.listarFontes)
            ? loadProjectFonts()
            : Promise.resolve([]);

        Promise.all([builtinPromise, projectPromise]).then(([builtinResult, projectFonts]) => {
            const builtinFonts = (builtinResult && builtinResult.success && builtinResult.fonts) || [];
            populateFontSelect(builtinFonts, projectFonts);
            injectFontFaces(builtinFonts, true);
            injectFontFaces(projectFonts, false);
        });

        // Atualiza o dropdown conforme a seleção muda no editor
        editor.addEventListener('mouseup', updateFontSelectorFromSelection);
        editor.addEventListener('keyup', updateFontSelectorFromSelection);

        fontSelect.addEventListener(
            'change',
            () => {
                const value = fontSelect.value;

                if (value === '__import__') {
                    // Restaura o select para o valor anterior
                    fontSelect.value = fontSelect.dataset.previousValue || '';
                    importProjectFont();
                    return;
                }

                fontSelect.dataset.previousValue = value;
                changeFont(value);
            }
        );
    }

    async function importProjectFont() {

        if (!projectPath || !window.electronAPI || !window.electronAPI.importarFonte) {
            return;
        }

        const result = await window.electronAPI.importarFonte(projectPath);

        if (!result || !result.success || !result.fonts || result.fonts.length === 0) {
            return;
        }

        // Recarrega as listas de fontes (base + projeto)
        const builtinResult = (window.electronAPI && window.electronAPI.listarFontesBase)
            ? await window.electronAPI.listarFontesBase()
            : { fonts: [] };
        const builtinFonts = (builtinResult && builtinResult.success && builtinResult.fonts) || [];
        const projectFonts = await loadProjectFonts();
        populateFontSelect(builtinFonts, projectFonts);
        injectFontFaces(builtinFonts, true);
        injectFontFaces(projectFonts, false);

        // Seleciona a primeira fonte importada
        if (result.fonts.length > 0 && fontSelect) {
            const importedName = result.fonts[0].name;
            for (let i = 0; i < fontSelect.options.length; i++) {
                if (fontSelect.options[i].value === importedName) {
                    fontSelect.value = importedName;
                    // A fonte já está selecionada no dropdown; o usuário
                    // pode aplicá-la selecionando um texto em seguida
                    break;
                }
            }
        }
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
       26.1 SELETOR DE ESPAÇAMENTO ENTRE LINHAS
    ========================================================= */

    function setupLineHeightSelector() {

        if (!lineHeightSelect) {
            return;
        }

        lineHeightSelect.addEventListener(
            'change',
            () => {

                changeLineHeight(
                    lineHeightSelect.value
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


        /*
         * Estado do seletor de espaçamento entre linhas.
         */

        updateLineHeightState();
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
       29.1 ESTADO DO ESPAÇAMENTO ENTRE LINHAS
    ========================================================= */

    function updateLineHeightState() {

        if (!lineHeightSelect) {
            return;
        }

        const node =
            getSelectionNode();

        if (!node) {
            return;
        }

        const block =
            node.closest ?
                node.closest(BLOCK_SELECTOR) :
                null;

        if (!block) {
            return;
        }

        const currentValue =
            block.style.lineHeight || 'default';

        const availableValues =
            Array.from(lineHeightSelect.options)
                .map(option => option.value);

        lineHeightSelect.value =
            availableValues.includes(currentValue) ?
                currentValue :
                'default';
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
       30-B. EXPORTAR (.EPUB / .PDF)
       -------------------------------------------------------
       Ao clicar em "Exportar": salva o capítulo que está aberto
       no editor (pra não exportar uma versão desatualizada) e
       pede pro processo principal abrir o modal nativo de
       seleção de pasta. O arquivo (.epub ou .pdf, conforme o
       formato escolhido no dropdown) é montado e gravado lá no
       main process (index.js); aqui só tratamos o resultado.
    ========================================================= */

    async function exportEbook() {

        if (!projectPath) {
            alert('Salve o projeto antes de exportar.');
            return;
        }

        if (!window.electronAPI || !window.electronAPI.exportarProjeto) {
            return;
        }

        // Garante que o texto mais recente do capítulo ativo já está
        // gravado em disco antes de gerar o arquivo exportado.
        saveActiveChapterContent();

        const originalLabel = downloadBtn.innerHTML;
        const formatLabel = exportFormat === 'pdf' ? 'PDF' : 'EPUB';

        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Exportando...';

        if (exportCaretBtn) {
            exportCaretBtn.disabled = true;
        }

        try {

            console.log('[exportEbook] chamando exportarProjeto para:', projectPath, 'formato:', exportFormat);

            const result = await window.electronAPI.exportarProjeto({
                projectPath,
                format: exportFormat
            });

            console.log('[exportEbook] resultado recebido:', result);

            if (!result || result.canceled) {
                return;
            }

            if (!result.success) {
                alert('Não foi possível exportar o eBook: ' + result.error);
                return;
            }

            alert('eBook exportado com sucesso (' + formatLabel + ') em:\n' + result.path);

        } catch (error) {

            console.error('Erro ao exportar ebook:', error);

            alert('Não foi possível exportar o eBook.');

        } finally {

            downloadBtn.disabled = false;
            downloadBtn.innerHTML = originalLabel;

            if (exportCaretBtn) {
                exportCaretBtn.disabled = false;
            }
        }
    }


    /* =========================================================
       30-C. DROPDOWN DE FORMATO DE EXPORTAÇÃO
       -------------------------------------------------------
       O botão principal ("Exportar EPUB"/"Exportar PDF") sempre
       exporta no formato atualmente selecionado. O botão menor
       ao lado (seta) abre um menu para trocar esse formato.
    ========================================================= */

    function setExportFormat(format) {

        exportFormat = format === 'pdf' ? 'pdf' : 'epub';

        if (exportBtnLabel) {
            exportBtnLabel.textContent = 'Exportar ' + exportFormat.toUpperCase();
        }

        if (exportMenu) {

            exportMenu.querySelectorAll('.export-menu-item').forEach(item => {
                item.classList.toggle(
                    'active',
                    item.dataset.format === exportFormat
                );
            });
        }
    }


    function closeExportMenu() {

        if (!exportMenu || exportMenu.hidden) {
            return;
        }

        exportMenu.hidden = true;

        if (exportCaretBtn) {
            exportCaretBtn.setAttribute('aria-expanded', 'false');
        }
    }


    function setupExportDropdown() {

        if (!exportCaretBtn || !exportMenu) {
            return;
        }

        exportCaretBtn.addEventListener('click', event => {

            event.stopPropagation();

            const isOpen = !exportMenu.hidden;

            exportMenu.hidden = isOpen;

            exportCaretBtn.setAttribute('aria-expanded', String(!isOpen));
        });

        exportMenu.querySelectorAll('.export-menu-item').forEach(item => {

            item.addEventListener('click', () => {

                setExportFormat(item.dataset.format);

                closeExportMenu();
            });
        });

        // Fecha o menu ao clicar fora do dropdown.
        document.addEventListener('click', event => {

            if (!exportDropdown || exportDropdown.contains(event.target)) {
                return;
            }

            closeExportMenu();
        });

        // Fecha o menu com Esc.
        document.addEventListener('keydown', event => {

            if (event.key === 'Escape') {
                closeExportMenu();
            }
        });
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

        // Carrega as fontes do programa e do projeto e injeta @font-face no editor
        const builtinResult = (window.electronAPI && window.electronAPI.listarFontesBase)
            ? await window.electronAPI.listarFontesBase()
            : { fonts: [] };
        const builtinFonts = (builtinResult && builtinResult.success && builtinResult.fonts) || [];
        const projectFonts = await loadProjectFonts();
        populateFontSelect(builtinFonts, projectFonts);
        injectFontFaces(builtinFonts, true);
        injectFontFaces(projectFonts, false);
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

        // Busca no capítulo (Ctrl/Cmd + F).
        setupSearch();


        // Botões de formatação.
        setupToolbarButtons();


        // Seletor de estilos.
        setupBlockStyle();


        // Seletor de fontes.
        setupFontSelector();


        // Seletor de tamanho.
        setupSizeSelector();


        // Seletor de espaçamento entre linhas.
        setupLineHeightSelector();


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
                    window.location.href = '../../../index.html';
                }
            );
        }


        // Exportação.
        if (downloadBtn) {

            downloadBtn.addEventListener(
                'click',
                exportEbook
            );
        }

        // Dropdown de formato de exportação (EPUB / PDF).
        setupExportDropdown();

        // Arrastar e soltar imagens direto no editor.
        setupImageDragAndDrop();


        // Divisor.
        setupDivider();


        // Barra lateral de capítulos.
        setupChapterSidebar();


        // Painel de CSS por imagem.
        setupCssEditorPanel();


        // Modal de confirmação para excluir imagem.
        setupImageDeleteModal();


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
