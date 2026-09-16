# SIMPLEX Central Operations Console
## Client Quickstart, Installation & Operations Manual
### Official Multi-Platform Deployment Guide (Windows, Linux & macOS)

---

### Executive Overview

This manual provides non-technical, step-by-step instructions to obtain, install, launch, update, and operate the **SIMPLEX Central Operations Console** on **Windows**, **Linux**, and **macOS**.

The application is distributed as a turnkey, self-contained containerized package using **Docker**. End-users and IT administrators do not need to manually configure Node.js, Python, or database engines. All components run in secure, isolated containers with persistent storage and strict data sandboxing.

```
+----------------------------------------------------------------------------------------------------+
|                                    SIMPLEX 1-CLICK ARCHITECTURE                                    |
|                                                                                                    |
|  [ 1. Install Docker ] ──► [ 2. Obtain ZIP Package ] ──► [ 3. Run Launcher ]                      |
|                                                                     │                              |
|                                                                     ▼                              |
|                                                [ Docker Auto-Pulls Pre-Built Images ]              |
|                                                ├── mcr.microsoft.com/mssql/server:2022-latest      |
|                                                ├── ghcr.io/rajeshsupport/simplex/simplex-api       |
|                                                └── ghcr.io/rajeshsupport/simplex/simplex-web       |
|                                                                     │                              |
|                                                                     ▼                              |
|  [ 5. 1-Click Update ] ◄── [ 4. Open Browser: http://localhost:5173 (Single Isolated DB) ]        |
+----------------------------------------------------------------------------------------------------+
```

---

## 1. How to Obtain the SIMPLEX Delivery Package (`simplex-delivery.zip`)

The delivery package `simplex-delivery.zip` is extremely lightweight (~10 KB) because it contains only the operational orchestration files, environment configs, and 1-click launchers. All heavy application binaries and database engines are pulled securely from the official registry.

Clients can obtain the package through either of the following two standard methods:

### Method A: Direct Download via Official GitHub Release (Recommended)
1. Open your web browser and visit the official repository releases page:
   👉 **https://github.com/rajeshsupport/SIMPLEX/releases**
2. Under the latest release (e.g. `v1.0.0`), click on **`simplex-delivery.zip`** to download it directly.
3. *Alternative command line download (Linux/Mac)*:
   ```bash
   curl -L -O https://github.com/rajeshsupport/SIMPLEX/raw/main/simplex-delivery.zip
   ```

### Method B: Direct Sharing from Software Vendor
If the client is operating in a closed network, intranet, or prefers direct delivery:
* The software vendor (Rajesh / PKV Global) will share `simplex-delivery.zip` via **Email attachment**, **Google Drive / OneDrive / Dropbox secure link**, or via a **USB flash drive**.
* Save the file to your computer (e.g., `Downloads` or `Desktop`).

---

## 2. Package Contents & How Docker Pulls the Images

When you extract `simplex-delivery.zip`, you will find the following clean launcher files:

| File Name | Platform | Description |
| :--- | :--- | :--- |
| **`start.bat`** | Windows | 1-Click Launcher that verifies Docker, starts all services, and opens the browser. |
| **`stop.bat`** | Windows | 1-Click Stopper to safely pause all services. |
| **`update.bat`** | Windows | 1-Click Updater to pull the latest patches without losing any data. |
| **`start.sh`** | Linux & macOS | 1-Command Launcher for Unix systems. |
| **`stop.sh`** | Linux & macOS | 1-Command Stopper for Unix systems. |
| **`update.sh`** | Linux & macOS | 1-Command Updater for Unix systems. |
| **`docker-compose.yml`** | All OS | Production service definitions for Database, API, and Web UI. |
| **`init-db.sql`** | All OS | Database security isolation script ensuring access strictly to `SIMPLEX_CENTRAL_DB`. |
| **`.env`** | All OS | Configurable ports and security tokens. |
| **`CLIENT_INSTRUCTIONS.txt`** | All OS | Quick reference text file. |

> **How Image Download Works**:
> When `start.bat` or `start.sh` is executed for the first time, Docker reads `docker-compose.yml` and automatically pulls the official pre-compiled Docker images from Microsoft and GitHub Container Registry. The client does not need to build, compile, or install anything manually.

