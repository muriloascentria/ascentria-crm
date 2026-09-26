# Ascentria CRM — Documento de contexto do projeto

Documento de passagem de contexto. Quem ler só isto deve conseguir entender o projeto inteiro e continuar o trabalho. Data de referência: 26/09/2026. Dono do projeto: Murilo (murilo@ascentria.com.br), empresa Ascentria (terapia e saúde integrativa, vende mentoria).

---

## 1. O que é o projeto

Um CRM web personalizável para a Ascentria, construído do zero. Tem contatos, empresas, funis de vendas em kanban (arrastar e soltar), atividades/tarefas, campos personalizados, permissões por perfil (admin / gestor / vendedor), automações do tipo "quando X, então Y" e identidade visual da marca.

O recurso central é o **funil "Mentoria — Instagram → WhatsApp"**: leads que mandam DM no Instagram com um número de celular caem automaticamente no CRM (coluna *Recebidos*, com nome e @ do perfil), a equipe libera manualmente uma quantidade por dia para o *Dia 1* (respeitando o limite diário da Meta), e a partir daí o sistema envia sozinho uma sequência de mensagens pelo WhatsApp (Dia 1 → Dia 5, um dia por coluna). Se o lead responde, o card vai para *Responsivo* e a conversa continua manual dentro do CRM, por qualquer um dos números de WhatsApp cadastrados. Se não responde até o Dia 5, é *Arquivado* e volta sozinho ao Dia 1 depois de 4 meses.

Stack: **React 19 + Vite 8** (frontend estático, JavaScript/JSX, sem TypeScript no front), **Supabase** (Postgres 17 + Auth + RLS + Edge Functions em Deno/TypeScript) e **Render** (hospedagem do site estático). Integração com a **API oficial da Meta** (WhatsApp Cloud API e Instagram Messaging API).

---

## 2. Onde cada parte está

### Código-fonte
- **GitHub:** `https://github.com/muriloascentria/ascentria-crm` — repositório **público**, branch de produção **`main`**.
- Estado atual do repositório: **INCOMPLETO**. Foi feito um único commit ("Add files via upload") pelo navegador do GitHub contendo só os arquivos da raiz (`.env.example`, `.gitignore`, `.oxlintrc.json`, `README.md`, `index.html`, `package-lock.json`, `package.json`, `render.yaml`, `vite.config.js`). **Faltam as pastas `src/`, `public/`, `supabase/` e `docs/`.** O código completo está no arquivo `ascentria-crm-codigo.zip` (última versão entregue na conversa anterior; Murilo tem o zip no computador). A primeira tarefa da nova conversa é colocar o repositório completo (descompactar o zip, `git add` de tudo exceto `node_modules`, `dist`, `dist-demo`, `.env`, commit e push para `main`).
- O `.gitignore` já exclui `node_modules`, `dist`, `dist-demo`, `.env` e `.env.local`.

### Hospedagem do site (Render)
- Workspace Render: "Murilo's workspace" (`tea-da3ljhf10e5c738olpb0`), conta murilo@ascentria.com.br.
- Serviço: **Static Site `ascentria-crm`** (`srv-das4hprbc2fs739a1tp0`), URL pública **https://ascentria-crm.onrender.com**, painel: https://dashboard.render.com/static/srv-das4hprbc2fs739a1tp0.
- Configuração: repo `https://github.com/muriloascentria/ascentria-crm`, branch `main`, build command `npm ci && npm run build`, publish directory `dist`, **deploy automático a cada commit na `main`**.
- Variáveis de ambiente já definidas no serviço: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (chave pública/publishable do Supabase, que é segura de expor no frontend).
- **Primeiro deploy falhou** (`Failed to resolve /src/main.jsx from index.html`) justamente porque a pasta `src/` não está no GitHub. Ao subir o código completo, o Render refaz o deploy sozinho.
- **Pendente no Render:** a regra de rewrite `/* → /index.html` (necessária para as rotas do React Router funcionarem ao recarregar a página ou abrir um link direto como `/contatos/...`). O arquivo `render.yaml` na raiz já declara essa regra (`routes: type rewrite, source /*, destination /index.html`), mas como o serviço foi criado pela API e não por Blueprint, é preciso confirmar no painel (*Redirects/Rewrites*) e adicionar manualmente se não estiver lá.
- O mesmo workspace tem outros dois sites estáticos não relacionados (`ascentria-area-do-aluno` e `ascentria-area-aluno`, repo `muriloascentria/ascentria-area-aluno`). Não mexer.

