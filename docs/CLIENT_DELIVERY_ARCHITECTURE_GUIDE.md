# Client Delivery Kit: SIMPLEX Central Operations Console
## 1-Click Docker Deployment & Seamless Update Guide

This folder is designed to be provided directly to the client/end-user. 
**It contains ZERO source code** — only pre-built container orchestrators and 1-click batch scripts.

---

### What Files Are Delivered to the Client?
The client receives only a lightweight folder containing:
```
simplex-portal-client/
├── docker-compose.yml    # Points to pre-compiled Docker images (No source code inside)
├── .env                  # Basic port & secret configuration
├── start.bat             # 1-Click Launcher for Windows
├── start.sh              # 1-Click Launcher for Linux / Mac
├── update.bat            # 1-Click Updater for Windows (Preserves database data!)
├── update.sh             # 1-Click Updater for Linux / Mac
└── README.html           # Simple client user manual
```

---

### How It Solves the Two Core Vendor Requirements:

#### 1. Code Protection (Client Never Gets Source Code)
* The client **never** downloads your Git repository, TypeScript files, NestJS controllers, or React components.
* The Docker image contains only **minified, pre-compiled bytecode** (`dist/main.js`).
* The client cannot inspect, modify, or steal your intellectual property.

#### 2. Seamless Bug Fixes & Updates (No Data Loss!)
When a client reports a bug:
1. **You** fix the bug on your system and push an updated Docker image (`docker push yourregistry/simplex-api:latest`).
2. **The Client** simply double-clicks **`update.bat`**!
3. Docker pulls the new image in 20–30 seconds and restarts the container.
4. **Data Safety**: The database volume (`mssql_data`) is stored separately on the host machine. **No clients, users, passwords, or audit trails are lost.**