---

## 3. Dedicated Database Isolation & Zero Data Exposure Guarantee

A common security requirement in enterprise and hospital environments is ensuring that the application only touches its own dedicated database and never accesses other corporate or clinical databases.

1. **Single Isolated Database (`SIMPLEX_CENTRAL_DB`)**:
   * The containerized Microsoft SQL Server instance runs in complete isolation.
   * None of your vendor's development databases, test fixtures, or external records exist in this container.
   * Only one database is created: **`SIMPLEX_CENTRAL_DB`**.
2. **Strict User Sandboxing (`DENY VIEW ANY DATABASE`)**:
   * The application connects using a restricted user `simplex_app_user` with permissions limited exclusively to `SIMPLEX_CENTRAL_DB`.
   * Even if deployed on an existing shared enterprise SQL Server, the script [init-db.sql](file:///Users/sharmila/Music/SIMPLEX/delivery/init-db.sql) enforces `DENY VIEW ANY DATABASE`, ensuring the application cannot see or query any other database on that server.

---

## 4. WINDOWS Installation & Operation Guide (Windows 10 / 11 / Server)

### Step 4.1: Install Docker Desktop on Windows
1. Download **Docker Desktop for Windows**:
   👉 **https://www.docker.com/products/docker-desktop/**
2. Run `Docker Desktop Installer.exe`.
3. Ensure **"Use WSL 2 instead of Hyper-V"** is checked (recommended).
4. Restart your computer if prompted.
5. Open **Docker Desktop** from the Start Menu.
6. Wait until the whale icon in the bottom-right Windows taskbar turns steady green with status: **"Engine running"**.

### Step 4.2: Extract the Package
1. Right-click `simplex-delivery.zip` and select **Extract All...**.
2. Choose a destination folder (e.g. `C:\SIMPLEX` or `Desktop\SIMPLEX`).
3. Click **Extract**.

### Step 4.3: Launch the Application (1-Click)
1. Ensure Docker Desktop is running.
2. Inside the extracted folder, **Double-Click `start.bat`**.
3. A command window will launch, verify Docker, download the latest images automatically, and initialize the system.
4. Your default web browser will automatically open to:
   👉 **http://localhost:5173**

### Step 4.4: How to Update When a Bug-Fix or Patch is Released
When the vendor notifies you of a new update:
1. Open your `SIMPLEX` folder.
2. **Double-Click `update.bat`**.
3. Docker will pull the updated container and restart the application in 15–20 seconds.
4. **Data Guarantee**: All database records, clients, and users are stored in the persistent volume `simplex_production_db_data` and are **100% PRESERVED**.

### Step 4.5: How to Stop
* Double-click **`stop.bat`** to safely halt the application.

---

## 5. LINUX Installation & Operation Guide (Ubuntu / Debian / RHEL)

### Step 5.1: Install Docker Engine on Linux
Open your terminal and run the standard official Docker installation:
```bash
# 1. Update package index and install prerequisites
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# 2. Add Docker official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# 3. Add repository to Apt sources
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 4. Install Docker Engine and Docker Compose Plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 5. Enable non-root user access (Optional but recommended)
sudo usermod -aG docker $USER
```
*(Log out and log back in for user group permissions to take effect).*

### Step 5.2: Extract and Set Permissions
```bash
# Unzip delivery archive
unzip simplex-delivery.zip -d ~/simplex
cd ~/simplex

# Grant executable permissions to shell scripts
chmod +x *.sh
```

### Step 5.3: Launch the Application (1-Command)
```bash
./start.sh
```
Open your web browser and navigate to:
👉 **http://localhost:5173** *(or `http://<server-ip>:5173` if accessing over LAN/Server).*

### Step 5.4: How to Apply Updates / Bug Fixes
```bash
cd ~/simplex
./update.sh
```
*Pulls updated containers and restarts seamlessly. All database data remains 100% intact.*

### Step 5.5: How to Stop
```bash
cd ~/simplex
./stop.sh
```

---

## 6. macOS Installation & Operation Guide (Apple Silicon & Intel)

### Step 6.1: Install Docker Desktop for Mac
1. Download **Docker Desktop for Mac**:
   👉 **https://www.docker.com/products/docker-desktop/**
   * Select **"Mac with Apple Silicon"** for M1 / M2 / M3 / M4 Macs.
   * Select **"Mac with Intel chip"** for Intel-based Macs.
2. Open the downloaded `.dmg` file and drag **Docker** to your **Applications** folder.
3. Open **Docker** from Applications and accept the agreement.
4. Wait until the whale icon in the top menu bar indicates **"Docker Desktop is running"**.

### Step 6.2: Extract the Package
1. Double-click `simplex-delivery.zip` in Finder to extract it.
2. Open **Terminal** (`Cmd + Space`, type `Terminal`, press Enter).
3. Navigate to the extracted folder:
   ```bash
   cd ~/Downloads/simplex-delivery   # (or your extracted folder path)
   chmod +x *.sh
   ```

### Step 6.3: Launch the Application
```bash
./start.sh
```
Open your web browser to:
👉 **http://localhost:5173**

### Step 6.4: How to Apply Updates / Bug Fixes
```bash
./update.sh
```

### Step 6.5: How to Stop
```bash
./stop.sh
```

---

## 7. Default Login Credentials & Access Points

| Service / Component | URL / Endpoint | Default Credentials | Description |
| :--- | :--- | :--- | :--- |
| **Web Operations Portal** | `http://localhost:5173` | Username: `admin`<br/>Password: `Rajesh@123` | Main dashboard for operations, users, and clients. |
| **Backend REST API** | `http://localhost:3000/api/v1` | Bearer Token / Session | Orchestration and management backend. |
| **Swagger API Documentation** | `http://localhost:3000/api/docs` | Public / Authorize Header | Interactive API specification and test console. |
| **Database Engine** | `localhost:1433` | Host: `simplex_db`<br/>Database: `SIMPLEX_CENTRAL_DB` | Dedicated Microsoft SQL Server 2022 instance. |

> [!NOTE]
> Upon your first login, it is strongly recommended to navigate to **Settings -> Security** and update the default administrator password.

---

## 8. 1-Click Over-The-Air Update Mechanism (Zero Data Loss)

When software enhancements or bug fixes are deployed:
1. The developer pushes verified code changes to GitHub.
2. GitHub Actions automatically packages and pushes the new container image to GitHub Container Registry.
3. The client executes `update.bat` (Windows) or `./update.sh` (Linux/Mac).
4. Docker detects the new image tag, downloads only the updated binary layers, and restarts the containers.
5. **Persistent Data Assurance**: The Microsoft SQL database volume (`simplex_production_db_data`) is decoupled from the application containers. User accounts, clients, audit logs, and configurations are **never overwritten or deleted** during updates.

---

## 9. Frequently Asked Questions (FAQ) & Troubleshooting

### Q1: When running `start.bat`, it reports "Docker is not running". What should I do?
* **Solution**: Docker Desktop has not completed its startup. Open Docker Desktop and verify the status indicator in the bottom-left corner is green (**"Engine running"**). Then re-run `start.bat`.

### Q2: Can multiple operators access the portal from different computers on the same network?
* **Solution**: Yes! Find the LAN IP address of the host machine (e.g. `192.168.1.100` via `ipconfig` on Windows or `ifconfig` on Linux/Mac). Other operators on the same network can access the portal via `http://192.168.1.100:5173`.

### Q3: What if port 5173 or 3000 is already in use by another application?
* **Solution**: Open the `.env` file in any text editor.
  * Change `WEB_PORT=5173` to `WEB_PORT=8080` (or any available port).
  * Change `API_PORT=3000` to `API_PORT=3001`.
  * Save the file and execute `start.bat` (or `./start.sh`). The portal will be available on the new port.

### Q4: Can I run this in an offline (air-gapped) environment without internet?
* **Solution**: Yes. The vendor can export the pre-built Docker containers into a single `.tar.gz` bundle (`docker save`). You can import it on the offline machine using `docker load -i simplex-offline-images.tar.gz` and then run `start.bat` without internet connectivity.

---

**SIMPLEX Central Operations Console** · Official Technical Documentation · Copyright © 2026. All rights reserved.