### Banco de dados e backend (Supabase)
- Organização Supabase: **Ascentria** (`jpsjpyjqjqqtuyxpsrmk`), plano **Pro**.
- Projeto: **`ascentria-crm`**, ref **`rtrtfxraiaudtkkdjmkn`**, região **sa-east-1 (São Paulo)**, Postgres 17. URL da API: `https://rtrtfxraiaudtkkdjmkn.supabase.co`.
- Criado manualmente por Murilo em 26/09/2026 (a criação via API falhou por timeout três vezes).
- **Migrações já aplicadas no projeto** (na ordem): `0001_init`, `0002_whatsapp_cadence`, `0004_instagram_multinumber`, `0005_inbox`, `0006_automation_pipeline_filter`, `0007_hardening`. A `0003_cron.sql` **não** foi aplicada de propósito (só depois das Edge Functions, ver pendências).
- Estado verificado: 2 funis, 17 colunas, tabela `wa_numbers` com 1 linha placeholder ("Principal", `phone_number_id = 'CONFIGURE-NO-PAINEL'`) que precisa ser editada quando houver número real.
- Edge Functions: **ainda não publicadas**. Código em `supabase/functions/` (`whatsapp-webhook`, `instagram-webhook`, `whatsapp-send`, `cadence-run`, mais `_shared/wa.ts`). Já passaram por `deno check` sem erros.
- A mesma organização tem outros projetos não relacionados: `Painel do Mentorado`, `ascentria-metodo-essencia`, `prontuario-clinico`. Não mexer.

### Domínio próprio
- Nenhum configurado. O site usa o subdomínio `ascentria-crm.onrender.com`. Não há DNS a gerenciar por enquanto.

### Serviços externos
- **Meta (WhatsApp Cloud API + Instagram Messaging API):** nada foi criado ainda (app, números, tokens, templates, webhooks). É a "Fase B" do plano de ativação, toda no lado de Murilo, com passo a passo em `docs/GUIA-WHATSAPP.md`.
- **Google Fonts:** Exo 2 e Nunito Sans carregadas por `<link>` no `index.html`.
- **Google Drive** (só como fonte de material): pasta da marca da Ascentria (dona: mariane@ascentria.com.br), com `Manual_da_Marca.pdf` (155 MB, todo em imagem), `Manual_Complementar.pdf`, logos e fontes (Exo 2, Avenir LT Std, Magice). Os logos já foram convertidos e estão em `src/assets/brand/`.
- Não há e-mail transacional, pagamentos ou analytics. O e-mail de autenticação (confirmação/reset de senha) é o do próprio Supabase Auth.
- Uma **demo navegável** com dados fictícios está publicada como artefato privado na conta Claude de Murilo (versão "Identidade visual Ascentria"); é gerada por `npm run build:demo` e não depende de banco.

---

## 3. Como uma alteração de código chega ao ar

1. Editar o código localmente (pasta do projeto descompactada do zip, ou clone do GitHub quando estiver completo).
2. Testar localmente: `npm install` uma vez; `npm run dev:demo` (dados fictícios, sem banco) ou `npm run dev` com um `.env` preenchido a partir de `.env.example` (aponta para o projeto Supabase real).
3. **Sempre rodar `npm run build` antes de publicar** e conferir que termina com `✓ built` — o Render usa exatamente esse comando e um erro de build derruba o deploy.
4. `git add -A && git commit -m "..." && git push origin main`.
5. O Render detecta o commit na `main`, roda `npm ci && npm run build` e publica a pasta `dist` em https://ascentria-crm.onrender.com (3–5 minutos). Acompanhar em *Events/Logs* no painel do serviço.
6. Alterações de **banco** não passam pelo Render: são arquivos novos em `supabase/migrations/` (numeração sequencial `00NN_nome.sql`) aplicados no projeto Supabase via SQL Editor, CLI (`supabase db push`) ou MCP. Sempre versionar o arquivo no repositório também.
7. Alterações em **Edge Functions**: `supabase functions deploy <nome>` (ver seção 6 para o primeiro deploy).

