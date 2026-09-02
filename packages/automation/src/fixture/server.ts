import express, { Request, Response } from 'express';
import * as http from 'http';

export function createFixtureApp(): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // In-memory mock storage
  const services: Array<{ serviceCode: string; serviceName: string; unitPrice: number }> = [
    { serviceCode: 'SRV-001', serviceName: 'General Consultation', unitPrice: 150 },
    { serviceCode: 'SRV-002', serviceName: 'Comprehensive Health Check', unitPrice: 450 },
  ];

  const users: Array<{ username: string; email: string; role: string }> = [
    { username: 'hmc_admin', email: 'admin@client-hmc.local', role: 'SuperUser' },
  ];

  // 1. Login Page
  app.get('/hmc/login', (req: Request, res: Response) => {
    const error = req.query.error as string;
    const showMfa = req.query.mfa === 'true';

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Client Portal - Login</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; width: 100%; max-width: 400px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }
          h2 { margin-top: 0; color: #38bdf8; font-size: 1.5rem; }
          .field { margin-bottom: 1.25rem; }
          label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
          input { width: 100%; box-sizing: border-box; padding: 0.75rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.375rem; color: #fff; font-size: 1rem; }
          input:focus { outline: none; border-color: #38bdf8; }
          button { width: 100%; padding: 0.75rem; background: #0284c7; color: #fff; border: none; border-radius: 0.375rem; font-weight: 600; cursor: pointer; font-size: 1rem; }
          button:hover { background: #0369a1; }
          .error { color: #f87171; background: rgba(239, 68, 68, 0.1); padding: 0.75rem; border-radius: 0.375rem; margin-bottom: 1rem; font-size: 0.875rem; }
          .mfa-box { border: 2px dashed #f59e0b; padding: 1rem; border-radius: 0.375rem; margin-bottom: 1rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>HMC Client Portal</h2>
          <p style="color: #64748b; font-size: 0.875rem; margin-bottom: 1.5rem;">Target Client Application Login</p>
          ${error ? `<div class="error" data-testid="error-message">${error}</div>` : ''}
          ${showMfa ? `
            <div class="mfa-box" data-testid="mfa-challenge">
              <strong style="color: #f59e0b;">Security Checkpoint</strong>
              <p style="font-size: 0.875rem; margin: 0.5rem 0;">Enter Multi-Factor Authentication Code:</p>
              <input type="text" data-testid="input-mfa-code" placeholder="6-digit code" />
            </div>
          ` : ''}
          <form method="POST" action="/hmc/login">
            <div class="field">
              <label for="username">Username</label>
              <input type="text" id="username" name="username" data-testid="input-username" placeholder="Enter your username" required autofocus />
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" data-testid="input-password" placeholder="Enter your password" required />
            </div>
            <button type="submit" id="btnLogin" data-testid="btn-login">Sign In</button>
          </form>
        </div>
      </body>
      </html>
    `);
  });

  // Login POST handler
  app.post('/hmc/login', (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (username === 'invalid_user') {
      return res.redirect('/hmc/login?error=' + encodeURIComponent('Invalid credentials'));
    }
    // Accept standard test operator login
    res.redirect('/hmc/dashboard');
  });

  // 2. Client Dashboard
  app.get('/hmc/dashboard', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Portal - Dashboard</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; }
          .header { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
          .nav a { color: #94a3b8; text-decoration: none; margin-right: 1.5rem; font-weight: 500; }
          .nav a:hover, .nav a.active { color: #38bdf8; }
          .content { padding: 2rem; }
          .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-top: 1.5rem; }
          .stat-card { background: #1e293b; padding: 1.5rem; border-radius: 0.5rem; border: 1px solid #334155; }
          .stat-val { font-size: 2rem; font-weight: bold; color: #38bdf8; margin-top: 0.5rem; }
        </style>
      </head>
      <body>
        <div id="hmc-app-header" class="header">
          <div style="font-weight: bold; font-size: 1.25rem; color: #38bdf8;">HMC Clinical Suite</div>
          <div class="nav">
            <a href="/hmc/dashboard" class="active">Dashboard</a>
            <a href="/hmc/users">Users</a>
            <a href="/hmc/services">Services</a>
            <a href="/hmc/login">Logout</a>
          </div>
        </div>
        <div class="content" data-testid="hmc-dashboard" id="hmc-dashboard">
          <h1>Client Dashboard</h1>
          <p style="color: #94a3b8;">Welcome to HMC Client Operations Console. Session active.</p>
          <div class="stats">
            <div class="stat-card"><div>Active Services</div><div class="stat-val">${services.length}</div></div>
            <div class="stat-card"><div>System Users</div><div class="stat-val">${users.length}</div></div>
            <div class="stat-card"><div>System Status</div><div class="stat-val" style="color: #4ade80;">Operational</div></div>
          </div>
        </div>
      </body>
      </html>
    `);
  });

  // 3. Services Screen
  app.get('/hmc/services', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Portal - Service Master</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; }
          .header { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
          .nav a { color: #94a3b8; text-decoration: none; margin-right: 1.5rem; font-weight: 500; }
          .nav a:hover, .nav a.active { color: #38bdf8; }
          .content { padding: 2rem; }
          table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; background: #1e293b; border-radius: 0.5rem; overflow: hidden; }
          th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #334155; }
          th { background: #0f172a; color: #94a3b8; font-size: 0.875rem; text-transform: uppercase; }
          .btn-add { background: #0284c7; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 0.375rem; font-weight: 600; cursor: pointer; }
          .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); align-items: center; justify-content: center; }
          .modal.active { display: flex; }
          .modal-content { background: #1e293b; padding: 2rem; border-radius: 0.5rem; width: 400px; border: 1px solid #334155; }
          .form-group { margin-bottom: 1rem; }
          .form-group label { display: block; margin-bottom: 0.4rem; color: #94a3b8; font-size: 0.875rem; }
          .form-group input { width: 100%; box-sizing: border-box; padding: 0.5rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.25rem; color: white; }
          .msg { margin-top: 1rem; color: #4ade80; font-weight: 500; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="font-weight: bold; font-size: 1.25rem; color: #38bdf8;">HMC Clinical Suite</div>
          <div class="nav">
            <a href="/hmc/dashboard">Dashboard</a>
            <a href="/hmc/users">Users</a>
            <a href="/hmc/services" class="active">Services</a>
            <a href="/hmc/login">Logout</a>
          </div>
        </div>
        <div class="content" data-testid="hmc-services-screen">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h1>Service Master</h1>
            <button class="btn-add" id="btnAddService" data-testid="btn-add-service" onclick="openModal()">Add New Service</button>
          </div>
          <div id="statusMessage" class="msg" style="display: none;">Service saved successfully</div>
          <table>
            <thead>
              <tr>
                <th>Service Code</th>
                <th>Service Name</th>
                <th>Unit Price ($)</th>
              </tr>
            </thead>
            <tbody id="servicesTableBody">
              ${services.map(s => `<tr><td>${s.serviceCode}</td><td>${s.serviceName}</td><td>$${s.unitPrice.toFixed(2)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div id="serviceModal" class="modal">
          <div class="modal-content">
            <h3 style="margin-top:0;">Create Service</h3>
            <form id="serviceForm" onsubmit="handleSaveService(event)">
              <div class="form-group">
                <label>Service Code</label>
                <input type="text" id="serviceCode" name="serviceCode" data-testid="input-service-code" required />
              </div>
              <div class="form-group">
                <label>Service Name</label>
                <input type="text" id="serviceName" name="serviceName" data-testid="input-service-name" required />
              </div>
              <div class="form-group">
                <label>Unit Price</label>
                <input type="number" id="unitPrice" name="unitPrice" data-testid="input-unit-price" required />
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem;">
                <button type="button" onclick="closeModal()" style="background: transparent; color: #94a3b8; border: 1px solid #334155; padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer;">Cancel</button>
                <button type="submit" id="btnSaveService" data-testid="btn-save-service" style="background: #0284c7; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer; font-weight: 600;">Save Service</button>
              </div>
            </form>
          </div>
        </div>

        <script>
          function openModal() { document.getElementById('serviceModal').classList.add('active'); }
          function closeModal() { document.getElementById('serviceModal').classList.remove('active'); }
          async function handleSaveService(e) {
            e.preventDefault();
            const code = document.getElementById('serviceCode').value;
            const name = document.getElementById('serviceName').value;
            const price = parseFloat(document.getElementById('unitPrice').value);

            const res = await fetch('/hmc/api/services', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ serviceCode: code, serviceName: name, unitPrice: price })
            });

            if (res.ok) {
              closeModal();
              document.getElementById('statusMessage').style.display = 'block';
              const tbody = document.getElementById('servicesTableBody');
              const tr = document.createElement('tr');
              tr.innerHTML = '<td>' + code + '</td><td>' + name + '</td><td>$' + price.toFixed(2) + '</td>';
              tbody.appendChild(tr);
            }
          }
        </script>
      </body>
      </html>
    `);
  });

  // Services API
  app.post('/hmc/api/services', (req: Request, res: Response) => {
    const { serviceCode, serviceName, unitPrice } = req.body;
    services.push({ serviceCode, serviceName, unitPrice: Number(unitPrice) });
    res.json({ success: true, message: 'Service created' });
  });

  // 4. Users Screen
  app.get('/hmc/users', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Portal - Users</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; }
          .header { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
          .nav a { color: #94a3b8; text-decoration: none; margin-right: 1.5rem; font-weight: 500; }
          .nav a:hover, .nav a.active { color: #38bdf8; }
          .content { padding: 2rem; }
          table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; background: #1e293b; border-radius: 0.5rem; overflow: hidden; }
          th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #334155; }
          th { background: #0f172a; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="font-weight: bold; font-size: 1.25rem; color: #38bdf8;">HMC Clinical Suite</div>
          <div class="nav">
            <a href="/hmc/dashboard">Dashboard</a>
            <a href="/hmc/users" class="active">Users</a>
            <a href="/hmc/services">Services</a>
            <a href="/hmc/login">Logout</a>
          </div>
        </div>
        <div class="content" data-testid="hmc-users-screen">
          <h1>User Management</h1>
          <table>
            <thead>
              <tr><th>Username</th><th>Email</th><th>Role</th></tr>
            </thead>
            <tbody>
              ${users.map(u => `<tr><td>${u.username}</td><td>${u.email}</td><td>${u.role}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `);
  });

  return app;
}

export function startFixtureServer(port: number = 4000): Promise<http.Server> {
  return new Promise((resolve) => {
    const app = createFixtureApp();
    const server = app.listen(port, () => {
      console.log(`[FIXTURE] Local Mock HMC Server running on http://localhost:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  const port = parseInt(process.env.FIXTURE_SERVER_PORT || '4000', 10);
  startFixtureServer(port);
}
