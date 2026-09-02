# Test Evidence Reconciliation & Matrix

## Overview
This document reconciles all automated tests across the monorepo, separating unit tests, integration tests, live MSSQL database tests, mock-browser tests, runtime health checks, real-client pilot tests, and human UAT. Compiled `dist` tests are verified and deduplicated against source tests.

---

## 1. Test Reconciliation Matrix

| Package / Scope | Category | Test File (Authoritative Source) | Planned Cases | Executed Cases | Direct Assertions | Passed | Failed | Skipped | Blocked | Exit Code | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `@hmc/shared` | **Unit** | `packages/shared/src/tests/schemas.test.ts` | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Unit (Crypto)** | `packages/database/src/tests/envelope-encryption.test.ts` | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Live MSSQL** | `packages/database/src/tests/mssql-live.integration.test.ts` | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Integration** | `packages/database/src/tests/admin-bootstrap.test.ts` | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/database` | **Integration (Leak Audit)** | `packages/database/src/tests/bootstrap-leak-audit.test.ts` | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/automation` | **Mock-Browser (Headless)** | `packages/automation/src/tests/automation-engine.test.ts` | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/automation` | **Mock-Browser (Headed & Isolation)** | `packages/automation/src/tests/headed-profile-isolation.test.ts` | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/automation` | **Security (Path/Symlink/ACL)** | `packages/automation/src/tests/profile-security.test.ts` | 9 | 8 | 8 | 8 | 0 | 0 | 1 | 0 | **PASS (1 BLOCKED_WINDOWS_ACL)** |
| `@hmc/automation` | **Runtime Health** | `packages/automation/src/tests/runtime-verification-audit.ts` | 5 | 5 | 5 | 5 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/api` | **Unit (RBAC)** | `apps/api/test/rbac-security.test.ts` | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/api` | **Integration (Import/Audit)** | `apps/api/test/import-resilience-audit.test.ts` | 4 | 4 | 4 | 4 | 0 | 0 | 0 | 0 | **PASS** |
| `@hmc/api` | **Integration (Revocation)** | `apps/api/test/account-revocation-disable.test.ts` | 5 | 5 | 5 | 5 | 0 | 0 | 0 | 0 | **PASS** |
| **Real Hospital Clients** | **Real-Client Pilot** | *Scheduled for Pilot Deployment Phase* | 0 | 0 | 0 | 0 | 0 | 0 | 0 | N/A | **PENDING_PILOT** |
| **Business Stakeholders** | **Human UAT** | *Pending Stakeholder Sign-Off on uat-checklist.md* | 0 | 0 | 0 | 0 | 0 | 0 | 0 | N/A | **PENDING** |

---

## 2. Reconciled Census Arithmetic & Invariants

- **Total Planned Cases**: 50
- **Total Executed Cases**: 49
- **Passed Cases**: 49
- **Failed Cases**: 0
- **Skipped Cases**: 0
- **Blocked Cases**: 1 (`BLOCKED_WINDOWS_ACL_TEST` — Windows ACL runtime verification was unavailable on macOS)
- **Not Executed Cases**: 0

### Arithmetic Invariants:
1. `Passed (49) + Failed (0) + Skipped (0) = Executed (49)` ✓
2. `Executed (49) + Blocked (1) + Not Executed (0) = Planned (50)` ✓

> **Authoritative Assertion**:  
> **49 / 49 executed automated cases passed; 1 of 50 planned cases remains blocked because Windows ACL runtime verification was unavailable on macOS.**

---

## 3. Real-Client Environment Notice

> [!NOTE]
> All automated browser tests were executed against the local mock HMC test fixture server (`http://localhost:4000` - `4002`) and isolated test database `HMC_CENTRAL_AUTOMATION_TEST`.
> Mock fixture testing validates engine capabilities, Playwright selector strategies, error conditions, and cross-client cookie/localStorage boundaries, but **does not constitute proof of compatibility with live third-party hospital production systems**. Real-client testing is governed by [REAL_CLIENT_PILOT_ENTRY_CHECKLIST.md](file:///Users/sharmila/Music/SIMPLEX/docs/REAL_CLIENT_PILOT_ENTRY_CHECKLIST.md).
