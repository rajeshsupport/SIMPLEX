# Test Evidence Reconciliation & Matrix

## Overview
This document reconciles all automated tests across the monorepo, separating unit tests, integration tests, live MSSQL database tests, mock-browser tests, and real-client tests. Compiled `dist` tests are verified and deduplicated against source tests.

---

## 1. Test Reconciliation Matrix

| Package / Scope | Category | Test File (Authoritative Source) | Suites / Blocks | Direct Assertions | Passed | Failed | Skipped | Exit Code | Result |
|---|---|---|---|---|---|---|---|---|---|
| `@hmc/shared` | **Unit** | `packages/shared/src/tests/schemas.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Unit (Crypto)** | `packages/database/src/tests/envelope-encryption.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Live MSSQL** | `packages/database/src/tests/mssql-live.integration.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Integration** | `packages/database/src/tests/admin-bootstrap.test.ts` | 4 | 4 | 4 | 0 | 0 | 0 | **PASS** |
| `@hmc/automation` | **Mock-Browser (Headless)** | `packages/automation/src/tests/automation-engine.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | **PASS** |
| `@hmc/automation` | **Mock-Browser (Headed & Isolation)** | `packages/automation/src/tests/headed-profile-isolation.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | **PASS** |
| `@hmc/automation` | **Live Endpoint Runtime** | `packages/automation/src/tests/runtime-verification-audit.ts` | 5 | 5 | 5 | 0 | 0 | 0 | **PASS** |
| `@hmc/api` | **Unit (RBAC)** | `apps/api/test/rbac-security.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | **PASS** |
| `@hmc/api` | **Integration (Import/Audit)** | `apps/api/test/import-resilience-audit.test.ts` | 4 | 4 | 4 | 0 | 0 | 0 | **PASS** |
| `@hmc/api` | **Integration (Revocation)** | `apps/api/test/account-revocation-disable.test.ts` | 5 | 5 | 5 | 0 | 0 | 0 | **PASS** |
| **Real Hospital Clients** | **Real-Client** | *Pilot Deployment Phase* | N/A | N/A | 0 | 0 | 0 | N/A | **PENDING_PILOT** |

---

## 2. Monorepo Summary Totals

- **Authoritative Test Files**: 10
- **Total Executed Test Blocks**: 36
- **Total Assertions Checked**: 36
- **Passed**: 36
- **Failed**: 0
- **Skipped**: 0
- **Overall Exit Code**: `0`

---

## 3. Real-Client Environment Notice

> [!NOTE]
> All automated browser tests above were executed against the local mock HMC test fixture server (`http://localhost:4000` - `4002`) and isolated test database `HMC_CENTRAL_AUTOMATION_TEST`.
> Mock fixture testing validates engine capabilities, Playwright selector strategies, and error handling, but **does not constitute proof of compatibility with live third-party hospital production systems**. Real-client testing is scheduled for the formal Pilot Deployment phase.
