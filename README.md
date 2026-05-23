# Pokémon Binder BR — Etapa 1

Este projeto cria um fichário digital 3x3 para cartas Pokémon, com:

- cadastro de cartas;
- busca por nome/número em PT-BR, japonês e inglês;
- OCR pela câmera ou imagem;
- preço com fonte identificada;
- salvamento em Google Sheets;
- hospedagem pelo Vercel usando GitHub.

## Arquivos

- `index.html` — página principal.
- `style.css` — visual do fichário.
- `script.js` — lógica da busca, OCR, fichário e conexão com Sheets.
- `google-apps-script/code.gs` — código para colar no Google Apps Script.

---

# PARTE 1 — Criar a planilha

1. Entre no Google Sheets.
2. Crie uma planilha nova.
3. Nome sugerido: `Pokemon Binder BR`.
4. Não precisa criar abas manualmente. O Apps Script cria as abas quando for executado.

---

# PARTE 2 — Colar o Apps Script

1. Dentro da planilha, clique em `Extensões`.
2. Clique em `Apps Script`.
3. Apague qualquer código que já exista.
4. Abra o arquivo `google-apps-script/code.gs` deste projeto.
5. Copie tudo.
6. Cole no Apps Script.
7. Clique em salvar.

---

# PARTE 3 — Implantar como Web App

1. No Apps Script, clique em `Implantar`.
2. Clique em `Nova implantação`.
3. Em tipo, escolha `App da Web`.
4. Em descrição, coloque: `Pokemon Binder API`.
5. Em `Executar como`, selecione `Eu`.
6. Em `Quem pode acessar`, selecione `Qualquer pessoa`.
7. Clique em `Implantar`.
8. Autorize as permissões.
9. Copie a URL do Web App.

A URL normalmente termina com `/exec`.

---

# PARTE 4 — Colar a URL no script.js

1. Abra o arquivo `script.js`.
2. Procure esta linha:

```js
const APPS_SCRIPT_URL = "COLE_AQUI_A_URL_DO_APPS_SCRIPT";
```

3. Troque pelo link do seu Web App.

Exemplo:

```js
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/SEU_CODIGO_AQUI/exec";
```

4. Salve o arquivo.

---

# PARTE 5 — Testar localmente sem Vercel

Você pode abrir o `index.html` direto no navegador.

Mas alguns recursos podem funcionar melhor depois de hospedado no Vercel, principalmente câmera/OCR.

---

# PARTE 6 — Subir no GitHub

1. Crie um repositório no GitHub.
2. Nome sugerido: `pokemon-binder-br`.
3. Envie estes arquivos para o repositório:
   - `index.html`
   - `style.css`
   - `script.js`
   - `README.md`

A pasta `google-apps-script` não precisa ir para o Vercel, mas pode ir para guardar o backup.

---

# PARTE 7 — Publicar no Vercel

1. Entre no Vercel.
2. Clique em `Add New Project`.
3. Escolha o repositório do GitHub.
4. Framework: `Other` ou sem framework.
5. Clique em `Deploy`.
6. Abra o link gerado pelo Vercel.

---

# Como usar

1. Clique em `+ Adicionar carta`.
2. Você pode:
   - tirar foto da carta;
   - rodar OCR;
   - corrigir o nome/número;
   - ou digitar manualmente.
3. Clique em `Buscar cartas`.
4. Escolha a carta correta.
5. Abra a busca na Liga Pokémon, se quiser conferir preço BR.
6. Preencha preço mínimo/médio/máximo.
7. Clique em `Salvar no fichário`.

---

# Observações importantes

## Liga Pokémon

Nesta etapa, o sistema ainda não puxa preço automaticamente da Liga Pokémon porque não foi encontrada uma API pública oficial estável. O app já cria o link de busca e salva a fonte como `Liga Pokémon`.

## OCR

O OCR usa Tesseract.js no navegador. Ele pode errar bastante em cartas com brilho, sleeve, reflexo, holográficas ou foto torta. Por isso os campos podem ser corrigidos manualmente.

## Modo local

Se você ainda não colou a URL do Apps Script, o site salva cartas temporariamente no navegador. Depois que configurar o Apps Script, ele passa a salvar na planilha.

---

# Próximas etapas futuras

- editar carta cadastrada;
- excluir carta;
- ordenação por coleção/número;
- página com detalhe da carta;
- importação em massa;
- histórico de preço mais completo;
- tentativa de integração mais profunda com preços brasileiros;
- melhora do OCR com recorte automático da carta.
