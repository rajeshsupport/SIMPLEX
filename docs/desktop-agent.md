# Desktop Automation Agent Guide

## 1. Overview

The **Desktop Automation Agent** (`apps/desktop-agent`) runs locally on authorized operator workstations to execute browser actions against HMC client instances.

### Key Capabilities

- **Strict Session Isolation**: Every client application and operator user combination is assigned an isolated user data directory:
  `~/.hmc-console/profiles/client_{clientId}/user_{userId}`
  This guarantees that cookies, cache, local storage, and active sessions for Client A never leak to Client B.
- **Interactive "Open & Login" Mode**: Launches a visible Chromium window, automatically fills in decrypted credentials, submits the form, verifies arrival on the dashboard, and keeps the browser open for operator use.
- **Headless Batch Mode**: Executes batch operations (such as Service Master row creation) with background efficiency and granular step telemetry.
- **Security Checkpoint Halts**: If a CAPTCHA, MFA prompt, or SMS OTP challenge is detected on the target screen, the agent immediately stops execution, marks the run status as `REQUIRES_MANUAL_INTERVENTION`, and notifies the console without ever attempting to bypass the security control.

---

## 2. Pairing & Authentication

1. Start the agent:
   ```bash
   pnpm --filter @hmc/desktop-agent start
   ```
2. The agent automatically registers itself with the central API using `AGENT_SHARED_SECRET`.
3. Heartbeats are dispatched every 10 seconds, reporting machine hostname, OS info, memory metrics, and active task state.
