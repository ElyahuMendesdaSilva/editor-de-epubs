# Changelog 0.0.6

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Em desenvolvimento] (não publicado)

Mudanças que estão sendo implementadas no momento e ainda não foram lançadas.

### Adicionado

- **Botão "Formatar XHTML" no painel "Código gerado"** — formata o XHTML apenas no painel (nunca altera o conteúdo do editor), mostrando até onde cada tag alcança com guias de bolinhas semitransparentes (`•`), como o VSCode. Um novo clique volta ao formato normal.
- **Toggle "Exibir botão de formatação de XHTML" nas Configurações** — interruptor na seção "Desenvolvedor" que controla a visibilidade do botão "Formatar XHTML" no editor (exige o modo desenvolvedor ativado).
- **Toggle "Exibir opção de exportar HTML" nas Configurações** — interruptor na seção "Desenvolvedor" que controla a visibilidade da opção "HTML" no menu de exportação do editor (exige o modo desenvolvedor ativado).
- **Dropdown de idiomas completo** — o modal de criação/edição de projetos agora lista todas as línguas possíveis (ISO 639-1 + `pt-BR`), exibidas como "Nome (código)" — ex.: "Inglês (en)". As principais línguas (Inglês, Espanhol, Francês, Alemão, Japonês, etc.) ficam no topo da lista.
- **Idioma da interface** — nova opção "Idioma da interface" nas Configurações (seção Aparência) que traduz todo o programa entre Português (Brasil), Inglês, Espanhol, Francês e Alemão. A preferência é salva e aplicada no Dashboard e no Editor.
- **Botão "Resetar aplicativo" nas Configurações** — nova seção "Manutenção" com botão que remove todos os projetos da lista "Em andamento" (sem apagar as pastas no disco) e limpa todos os caches (tema, idioma, preferências e cache HTTP do Electron), com confirmação antes de executar.
- **Realce de sintaxe no painel de código** — tags e atributos do XHTML ganharam cores (azul para tags, âmbar para atributos), com variáveis próprias para os temas claro e escuro.
- **Exportar como HTML** — nova opção no menu de exportação do editor que gera um único arquivo HTML autocontido com capa e todos os capítulos na ordem certa. Imagens, fontes e a folha de estilo do projeto são embutidas no próprio arquivo (base64/data URI), permitindo visualizar o eBook em qualquer navegador sem depender da pasta do projeto.

### Corrigido

- Parágrafos longos no formatador saíam do padrão — as linhas de continuação perdiam a guia. Agora o texto é quebrado em ~80 caracteres e cada linha mantém a bolinha-guia.
- Línguas principais (ex.: Inglês) pareciam faltar no dropdown de idiomas por ficarem ocultas na ordem alfabética — agora aparecem no topo da lista.

### Alterado

- A janela de Configurações deixou de ser um modal e virou uma página em tela cheia, acessível pela aba superior "Configurações".
- Guias do formatador de XHTML: as barras verticais (`│`) foram substituídas por bolinhas semitransparentes (`•`), maiores e menos transparentes para ficarem mais visíveis.
- O botão "Formatar XHTML" virou um alternador: o segundo clique desfaz a formatação e volta à exibição normal.
- A visibilidade do botão "Formatar XHTML" passou a depender do modo desenvolvedor e do novo toggle nas Configurações.
- Exportação de PDF finalizada 
