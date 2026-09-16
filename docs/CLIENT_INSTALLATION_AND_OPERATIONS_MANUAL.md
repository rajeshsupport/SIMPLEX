# SIMPLEX Central Operations Console
## Client Quickstart & Installation Manual (Windows, Linux & macOS)

---

### Executive Overview

This manual provides non-technical, step-by-step instructions to install, launch, update, and manage the **SIMPLEX Central Operations Console** on **Windows**, **Linux**, and **macOS**.

The application is distributed as a self-contained, containerized package using **Docker**. End-users do not need to install Node.js, pnpm, Python, or database engines. All dependencies, background workers, and databases run in isolated, secure containers.

```
+-----------------------------------------------------------------------------+
|                          SIMPLEX 1-CLICK WORKFLOW                           |
|                                                                             |
|  [ 1. Install Docker ] ──► [ 2. Unzip Delivery Package ] ──► [ 3. Run ]    |
|                                                                    │        |
|                                                                    ▼        |
|  [ 5. 1-Click Update ] ◄── [ 4. Open Web Browser (http://localhost:5173) ] |
+-----------------------------------------------------------------------------+
```

---

## 1. WINDOWS Installation & Operation Guide (Windows 10 / 11 / Server)

### Step 1.1: Install Docker Desktop for Windows
1. Download **Docker Desktop for Windows** from the official site:
   👉 **https://www.docker.com/products/docker-desktop/**
2. Run the downloaded installer `Docker Desktop Installer.exe`.
3. During installation, ensure the option **"Use WSL 2 instead of Hyper-V"** is checked (recommended).
4. Follow the on-screen prompts and click **Close and restart** if prompted to restart your computer.
5. After restart, open **Docker Desktop** from your Start menu or desktop shortcut. Accept the service agreement.
6. Look at your Windows System Tray (bottom-right corner near the clock):
   * When Docker Desktop finishes loading, the whale icon will remain steady with a green indicator: **"Engine running"**.

### Step 1.2: Verify Docker Installation
1. Press `Win + R`, type `cmd`, and press **Enter** to open Command Prompt.
2. Run:
   ```cmd
   docker --version
   ```
   *Expected Output:* `Docker version 27.x.x` (or similar).

### Step 1.3: Download and Extract the SIMPLEX Package
1. Download the provided ZIP package (e.g. `simplex-delivery.zip`) sent by the vendor.
2. Right-click `simplex-delivery.zip` and select **Extract All...**.
3. Choose a destination folder (e.g. `C:\SIMPLEX`) and click **Extract**.
4. Inside the extracted folder, you will see:
   * `docker-compose.yml`
   * `start.bat`
   * `update.bat`
   * `stop.bat`
   * `.env`
   * `CLIENT_INSTRUCTIONS.txt`

### Step 1.4: Launch the Application (1-Click)
1. Make sure Docker Desktop is running in your taskbar.
2. Simply **Double-Click on `start.bat`**.
3. A command window will open, verify Docker, and start the Database, Central API, and Web Portal.
4. Once completed, your default web browser will **automatically open** to:
   👉 **http://localhost:5173**

### Step 1.5: How to Update When a Bug-Fix or New Version is Released
When the software vendor notifies you that an update or bug-fix is available:
1. Open the `C:\SIMPLEX` folder.
2. **Double-Click on `update.bat`**.
3. The system will download the latest patch and automatically restart the application within 20–30 seconds.
4. **Data Guarantee**: All your registered hospitals, users, passwords, and logs are **100% safe and preserved** in the separate persistent storage. Nothing is erased!

### Step 1.6: How to Stop the Application
* When you want to stop the system, simply double-click **`stop.bat`**.

---

## 2. LINUX Installation & Operation Guide (Ubuntu / Debian / RHEL)

### Step 2.1: Install Docker Engine on Linux (Ubuntu / Debian)
Open your terminal and run the standard official Docker installation:
```bash
# 1. Update package index and install prerequisites
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# 2. Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# 3. Add the repository to Apt sources
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 4. Install Docker Engine, CLI, and Docker Compose Plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 5. Enable non-root user access (Optional but recommended)
sudo usermod -aG docker $USER
```
*(Log out and log back in for group changes to take effect).*

### Step 2.2: Verify Docker on Linux
```bash
docker --version
docker compose version
```

