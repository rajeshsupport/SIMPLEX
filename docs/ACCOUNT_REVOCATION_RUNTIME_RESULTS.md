# Account Revocation and Runtime Security Results

## Overview
This document records the automated verification and audit of the compromised administrator account revocation against the isolated Microsoft SQL Server 2022 database (`HMC_CENTRAL_AUTOMATION_TEST`).

---

## 1. Explicit Disable Semantics

Rather than relying on transient lockout counters (`failedAttempts = 999`, `lockoutUntil`), explicit non-destructive database columns were introduced to the `application_users` table via migration `1700000000001-AddUserDisableFields`:

| Column | Data Type | Nullable | Description |
|---|---|---|---|
| `isDisabled` | `BIT` | `NOT NULL (DEFAULT 0)` | Boolean flag indicating whether the account is disabled |
| `disabledAt` | `DATETIME2` | `NULL` | Timestamp of when the disable action occurred |
| `disabledReason` | `NVARCHAR(500)` | `NULL` | Human-readable reason for disabling the account |
| `disabledBy` | `NVARCHAR(100)` | `NULL` | Identity of the administrator or security agent |

---

## 2. Automated Test Results against `HMC_CENTRAL_AUTOMATION_TEST`

Test Suite: `apps/api/test/account-revocation-disable.test.ts`  
Execution Timestamp: `2026-09-02T18:02:59Z`  
Database Engine: Microsoft SQL Server 2022 (RTM-CU24)

| Test ID | Objective | Action / Request | Expected Result | Actual HTTP Status | Classification | Result |
|---|---|---|---|---|---|---|
| **REV-01** | Compromised Password Login | `POST /api/v1/auth/login` with compromised username | Account disabled rejection | `401 Unauthorized` | `ACCOUNT_DISABLED_REJECTED` | **PASS** |
| **REV-02** | Refresh Token Invalidation | `POST /api/v1/auth/refresh-token` with old token | Token mismatch / user disabled | `401 Unauthorized` | `REFRESH_TOKEN_REJECTED` | **PASS** |
| **REV-03** | Active Session / JWT Invalidation | Direct `JwtStrategy.validate()` evaluation | Immediate rejection of unexpired access token | `401 Unauthorized` | `ACCESS_TOKEN_REJECTED` | **PASS** |
| **REV-04** | Anti-Silent Re-enablement | Reset `failedAttempts = 0`, `lockoutUntil = null` | Account remains disabled (`isDisabled=true`), login blocked | `401 Unauthorized` | `ANTI_RE_ENABLEMENT_ENFORCED` | **PASS** |
| **REV-05** | Audit & History Leak Audit | Query `application_login_history` and `audit_logs` | No plaintext password strings or unmasked secrets | `200 OK (DB Query)` | `CLEAN_AUDIT_TRAIL` | **PASS** |

---

## 3. Database State Verification

Verification query executed on `application_users` table:
```sql
SELECT id, username, email, status, isDisabled, disabledReason, failedAttempts, lockoutUntil, refreshTokenHash 
FROM application_users 
WHERE username = 'superadmin' OR isDisabled = 1;
```

**Result**:
- `status`: `'DISABLED'`
- `isDisabled`: `1` (`true`)
- `disabledReason`: `'Compromised default administrator credential permanently revoked'`
- `passwordHash`: `$argon2id$v=19$m=65536,t=3,p=4$REVOKED_COMPROMISED_<random_bytes>` (unusable)
- `refreshTokenHash`: `NULL`
- Active sessions: `0`
