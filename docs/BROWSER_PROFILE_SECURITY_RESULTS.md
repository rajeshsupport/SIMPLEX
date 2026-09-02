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

## 2. Strengthened Cross-Client Session Isolation Evidence

Test Suite: `packages/automation/src/tests/headed-profile-isolation.test.ts`  
Execution Status: **PASSED (Exit Code: 0)**

### Non-Zero Marker Verification Protocol:
1. **Client A (`HOSP_ALPHA`) Profile**:
   - Injected persistent cookie: `client_a_cookie_marker=marker_alpha_val`
   - Injected `localStorage`: `client_a_ls_marker=marker_alpha_ls_val`
   - Injected `sessionStorage`: `client_a_ss_marker=marker_alpha_ss_val`
2. **Client B (`HOSP_BETA`) Profile**:
   - Injected persistent cookie: `client_b_cookie_marker=marker_beta_val`
   - Injected `localStorage`: `client_b_ls_marker=marker_beta_ls_val`
   - Injected `sessionStorage`: `client_b_ss_marker=marker_beta_ss_val`
3. **Context Restart & Cross-Profile Reading Audit**:
   - Both Chromium browser contexts were closed and restarted from their respective on-disk persistent user data directories.
   - Client A persistent store: Retrieved `client_a_cookie_marker` and `client_a_ls_marker`. Cross-read for Client B markers returned **0 matches / null**.
   - Client B persistent store: Retrieved `client_b_cookie_marker` and `client_b_ls_marker`. Cross-read for Client A markers returned **0 matches / null**.
   - **Conclusion**: 100% strict cookie and web-storage isolation confirmed between Client A and Client B.