### Step 2.3: Extract the Package
```bash
# Unzip the delivery archive
unzip simplex-delivery.zip -d ~/simplex
cd ~/simplex

# Ensure shell scripts have execute permissions
chmod +x *.sh
```

### Step 2.4: Launch the Application (1-Command)
```bash
./start.sh
```
*The services will launch in the background. Open your browser and navigate to:*
👉 **http://localhost:5173** *(or `http://<server-ip>:5173` if running on a remote Linux server).*

### Step 2.5: How to Apply Updates / Bug Fixes
```bash
cd ~/simplex
./update.sh
```
*Downloads the latest image updates and restarts services in under 30 seconds. Zero database data loss.*

### Step 2.6: How to Stop the Application
```bash
cd ~/simplex
./stop.sh
```

---

## 3. macOS Installation & Operation Guide (Apple Silicon M1/M2/M3/M4 & Intel)

### Step 3.1: Install Docker Desktop for Mac
1. Download **Docker Desktop for Mac** from the official site:
   👉 **https://www.docker.com/products/docker-desktop/**
   * Select **"Mac with Apple Silicon"** (if you have an M1, M2, M3, or M4 chip).
   * Select **"Mac with Intel chip"** (if using an older Intel Mac).
2. Open the downloaded `.dmg` file and drag the **Docker** icon into your **Applications** folder.
3. Open **Docker** from Applications (or Spotlight with `Cmd + Space`).
4. Click **Accept** on the agreement and complete the quick setup.
5. Wait until the whale icon in your macOS top menu bar says **"Docker Desktop is running"**.

### Step 3.2: Verify Docker on Mac
Open **Terminal** (`Cmd + Space`, type `Terminal`, press Enter) and run:
```bash
docker --version
```

### Step 3.3: Extract the Package
1. Double-click the downloaded `simplex-delivery.zip` file to unzip it into a folder.
2. In Terminal, navigate to the extracted directory:
   ```bash
   cd ~/Downloads/simplex-delivery   # (or wherever extracted)
   chmod +x *.sh
   ```

### Step 3.4: Launch the Application
In your Terminal, run:
```bash
./start.sh
```
Then open your web browser to:
👉 **http://localhost:5173**

### Step 3.5: How to Apply Updates / Bug Fixes
```bash
./update.sh
```
*Pulls updated containers and restarts seamlessly. Database data remains 100% intact.*

### Step 3.6: How to Stop the Application
```bash
./stop.sh
```

---

## 4. Default Login & First-Time Access

Once the application is running, access the web portal at **`http://localhost:5173`** (or your server's LAN IP address):

* **Web Portal URL**: `http://localhost:5173`
* **API Swagger Documentation**: `http://localhost:3000/api/docs`
* **Default Initial Username**: `admin`
* **Default Initial Password**: `Rajesh@123`

> [!IMPORTANT]
> Upon your first login, the system will prompt you to update the initial password to a secure personal password.

---

## 5. Frequently Asked Questions (FAQ) & Troubleshooting

### Q1: When I double-click `start.bat`, it says "Docker is not running". What should I do?
* **Cause**: Docker Desktop has not finished starting.
* **Fix**: Open Docker Desktop from your desktop or start menu. Look at the bottom-left corner of the Docker window; wait until the status turns **green ("Engine running")**, then double-click `start.bat` again.

### Q2: Will updating via `update.bat` or `update.sh` delete my client data or user records?
* **No, absolutely not.**
* The database is stored inside a named persistent Docker volume (`simplex_production_db_data`), which is physically decoupled from the software containers.
* When you run `update.bat`, only the application binary containers are replaced. Your database remains untouched, and all existing clients, credentials, users, and audit logs are 100% retained.

### Q3: What if port 5173 or 3000 is already in use by another software?
* Open the `.env` file in Notepad or any text editor.
* Change `WEB_PORT=5173` to `WEB_PORT=8080` (or any available port).
* Change `API_PORT=3000` to `API_PORT=3001`.
* Save the file and run `start.bat` / `./start.sh` again. The portal will then be available at `http://localhost:8080`.

### Q4: Can multiple team members access the application over the local hospital network (LAN)?
* **Yes!**
* Find the IP address of the machine running Docker (e.g. `192.168.1.50`).
* Any team member on the same Wi-Fi/LAN can open their browser and access:
  `http://192.168.1.50:5173`
