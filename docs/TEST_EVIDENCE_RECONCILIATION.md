# Test Evidence Reconciliation & Matrix

## Overview
This document reconciles all automated tests across the monorepo, separating unit tests, integration tests, live MSSQL database tests, mock-browser tests, runtime health checks, real-client pilot tests, and human UAT. Compiled `dist` tests are verified and deduplicated against source tests.

---

## 1. Test Reconciliation Matrix

| Package / Scope | Category | Test File (Authoritative Source) | Executed Cases | Direct Assertions | Passed | Failed | Skipped | Blocked | Exit Code | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| `@hmc/shared` | **Unit** | `packages/shared/src/tests/schemas.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Unit (Crypto)** | `packages/database/src/tests/envelope-encryption.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Live MSSQL** | `packages/database/src/tests/mssql-live.integration.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Integration** | `packages/database/src/tests/admin-bootstrap.test.ts` | 4 | 4 | 4 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Integration (Leak Audit)** | `packages/database/src/tests/bootstrap-leak-audit.test.ts` | 4 | 4 | 4 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/automation` | **Mock-Browser (Headless)** | `packages/automation/src/tests/automation-engine.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/automation` | **Mock-Browser (Headed & Isolation)** | `packages/automation/src/tests/headed-profile-isolation.test.ts` | 4 | 4 | 4 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/automation` | **Security (Path/Symlink/ACL)** | `packages/automation/src/tests/profile-security.test.ts` | 9 | 9 | 8 | 0 | 0 | 1 | 0 | **PASS (1 BLOCKED_WINDOWS_ACL)** |
| `@hmc/automation` | **Runtime Health** | `packages/automation/src/tests/runtime-verification-audit.ts` | 5 | 5 | 5 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/api` | **Unit (RBAC)** | `apps/api/test/rbac-security.test.ts` | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/api` | **Integration (Import/Audit)** | `apps/api/test/import-resilience-audit.test.ts` | 4 | 4 | 4 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/api` | **Integration (Revocation)** | `apps/api/test/account-revocation-disable.test.ts` | 5 | 5 | 5 | 0 | 0 | 0 | 0 | **PASS** |
| **Real Hospital Clients** | **Real-Client Pilot** | *Scheduled for Pilot Deployment Phase* | 0 | 0 | 0 | 0 | 0 | 0 | N/A | **PENDING_PILOT** |
| **Business Stakeholders** | **Human UAT** | *Pending Stakeholder Sign-Off on uat-checklist.md* | 0 | 0 | 0 | 0 | 0 | 0 | N/A | **PENDING** |

---

## 2. Monorepo Summary Totals

- **Authoritative Test Files**: 12
- **Total Executed Automated Assertions**: 50 / 50 Passed (100%)
- **Blocked Tests**: 1 (`BLOCKED_WINDOWS_ACL_TEST` — environment is macOS; Windows ACL test not runnable on non-Windows)
- **Failed**: 0
- **Skipped**: 0
- **Overall Exit Code**: `0`

> **Audit Assertion**: **50 / 50 executed automated assertions passed; real-client pilot and human UAT were not executed.**

---

## 3. Real-Client Environment Notice

> [!NOTE]
> All automated browser tests were executed against the local mock HMC test fixture server (`http://localhost:4000` - `4002`) and isolated test database `HMC_CENTRAL_AUTOMATION_TEST`.
> Mock fixture testing validates engine capabilities, Playwright selector strategies, error conditions, and cross-client cookie/localStorage boundaries, but **does not constitute proof of compatibility with live third-party hospital production systems**. Real-client testing is governed by [REAL_CLIENT_PILOT_ENTRY_CHECKLIST.md](file:///Users/sharmila/Music/SIMPLEX/docs/REAL_CLIENT_PILOT_ENTRY_CHECKLIST.md).
