# Account Revocation and Runtime Security Results

## Overview
This document records the automated verification and audit of the compromised administrator account revocation against both the isolated Microsoft SQL Server 2022 test database (`HMC_CENTRAL_AUTOMATION_TEST`) and the actual local development database (`HMC_CENTRAL_AUTOMATION`).

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

## 2. Actual Development Database Verification (`HMC_CENTRAL_AUTOMATION`)

Script: `packages/database/src/scripts/verify-dev-account-revocation.ts`  
Execution Timestamp: `2026-09-02T18:09:48Z`  
Database Engine: Microsoft SQL Server 2022 (RTM-CU24)

### Read-Only Inspection Results:
- **Masked Account**: `sup***in` (`ad***@hmc-central.local`)
- **Account ID**: `274DE3B8-4CD9-4D7D-831F-D708EE881D69`
- **Status**: `DISABLED`
- **`isDisabled`**: `true` *(Confirmed Disabled)*
- **`disabledAt`**: `2026-09-02T18:00:38.083Z` *(Populated)*
- **`disabledReason`**: `Compromised default administrator credential permanently revoked` *(Populated)*
- **`disabledBy`**: `SECURITY_REMEDIATION_AGENT`
- **Password Hash**: `$argon2id$ (Revoked Bytes - Unusable)`
- **Active Refresh Tokens**: `0`
- **Active Sessions**: `0`

---

## 3. Automated Test Results against `HMC_CENTRAL_AUTOMATION_TEST`

Test Suite: `apps/api/test/account-revocation-disable.test.ts`  
Execution Status: **PASSED (Exit Code: 0)**

| Test ID | Objective | Action / Request | Expected Result | Actual HTTP Status | Classification | Result |
|---|---|---|---|---|---|---|
| **REV-01** | Compromised Password Login | `POST /api/v1/auth/login` with compromised username | Account disabled rejection | `401 Unauthorized` | `ACCOUNT_DISABLED_REJECTED` | **PASS** |
| **REV-02** | Refresh Token Invalidation | `POST /api/v1/auth/refresh-token` with old token | Token mismatch / user disabled | `401 Unauthorized` | `REFRESH_TOKEN_REJECTED` | **PASS** |
| **REV-03** | Active Session / JWT Invalidation | Direct `JwtStrategy.validate()` evaluation | Immediate rejection of unexpired access token | `401 Unauthorized` | `ACCESS_TOKEN_REJECTED` | **PASS** |
| **REV-04** | Anti-Silent Re-enablement | Reset `failedAttempts = 0`, `lockoutUntil = null` | Account remains disabled (`isDisabled=true`), login blocked | `401 Unauthorized` | `ANTI_RE_ENABLEMENT_ENFORCED` | **PASS** |
| **REV-05** | Audit & History Leak Audit | Query `application_login_history` and `audit_logs` | No plaintext password strings or unmasked secrets | `200 OK (DB Query)` | `CLEAN_AUDIT_TRAIL` | **PASS** |
