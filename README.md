# 🐾 ViaPet API - Backend

API REST para sistema de gerenciamento veterinário completo.

## 📁 **Estrutura do Monorepo**

Este é o **backend** do projeto ViaPet. A estrutura completa do monorepo é:

```
viapet-full/                     # 📦 Monorepo principal
├── api.viapet.app/              # 🔧 Backend API (você está aqui)
│   ├── config/                  # Configurações de ambiente e banco
│   ├── database/                # Dumps SQL e configurações Sequelize
│   ├── middlewares/             # Auth, validações, upload de arquivos
│   ├── models/                  # Modelos Sequelize (Users, Pets, etc.)
│   ├── routes/                  # Rotas da API REST
│   ├── migrations/              # Migrações do banco de dados
│   ├── service/                 # Serviços (email, WhatsApp, pagamento)
│   ├── uploads/                 # Arquivos enviados (imagens de pets)
│   ├── package.json             # Dependências e scripts npm
│   ├── index.js                 # Servidor Express principal
│   └── README.md                # Este arquivo
└── viapet2/                     # 🎨 Frontend (React/Next.js/Vue)
    ├── src/                     # Código fonte do frontend
    ├── public/                  # Arquivos estáticos
    └── package.json             # Dependências do frontend
```

## 🤖 **Trabalhando com Copilot**

Para instruções detalhadas sobre como usar o Copilot neste monorepo:

- **[COPILOT-INSTRUCTIONS.md](./COPILOT-INSTRUCTIONS.md)** - Instruções gerais
- **[COPILOT-USAGE-GUIDE.md](./COPILOT-USAGE-GUIDE.md)** - Exemplos práticos

## 🚀 **Início Rápido - Backend**

### **Pré-requisitos**

- Node.js 18+
- XAMPP (desenvolvimento) ou MySQL (produção)
- Git

### **Instalação e Configuração**

```bash
# 1. Navegue para o diretório do backend
cd viapet-full/api.viapet.app/

# 2. Instale dependências
npm install

# 3. Configure XAMPP
# - Baixe: https://www.apachefriends.org/
# - Inicie Apache + MySQL no Control Panel XAMPP

# 4. Configure banco de dados
# Via phpMyAdmin (http://localhost/phpmyadmin):
# - Crie banco: viapet (collation: utf8mb4_general_ci)
# - Importe: database/viapet.sql

# 5. Configure variáveis de ambiente
# Edite .env.development se necessário (senha MySQL)

# 6. Execute em desenvolvimento
npm run dev
```

## 🌍 **Ambientes**

### **Desenvolvimento (Local)**

- **Banco:** XAMPP MySQL (localhost:3306)
- **Usuário:** root (sem senha)
- **URL:** http://localhost:4002

### **Produção (VPS)**

- **Banco:** MySQL remoto (api.viapet.app:3306)
- **Usuário/Senha:** Configurados via .env
- **URL:** https://api.viapet.app

## 📋 **Scripts Disponíveis**

```bash
# Desenvolvimento
npm run dev              # Executar com nodemon (auto-reload)
npm run start            # Executar em produção

# Migrações
npm run migrate          # Executar migrações (local)
npm run migrate:undo     # Reverter última migração
npm run migrate:status   # Status das migrações
npm run migrate:prod     # Executar migrações (produção)

# Utilities
npm test                 # Executar testes
```

## 🔄 **Fluxo de Desenvolvimento**

### **1. Fazer mudanças no banco**

```bash
# Criar nova migração
npx sequelize-cli migration:generate --name add-nova-funcionalidade

# Editar arquivo gerado em migrations/
# Aplicar migração local
npm run migrate

# Testar mudanças
npm run dev
```

### **2. Deploy para produção**

```bash
# Na VPS:
git pull
npm install
npm run migrate:prod
pm2 restart api
```

## 🗄️ **Banco de Dados**

### **Estrutura**

- **admin** - Configurações administrativas
- **users** - Usuários do sistema
- **custumers** - Clientes/tutores
- **pets** - Animais de estimação
- **appointments** - Agendamentos
- **products** - Produtos
- **services** - Serviços
- **sales** - Vendas
- **finances** - Controle financeiro
- E mais...

### **Migrações**

As mudanças no banco são gerenciadas via Sequelize migrations:

```bash
# Verificar status
npm run migrate:status

# Aplicar migrações pendentes
npm run migrate

# Reverter última migração
npm run migrate:undo
```

## 📁 **Estrutura do Projeto**

```
api.viapet.app/
├── config/
│   └── env.js              # Carregador de configurações
├── database/
│   ├── config.js           # Configuração Sequelize (app)
│   ├── cli-config.cjs      # Configuração Sequelize CLI
│   └── viapet.sql          # Dump do banco
├── middlewares/
│   ├── auth.js             # Autenticação JWT
│   ├── admin.js            # Middleware admin
│   └── ...
├── models/
│   ├── index.js            # Índice dos modelos
│   ├── Users.js            # Modelo de usuários
│   └── ...
├── routes/
│   ├── Users/              # Rotas de usuários
│   ├── Pet.js              # Rotas de pets
│   └── ...
├── migrations/             # Migrações do banco
├── uploads/                # Arquivos enviados
├── .env                    # Configurações produção
├── .env.development        # Configurações desenvolvimento
├── .sequelizerc            # Configuração Sequelize CLI
└── index.js                # Entrada da aplicação
```