---

## 4. Convenções técnicas

- **Node 22+** (Render usa Node 24 por padrão; funciona). npm 10+. Sem TypeScript no frontend (arquivos `.jsx`/`.js`); TypeScript só nas Edge Functions (Deno).
- Frontend: React 19, React Router 7, `@supabase/supabase-js` v2, Vite 8 (usa Rolldown), lint com `oxlint`. Sem Tailwind, sem UI kit: CSS próprio em `src/styles.css` com tokens em `:root`. Sem biblioteca de drag-and-drop (HTML5 nativo).
- Estrutura: `src/lib/supabase.js` (cliente real ou mock), `src/lib/mock.js` (banco em memória para a demo — **espelha as regras do SQL; toda mudança de regra de negócio no banco deve ser replicada aqui para a demo continuar fiel**), `src/lib/store.jsx` (contexto global: sessão, perfil, settings, funis, etapas, usuários, campos, números), `src/lib/wa.js` (helpers do WhatsApp/Instagram), `src/pages/*` (Dashboard, Pipeline, Contacts, Companies, Activities, Settings, Login, ResetPassword), `src/components/*` (Layout, DealModal, ActivityPanel, WhatsAppPanel, ui).
- **Modo demo:** `VITE_DEMO=1` troca o cliente Supabase pelo mock, usa `HashRouter` em vez de `BrowserRouter` e `vite-plugin-singlefile` gera um único HTML (`dist-demo/index.html`) com imagens embutidas (`assetsInlineLimit` alto). Em produção `VITE_DEMO` não existe.
- Variáveis de ambiente do front: apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Vite só expõe variáveis com prefixo `VITE_`.
- Regras de negócio vivem **no banco** (funções PL/pgSQL, triggers, RLS), não no frontend. O frontend só lê/escreve tabelas e chama RPCs (`run_cadence`, `move_inbox_to_day1`, `sent_last_24h`) e Edge Functions (`whatsapp-send`, `cadence-run`). O mock reimplementa isso em JS.
- Textos da interface em **português do Brasil**; moeda padrão BRL; datas via `Intl` pt-BR.
- Identidade visual (Manual da Marca, Studio Anamo 2024): verde-floresta `#2e381a` (primária), oliva `#818a66`, sálvia `#d5dec8`, areia `#cfc9b6`, off-white `#e4e3df`, cobre `#ab6f30` (destaque), cinza-azulado `#babec6`. Fontes: Exo 2 (títulos/rótulos), Avenir com fallback Nunito Sans (corpo), Magice só no logotipo (imagem). Logos em `src/assets/brand/` (gerados por recolorização das máscaras PNG originais). Cores primária/destaque também podem ser alteradas em tempo de execução em *Configurações → Marca* (tabela `org_settings`).
- Coisas que costumam quebrar: (a) esquecer de rodar `npm run build` antes do push; (b) mudar o nome de uma coluna/tabela no SQL sem atualizar `src/` e `src/lib/mock.js`; (c) mudar a assinatura de funções SQL chamadas pelas Edge Functions (`wa_inbound`, `ig_inbound`, `run_cadence`) sem atualizar o TypeScript; (d) faltar a regra de rewrite no Render (rotas diretas dão 404); (e) `import.meta.env` indefinido em produção por variável sem prefixo `VITE_`.

---

## 5. Histórico e decisões (o que não é óbvio)

