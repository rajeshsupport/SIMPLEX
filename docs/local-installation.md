# Local Installation & Quick Start Guide

## Prerequisites

- Node.js 20 LTS or Node.js 24 LTS
- pnpm 9.x (`corepack enable pnpm`)
- Docker & Docker Compose (for Microsoft SQL Server 2022)

---

## 1. Environment Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Verify MSSQL credentials in `.env`:
   ```env
   MSSQL_HOST=localhost
   MSSQL_PORT=1433
   MSSQL_DATABASE=HMC_CENTRAL_AUTOMATION
   MSSQL_USER=sa
   MSSQL_PASSWORD=Rajesh@123
   ENCRYPTION_MASTER_KEY=e8b839655f46a7be7e3c15c6b7582b1c853f6517a942bcba5e7e600d89e574ac
   ```

---

## 2. Install Dependencies & Build Packages

```bash
# Install dependencies across all monorepo workspaces
pnpm install

# Build shared libraries and database package
pnpm build
```

---

## 3. Database Migration & Seeding

```bash
# Run versioned MSSQL schema migration
pnpm db:migrate

# Seed default roles, permissions, workflows, and Super Admin user
pnpm db:seed
```

---

## 4. Bootstrap Super Administrator Account

> **SECURITY NOTICE**: No default administrator accounts or passwords exist in this codebase. You must run the secure interactive bootstrap command to create or reset the Super Administrator account:

```bash
pnpm admin:bootstrap
```
This command prompts for the administrator username, email, and password interactively with masked input, enforces password complexity policies, and hashes the credential with Argon2id.

---

## 5. Running the Development Services

You can run individual components using dedicated scripts:

```bash
# Terminal 1: Start NestJS Central API (Port 3000)
pnpm dev:api

# Terminal 2: Start React Web Admin Console (Port 5173)
pnpm dev:web

# Terminal 3: Start Local Mock HMC Fixture Server (Port 4000)
pnpm dev:fixture

# Terminal 4: Start Desktop Automation Agent
pnpm dev:agent
```

---

## 6. Accessing the Central Console

- Web Console: [http://localhost:5173](http://localhost:5173)
- API Swagger Docs: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- Mock HMC Client: [http://localhost:4000/hmc/login](http://localhost:4000/hmc/login)

