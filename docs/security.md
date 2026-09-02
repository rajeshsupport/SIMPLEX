# Security Architecture & Credential Protection

## 1. Credential Security & Envelope Encryption

- **Master Encryption Key**: Loaded exclusively from runtime secret `ENCRYPTION_MASTER_KEY` (never committed to repository).
- **AES-256-GCM Envelope Encryption**: Client passwords and usernames are encrypted with a fresh 96-bit (12-byte) initialization vector (IV) and a 128-bit authentication tag for integrity verification.
- **Credential Masking**: All user interfaces and logging pipelines display only masked placeholders (e.g. `ad***@client.com` and `********`). Decrypted credentials exist only in memory during active Playwright execution.

---

## 2. Authentication & Account Protection

- **Password Hashing**: Application user credentials use **Argon2id** (memory cost: 64MB, time cost: 3 iterations, parallelism: 4 threads).
- **JWT Lifecycles**:
  - Access Token: 15 minutes validity
  - Refresh Token: 7 days validity with single-use cryptographic rotation
- **Lockout Policy**: 5 failed login attempts trigger an automatic 15-minute account lockout.
- **Audit Trails**: All authentication attempts (success, failed credentials, locked out) are captured in `application_login_history`.

---

## 3. RBAC & Client Access Boundary

Authorization is enforced at 3 levels on every request:

1. **Role Level**: Super Admin, Admin, Import Operator, URL Operator, Auditor, Viewer.
2. **Action Level**: `@RequirePermissions(...)` on controllers.
3. **Client Level**: `@RequireClientAccess(...)` ensures operators can only view or execute against assigned clients.