- **Frontend em Render + banco em Supabase** foi escolhido porque Murilo já usava os dois (outros projetos da Ascentria). A alternativa Vercel/Netlify não foi usada.
- **Primeiro usuário cadastrado vira admin ativo** (trigger `handle_new_user` em `auth.users`). Todos os seguintes entram como *vendedor inativo* e ficam numa tela "Aguardando aprovação" até um admin ativar em *Configurações → Usuários*. **Ninguém deve criar uma conta de teste antes de Murilo**, ou essa conta vira o admin.
- Perfis: `admin` (tudo), `manager` (vê/edita todos os registros), `seller` (conforme `org_settings.seller_visibility`: `all` ou `own`). RLS implementa isso via funções `is_admin()`, `is_manager_or_admin()`, `is_active_user()`, `can_access(owner_id)`.
- **Funis e colunas são dados, não código.** Cada coluna (`stages`) tem `role` (`inbox`, `day`, `responsive`, `archived`, `reactivate` ou nulo), `advance_after_days`, `message_text`, `wa_template_name`, `wa_template_lang`, `auto_send`, além de `kind` (`open`/`won`/`lost`), `color`, `probability`. O motor identifica "o funil de cadência" como o funil que tem colunas com `role = 'day'`; a ordem das colunas de dia é a ordem da sequência.
- **Fluxo decidido para o funil de mentoria** (evoluiu em três rodadas): (1) gatilho é a **DM do Instagram contendo celular** — não uma mensagem no WhatsApp; (2) o lead cai em **Recebidos** sem envio; a passagem para o Dia 1 é **manual e dosada** (arrastar ou botão "Mover em lote para o Dia 1", que move os mais antigos primeiro e sugere a quantidade = limite diário − enviados nas últimas 24 h); (3) Dia 1 → Dia 5 → Arquivado é automático (`run_cadence()`, 1 dia por coluna por padrão); (4) resposta do lead em qualquer coluna (inclusive Recebidos) → *Responsivo* (feito pelo webhook do WhatsApp); (5) arquivado volta ao **Dia 1** após `pipelines.archive_months` (4) — a coluna "Reativar" foi removida do funil padrão e virou opcional (se existir uma coluna com `role = 'reactivate'`, o motor manda o lead para ela com uma tarefa "Retomar contato" em vez de reiniciar); (6) `deals.cycle` conta as passagens pela sequência.
- **Regra da Meta que moldou o design:** texto livre só é permitido nas 24 h após a última mensagem do lead no WhatsApp. Como o lead vem do Instagram (nunca escreveu no WhatsApp), **todas as mensagens Dia 1–5 precisam ser templates aprovados** (`mentoria_dia_1` … `mentoria_dia_5`, variável `{{1}}` = primeiro nome). `queue_stage_message()` escolhe sozinho: texto livre se `in_wa_window(deal)`, senão template; se `auto_send` for falso, cria uma tarefa "Enviar mensagem — Dia N" com o roteiro em vez de enviar.
- **Limite diário da Meta** (250 conversas iniciadas por número sem verificação da empresa): existe `pipelines.daily_limit` (padrão 250) e a coluna Dia 1 mostra "últimas 24h: X / limite" (RPC `sent_last_24h`, que conta `wa_messages` de saída do tipo template).
- **Vários números de WhatsApp:** tabela `wa_numbers` (apelido, número, `phone_number_id` da Meta, padrão, ativo, responsável). O número padrão envia a sequência automática; cada negócio tem `deals.wa_number_id` ("número que atende"); envios manuais usam esse número. O token de acesso é único para todos os números (mesma conta WhatsApp Business) e fica em secret, nunca no banco.
- **Instagram:** `ig_inbound()` extrai o celular do texto com `extract_br_phone()` (aceita `(48) 99911-2233`, `48 9 9911 2233`, `+55 48…`, etc.), busca/cria o contato por `ig_id` ou pelo telefone, guarda `ig_username`; a Edge Function consulta a Graph API para pegar nome e @ do perfil (`IG_ACCESS_TOKEN`). DM **sem número** não entra na sequência: cria a tarefa "Instagram: pedir número — <nome>" (uma só por contato); quando o número chega numa DM seguinte, o lead entra em Recebidos. Mensagens do Instagram ficam na mesma tabela `wa_messages` com `channel = 'instagram'`.
- **Lead que escreve direto no WhatsApp** (sem Instagram) entra já em *Responsivo* (janela de 24 h aberta), não em Recebidos.
- **Automações genéricas** (`automations`: gatilhos `deal_created`, `deal_stage_changed`, `deal_won`, `deal_lost`, `contact_created`; ações `create_activity`, `set_deal_field`, `add_tag`) podem ser limitadas a um funil via `trigger_config.pipeline_id` (migração 0006). O follow-up padrão "Primeiro contato" foi restrito ao Funil de Vendas para não gerar tarefas para leads do Instagram.
- **Motor `run_cadence()` é idempotente e roda de hora em hora** (pg_cron → `net.http_post` → Edge Function `cadence-run`, que depois processa a fila `wa_outbox` com até 3 tentativas por mensagem). Também pode ser disparado pelo botão "Rodar agora" (Configurações → WhatsApp) por um admin logado.
- **Segurança das Edge Functions:** webhooks validam a assinatura `X-Hub-Signature-256` com `WA_APP_SECRET`; `cadence-run` aceita `CRON_SECRET` ou JWT de admin; `whatsapp-send` exige usuário ativo. `wa_inbound`, `ig_inbound` e `run_cadence` têm EXECUTE só para `service_role`. A migração 0007 fixou `search_path` e revogou EXECUTE de funções internas para `anon`/`authenticated` (resultado do linter de segurança do Supabase; restaram só avisos aceitáveis).
- **Demo:** modo `VITE_DEMO=1` com dados fictícios, botões "📷 Simular DM do Instagram" e "⏩ Simular +1 dia" (só na demo), e resposta simulada do lead 2 s após um envio. Publicada como artefato na conta Claude de Murilo, atualizada 5 vezes.
- Todo o SQL foi testado num Postgres 16 local com simulação de `auth.uid()` (cadência completa, RLS, Instagram, múltiplos números, reinício no Dia 1, lote); o frontend foi testado com Playwright.
- O `Manual_da_Marca.pdf` (155 MB) não pôde ser lido (só imagens, grande demais); a paleta veio das variações oficiais do logo em RGB e as fontes da pasta do Drive. Se o manual trouxer regras diferentes, ajustar tokens em `src/styles.css`.

