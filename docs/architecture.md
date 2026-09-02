# HMC Central Operations Console - System Architecture

## 1. Architectural Overview

The **HMC Central Operations Console** is designed to centrally orchestrate multiple isolated HMC client application deployments without direct database, backend API, or source-code access. All client operations are performed via Chromium browser automation running with Playwright on authorized desktop agents.

```
+-------------------------------------------------------------------------------+
|                                CLIENT TIER                                    |
|                                                                               |
|   +------------------------------------+  +-------------------------------+   |
|   |         React Admin Web UI         |  |    Electron Desktop Agent     |   |
|   |   (Vite, TailwindCSS, Dashboard)   |  |   (Playwright, Chromium Core) |   |
|   +-----------------+------------------+  +---------------+---------------+   |
+---------------------|-------------------------------------|-------------------+
                      | HTTP/REST                           | REST / Polling
                      v                                     v
+-------------------------------------------------------------------------------+
|                           CENTRAL API (NestJS)                                |
|                                                                               |
|  +----------------+  +-----------------+  +----------------+  +-------------+ |
|  |  Auth & RBAC   |  |  Client Vault   |  | Import Manager |  | Agent Hub   | |
|  |  (Argon2/JWT)  |  |  (AES-256-GCM)  |  | (Resumption)   |  | (Heartbeat) | |
|  +----------------+  +-----------------+  +----------------+  +-------------+ |
+-----------------------------------|-------------------------------------------+
                                    | TypeORM
                                    v
+-------------------------------------------------------------------------------+
|                       DATABASE TIER (Microsoft SQL Server 2022)                |
|                                                                               |
|   +-----------------------------------------------------------------------+   |
|   | Database: HMC_CENTRAL_AUTOMATION                                      |   |
|   | 20 Normalized Tables (Users, Roles, Perms, Clients, Workflows, Jobs) |   |
|   +-----------------------------------------------------------------------+   |
+-------------------------------------------------------------------------------+
```

---

## 2. Monorepo Modules

1. **`apps/web`**: React 18 single-page application providing executive metrics, client management with environment badges, import wizard with validation preview, user and RBAC configuration, desktop agent status, and audit viewer.
2. **`apps/api`**: NestJS backend providing Argon2id password authentication, JWT token refresh rotation, AES-256-GCM envelope encryption for client secrets, rate limiting, and structured audit/error logging.
3. **`apps/desktop-agent`**: Electron desktop application running on operator workstations. Bundles Playwright to execute persistent isolated Chromium sessions per `{client_id}/{user_id}`.
4. **`packages/shared`**: Common TypeScript types, Zod schemas, error definitions, permissions, and roles.
5. **`packages/automation`**: Selector resolution strategy hierarchy, profile isolation manager, workflow step executor, and local HMC mock fixture server.
6. **`packages/database`**: 20 TypeORM entities, versioned SQL Server migrations, seeders, and AES-256-GCM crypto helpers.

---

## 3. Selector Fallback Hierarchy

To eliminate fragile XPath or screen coordinates, the automation engine evaluates selectors strictly in this sequence:

1. **`TEST_ID`**: `getByTestId(id)` / `[data-testid="id"]`
2. **`ID`**: `#element-id`
3. **`ROLE`**: `getByRole(role, { name })`
4. **`LABEL`**: `getByLabel(labelText)`
5. **`NAME`**: `[name="fieldName"]`
6. **`PLACEHOLDER`**: `getByPlaceholder(placeholderText)`
7. **`CSS`**: Scoped CSS selector (`.my-form input.field`)
8. **`XPATH_LEGACY`**: Only as explicit fallback
