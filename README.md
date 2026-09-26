# Ascentria CRM

CRM personalizável: contatos, empresas, funil de vendas (kanban), atividades, campos personalizados, marca, permissões e automações.

**Stack:** React + Vite (frontend estático) · Supabase (Postgres, autenticação, RLS, automações via triggers) · Render (hospedagem).

---

## 1. Testar sem banco (modo demonstração)

```bash
npm install
npm run dev:demo      # abre em http://localhost:5173 com dados fictícios
npm run build:demo    # gera dist-demo/index.html (arquivo único, abre direto no navegador)
```

## 2. Preparar o banco (Supabase)

1. Projeto: **ascentria-crm** (`rtrtfxraiaudtkkdjmkn`, São Paulo) — já criado e com todas as migrações aplicadas.
2. Para um projeto novo: **SQL Editor → New query**, cole e execute cada arquivo de `supabase/migrations` na ordem (exceto `0003_cron.sql`, que roda depois das Edge Functions).
3. Em **Authentication → Providers → Email**, deixe *Email* habilitado. Se quiser que novos usuários entrem sem confirmar e-mail, desative *Confirm email*.
4. Em **Authentication → URL Configuration**, defina *Site URL* como a URL do app (ex.: `https://ascentria-crm.onrender.com`) e adicione `https://ascentria-crm.onrender.com/redefinir-senha` em *Redirect URLs*.
5. Copie **Project URL** e a chave **anon / publishable** em **Project Settings → API**.

> O **primeiro usuário** que criar conta vira administrador ativo. Os seguintes entram como vendedores inativos até um admin ativá-los em *Configurações → Usuários*.

## 3. Rodar localmente com o banco real

```bash
cp .env.example .env    # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev
```

## 4. Publicar no Render

1. Suba este projeto para um repositório no GitHub (sem `node_modules`, `dist`, `.env`).
2. No Render: **New → Static Site**, conecte o repositório.
   - Build command: `npm ci && npm run build`
   - Publish directory: `dist`
   - Environment: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
3. Em **Redirects/Rewrites**, adicione a regra `/*  →  /index.html  (Rewrite)` para o roteamento do app funcionar.
   (O arquivo `render.yaml` já traz essa configuração se você usar *Blueprint*.)

## Sequência de WhatsApp (API oficial da Meta)

O funil **Mentoria — Instagram → WhatsApp** recebe leads automaticamente pelo direct do Instagram (mensagem com celular) na coluna *Recebidos*; a equipe libera manualmente a quantidade do dia para o Dia 1 (limite da Meta) e daí o CRM envia a sequência Dia 1 → Dia 5 pelo WhatsApp, move para *Responsivo* quando o lead responde (conversa manual dentro do CRM, com vários números cadastrados), arquiva quem não responde e devolve ao Dia 1 depois de 4 meses. Passo a passo completo em **[docs/GUIA-WHATSAPP.md](docs/GUIA-WHATSAPP.md)**.

## Estrutura

```
supabase/migrations/0001_init.sql   schema, RLS, triggers e automações
supabase/migrations/0002_*.sql      cadência de WhatsApp (colunas com regras, mensagens, motor run_cadence)
supabase/migrations/0003_cron.sql   agendamento do motor (pg_cron)
supabase/migrations/0004_*.sql      Instagram (ig_inbound), vários números (wa_numbers), reinício no Dia 1
supabase/migrations/0005_inbox.sql  coluna Recebidos, mover em lote, contador de envios/24h
supabase/migrations/0006_*.sql      automações limitadas a um funil
supabase/migrations/0007_*.sql      endurecimento de segurança (search_path, permissões de funções)
supabase/functions/                 Edge Functions: whatsapp-webhook, instagram-webhook, whatsapp-send, cadence-run
src/lib/supabase.js                 cliente (real ou mock em modo demo)
src/lib/mock.js                     banco em memória para demonstração
src/lib/store.jsx                   estado global (sessão, perfil, configurações, funis…)
src/pages/                          Dashboard, Pipeline, Contacts, Companies, Activities, Settings, Login
src/components/                     Layout, DealModal, ActivityPanel, ui
```

## Identidade visual

Cores, fontes e logos seguem o Manual da Marca Ascentria (Studio Anamo, 2024): verde-floresta `#2e381a`, oliva `#818a66`, sálvia `#d5dec8`, areia `#cfc9b6`, off-white `#e4e3df`, cobre `#ab6f30`, cinza-azulado `#babec6`. Fontes: **Exo 2** (títulos e rótulos, via Google Fonts) e **Avenir** no corpo (com *Nunito Sans* como reserva quando a Avenir não está instalada). Os tokens ficam em `src/styles.css` (`:root`) e os logos em `src/assets/brand/`. As cores principal e de destaque podem ser trocadas em *Configurações → Marca* sem mexer no código.

## Personalização

| O quê | Onde |
|---|---|
| Nome, logo, cores, moeda, nomes das seções | Configurações → Marca |
| Funis e etapas (cor, probabilidade, ganho/perdido) | Configurações → Funis e etapas |
| Campos extras em contatos, empresas e negócios | Configurações → Campos personalizados |
| Perfis (admin / gestor / vendedor), equipes, visibilidade | Configurações → Usuários e permissões (+ Marca → Visibilidade) |
| Regras "quando X, então Y" | Configurações → Automações |

As automações rodam dentro do banco (triggers), então funcionam mesmo com o CRM fechado. Ações disponíveis: criar atividade, alterar campo do negócio, adicionar tag ao contato. Para envio de e-mail/WhatsApp, o próximo passo natural é uma Edge Function do Supabase disparada por webhook do banco.

## Segurança

- Row Level Security ativo em todas as tabelas; a chave `anon` pode ficar no frontend.
- Vendedores só alteram o que a política permite (`seller_visibility`); apenas admins mexem em configurações, funis, campos, usuários e automações.
- Contas novas ficam inativas até aprovação de um admin.