---

## 6. Pendências conhecidas (em ordem)

1. **Completar o repositório GitHub** com `src/`, `public/`, `supabase/`, `docs/` (a partir do zip) e fazer push na `main`. O Render vai redeployar sozinho. Conferir nos logs do Render que o build passa.
2. **Regra de rewrite no Render** (`/*` → `/index.html`, tipo Rewrite) — confirmar/adicionar no painel do serviço.
3. **Supabase Auth:** em *Authentication → Providers → Email* deixar habilitado (decidir se desativa *Confirm email*); em *URL Configuration* colocar Site URL `https://ascentria-crm.onrender.com` e Redirect URL `https://ascentria-crm.onrender.com/redefinir-senha`.
4. **Primeiro acesso:** Murilo cria a conta no site publicado (vira admin). Só depois disso outras pessoas se cadastram.
5. **Fase B — Meta** (tudo no lado de Murilo; guia completo em `docs/GUIA-WHATSAPP.md`): app Business em developers.facebook.com com produtos WhatsApp e Messenger/Instagram; Instagram profissional ligado a Página do Facebook; revisão do app para `instagram_manage_messages` e `pages_messaging`; cadastrar número(s) no WhatsApp Business Platform (regra: o número não pode estar no app comum do WhatsApp, salvo modo coexistência); token permanente de usuário do sistema; 5 templates de marketing aprovados.
6. **Publicar as Edge Functions** com a Supabase CLI: `supabase login`, `supabase link --project-ref rtrtfxraiaudtkkdjmkn`, `supabase secrets set WA_ACCESS_TOKEN=… WA_VERIFY_TOKEN=… WA_APP_SECRET=… IG_ACCESS_TOKEN=… CRON_SECRET=…`, depois `supabase functions deploy whatsapp-webhook --no-verify-jwt`, `supabase functions deploy instagram-webhook --no-verify-jwt`, `supabase functions deploy whatsapp-send`, `supabase functions deploy cadence-run --no-verify-jwt`.
7. **Webhooks na Meta** apontando para `https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/whatsapp-webhook` e `…/instagram-webhook`, campo `messages`, token de verificação = `WA_VERIFY_TOKEN`.
8. **Cadastrar os números no CRM** (Configurações → WhatsApp → editar o placeholder "Principal" com o `phone_number_id` real; adicionar os demais) e marcar `auto_send` + nome do template nas colunas Dia 1–5.
9. **Aplicar `supabase/migrations/0003_cron.sql`** (substituindo `<SEU-PROJETO>` por `rtrtfxraiaudtkkdjmkn` e `<CRON_SECRET>` pelo valor real) para agendar o motor de hora em hora.
10. Teste ponta a ponta com o número de teste da Meta e, depois, migração do número real e verificação da empresa no Business Manager (sobe o limite diário).
11. Melhorias possíveis, não solicitadas: realtime nas conversas (hoje o painel de WhatsApp atualiza a cada 5 s), notificações, envio de mídia, domínio próprio.

