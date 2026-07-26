# Editor de eBook

Um aplicativo de desktop minimalista para escrever e exportar eBooks em **ePub**, com editor de texto rico, organização de capítulos e geração do arquivo `.epub` sem depender de bibliotecas externas de compressão.

Construído com **Electron**, **HTML**, **CSS** e **JavaScript puro** — sem frameworks de front-end.

![](src/imagens/Configurações.png)
![](src/imagens/Editor.png)
![](src/imagens/Dashboard.png)

---

## Funcionalidades

- **Gerenciamento de projetos** — crie, abra, edite e exclua projetos de eBook, cada um salvo em sua própria pasta local.
- **Capa personalizada** — arraste e solte ou selecione uma imagem de capa ao criar o projeto.
- **Editor de texto** com:
  - Títulos, parágrafos e citações
  - Negrito, itálico e riscado
  - Alinhamento de texto e listas (ordenadas/não ordenadas)
  - Inserção de links, imagens e quebras de página
  - Contagem de palavras e caracteres em tempo real
- **Organização por capítulos** — barra lateral para adicionar, reordenar e navegar entre capítulos.
- **Estilização de imagens** — edição de CSS específico por imagem ou global, com pré-visualização do código gerado (XHTML).
- **Geração manual do `.epub`** — o app monta a estrutura `mimetype`, `META-INF/container.xml`, `content.opf` e `toc.ncx` e compacta tudo em um ZIP válido "na mão", sem depender de pacotes como `archiver` ou `jszip`.
- **Modo escuro/claro** com persistência da preferência do usuário.
- **Tela de configurações** com informações do app e créditos.

## Telas

| Tela | Descrição |
|---|---|
| **Projetos** | Dashboard inicial com criação/abertura de projetos e lista de projetos em andamento |
| **Editor** | Editor de texto com toolbar completa, sidebar de capítulos/imagens e painel de código gerado (XHTML) |
| **Configurações** | Tema, informações e créditos do aplicativo |

## Tecnologias

- [Electron](https://www.electronjs.org/) — empacotamento e APIs de sistema (diálogos de pasta, sistema de arquivos, etc.)
- HTML5 + CSS3
- JavaScript (Vanilla)

## Estrutura do projeto

```
Editor_de_EPUB/
├──src/
|   ├──editor/
|   |   ├── editor.html # Tela do editor de eBook
|   |   ├── editor.js # Lógica do editor (renderer)
|   |   └── style.css # Estilos da tela de edição
|   └──icons/
|       └──claude_code_icon.png
|   
├── index.html        # Tela de projetos (dashboard)
├── main.js            # Lógica do dashboard (renderer)
├── index.js           # Processo principal do Electron 
├── preload.js         # Ponte segura entre o main process e o renderer
├── style.css           # Estilos de toda a aplicação
└── package.json
```

##  Exportação

Ao exportar um projeto, o app gera um arquivo `.epub` válido contendo:
- Estrutura `OEBPS` com manifesto e spine (`content.opf`)
- Sumário de navegação (`nav` + `toc.ncx`, compatível com EPUB 2 e 3)
- Capítulos convertidos para XHTML e imagens copiadas para o pacote

## Créditos

Desenvolvido por [elyahumendes](https://github.com/ElyahuMendesdaSilva)

## Licença

Este projeto está sob a PolyForm Noncommercial License 1.0.0 — uso, estudo e modificação são livres para fins não comerciais. É proibido usar este código, no todo ou em parte, para fins comerciais (venda, assinaturas, SaaS, ou qualquer forma de monetização), por pessoas físicas ou empresas, sem autorização prévia do autor. Veja o arquivo LICENSE para o texto completo.
