# Zendesk Equalizer

Ferramenta web para **equalizar configurações entre ambientes Zendesk** (ex.: sandbox → homologação → produção).
Antes de aplicar qualquer coisa, mostra um diff no estilo "merge do GitHub": o que será criado, o que será substituído e exatamente quais informações mudam.

## Objetivos

- Escolher **ambiente de origem** e **ambiente de destino**.
- Escolher **o que migrar**: grupos, campos de ticket, formulários, gatilhos, automações.
- Visualizar o diff por item (verde = entra, vermelho = sai) e selecionar item a item.
- **Warning visível** sempre que o destino for produção.
- **Modal de confirmação obrigatório** antes de qualquer escrita. Em produção, o usuário precisa digitar o nome do ambiente.

## Stack

| Camada    | Tecnologia                                   |
|-----------|----------------------------------------------|
| Frontend  | Vue 3 + Vite (sem lib de UI, sem store/router) |
| Backend   | Node.js 24+ + Express + TypeScript            |
| Diff      | `diff` (jsdiff) — diff linha a linha do JSON  |
| Zendesk   | REST API v2, autenticação por API token       |

## Arquitetura

```
 Navegador (Vue)                Backend (Express)                   Zendesk
 ┌──────────────┐  /api/*  ┌────────────────────────┐   REST v2   ┌──────────────┐
 │ App.vue      │ ───────▶ │ index.ts   (rotas)     │ ──────────▶ │ origem       │
 │ DiffView.vue │          │ zendesk.ts (client)    │ ──────────▶ │ destino      │
 │ ConfirmModal │ ◀─────── │ diff.ts    (compare)   │             └──────────────┘
 └──────────────┘          └────────────────────────┘
```

- As **credenciais ficam só no backend** (`.env`). O front conhece apenas o nome dos ambientes.
- O backend **recalcula o diff no momento de aplicar** — nunca confia no payload vindo do navegador.

```
server/
  index.ts       rotas HTTP
  zendesk.ts     client Zendesk (paginação, create/update, retry em 429)
  diff.ts        matching por título, remapeamento de IDs, status
  diff.test.ts   testes (node:test)
web/
  index.html, vite.config.ts
  src/App.vue                     tela única
  src/components/DiffView.vue     diff estilo GitHub
  src/components/ConfirmModal.vue modal de confirmação
```

## Configuração (`.env`)

```
PORT=3001
ENVIRONMENTS=sandbox,producao
PRODUCTION_ENV=producao

SANDBOX_SUBDOMAIN=minhaempresa-sandbox
SANDBOX_EMAIL=admin@empresa.com
SANDBOX_TOKEN=xxxxx

PRODUCAO_SUBDOMAIN=minhaempresa
PRODUCAO_EMAIL=admin@empresa.com
PRODUCAO_TOKEN=xxxxx
```

Para cada nome em `ENVIRONMENTS`, o backend lê `<NOME>_SUBDOMAIN`, `<NOME>_EMAIL` e `<NOME>_TOKEN` (nome em maiúsculas).
O token é gerado em *Admin Center → Apps e integrações → APIs → API do Zendesk*.

## Tipos suportados

| Tipo              | Endpoint                   | Chave de matching | Observação                          |
|-------------------|----------------------------|-------------------|-------------------------------------|
| Grupos            | `/api/v2/groups`           | `name`            | Ignora `default` e grupos apagados  |
| Campos de ticket  | `/api/v2/ticket_fields`    | `title`           | Só campos customizados (sistema é ignorado) |
| Formulários       | `/api/v2/ticket_forms`     | `name`            | Remapeia `ticket_field_ids` e condições |
| Gatilhos          | `/api/v2/triggers`         | `title`           | Remapeia campos, formulários e grupos |
| Automações        | `/api/v2/automations`      | `title`           | Idem gatilhos                       |

Adicionar um tipo novo (ex.: macros, views) = uma linha em `TYPES` (`server/zendesk.ts`) + regra de remap em `diff.ts` se ele referenciar IDs.

## Regras de equalização

1. **Matching por título/nome.** O item "X" na origem corresponde ao item "X" no destino. Títulos duplicados: vale o primeiro.
2. **Status por item:**
   - `novo` — existe só na origem → será **criado**.
   - `alterado` — existe nos dois e difere → será **substituído** no destino.
   - `igual` — nada a fazer.
   - `so_no_destino` — existe só no destino → **apenas exibido, nunca removido**.
   - `bloqueado` — referencia algo que não dá para mapear (usuário, webhook, marca…) → não pode ser aplicado.
3. **Remapeamento de IDs.** IDs são diferentes em cada instância. Antes de comparar/aplicar, referências da origem são traduzidas para IDs do destino via título:
   - `custom_fields_<id>` em condições/ações → ID do campo no destino.
   - `ticket_form_id` → ID do formulário no destino.
   - `group_id`, `notification_group` → ID do grupo no destino.
   - `ticket_field_ids` e condições de formulários → IDs dos campos no destino.
   - Se a referência é a um grupo/campo/formulário que **ainda não existe no destino** mas existe na origem, o item mostra "requer: campo X". Basta selecionar a dependência também.
4. **Ordem de aplicação:** grupos → campos → formulários → gatilhos → automações. O remapeamento é refeito após cada etapa, então um formulário pode usar um campo criado na mesma execução.
5. **Campos ignorados na comparação:** `id`, `url`, `created_at`, `updated_at`, `position`, `raw_*`, `category_id`, `restricted_brand_ids` e IDs internos de opções de dropdown.

## Segurança

- Destino = `PRODUCTION_ENV` → banner vermelho permanente na tela.
- Toda aplicação passa pelo modal de confirmação, que lista o que será criado/substituído.
- Em produção o botão só habilita após digitar o nome do ambiente; o backend também exige isso (`confirm === target`), senão retorna 400.
- Nenhuma deleção é feita.

## Fluxo de uso

1. Escolher origem e destino.
2. Marcar os tipos.
3. **Comparar** → lista de itens com status e diff.
4. Marcar/desmarcar itens (novos e alterados vêm marcados).
5. **Aplicar** → modal → confirmar.
6. Resultado item a item; a comparação é refeita automaticamente.

## API do backend

| Método | Rota                | Corpo                                         |
|--------|---------------------|-----------------------------------------------|
| GET    | `/api/environments` | —                                             |
| POST   | `/api/compare`      | `{ source, target, types[] }`                 |
| POST   | `/api/apply`        | `{ source, target, items:[{type,title}], confirm }` |

## Como rodar

```
npm install
cp .env.example .env    # preencher
npm run dev             # backend :3001 + frontend :5173
npm test                # testes do diff
npm run build && npm start   # produção: Express serve o front buildado
```

## Limitações conhecidas (v1)

- Sem deleção, sem rollback/backup automático.
- Sem login na própria ferramenta — rodar apenas em rede interna.
- Categorias de gatilho, marcas, usuários, webhooks e SLAs não são mapeados (itens que os referenciam ficam bloqueados ou ignoram o campo).
- Condições de formulário por status customizado (`required_on_statuses`) não são remapeadas.
