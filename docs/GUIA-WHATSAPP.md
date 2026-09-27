# Guia de ativação — Instagram → WhatsApp com a API oficial da Meta

Este guia coloca em funcionamento o funil **Mentoria — Instagram → WhatsApp**:

1. A pessoa manda uma DM no seu Instagram com o número de celular.
2. O CRM cria o contato (com nome e @ do perfil do Instagram) e o negócio na coluna **Recebidos** — nada é enviado ainda.
3. Alguém da equipe move os leads de **Recebidos** para o **Dia 1** (arrastando ou pelo botão *Mover em lote*, informando a quantidade). Isso existe porque a Meta limita quantas conversas a empresa pode iniciar por dia; a coluna Dia 1 mostra "últimas 24h: X / limite". Ao entrar no Dia 1, o lead recebe a primeira mensagem pelo WhatsApp.
4. Sem resposta, o lead avança um dia por vez (Dia 2 … Dia 5), recebendo a mensagem de cada dia — tudo automático daqui em diante.
5. Se responder em qualquer dia (inclusive ainda em Recebidos), vai para **Responsivo** e a conversa continua manual, dentro do CRM, pelo número de WhatsApp que você escolher.
6. Terminou o Dia 5 sem responder → **Arquivado**; 4 meses depois volta sozinho para o **Dia 1** (essa volta é automática e também conta no limite diário).

Tempo estimado: 1 a 2 horas (mais o tempo de aprovação dos templates pela Meta, que costuma levar de minutos a 1 dia).

---

## Antes de começar — 4 coisas que você precisa saber

**1. O número.** A API oficial usa o número de forma exclusiva. Se o +55 48… hoje está no aplicativo WhatsApp / WhatsApp Business do celular, você tem duas opções: (a) migrá-lo para a API (você deixa de usar o app nesse número; as conversas passam a acontecer pelo CRM), ou (b) usar um número novo só para a API. A Meta vem liberando um modo de **coexistência** (app + API no mesmo número) — verifique se já está disponível para você no momento do cadastro; se estiver, é a melhor opção.

**2. A janela de 24 horas.** No WhatsApp, texto livre só é permitido nas 24 h após a última mensagem que o lead mandou **no WhatsApp**. Como o lead chega pelo Instagram (ainda não escreveu no WhatsApp), **todas as mensagens da sequência, do Dia 1 ao Dia 5, precisam ser templates aprovados pela Meta**. Quando ele responde, abre-se a janela e você conversa livremente no painel. O CRM escolhe sozinho o formato certo — você só precisa criar os 5 templates (passo 7).

**2b. Instagram.** A leitura do direct usa a *Messenger API for Instagram*. Exige conta **profissional** (Business ou Creator) conectada a uma **Página do Facebook**, e as permissões `instagram_manage_messages`, `instagram_basic`, `pages_manage_metadata` e `pages_messaging`, que passam por **revisão do app** na Meta (normalmente alguns dias; enquanto isso funciona para os administradores do app, o que já permite testar com a sua conta). Além do texto, a API devolve o nome e o @username do remetente — é assim que o contato entra no CRM já com o nome certo.

**3. Custo.** Mensagens que o lead inicia (ele te chama, você responde em 24 h) são gratuitas. Mensagens de template enviadas por você fora da janela são cobradas por mensagem — categoria *Marketing* custa alguns centavos de dólar por envio no Brasil. Para 100 leads × 4 templates = 400 mensagens/mês, estamos falando de poucas dezenas de reais. Consulte a tabela vigente em <https://developers.facebook.com/docs/whatsapp/pricing>.

**4. Limite diário e verificação da empresa.** Sem verificar o negócio no Business Manager, cada número pode iniciar conversa com até **250 contatos por 24 h**; com verificação o limite sobe em degraus (1.000 → 10.000 → 100.000) conforme a qualidade das mensagens. Por isso a coluna **Recebidos** existe: você decide quantos leads entram no Dia 1 por dia. Configure o limite em *Configurações → Funis e etapas* (campo "Limite diário de envios") para o contador da coluna Dia 1 refletir o seu caso.

---

## Passo 1 — Conta Meta Business e app de desenvolvedor

1. Acesse <https://business.facebook.com> e crie (ou use) o **Portfólio empresarial** da Ascentria.
2. Acesse <https://developers.facebook.com/apps> → **Criar app** → tipo **Empresa (Business)** → dê o nome "Ascentria CRM" e vincule ao portfólio.
3. No painel do app, em **Adicionar produtos**, clique em **WhatsApp → Configurar**.
4. Abra **Configurações do app → Básico** e anote o **Chave secreta do aplicativo** (App Secret). Ele será o `WA_APP_SECRET`.

