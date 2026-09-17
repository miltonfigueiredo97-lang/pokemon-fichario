# Pokémon Binder BR — Supabase

Fichário digital 3×3 de cartas Pokémon hospedado no Vercel.

## Arquitetura

- Frontend estático: HTML/CSS/JS
- Hospedagem: Vercel
- Repositório: GitHub
- Banco/Auth: Supabase
- Tabelas do fichário: `pokemon_cards` e `pokemon_settings`
- As tabelas do Pokémon usam prefixo `pokemon_` e não dependem das tabelas do Football Legacy.

## Recursos

- login por e-mail e senha com Supabase Auth;
- RLS: cada usuário acessa apenas as próprias cartas;
- fichário 3×3;
- busca em PT-BR, EN e JA com prioridade para português;
- TCGdex como base principal e Pokémon TCG API como fallback;
- OCR experimental;
- link da Liga Pokémon preenchido automaticamente;
- preços em BRL preenchidos manualmente;
- cópias repetidas agrupadas automaticamente (`x2`, `x3`, etc.) quando carta, condição e acabamento são iguais;
- exclusão otimista pelo X vermelho.

## Supabase

Este frontend usa a Publishable Key do Supabase. Ela pode ficar no navegador; a proteção dos dados é feita pelas policies de Row Level Security (RLS).

Nunca coloque uma `service_role` key no frontend.
