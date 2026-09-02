# HMC Central Operations Console

> A production-grade multi-client management and browser automation console built with React, NestJS, Electron, Playwright, and Microsoft SQL Server 2022.

---

## Architecture Summary

```
SIMPLEX/
├── apps/
│   ├── web/                      # React 18 + Vite + TailwindCSS Admin Dashboard
│   ├── api/                      # NestJS Central API (Argon2id, JWT, RBAC, MSSQL)
│   └── desktop-agent/            # Electron + Playwright Desktop Agent (Isolated Sessions)
├── packages/
│   ├── shared/                   # Shared types, Zod schemas, RBAC constants
│   ├── database/                 # TypeORM MSSQL 2022 Data Layer & Migrations
│   └── automation/               # Playwright Workflow Engine & Local Mock HMC Server
└── docs/                         # Comprehensive Engineering & UAT Documentation
```

---

## Key Features

1. **Multi-Client HMC Management**: Database-driven client portal configurations with environment indicators (Red warning badges for Production).
2. **AES-256-GCM Credential Envelope Encryption**: Master key runtime secret protection with automated masking in UI and logs.
3. **Session-Isolated Desktop Agent**: Runs Playwright in isolated persistent Chromium profiles per `{client_id}/{user_id}`.
4. **Interactive "Open & Login"**: Automatically fills credentials and leaves browser open for operator use.
5. **Spreadsheet Import Engine**: Resumable .xlsx / .csv parser with preview validation, 1-record test mode, typed production confirmation, failed-row retry, and downloadable error CSVs.
6. **Granular RBAC & Security**: Role-based, action-based, and client-scoped authorization guards with Argon2id password hashing and lockout protection.
7. **Audit & Log Retention**: Tamper-evident structured logging, correlation IDs, configurable retention policies, and CSV export.

---

## Quick Start Commands

```bash
# 1. Install all dependencies
pnpm install

# 2. Build monorepo packages
pnpm build

# 3. Run database migrations & system seeders
pnpm db:migrate
pnpm db:seed

# 4. Bootstrap Super Administrator (Interactive password setup; NO default passwords)
pnpm admin:bootstrap

# 5. Start local development services
pnpm dev:api       # NestJS Central API (http://localhost:3000)
pnpm dev:web       # React Admin Web Console (http://localhost:5173)
pnpm dev:fixture   # Mock HMC Client (http://localhost:4000)
pnpm dev:agent     # Desktop Automation Agent

# 6. Run automated tests
pnpm test
```

---

## Documentation Links

- [Architecture & Monorepo Design](docs/architecture.md)
- [Local Installation Guide](docs/local-installation.md)
- [Microsoft SQL Server Setup](docs/mssql-setup.md)
- [Desktop Automation Agent](docs/desktop-agent.md)
- [Workflow & Selector Configuration](docs/workflow-configuration.md)
- [Security & Encryption Architecture](docs/security.md)
- [Spreadsheet Import Process](docs/import-process.md)
- [Roles & Permissions (RBAC Matrix)](docs/roles-and-permissions.md)
- [Log Retention & Archiving Policy](docs/log-retention.md)
- [Hybrid-Cloud Deployment Guide](docs/hybrid-cloud-deployment.md)
- [UAT Checklist](docs/uat-checklist.md)
- [Implementation Status](docs/implementation-status.md)