## Passo 2 — Instagram (gatilho de entrada)

1. Garanta que o Instagram da Ascentria é **profissional** e está vinculado a uma Página do Facebook (Instagram → Configurações → Central de contas / Página conectada).
2. No app (developers.facebook.com), **Adicionar produtos → Messenger → Configurações da API do Instagram** (Instagram Messaging).
3. Em **Gerar tokens de acesso**, conecte a Página vinculada ao Instagram e gere o token → esse é o `IG_ACCESS_TOKEN` (para produção, gere-o via usuário do sistema, como no passo 3, incluindo as permissões do Instagram).
4. Em **Webhooks**, você configurará a URL no passo 6.
5. Para a conta funcionar para qualquer pessoa (não só administradores), envie o app para **Revisão** solicitando `instagram_manage_messages` e `pages_messaging`, com um vídeo curto mostrando o fluxo (DM → lead no CRM).

## Passo 2b — Números de WhatsApp

1. No app, vá em **WhatsApp → Configuração da API**. A Meta oferece um número de teste — útil para validar tudo antes de usar o número real.
2. Para usar o seu número: **Adicionar número de telefone** → informe o nome de exibição ("Ascentria"), categoria, e o número +55 48… → confirme o código por SMS ou ligação.
   - Se o número estiver no app do WhatsApp, a Meta pedirá para removê-lo de lá primeiro (ou oferecerá a coexistência, se disponível).
3. Anote o **ID do número de telefone** (Phone number ID). Cadastre-o no CRM em **Configurações → WhatsApp → + Número** (apelido, número e esse ID). Repita para cada número que vai atender leads; marque um como **padrão** — é ele que envia a sequência automática. Nas conversas manuais você escolhe o número em cada negócio.
4. Todos os números da mesma conta do WhatsApp Business usam o mesmo token (passo 3).

## Passo 3 — Token permanente

O token que aparece em "Configuração da API" expira em 24 h. Para produção, crie um token de **usuário do sistema**:

1. <https://business.facebook.com/settings> → **Usuários → Usuários do sistema** → **Adicionar** → nome "crm-bot", função **Administrador**.
2. Clique no usuário criado → **Adicionar ativos** → aba **Apps** → selecione o app "Ascentria CRM" → marque **Gerenciar app**.
3. Ainda no usuário → **Gerar novo token** → escolha o app → marque as permissões `whatsapp_business_messaging` e `whatsapp_business_management` → **Gerar token** → escolha validade **Nunca expira**.
4. Copie o token agora (ele não aparece de novo). Será o `WA_ACCESS_TOKEN`.
5. Em **Contas → Contas do WhatsApp**, confira se a conta do WhatsApp Business está vinculada ao usuário do sistema com acesso total.

## Passo 4 — Banco de dados (Supabase)

Se ainda não fez a instalação básica (README, seção 2), faça agora. Depois:

1. **SQL Editor** → execute, nesta ordem, `0002_whatsapp_cadence.sql`, `0004_instagram_multinumber.sql` e `0005_inbox.sql` (pasta `supabase/migrations`). Isso cria as colunas de cadência, o histórico de mensagens, a fila de envio, a tabela de números, a leitura do Instagram e o funil **Mentoria — Instagram → WhatsApp** com as 5 mensagens de exemplo.
2. Confira em **Table Editor** que apareceram as tabelas `wa_messages`, `wa_outbox` e `wa_numbers`.

## Passo 5 — Edge Functions e secrets

