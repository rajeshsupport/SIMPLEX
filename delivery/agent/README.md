# SIMPLEX Desktop Browser Automation Agent

## What is this?
The **SIMPLEX Desktop Browser Agent** is a lightweight local runner that enables the SIMPLEX Web Console to automatically launch and control visible Chrome/Chromium sessions on your workstation.

When you click **"Open & Login"** or run browser automation workflows in the SIMPLEX Web Console, this agent:
1. Opens an isolated Google Chrome / Chromium window directly on your monitor screen.
2. Automatically fills in your saved encrypted credentials.
3. Completes login verification and leaves the portal open and ready for your work.

---

## Quick Start (Windows)

1. Make sure **Node.js (v20 or higher)** is installed:
   - Download from: [https://nodejs.org/](https://nodejs.org/)
2. Double-click **`start-agent.bat`**.
   - On first run, it will automatically install required drivers and browser binaries.
   - It will connect to the SIMPLEX Central API and show:
     ```text
     [AGENT] Successfully paired! Agent ID: ...
     Desktop Agent ready — visible Chrome mutations enabled
     [AGENT] Starting fast event-polling loop (250ms)...
     ```
3. Keep the command prompt window open while you work.

---

## Quick Start (Mac / Linux)

1. Open Terminal in this `agent` directory.
2. Run:
   ```bash
   ./start-agent.sh
   ```
3. Keep the terminal window open.

---

## Configuration

The agent automatically reads configuration from the parent `../.env` file. You can override settings using environment variables:
- `API_BASE_URL`: URL of the SIMPLEX Central API (default: `http://localhost:3000`)
- `AGENT_SHARED_SECRET`: Secret pairing key matching `docker-compose.yml` (default: `simplex_agent_shared_key_2026`)
