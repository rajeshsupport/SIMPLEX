# Browser Profile Security, Isolation & Path Audit Results

## Overview
The Electron Desktop Agent manages Chromium persistent contexts for executing interactive workflows across multiple hospital clients. This document details the security architecture, path traversal defenses, symlink protections, POSIX/Windows ACL enforcement, and strengthened session isolation results.

---

## 1. Security Architecture & Threat Mitigations

| Threat Vector | Mitigation Implementation | Audit Test | Result |
|---|---|---|---|
| **Path Traversal (`../`)** | Explicit regex `^[a-zA-Z0-9_-]+$` + canonical resolved path containment check `profilePath.startsWith(BASE_PROFILE_DIR)`. | `profile-security.test.ts` (Test 1) | **PASS (Security Violation)** |
| **Absolute Paths (`/etc/shadow`)** | Slashes rejected; canonical path check prevents escaping profile directory root. | `profile-security.test.ts` (Test 2) | **PASS (Security Violation)** |
| **Null-Byte Injection (`\x00`)** | Rejects control characters (`[\x00-\x1F\x7F]`) before path resolution. | `profile-security.test.ts` (Test 3) | **PASS (Security Violation)** |
| **URL-Encoded Traversal (`%2e%2e%2f`)** | Rejects URL-encoded percent sequences (`%[0-9a-fA-F]{2}`). | `profile-security.test.ts` (Test 4) | **PASS (Security Violation)** |
| **Unicode Slash Variants (`\u2215`, `\uFF0F`)** | Rejects division slashes and fullwidth slash characters. | `profile-security.test.ts` (Test 5) | **PASS (Security Violation)** |
| **Backslash Injections (`\`)** | Backslashes strictly rejected in all client/user identifiers. | `profile-security.test.ts` (Test 6) | **PASS (Security Violation)** |
| **Symlink Escape** | `fs.realpathSync(profilePath)` verifies canonical resolution target remains within `BASE_PROFILE_DIR`. | `profile-security.test.ts` (Test 7) | **PASS (Contained)** |
| **Cross-User Snooping (POSIX)** | Directory created and enforced with `0700` mode (owner read/write/execute only). | `profile-security.test.ts` (Test 8) | **PASS (0700 Verified)** |
| **Windows ACL Protection** | Windows desktop target: `%USERPROFILE%\.hmc-console\profiles` inherits user-exclusive discretionary ACLs (`NT AUTHORITY\SYSTEM` and active user only). | `profile-security.test.ts` (Test 9) | **BLOCKED_WINDOWS_ACL_TEST (macOS Runtime)** |

---

## 2. Strengthened Storage & Session Isolation Evidence

Test Suite: `packages/automation/src/tests/headed-profile-isolation.test.ts`  
Execution Status: **PASSED (Exit Code: 0)**

### Storage Lifecycle & Isolation Verification:
1. **Pre-Restart State**:
   - Injected distinct test cookies: `client_a_cookie_marker=marker_alpha_val` (Client A) vs `client_b_cookie_marker=marker_beta_val` (Client B).
   - Injected distinct `localStorage`: `client_a_ls_marker=marker_alpha_ls_val` (Client A) vs `client_b_ls_marker=marker_beta_ls_val` (Client B).
   - Injected distinct `sessionStorage`: `client_a_ss_marker=marker_alpha_ss_val` (Client A) vs `client_b_ss_marker=marker_beta_ss_val` (Client B).
   - **Pre-restart verification**: Each client reads exclusively its own markers; cross-client reads of cookies, `localStorage`, and `sessionStorage` strictly return `null`.
2. **Post-Restart Persistence & Expected SessionStorage Behavior**:
   - Both Chromium browser contexts were completely closed and relaunched from their respective on-disk persistent user data directories.
   - **Persistent Stores**: Client A persisted its cookie (`marker_alpha_val`) and `localStorage` (`marker_alpha_ls_val`). Client B persisted its cookie (`marker_beta_val`) and `localStorage` (`marker_beta_ls_val`). Cross-reads returned `null`.
   - **SessionStorage Lifecycle**: Pre-restart `sessionStorage` values returned `null` for both clients upon restart, verifying standard and expected browser session boundary behavior (sessionStorage is non-persistent across closed browser contexts).
3. **Post-Restart SessionStorage Isolation**:
   - Fresh post-restart `sessionStorage` markers (`client_a_ss_post=post_restart_alpha` vs `client_b_ss_post=post_restart_beta`) were injected into the relaunched sessions.
   - Cross-client reads strictly returned `null`.
   - Temporary markers were cleaned up.
