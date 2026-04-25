# WhatsApp CRM Renovado - ViaPet

## O que foi implementado

O projeto agora tem uma base renovada para WhatsApp no CRM, sem remover o fluxo antigo:

- `Modo simples`
  - Abre o WhatsApp por link `wa.me`
  - Registra a acao no CRM
  - Nao exige API, QR Code ou token
- `Modo API oficial`
  - Reaproveita a estrutura oficial da Meta ja existente
  - Salva dados por empresa
  - Mantem webhook, inbox e envio interno preparados

## Backend

Novas rotas da central:

- `GET /api/whatsapp-hub/overview`
- `GET /api/whatsapp-hub/config`
- `PUT /api/whatsapp-hub/config`
- `POST /api/whatsapp-hub/config/disconnect`
- `GET /api/whatsapp-hub/templates`
- `POST /api/whatsapp-hub/templates`
- `DELETE /api/whatsapp-hub/templates/:templateId`
- `GET /api/whatsapp-hub/activity`
- `GET /api/whatsapp-hub/inbox`
- `GET /api/whatsapp-hub/logs`
- `POST /api/whatsapp-hub/launch`
- `POST /api/whatsapp-hub/send`

## Banco de dados

Foi feita uma migracao aditiva em:

- `migrations/20260425113000-expand-whatsapp-hub-structure.cjs`

Ela expande as tabelas existentes:

- `whatsapp_connections`
- `whatsapp_messages`
- `whatsapp_templates`
- `whatsapp_webhook_logs`

## Frontend

Foi criada uma nova area no modulo de Mensagens:

- menu `WhatsApp`
- aba `Configuracao`
- aba `Modelos de mensagem`
- aba `Conversas`

Arquivo principal:

- `viapet.app-frontend/src/features/messages/MessagesWhatsappHubPanel.jsx`

## Como usar

### Modo simples

1. Abrir `Mensagens > WhatsApp`
2. Selecionar `WhatsApp simples`
3. Salvar
4. Usar os modelos para gerar mensagens e registrar o inicio das conversas

### Modo API oficial

1. Abrir `Mensagens > WhatsApp`
2. Selecionar `WhatsApp Business API`
3. Preencher `Business ID`, `WABA ID`, `Phone Number ID` e token
4. Salvar
5. Se preferir, usar `Conectar pela Meta`

## Observacoes

- O sistema continua funcionando mesmo com o WhatsApp desconectado.
- O modo simples e o modo API convivem sem quebrar agenda, clientes, pets, financeiro ou CRM atual.
- O proximo passo natural e ligar mais botoes do sistema diretamente ao endpoint `POST /api/whatsapp-hub/launch`, para registrar automaticamente cobranca, confirmacao e lembretes em qualquer tela.
