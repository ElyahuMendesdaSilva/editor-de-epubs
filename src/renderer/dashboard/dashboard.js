document.addEventListener('DOMContentLoaded', () => {
    const btnNewProject = document.getElementById('btnNewProject');
    const btnOpenProject = document.getElementById('btnOpenProject');
    const modalOverlay = document.getElementById('modalOverlay');
    const modalTitleEl = document.getElementById('modalTitle');
    const submitProjectBtn = document.getElementById('submitProjectBtn');
    const btnDeleteProject = document.getElementById('btnDeleteProject');
    const pathFieldGroup = document.getElementById('pathFieldGroup');
    const btnCancel = document.getElementById('btnCancel');
    const form = document.getElementById('newProjectForm');
    const noticeOverlay = document.getElementById('noticeOverlay');
    const noticeTitle = document.getElementById('noticeTitle');
    const noticeMessage = document.getElementById('noticeMessage');
    const noticeCloseBtn = document.getElementById('noticeCloseBtn');

    const btnSelectFolder = document.getElementById('btnSelectFolder');
    const pathInput = document.getElementById('pathInput');

    const coverInput = document.getElementById('coverInput');
    const coverDropzone = document.getElementById('coverDropzone');
    const coverPreviewImg = document.getElementById('coverPreviewImg');

    const titleInput = document.getElementById('titleInput');
    const authorInput = document.getElementById('authorInput');
    const langSelect = document.getElementById('langSelect');
    const descInput = document.getElementById('descInput');

    const ongoingEmptyState = document.getElementById('ongoingEmptyState');
    const ongoingProjectsGrid = document.getElementById('ongoingProjectsGrid');

    // Abas superiores
    const tabProjetos = document.getElementById('tabProjetos');
    const tabConfiguracoes = document.getElementById('tabConfiguracoes');
    const settingsOverlay = document.getElementById('settingsOverlay');
    const btnCloseSettings = document.getElementById('btnCloseSettings');

    // Tema (claro/escuro)
    const themeToggle = document.getElementById('themeToggle');
    const themeStatusLabel = document.getElementById('themeStatusLabel');
    const sizeEstimateToggle = document.getElementById('sizeEstimateToggle');
    const sizeEstimateStatusLabel = document.getElementById('sizeEstimateStatusLabel');

    // Modo desenvolvedor
    const devSettingsSection = document.getElementById('devSettingsSection');
    const devModeStatusLabel = document.getElementById('devModeStatusLabel');

    // Campos de "Sobre o aplicativo" / créditos, preenchidos a partir do package.json
    const settingsAppName = document.getElementById('settingsAppName');
    const settingsAppVersion = document.getElementById('settingsAppVersion');
    const settingsAppDescription = document.getElementById('settingsAppDescription');
    const settingsGithubLink = document.getElementById('settingsGithubLink');
    const settingsTechnologies = document.getElementById('settingsTechnologies');

    // Guarda o caminho real do arquivo de capa selecionado (usado para copiar depois)
    let selectedCoverPath = null;

    // Quando null, o modal está em modo "criar projeto novo". Quando
    // preenchido com o caminho de um projeto existente, o modal está
    // em modo "editar" e o formulário atualiza esse projeto em vez de
    // criar um novo.
    let editingProjectPath = null;
    let noticeCloseAction = null;

    function showNotice(title, message, buttonLabel = 'Entendi', onClose = null) {
        if (!noticeOverlay) {
            alert(message);
            return;
        }

        noticeTitle.textContent = title;
        noticeMessage.textContent = message;
        noticeCloseBtn.textContent = buttonLabel;
        noticeCloseAction = onClose;
        noticeOverlay.classList.add('active');
        noticeCloseBtn.focus();
    }

    function closeNotice() {
        if (!noticeOverlay) {
            return;
        }

        noticeOverlay.classList.remove('active');

        const action = noticeCloseAction;
        noticeCloseAction = null;

        if (action) {
            action();
        }
    }

    // ---------- Modal de novo projeto / edição ----------

    const openModal = () => {
        editingProjectPath = null;

        modalTitleEl.textContent = 'Novo eBook';
        submitProjectBtn.textContent = 'Salvar';
        pathFieldGroup.hidden = false;
        pathInput.value = 'C:\\Documentos\\eBooks';

        if (btnDeleteProject) {
            btnDeleteProject.hidden = true;
        }

        modalOverlay.classList.add('active');
    };

    // Abre o mesmo modal, mas pré-preenchido com os dados de um
    // projeto já existente, para edição.
    const openEditModal = (project) => {
        editingProjectPath = project.path;

        modalTitleEl.textContent = 'Editar eBook';
        submitProjectBtn.textContent = 'Salvar alterações';

        // O local do projeto não é editável aqui (mudar de pasta
        // exigiria mover a pasta inteira no disco), então o campo
        // fica escondido nesse modo.
        pathFieldGroup.hidden = true;

        titleInput.value = project.title || '';
        authorInput.value = project.author || '';
        langSelect.value = project.language || 'pt-BR';
        descInput.value = project.description || '';

        selectedCoverPath = null;

        if (btnDeleteProject) {
            btnDeleteProject.hidden = false;
        }

        if (project.cover) {
            coverPreviewImg.src = project.cover;
            coverPreviewImg.hidden = false;
            coverDropzone.classList.add('has-image');
        } else {
            coverPreviewImg.hidden = true;
            coverPreviewImg.src = '';
            coverDropzone.classList.remove('has-image');
        }

        modalOverlay.classList.add('active');
    };

    const closeModal = () => {
        modalOverlay.classList.remove('active');
        form.reset();
        editingProjectPath = null;
        selectedCoverPath = null;
        coverPreviewImg.hidden = true;
        coverPreviewImg.src = '';
        coverDropzone.classList.remove('has-image');
        pathFieldGroup.hidden = false;

        if (btnDeleteProject) {
            btnDeleteProject.hidden = true;
        }
    };

    btnNewProject.addEventListener('click', openModal);
    btnCancel.addEventListener('click', closeModal);

    // ---------- Abrir projeto existente (via project.json) ----------
    if (btnOpenProject) {
        btnOpenProject.addEventListener('click', async () => {
            const result = await window.electronAPI.abrirProjeto();

            if (!result || result.canceled) {
                return;
            }

            if (!result.success) {
                alert('Não foi possível abrir o projeto: ' + result.error);
                return;
            }

            // Quando o título já estiver em uso no Dashboard, o processo
            // principal importa o projeto com um sufixo numérico. O aviso
            // fica visível antes de navegar para o editor.
            if (result.renamed) {
                showNotice(
                    'Projeto renomeado',
                    `Já existe um projeto chamado "${result.originalTitle}". ` +
                    `O projeto importado foi renomeado para "${result.title}".`,
                    'Abrir projeto',
                    () => openProject(result.path)
                );
                return;
            }

            // Abre o projeto no editor. Ao carregar lá, o próprio app já
            // salva o projeto na seção "Em andamento" automaticamente.
            openProject(result.path);
        });
    }

    modalOverlay.addEventListener('click', (event) => {
        if (event.target === modalOverlay) {
            closeModal();
        }
    });

    if (noticeCloseBtn) {
        noticeCloseBtn.addEventListener('click', closeNotice);
    }

    if (noticeOverlay) {
        noticeOverlay.addEventListener('click', event => {
            if (event.target === noticeOverlay) {
                closeNotice();
            }
        });
    }

    btnSelectFolder.addEventListener('click', async () => {
        const selectedPath = await window.electronAPI.selecionarPasta();
        if (selectedPath) {
            pathInput.value = selectedPath;
        }
    });

    // ---------- Barra superior: Projetos / Configurações ----------

    const openSettings = () => {
        if (settingsOverlay) {
            settingsOverlay.classList.add('active');
            applyDevModeVisibility();
        }
    };

    const closeSettings = () => {
        if (settingsOverlay) {
            settingsOverlay.classList.remove('active');
        }
    };

    if (tabProjetos) {
        tabProjetos.addEventListener('click', () => {
            tabProjetos.classList.add('active');
            if (tabConfiguracoes) {
                tabConfiguracoes.classList.remove('active');
            }
            closeSettings();
            window.location.href = 'index.html';
        });
    }

    if (tabConfiguracoes) {
        tabConfiguracoes.addEventListener('click', () => {
            tabConfiguracoes.classList.add('active');
            if (tabProjetos) {
                tabProjetos.classList.remove('active');
            }
            openSettings();
        });
    }

    if (btnCloseSettings) {
        btnCloseSettings.addEventListener('click', () => {
            closeSettings();
            if (tabConfiguracoes) {
                tabConfiguracoes.classList.remove('active');
            }
            if (tabProjetos) {
                tabProjetos.classList.add('active');
            }
        });
    }

    if (settingsOverlay) {
        settingsOverlay.addEventListener('click', (event) => {
            if (event.target === settingsOverlay) {
                btnCloseSettings.click();
            }
        });
    }

    // ---------- Modo desenvolvedor (segure Ctrl + D por 3 segundos) ----------

    const DEV_MODE_STORAGE_KEY = 'ebook-editor-dev-mode';
    const DEV_MODE_HOLD_MS = 3000;

    function isDevModeEnabled() {
        try {
            return localStorage.getItem(DEV_MODE_STORAGE_KEY) === '1';
        } catch (error) {
            console.error('Não foi possível ler a preferência do modo desenvolvedor:', error);
            return false;
        }
    }

    function applyDevModeVisibility() {
        const enabled = isDevModeEnabled();

        if (devSettingsSection) {
            devSettingsSection.hidden = !enabled;
        }

        if (devModeStatusLabel) {
            devModeStatusLabel.textContent = enabled ? 'Ativado' : 'Desativado';
        }
    }

    function setDevModeEnabled(enabled) {
        try {
            localStorage.setItem(DEV_MODE_STORAGE_KEY, enabled ? '1' : '0');
        } catch (error) {
            console.error('Não foi possível salvar a preferência do modo desenvolvedor:', error);
        }

        applyDevModeVisibility();

        showNotice(
            'Modo desenvolvedor ' + (enabled ? 'ativado' : 'desativado'),
            'As opções de desenvolvedor ' + (enabled ? 'agora estão visíveis' : 'foram ocultadas') + ' nas Configurações.'
        );
    }

    let ctrlDKeyHeld = false;
    let ctrlDTimer = null;

    function cancelCtrlDHold() {
        ctrlDKeyHeld = false;

        if (ctrlDTimer !== null) {
            clearTimeout(ctrlDTimer);
            ctrlDTimer = null;
        }
    }

    document.addEventListener('keydown', (event) => {
        if (!event.ctrlKey || (event.key !== 'd' && event.key !== 'D')) {
            return;
        }

        // Evita ações padrão (ex.: favoritar no navegador).
        event.preventDefault();

        if (ctrlDKeyHeld) {
            return;
        }

        ctrlDKeyHeld = true;
        ctrlDTimer = setTimeout(() => {
            ctrlDTimer = null;
            setDevModeEnabled(!isDevModeEnabled());
        }, DEV_MODE_HOLD_MS);
    });

    document.addEventListener('keyup', (event) => {
        if (event.key !== 'd' && event.key !== 'D') {
            return;
        }

        cancelCtrlDHold();
    });

    window.addEventListener('blur', cancelCtrlDHold);

    applyDevModeVisibility();

    // ---------- Tema (claro / escuro) ----------

    const THEME_STORAGE_KEY = 'ebook-editor-theme';

    function applyTheme(theme) {
        const isDark = theme === 'dark';

        document.documentElement.classList.toggle('dark-theme', isDark);

        if (themeToggle) {
            themeToggle.checked = isDark;
        }

        if (themeStatusLabel) {
            themeStatusLabel.textContent = isDark ? 'Escuro' : 'Claro';
        }
    }

    function loadSavedTheme() {
        let saved = 'light';

        try {
            saved = localStorage.getItem(THEME_STORAGE_KEY) || 'light';
        } catch (error) {
            console.error('Não foi possível ler o tema salvo:', error);
        }

        applyTheme(saved);
    }

    if (themeToggle) {
        themeToggle.addEventListener('change', () => {
            const theme = themeToggle.checked ? 'dark' : 'light';

            applyTheme(theme);

            try {
                localStorage.setItem(THEME_STORAGE_KEY, theme);
            } catch (error) {
                console.error('Não foi possível salvar o tema escolhido:', error);
            }
        });
    }

    loadSavedTheme();

    // ---------- Tamanho estimado do arquivo de exportação ----------

    const SIZE_ESTIMATE_STORAGE_KEY = 'ebook-editor-show-size-estimate';

    function applySizeEstimatePreference(enabled) {

        if (sizeEstimateToggle) {
            sizeEstimateToggle.checked = enabled;
        }

        if (sizeEstimateStatusLabel) {
            sizeEstimateStatusLabel.textContent = enabled ? 'Ativado' : 'Desativado';
        }
    }

    function loadSavedSizeEstimatePreference() {

        let enabled = false;

        try {
            enabled = localStorage.getItem(SIZE_ESTIMATE_STORAGE_KEY) === '1';
        } catch (error) {
            console.error('Não foi possível ler a preferência de tamanho do arquivo:', error);
        }

        applySizeEstimatePreference(enabled);
    }

    if (sizeEstimateToggle) {

        sizeEstimateToggle.addEventListener('change', () => {

            const enabled = sizeEstimateToggle.checked;

            applySizeEstimatePreference(enabled);

            try {
                localStorage.setItem(SIZE_ESTIMATE_STORAGE_KEY, enabled ? '1' : '0');
            } catch (error) {
                console.error('Não foi possível salvar a preferência de tamanho do arquivo:', error);
            }
        });
    }

    loadSavedSizeEstimatePreference();

    // ---------- Informações do app (via package.json) ----------

    async function loadAppInfo() {

        if (!window.electronAPI || !window.electronAPI.obterInfoApp) {
            return;
        }

        const info = await window.electronAPI.obterInfoApp();

        if (!info || !info.success) {
            console.error('Erro ao obter informações do app:', info && info.error);
            return;
        }

        if (settingsAppName && info.name) {
            settingsAppName.textContent = info.name;
        }

        if (settingsAppVersion && info.version) {
            settingsAppVersion.textContent = info.version;
        }

        if (settingsAppDescription && info.description) {
            settingsAppDescription.textContent = info.description;
        }

        if (settingsGithubLink && info.repositoryUrl) {
            settingsGithubLink.href = info.repositoryUrl;
            settingsGithubLink.textContent = info.repositoryUrl.replace(/^https?:\/\//, '');
        }

        if (settingsTechnologies && info.technologies && info.technologies.length > 0) {
            settingsTechnologies.textContent = info.technologies.join(', ');
        }
    }

    loadAppInfo();

    // ---------- Pré-visualização da capa ----------

    // A partir de agora só png/jpg/jpeg são aceitos como capa — tanto
    // selecionando pelo diálogo quanto arrastando e soltando o arquivo.
    const ALLOWED_COVER_EXTENSIONS = ['png', 'jpg', 'jpeg'];
    const ALLOWED_COVER_MIME_TYPES = ['image/png', 'image/jpeg'];

    function isAllowedCoverFile(file) {
        if (!file) {
            return false;
        }

        if (file.type && ALLOWED_COVER_MIME_TYPES.includes(file.type)) {
            return true;
        }

        // Alguns arquivos arrastados de fora do app não trazem um MIME
        // type confiável; nesse caso confere pela extensão do nome.
        const extension = (file.name || '').split('.').pop().toLowerCase();

        return ALLOWED_COVER_EXTENSIONS.includes(extension);
    }

    function handleCoverFile(file) {
        if (!file) return;

        if (!isAllowedCoverFile(file)) {
            showNotice(
                'Formato de imagem inválido',
                'Só é possível usar imagens nos formatos PNG, JPG ou JPEG.'
            );
            return;
        }

        // file.path não é mais confiável nas versões atuais do Electron
        // (fica undefined mesmo com contextIsolation ativado). O caminho
        // real do arquivo, usado depois para copiá-lo para a pasta do
        // projeto, precisa vir do webUtils exposto no preload.js.
        selectedCoverPath = window.electronAPI.getPathForFile(file);

        const reader = new FileReader();
        reader.onload = (event) => {
            coverPreviewImg.src = event.target.result;
            coverPreviewImg.hidden = false;
            coverDropzone.classList.add('has-image');
        };
        reader.readAsDataURL(file);
    }

    coverInput.addEventListener('change', () => {
        handleCoverFile(coverInput.files[0]);
    });

    coverDropzone.addEventListener('dragover', (event) => {
        event.preventDefault();
        coverDropzone.classList.add('drag-over');
    });

    coverDropzone.addEventListener('dragleave', () => {
        coverDropzone.classList.remove('drag-over');
    });

    coverDropzone.addEventListener('drop', (event) => {
        event.preventDefault();
        coverDropzone.classList.remove('drag-over');

        const file = event.dataTransfer.files[0];

        if (!file) {
            return;
        }

        if (!isAllowedCoverFile(file)) {
            showNotice(
                'Formato de imagem inválido',
                'Só é possível usar imagens nos formatos PNG, JPG ou JPEG.'
            );
            return;
        }

        coverInput.files = event.dataTransfer.files;
        handleCoverFile(file);
    });

    // ---------- Projetos em andamento ----------
    function escapeHtmlText(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function openProject(projectPath) {
        window.location.href = 'src/renderer/editor/editor.html?project=' + encodeURIComponent(projectPath);
    }

    async function loadOngoingProjects() {
        const result = await window.electronAPI.listarProjetos();

        if (!result || !result.success) {
            console.error('Erro ao listar projetos:', result && result.error);
            return;
        }

        const projects = result.projects || [];

        if (projects.length === 0) {
            ongoingEmptyState.hidden = false;
            ongoingProjectsGrid.hidden = true;
            return;
        }

        ongoingEmptyState.hidden = true;
        ongoingProjectsGrid.hidden = false;
        ongoingProjectsGrid.innerHTML = '';

        projects.forEach(project => {
            const card = document.createElement('div');
            card.className = 'card project-card';
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');

            const coverHtml = project.cover
                ? `<img src="${project.cover}" alt="Capa de ${escapeHtmlText(project.title)}" class="project-card-cover">`
                : `<div class="project-card-cover project-card-cover--placeholder">
                       <svg xmlns="http://www.w3.org/2000/svg" height="28px" viewBox="0 -960 960 960" width="28px" fill="currentColor">
                           <path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Z"/>
                       </svg>
                   </div>`;

            card.innerHTML = `
                ${coverHtml}
                <div class="project-card-title-row">
                    <p>${escapeHtmlText(project.title)}</p>
                    <button type="button" class="project-edit-btn" title="Editar projeto" aria-label="Editar projeto">
                        <svg viewBox="0 0 24 24">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                    </button>
                </div>
            `;

            card.addEventListener('click', () => openProject(project.path));
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openProject(project.path);
                }
            });

            const editBtn = card.querySelector('.project-edit-btn');
            editBtn.addEventListener('click', (event) => {
                // Impede que o clique também abra o projeto no editor.
                event.stopPropagation();
                openEditModal(project);
            });

            ongoingProjectsGrid.appendChild(card);
        });
    }

    loadOngoingProjects();

    // ---------- Excluir projeto (só disponível no modo edição) ----------
    if (btnDeleteProject) {
        btnDeleteProject.addEventListener('click', async () => {
            if (!editingProjectPath) {
                return;
            }

            const tituloAtual = titleInput.value || 'este projeto';
            const confirmado = confirm(
                `Tem certeza que deseja excluir "${tituloAtual}"?\n\n` +
                'Isso vai apagar a pasta do projeto (capítulos, imagens e capa) permanentemente do disco. Essa ação não pode ser desfeita.'
            );

            if (!confirmado) {
                return;
            }

            if (!window.electronAPI || typeof window.electronAPI.excluirProjeto !== 'function') {
                alert('A função de exclusão não está disponível. Reinicie o aplicativo e tente novamente.');
                return;
            }

            btnDeleteProject.disabled = true;

            try {
                const result = await window.electronAPI.excluirProjeto(editingProjectPath);

                if (result && result.success) {
                    closeModal();
                    await loadOngoingProjects();
                    return;
                }

                const errorMessage = result && result.error
                    ? result.error
                    : 'Resposta inválida ao excluir o projeto.';
                console.error('Erro:', errorMessage);
                alert('Não foi possível excluir o projeto: ' + errorMessage);
            } catch (error) {
                console.error('Erro ao excluir projeto:', error);
                alert('Não foi possível excluir o projeto: ' + error.message);
            } finally {
                btnDeleteProject.disabled = false;
            }
        });
    }

    // ---------- Envio do formulário (criação ou edição) ----------
    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (editingProjectPath) {
            // ---- Modo edição: atualiza um projeto já existente ----

            const dadosEdicao = {
                projectPath: editingProjectPath,
                title: titleInput.value,
                author: authorInput.value,
                language: langSelect.value,
                description: descInput.value,
                coverPath: selectedCoverPath
            };

            const result = await window.electronAPI.atualizarProjeto(dadosEdicao);

            if (result.success) {
                closeModal();
                await loadOngoingProjects();
            } else if (result.code === 'DUPLICATE_PROJECT_TITLE') {
                showNotice(
                    'Projeto já existe',
                    `Já existe um projeto chamado "${titleInput.value.trim()}" no Dashboard. ` +
                    'Escolha outro título antes de salvar as alterações.'
                );
            } else {
                console.error('Erro:', result.error);
                alert('Não foi possível salvar as alterações: ' + result.error);
            }

            return;
        }

        // ---- Modo criação: novo projeto ----

        if (!pathInput.value) {
            alert('Selecione uma pasta de destino antes de salvar.');
            return;
        }

        const dadosProjeto = {
            title: titleInput.value,
            author: authorInput.value,
            language: langSelect.value,
            description: descInput.value,
            basePath: pathInput.value,
            coverPath: selectedCoverPath
        };

        const result = await window.electronAPI.criarProjeto(dadosProjeto);

        if (result.success) {
            if (result.renamed) {
                showNotice(
                    'Projeto renomeado',
                    `Já existe um projeto chamado "${result.originalTitle}" no Dashboard. ` +
                    `O projeto foi criado como "${result.title}".`,
                    'Abrir projeto',
                    () => {
                        window.location.href = 'src/renderer/editor/editor.html?project=' + encodeURIComponent(result.path);
                    }
                );
                return;
            }

            // Leva direto para o editor, já apontando para a pasta do projeto criado
            window.location.href = 'src/renderer/editor/editor.html?project=' + encodeURIComponent(result.path);
        } else {
            console.error('Erro:', result.error);
            alert('Não foi possível criar o projeto: ' + result.error);
        }
    });
});
