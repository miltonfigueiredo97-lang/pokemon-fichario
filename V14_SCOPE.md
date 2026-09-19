# V14 — Escopo fechado do Fichário Pokémon

Este arquivo é a fonte de verdade do próximo pacote. Nada deve ir para `main` até os critérios de aceite abaixo passarem.

## 1. Adição rápida + preço em segundo plano

- Ao clicar em **Adicionar**, a carta deve entrar no fichário imediatamente.
- A janela de adicionar deve fechar/liberar na hora para o usuário cadastrar outra carta.
- A consulta da MYP deve continuar em segundo plano.
- Quando a cotação terminar, atualizar automaticamente:
  - link MYP;
  - mínimo;
  - médio;
  - máximo;
  - data da consulta.
- Erro de preço não pode impedir a inclusão da carta.
- Erro de preço não pode apagar preço antigo.
- O usuário deve enxergar um estado discreto de “preço atualizando” na carta/Resumo.

### Aceite
Adicionar 3 cartas em sequência sem esperar preço; as 3 entram imediatamente e recebem preço depois, sem interação extra.

---

## 2. Imagens de cartas japonesas

- Resultado japonês nunca deve ficar como card de texto vazio quando houver imagem disponível em outra base confiável.
- Prioridade de imagem:
  1. imagem japonesa exata;
  2. fallback confiável da mesma impressão/ID;
  3. imagem inglesa equivalente da mesma impressão, marcada como fallback visual;
  4. placeholder somente quando não houver imagem em nenhuma fonte.
- Nunca associar imagem de outra carta apenas por nome.

### Aceite
Busca por cartas japonesas de teste (incluindo Umbreon) mostra imagem sempre que houver correspondência segura.

---

## 3. Scanner reconstruído

O scanner atual não serve como identificação final.

### Fluxo novo
1. Abrir câmera traseira.
2. Detectar/enquadrar a carta inteira.
3. Capturar múltiplas regiões:
   - topo/nome;
   - canto com HP/tipo;
   - rodapé com número/total;
   - imagem completa para desempate.
4. OCR em múltiplas passagens e pré-processamentos.
5. Extrair candidatos de nome e número, não aceitar o primeiro texto plausível.
6. Consultar catálogo com tolerância a erro.
7. Ranqueamento por:
   - número/total;
   - similaridade do nome;
   - coleção;
   - tipo/HP quando disponível;
   - comparação visual entre a foto e as imagens candidatas.
8. Só aceitar automaticamente quando a confiança for alta.
9. Se confiança não for alta, mostrar 3–6 candidatos com imagem para o usuário tocar.
10. Ao escolher, abrir o fluxo normal de acabamento + condição.

### Aceite
Scanner não deve “inventar” uma carta. Em dúvida, mostra candidatos. Nome/número parciais devem ser suficientes para gerar candidatos úteis.

---

## 4. Múltiplos fichários

### Estrutura
- Usuário pode ter fichários ilimitados.
- Cabeçalho deve ter:
  - seletor do fichário atual;
  - botão **+ Fichário**;
  - ação de renomear;
  - ação de excluir fichário com confirmação.
- Sempre existe a visão virtual **Geral**.
- **Geral não é um fichário físico**: reúne todas as cartas de todos os fichários.

### Compatibilidade
- As cartas atuais devem ser migradas para um fichário padrão sem perda de posição, preço, condição ou acabamento.
- A mesma carta/condição/acabamento pode existir em fichários diferentes.

---

## 5. Ordenação e movimentação

Cada fichário e a visão Geral terão seletor de ordenação:

- **Ordem do fichário** (padrão)
- Alfabética
- Tipo
- Raridade
- Número da coleção

### Regras
- Drag & drop / mover bolso só funciona em **Ordem do fichário**.
- Em qualquer ordenação calculada, arrastar deve ser desativado visual e funcionalmente.
- A ordenação não altera a posição física salva.
- Voltar para **Ordem do fichário** restaura exatamente a organização manual.

### Geral
- Em Geral, a ordem de fichário deve respeitar:
  1. ordem dos fichários;
  2. página;
  3. bolso.
- Geral é somente visão agregada; não se arrasta carta entre posições por essa visão.

---

## 6. Criar fichário vazio ou por coleção

Botão **+ Fichário** abre duas opções:

### A. Fichário vazio
- Nome.
- Número inicial de páginas.
- Cria vazio.

### B. Fichário de coleção / Master Set
- Buscar coleção.
- Mostrar nome, logo, série, data e quantidade de cartas.
- Selecionar idioma do master set.
- Carregar todas as cartas da coleção na ordem oficial.
- Antes de criar, mostrar tela **“Marque as cartas que você já tem”**.
- Usuário toca nas cartas possuídas.
- Ao confirmar:
  - todas as entradas são criadas;
  - marcadas ficam **Tenho**;
  - demais ficam **Não tenho**;
  - preços das possuídas são atualizados em segundo plano.

---

## 7. Base de coleções

Usar uma base aberta/estruturada como fonte principal. TCGdex é apropriado porque possui:
- catálogo multilíngue;
- séries e coleções;
- contagem oficial/total;
- variantes de impressão;
- variantes detalhadas por idioma.

A aplicação deve manter uma camada própria de normalização/cache para não depender da UI de terceiros.

### Base precisa permitir
- listar todas as coleções;
- buscar por nome;
- buscar por série;
- obter todas as cartas de uma coleção;
- obter número oficial/total;
- raridade;
- tipo;
- variantes por carta;
- idioma;
- imagens disponíveis.

---

## 8. Master Set com variantes reais

Um Master Set não é só 1 linha por número.

Para cada carta, criar entradas conforme as variantes realmente disponíveis na coleção/idioma, por exemplo:

- Normal
- Holo
- Reverse Holo
- Poké Ball Foil
- Master Ball Foil
- outras variantes/stamps oficiais quando a base indicar disponibilidade

### Regras
- Não duplicar variantes que não existem.
- Variantes podem ser específicas de idioma.
- Mesma carta/número pode aparecer múltiplas vezes no fichário, uma por variante.
- A ordem deve ser determinística:
  1. número oficial da carta;
  2. variante base;
  3. holo;
  4. reverse;
  5. Poké Ball;
  6. Master Ball;
  7. demais variantes.
- Cada variante tem seu próprio status Tenho/Não tenho, condição e preço.

---

## 9. Regras de preço existentes que devem continuar

- Fonte automática: MYP Cards.
- Respeitar:
  - carta correta;
  - idioma;
  - condição;
  - acabamento.
- Não preencher preço manualmente durante testes.
- Teste de preço sempre deve partir do próprio botão/fluxo do sistema.
- Consulta da Liga Pokémon não faz parte do fluxo automático por enquanto; apenas link manual permanece.

---

## 10. Critério de entrega da V14

Não fazer merge parcial para produção.

A V14 só vai para `main` quando:
- cadastro em segundo plano estiver funcionando;
- japonês tiver fallback de imagem;
- scanner novo gerar candidatos confiáveis;
- múltiplos fichários funcionarem;
- Geral funcionar;
- ordenações funcionarem;
- drag ficar restrito à ordem manual;
- criação por coleção funcionar;
- variantes de master set funcionarem;
- migração das cartas atuais tiver sido testada sem perda de dados.