Você precisa da **Supabase CLI** no seu computador (<https://supabase.com/docs/guides/cli>). No terminal, dentro da pasta do projeto:

```bash
supabase login
supabase link --project-ref SEU-PROJETO      # o "ref" aparece na URL do painel

# secrets (troque pelos seus valores)
supabase secrets set WA_ACCESS_TOKEN="EAAG..." \
  WA_VERIFY_TOKEN="uma-palavra-secreta-que-voce-inventa" \
  WA_APP_SECRET="chave-secreta-do-app" \
  IG_ACCESS_TOKEN="EAAG..." \
  CRON_SECRET="outra-palavra-secreta-longa"

# publicar as quatro funções
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy instagram-webhook --no-verify-jwt
supabase functions deploy whatsapp-send
supabase functions deploy cadence-run --no-verify-jwt
```

> `--no-verify-jwt` é necessário nos webhooks (a Meta não envia token do Supabase) e no motor (chamado pelo cron com o `CRON_SECRET`). A segurança deles é feita pela assinatura da Meta e pelo `CRON_SECRET`, respectivamente. `WA_PHONE_NUMBER_ID` continua aceito como reserva, mas os números agora ficam cadastrados no CRM.

Teste: abra `https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=SUA-PALAVRA&hub.challenge=123` no navegador. Deve aparecer `123`.

## Passo 6 — Webhooks no painel da Meta

**WhatsApp**
1. No app → **WhatsApp → Configuração** (Configuration) → **Webhook → Editar**.
2. **URL de callback:** `https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-webhook` (o CRM mostra em *Configurações → WhatsApp*).
3. **Token de verificação:** o mesmo valor de `WA_VERIFY_TOKEN` → **Verificar e salvar**.
4. Em **Campos do webhook → Gerenciar**, assine **`messages`**.

**Instagram**
1. No app → **Webhooks** (menu lateral) → escolha o objeto **Instagram** → **Assinar a este objeto**.
2. **URL de callback:** `https://SEU-PROJETO.supabase.co/functions/v1/instagram-webhook`, mesmo token de verificação → **Verificar e salvar**.
3. Assine o campo **`messages`**.
4. Em **Messenger → Configurações da API do Instagram → Webhooks**, confirme que a Página/Instagram está assinada (botão *Adicionar assinaturas* → `messages`).

Teste: mande uma DM do seu Instagram pessoal para a conta da Ascentria com um texto como "quero saber da mentoria, meu whats é 48 99999-0000". O contato deve aparecer em **Contatos** com o @ do perfil e o negócio na coluna **Recebidos**. Uma DM sem número gera a tarefa "Instagram: pedir número".

## Passo 7 — Templates das mensagens (Dia 1 a Dia 5)

1. <https://business.facebook.com/wa/manage/message-templates> → **Criar modelo**.
2. Categoria **Marketing**, idioma **Português (BR)**, nome exatamente como abaixo.
3. Cole o corpo de cada modelo. `{{1}}` é o primeiro nome do lead; informe um exemplo (ex.: "Fernanda") quando a Meta pedir. O Dia 2 não tem variável.

   **`mentoria_dia_1`**
   > Oi, {{1}}! Aqui é a Mari, do time do enfermeiro Murilo Pedroso. Você solicitou no Instagram uma consultoria gratuita para estruturar seu consultório de enfermagem com faturamento de mais de 10 mil reais mensais.
   > Posso te passar os horários disponíveis para esta semana?

   **`mentoria_dia_2`**
   > Poderia ouvir o áudio que enviei?

   **`mentoria_dia_3`**
   > Oi, {{1}}! Você ainda tem interesse na consultoria para estruturar seu consultório de enfermagem com a meta de faturar pelo menos R$ 10 mil por mês? Se tiver alguma dúvida antes de agendar, pode me falar por aqui.

   **`mentoria_dia_4`**
   > Oi, {{1}}! Passando para retomar a consultoria gratuita que você pediu pelo Instagram. Posso te enviar os horários disponíveis para agendarmos?

   **`mentoria_dia_5`**
   > {{1}}, esta é minha última mensagem sobre a consultoria gratuita que você pediu pelo Instagram.
   > Se ainda quiser agendar, responda SIM que te envio os horários. Se não for o momento, responda NÃO e encerro o contato por aqui.

4. Envie cada um para análise (5 modelos no total). O texto aprovado na Meta é o que o lead recebe; o texto da coluna no CRM serve de roteiro e é usado quando a conversa já está aberta (lead respondeu nas últimas 24 h).
5. Dicas para aprovação rápida: nada de CAPS LOCK exagerado, sem links encurtados, texto claro sobre quem você é.
6. As colunas Dia 1 a Dia 5 já estão com **Enviar automaticamente** ligado e o nome do modelo preenchido (`mentoria_dia_N`). Confira em **Configurações → Funis e etapas → Mentoria** → botão **⚙** de cada coluna.

Enquanto os templates não estiverem aprovados, deixe as colunas em **Criar tarefa para eu enviar manualmente**: o CRM cria a tarefa com o roteiro do dia e você envia pelo próprio painel de conversa (ou pelo celular).

### Modelos do funil Reativação

Leads que ficam 4 meses no Arquivado da Mentoria passam sozinhos para o **Dia 1 do funil Reativação** (configurável em *Configurações → Funis e etapas → Mentoria*). Quem não responder na Reativação fica 4 meses arquivado e recomeça a Reativação. Crie estes 5 modelos (Marketing, Português (BR), variável tipo Número, exemplo "Fernanda"):

**`reativacao_dia_1`**
> Oi, {{1}}! Aqui é a Mari, do time do enfermeiro Murilo Pedroso. Há alguns meses você demonstrou interesse na consultoria gratuita para estruturar seu consultório de enfermagem. Como estão as coisas por aí? Esse ainda é um objetivo seu?

**`reativacao_dia_2`**
> Oi, {{1}}! Uma pergunta rápida: hoje, o que mais te impede de fazer seu consultório de enfermagem faturar mais? Pode me responder em uma frase que eu te ajudo a partir daí.

**`reativacao_dia_3`**
> Oi, {{1}}! O enfermeiro Murilo abriu novos horários para a consultoria gratuita. Nela, ele ajuda você a estruturar seu consultório com a meta de faturar pelo menos R$ 10 mil por mês. Quer que eu te envie as opções?

**`reativacao_dia_4`**
> Oi, {{1}}! Ainda tenho alguns horários livres nesta semana para a consultoria gratuita. Posso reservar um para você?

**`reativacao_dia_5`**
> Oi, {{1}}, esta é minha última mensagem por agora sobre a consultoria gratuita.
> Se quiser agendar, responda SIM que te envio os horários. Se não for o momento, responda NÃO e encerro o contato por aqui.

## Passo 8 — Agendar o motor (roda sozinho, de hora em hora)

1. **SQL Editor** → abra `supabase/migrations/0003_cron.sql`, troque `<SEU-PROJETO>` e `<CRON_SECRET>` pelos seus valores e execute.
2. Confira com `select * from cron.job;`.
3. Para rodar na hora (sem esperar): CRM → **Configurações → WhatsApp → Rodar agora**.

O motor faz, a cada execução: avança quem cumpriu o prazo da coluna (padrão 1 dia), arquiva quem terminou a sequência sem responder, devolve ao **Dia 1** quem completou os 4 meses arquivado (recomeçando a sequência; o card mostra "2ª passagem") e envia as mensagens pendentes. Se um dia você preferir tratar os arquivados manualmente, basta criar uma coluna com a função *Reativar*: o motor passa a mandá-los para lá, com uma tarefa "Retomar contato".

## Passo 9 — Frontend

No Render (ou onde o app estiver publicado), nada muda: as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` já bastam. Faça o deploy da versão nova do código.

---

## Como usar no dia a dia

- **Funil → Mentoria — Instagram → WhatsApp**: leads novos ficam em **Recebidos**; use o botão *Mover em lote para o Dia 1* (ou arraste) para liberar a quantidade do dia. Cada coluna mostra há quantos dias o lead está nela e se o envio é automático ou manual.
- Abra um card para ver a **conversa completa** (a DM do Instagram aparece marcada com 📷), escolher o **número de WhatsApp que atende** aquele lead, responder (texto dentro das 24 h, template fora) e ver o histórico de colunas.
- **Contatos** mostra o @ do Instagram; **Atividades** lista as tarefas "Enviar mensagem — Dia N" (colunas manuais) e "Instagram: pedir número" (DM sem celular).
- **Painel** mostra quantos leads estão em sequência.
- **Configurações → WhatsApp** gerencia os números, mostra as URLs dos webhooks e permite rodar o motor na hora.
- Para mudar a sequência (mais dias, outro intervalo, novas mensagens): **Configurações → Funis e etapas**, adicione/renomeie colunas e ajuste o ⚙ de cada uma. Só colunas com função **Dia da sequência** participam do avanço automático; a ordem das colunas é a ordem da sequência.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Lead mandou mensagem e não apareceu | Webhook não assinado no campo `messages`, ou URL/token errados | Passo 6; veja **Edge Functions → whatsapp-webhook → Logs** no Supabase |
| "Assinatura inválida" nos logs | `WA_APP_SECRET` diferente do App Secret do app | Copie de novo em Configurações do app → Básico |
| Template "falhou" na conversa | Nome do template errado, não aprovado, ou idioma diferente | Confira o nome exato e `pt_BR` no WhatsApp Manager |
| Erro 131047 / "re-engagement" | Tentou texto livre fora da janela de 24 h | Use template (o CRM já força isso quando `last_inbound_at` > 24 h) |
| Erro 190 / token inválido | Token temporário expirou | Passo 3: token de usuário do sistema sem expiração |
| Mensagens não saem sozinhas | Cron não agendado ou `CRON_SECRET` diferente | Passo 8; `select * from cron.job_run_details order by start_time desc limit 10;` |
| Lead não foi para "Responsivo" | Não existe coluna com função *Responsivo* no funil | Configurações → Funis → ⚙ da coluna → função Responsivo |
| DM do Instagram não vira lead | Webhook do Instagram não assinado, Página não vinculada, ou permissões sem revisão | Passo 2 e 6; logs em **Edge Functions → instagram-webhook** |
| Contato do Instagram sem nome ("Instagram 1784…") | `IG_ACCESS_TOKEN` ausente ou sem permissão | Passo 2, item 3; o nome é corrigido na próxima DM |
| "Nenhum número de WhatsApp cadastrado" | Números sem o ID da Meta | Configurações → WhatsApp → Editar número → ID do número de telefone |