## 🔧 **Configuração**

### **Variáveis de Ambiente**

**Desenvolvimento (.env.development):**

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=viapet
DB_USER=root
DB_PASS=
URL=http://localhost:4002
FRONTEND_URL=http://localhost:3001/
JWT_SECRET=1234567890
```

**Produção (.env):**

```env
DB_HOST=api.viapet.app
DB_PORT=3306
DB_NAME=viapet
DB_USER=viapet
DB_PASS=sua_senha_producao
URL=https://api.viapet.app
FRONTEND_URL=https://viapet.app/
JWT_SECRET=1234567890
```

## 🛠️ **Desenvolvimento**

### **Auto-reload com Nodemon**

```bash
npm run dev  # Inicia com nodemon, reinicia automaticamente ao salvar
```

### **Logs**

Em desenvolvimento, todas as queries SQL são logadas no console.

### **Estrutura de Rotas**

```
/api/users     # Gestão de usuários
/api/pets      # Gestão de pets
/api/agenda    # Agendamentos
/api/products  # Produtos
/api/services  # Serviços
/api/sales     # Vendas
/api/finance   # Financeiro
```

## 🚀 **Deploy**

### **VPS/Servidor**

```bash
# 1. Clone e configure
git clone <repo>
cd api.viapet.app
npm install

# 2. Configure .env para produção

# 3. Execute migrações
npm run migrate:prod

# 4. Inicie com PM2
pm2 start index.js --name "viapet-api"
pm2 startup
pm2 save
```

### **Atualizações**

```bash
git pull
npm install
npm run migrate:prod
pm2 restart viapet-api
```

## � **Integração com Frontend**

### **Estrutura do Monorepo**

```bash
# Desenvolvimento simultâneo
cd viapet-full/

# Terminal 1 - Backend
cd api.viapet.app/
npm run dev              # Roda na porta 4002

# Terminal 2 - Frontend
cd viapet2/
npm run dev              # Roda na porta 3000 (ou 3001)
```

### **URLs de Integração**

- **Backend API:** `http://localhost:4002/api/`
- **Frontend:** `http://localhost:3000` (ajustar conforme framework)
- **Uploads:** `http://localhost:4002/uploads/[arquivo]`

### **CORS e Configuração**

O backend já está configurado para aceitar requests do frontend. Verifique em `index.js`:

```javascript
// CORS configurado para desenvolvimento e produção
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      process.env.FRONTEND_URL,
    ],
  })
);
```

### **Endpoints Principais para Frontend**

```javascript
// Autenticação
POST /api/login
POST /api/register

// Gestão de Pets
GET  /api/pets
POST /api/pets
PUT  /api/pets/:id
DELETE /api/pets/:id

// Agendamentos
GET  /api/appointments
POST /api/appointments
PUT  /api/appointments/:id

// Clientes
GET  /api/custumers
POST /api/custumers

// Upload de Imagens
POST /api/upload (multipart/form-data)
```

Para documentação completa da API, consulte `docs/swagger.yaml`.

### **Deploy para Produção**

```bash
# Na VPS - Backend
cd /path/to/viapet-full/api.viapet.app/
git pull
npm install
npm run migrate:prod
pm2 restart viapet-api

# Frontend (separadamente ou junto)
cd ../viapet2/
npm run build
# Deploy para servidor web (Nginx, Vercel, etc.)
```

## �📚 **Documentação Adicional**

- **[MIGRATIONS.md](./MIGRATIONS.md)** - Fluxo completo de migrações
- **[SETUP-FINAL.md](./SETUP-FINAL.md)** - Status da configuração

## 🐛 **Troubleshooting**

### **Erro de conexão com banco**

1. Verifique se MySQL está rodando no XAMPP
2. Confirme credenciais no .env.development
3. Teste conexão: `mysql -u root -p`

### **Erro de migração**

1. Verifique status: `npm run migrate:status`
2. Rollback se necessário: `npm run migrate:undo`
3. Re-aplique: `npm run migrate`

### **Porta em uso**

```bash
# Encontrar processo usando porta 4002
netstat -ano | findstr :4002
# Matar processo
taskkill /PID <PID> /F
```

## 🤝 **Contribuição**

1. Fork o projeto
2. Crie uma branch: `git checkout -b feature/nova-funcionalidade`
3. Commit suas mudanças: `git commit -m 'Add nova funcionalidade'`
4. Push para a branch: `git push origin feature/nova-funcionalidade`
5. Abra um Pull Request

## 📄 **Licença**

Este projeto está sob licença [MIT](LICENSE).

---

**🐾 Desenvolvido para ViaVet - Sistema Veterinário Completo**