---

## 7. Cuidados para não quebrar nada

- **Credenciais existentes e onde ficam** (nunca colar valores em documentos/commits):
  - Chave pública (anon/publishable) do Supabase: em `.env.example`, nas variáveis do serviço Render e no painel Supabase (*Project Settings → API*). É pública por design; a segurança vem do RLS.
  - Chave `service_role` do Supabase: só no painel; as Edge Functions a recebem automaticamente. Nunca no frontend.
  - Senha do banco Postgres: definida por Murilo ao criar o projeto.
  - Futuros: `WA_ACCESS_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `IG_ACCESS_TOKEN`, `CRON_SECRET` — só como *secrets* das Edge Functions (`supabase secrets set`); o `CRON_SECRET` também aparece dentro do comando `cron.schedule` no banco.
  - Tokens do Render, GitHub e Meta: nas respectivas contas de Murilo.
- **Não alterar sem cuidado:** as funções SQL `wa_inbound`, `ig_inbound`, `run_cadence`, `queue_stage_message`, `move_inbox_to_day1` (as Edge Functions e o frontend dependem das assinaturas); os triggers `deals_sync_status`, `deals_touch_stage`, `deals_cadence_on_enter`, `deals_automations` (ordem e efeitos encadeados: status/pipeline coerentes com a etapa, `stage_entered_at`, fila de mensagens, histórico); as políticas RLS e as funções `is_*`/`can_access` (usadas pelas políticas — revogar EXECUTE de `authenticated` nelas quebra o app); os IDs fixos dos funis padrão (`00000000-0000-0000-0000-000000000001` Funil de Vendas, `…0002` Mentoria) referenciados por migrações e automações.
- **Nunca reaplicar migrações antigas** no projeto (elas criam tabelas e fariam erro/duplicação). Toda mudança de schema é uma migração nova e numerada.
- **`0003_cron.sql` cria um job que chama a Edge Function com o `CRON_SECRET`** — se o secret mudar, reagendar (`cron.unschedule('crm-cadence-hourly')` e rodar de novo).
- **Trigger em `auth.users`** (`on_auth_user_created`): se for removido, novos usuários ficam sem perfil e não conseguem entrar.
- **Envios reais custam dinheiro** (templates de marketing da Meta) e contam no limite diário: qualquer teste com `auto_send` ligado e credenciais reais dispara mensagens de verdade. Para testar sem enviar, deixar as colunas em "Criar tarefa para eu enviar manualmente" ou não configurar `WA_ACCESS_TOKEN`.
- **Webhooks precisam responder 200 rápido** (a Meta reenvia e pode desativar o webhook se falhar muito); `wa_inbound`/`ig_inbound` ignoram mensagens duplicadas pelo `wa_message_id`.
- O `src/lib/mock.js` é só para demonstração; não é usado em produção, mas quebra o `npm run build:demo` se ficar desatualizado em relação às tabelas usadas pelo frontend.
- Arquivos gerados (`dist/`, `dist-demo/`, `node_modules/`) nunca vão para o GitHub.
