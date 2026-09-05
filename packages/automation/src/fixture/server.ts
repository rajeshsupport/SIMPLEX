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

  const clientUsers: Array<{
    username: string;
    firstName: string;
    middleName?: string;
    lastName: string;
    fullName: string;
    nickName?: string;
    email: string;
    mobileNumber: string;
    nationality: string;
    role: string;
    profileRole: string;
    status: 'ACTIVE' | 'INACTIVE';
    barcodeNumber?: string;
  }> = [
    {
      username: 'hmc_admin',
      firstName: 'System',
      lastName: 'Administrator',
      fullName: 'System Administrator',
      email: 'admin@client-hmc.local',
      mobileNumber: '0501112233',
      nationality: 'Saudi Arabia',
      role: 'Super User',
      profileRole: 'System Administrator',
      status: 'ACTIVE',
      barcodeNumber: 'BC-0001',
    },
    {
      username: 'dr_sarah',
      firstName: 'Sarah',
      lastName: 'Al-Mansoor',
      fullName: 'Sarah Al-Mansoor',
      email: 'sarah.m@hospital.example.com',
      mobileNumber: '0502223344',
      nationality: 'Saudi Arabia',
      role: 'Physician',
      profileRole: 'Clinical Specialist',
      status: 'ACTIVE',
      barcodeNumber: 'BC-0002',
    },
    {
      username: 'nurse_ali',
      firstName: 'Ali',
      lastName: 'Hassan',
      fullName: 'Ali Hassan',
      email: 'ali.hassan@hospital.example.com',
      mobileNumber: '0503334455',
      nationality: 'Egypt',
      role: 'Nurse',
      profileRole: 'Head Nurse',
      status: 'ACTIVE',
      barcodeNumber: 'BC-0003',
    },
    {
      username: 'abdul.p',
      firstName: 'Abdul',
      lastName: 'Pathan',
      fullName: 'Abdul Qadeer Pathan',
      email: 'abdul.p@hospital.example.com',
      mobileNumber: '0504445566',
      nationality: 'India',
      role: 'Physician',
      profileRole: 'General Practitioner',
      status: 'ACTIVE',
      barcodeNumber: 'BC-0004',
    },
    {
      username: 'synthetic.test.user',
      firstName: 'Synthetic',
      lastName: 'User',
      fullName: 'Synthetic Test User',
      email: 'synthetic.user@hospital.example.com',
      mobileNumber: '0509998877',
      nationality: 'Saudi Arabia',
      role: 'Admin',
      profileRole: 'System Administrator',
      status: 'ACTIVE',
      barcodeNumber: 'BC-0005',
    },
  ];

  const userRolesMap = new Map<string, string[]>();
  userRolesMap.set('hmc_admin', ['Admin', 'Super User']);
  userRolesMap.set('dr_sarah', ['Physician']);
  userRolesMap.set('nurse_ali', ['Nurse']);
  userRolesMap.set('abdul.p', ['Physician']);
  userRolesMap.set('synthetic.test.user', ['Admin']);

  // 1. Login Page
  const handleLoginGet = (req: Request, res: Response) => {
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
          <form method="POST" action="${req.path}">
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
  };

  const handleLoginPost = (req: Request, res: Response) => {
    const { username, password } = req.body;
    const loginPath = req.path;
    if (username === 'invalid_user' || username === 'bad_user' || password === 'WrongPassword!' || password === 'WrongPassword123!') {
      return res.redirect(`${loginPath}?error=` + encodeURIComponent('Invalid credentials'));
    }
    res.redirect('/hmc/dashboard');
  };

  app.get('/login', handleLoginGet);
  app.post('/login', handleLoginPost);
  app.get('/hmc/login', handleLoginGet);
  app.post('/hmc/login', handleLoginPost);

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
          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-top: 1.5rem; }
          .card { background: #1e293b; padding: 1.5rem; border-radius: 0.5rem; border: 1px solid #334155; }
          .card h3 { margin-top: 0; color: #94a3b8; font-size: 0.875rem; text-transform: uppercase; }
          .card .val { font-size: 1.75rem; font-weight: bold; color: #38bdf8; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="font-weight: bold; font-size: 1.25rem; color: #38bdf8;">HMC Clinical Suite</div>
          <div class="nav">
            <a href="/hmc/dashboard" class="active">Dashboard</a>
            <a href="/MasterV9.4/users">Users</a>
            <a href="/hmc/services">Services</a>
            <a href="/login">Logout</a>
          </div>
        </div>
        <div class="content" data-testid="client-dashboard">
          <h1>Welcome to Central Portal</h1>
          <div class="grid">
            <div class="card">
              <h3>Active Patients</h3>
              <div class="val" data-testid="metric-patients">1,248</div>
            </div>
            <div class="card">
              <h3>Configured Services</h3>
              <div class="val" data-testid="metric-services">${services.length}</div>
            </div>
            <div class="card">
              <h3>Registered Users</h3>
              <div class="val" data-testid="metric-users">${clientUsers.length}</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `);
  });

  // 3. Users List Screen (/MasterV9.4/users and /hmc/users)
  const handleUsersListGet = (req: Request, res: Response) => {
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
          .actions { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
          .btn-primary { background: #0284c7; color: white; padding: 0.5rem 1rem; border-radius: 0.375rem; text-decoration: none; font-weight: 600; border: none; cursor: pointer; }
          table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 0.5rem; overflow: hidden; font-size: 0.875rem; }
          th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #334155; }
          th { background: #0f172a; color: #94a3b8; text-transform: uppercase; font-size: 0.75rem; }
          .badge-active { color: #34d399; font-weight: bold; }
          .badge-inactive { color: #f87171; font-weight: bold; }
          .btn-action { background: #334155; color: #cbd5e1; border: none; padding: 0.25rem 0.5rem; border-radius: 0.25rem; cursor: pointer; margin-right: 0.25rem; font-size: 0.75rem; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="font-weight: bold; font-size: 1.25rem; color: #38bdf8;">HMC Clinical Suite</div>
          <div class="nav">
            <a href="/hmc/dashboard">Dashboard</a>
            <a href="/MasterV9.4/users" class="active">Users</a>
            <a href="/hmc/services">Services</a>
            <a href="/login">Logout</a>
          </div>
        </div>
        <div class="content" data-testid="hmc-users-screen">
          <div class="actions">
            <h1>User Details</h1>
            <input type="search" id="userSearch" data-testid="input-user-search" placeholder="Search by username or name..." oninput="filterTable()" onchange="filterTable()" onkeyup="filterTable()" style="padding: 0.5rem 1rem; border-radius: 0.375rem; background: #0f172a; border: 1px solid #334155; color: white;" />
            <a href="/MasterV9.4/addUsers" id="btnAddUser" class="btn-primary" data-testid="btn-add-user">+ Add User</a>
          </div>

          <table id="usersTable" data-testid="users-table">
            <thead>
              <tr>
                <th>S.NO</th>
                <th>User Name</th>
                <th>Name</th>
                <th>Mobile No</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${clientUsers
                .map(
                  (u, idx) => `
                <tr data-testid="user-row-${u.username}">
                  <td>${idx + 1}</td>
                  <td>${u.fullName}</td>
                  <td>${u.username}</td>
                  <td>${u.mobileNumber}</td>
                  <td class="status-cell">
                    <a href="javascript:void(0)" class="status-toggle ${u.status === 'ACTIVE' ? 'status-active' : 'status-inactive'}" title="${u.status === 'ACTIVE' ? 'Active' : 'Inactive'}" onclick="toggleStatus('${u.username}')" data-testid="btn-toggle-status">
                      ${u.status === 'ACTIVE'
                        ? '<span class="status-icon icon-active text-green" style="color: #10b981; font-size: 16px; font-weight: bold;" title="Active">✔</span>'
                        : '<span class="status-icon icon-inactive text-red" style="color: #ef4444; font-size: 16px; font-weight: bold;" title="Inactive">✖</span>'
                      }
                    </a>
                  </td>
                  <td class="action-cell">
                    <a href="javascript:void(0)" class="btn-action btn-edit" title="Edit" onclick="alert('Edit ${u.username}')"><i class="fa fa-pencil"></i> Edit</a>
                    <a href="javascript:void(0)" class="btn-action btn-reset-password" title="Reset Password" onclick="resetPassword('${u.username}')"><i class="fa fa-key"></i> Reset</a>
                    <a href="javascript:void(0)" class="btn-action btn-delete action-delete" title="Delete" onclick="alert('Delete ${u.username}')"><i class="fa fa-trash"></i> Delete</a>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>

        <script>
          function filterTable() {
            var input = document.getElementById('userSearch');
            var filter = input.value.toLowerCase().trim();
            var table = document.getElementById('usersTable');
            var tr = table.getElementsByTagName('tr');
            for (var i = 1; i < tr.length; i++) {
              var tdUsername = tr[i].getElementsByTagName('td')[2];
              var tdFullName = tr[i].getElementsByTagName('td')[1];
              if (tdUsername || tdFullName) {
                var uVal = tdUsername ? (tdUsername.textContent || tdUsername.innerText).toLowerCase().trim() : '';
                var fVal = tdFullName ? (tdFullName.textContent || tdFullName.innerText).toLowerCase().trim() : '';
                if (!filter || uVal === filter || uVal.indexOf(filter) > -1 || fVal.indexOf(filter) > -1) {
                  tr[i].style.display = '';
                } else {
                  tr[i].style.display = 'none';
                }
              }
            }
          }

          function toggleStatus(username) {
            fetch('/MasterV9.4/api/users/' + username + '/toggle-status', { method: 'POST' })
              .then(() => location.reload());
          }
          function resetPassword(username) {
            fetch('/MasterV9.4/api/users/' + username + '/reset-password', { method: 'POST' })
              .then(res => res.json())
              .then(data => {
                alert('Password reset: Temporary password is ' + data.temporaryPassword);
              });
          }
        </script>
      </body>
      </html>
    `);
  };

  app.get('/users', handleUsersListGet);
  app.get('/MasterV9.4/users', handleUsersListGet);
  app.get('/MasterV9.3/users', handleUsersListGet);
  app.get('/hmc/users', handleUsersListGet);

  // 4. Add User Screen (/MasterV9.4/addUsers, /MasterV9.3/addUsers, /addUsers)
  const handleAddUsersGet = (req: Request, res: Response) => {
    const postAction = req.path;
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Portal - Add User</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; }
          .content { padding: 2rem; max-width: 800px; margin: 0 auto; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.5rem; border: 1px solid #334155; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
          .field { margin-bottom: 1rem; }
          label { display: block; margin-bottom: 0.25rem; font-size: 0.875rem; color: #94a3b8; }
          input, select { width: 100%; box-sizing: border-box; padding: 0.5rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.375rem; color: #fff; font-size: 0.875rem; }
          .actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; }
          .btn-save { background: #0284c7; color: white; border: none; padding: 0.6rem 1.25rem; border-radius: 0.375rem; font-weight: bold; cursor: pointer; }
          .btn-cancel { background: transparent; color: #94a3b8; border: 1px solid #334155; padding: 0.6rem 1.25rem; border-radius: 0.375rem; cursor: pointer; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="content">
          <div class="card">
            <h2>Add User Master</h2>
            <form id="addUserForm" method="POST" action="${postAction}">
              <div class="grid">
                <div class="field">
                  <label for="username">User Name *</label>
                  <input type="text" id="username" name="username" data-testid="input-username" required />
                </div>
                <div class="field">
                  <label>Password</label>
                  <input type="text" disabled value="FixedDefaultPassword" />
                </div>
                <div class="field">
                  <label for="firstName">First Name *</label>
                  <input type="text" id="firstName" name="firstName" data-testid="input-firstname" required />
                </div>
                <div class="field">
                  <label for="middleName">Middle Name</label>
                  <input type="text" id="middleName" name="middleName" data-testid="input-middlename" />
                </div>
                <div class="field">
                  <label for="lastName">Last Name *</label>
                  <input type="text" id="lastName" name="lastName" data-testid="input-lastname" required />
                </div>
                <div class="field">
                  <label for="nickName">Nick Name</label>
                  <input type="text" id="nickName" name="nickName" data-testid="input-nickname" />
                </div>
                <div class="field">
                  <label for="email">Email</label>
                  <input type="email" id="email" name="email" data-testid="input-email" />
                </div>
                <div class="field">
                  <label for="mobileNo">Mobile No *</label>
                  <input type="tel" id="mobileNo" name="mobileNumber" data-testid="input-mobile" required />
                </div>
                <div class="field">
                  <label for="nationality">Nationality *</label>
                  <select id="nationality" name="nationality" data-testid="select-nationality">
                    <option value="Saudi Arabia">Saudi Arabia</option>
                    <option value="United Arab Emirates">United Arab Emirates</option>
                    <option value="India">India</option>
                    <option value="Egypt">Egypt</option>
                    <option value="Philippines">Philippines</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div class="field">
                  <label for="role">Role</label>
                  <select id="role" name="role" data-testid="select-role">
                    <option value="Physician">Physician</option>
                    <option value="Nurse">Nurse</option>
                    <option value="Admin">Admin</option>
                    <option value="Pharmacist">Pharmacist</option>
                  </select>
                </div>
                <div class="field">
                  <label for="profileRole">Profile Role</label>
                  <select id="profileRole" name="profileRole" data-testid="select-profilerole">
                    <option value="Clinical Specialist">Clinical Specialist</option>
                    <option value="General Practitioner">General Practitioner</option>
                    <option value="Head Nurse">Head Nurse</option>
                  </select>
                </div>
                <div class="field">
                  <label for="barcodeNo">Barcode No</label>
                  <input type="text" id="barcodeNo" name="barcodeNumber" data-testid="input-barcode" />
                </div>
                <div class="field">
                  <label>Signature</label>
                  <input type="file" id="signatureFile" name="signature" data-testid="input-signature-file" />
                </div>
                <div class="field">
                  <label>Stamp</label>
                  <input type="file" id="stampFile" name="stamp" data-testid="input-stamp-file" />
                </div>
                <div class="field">
                  <label>Profile</label>
                  <input type="file" id="profileFile" name="profile" data-testid="input-profile-file" />
                </div>
              </div>

              <div class="actions">
                <a href="/MasterV9.4/users" class="btn-cancel">Cancel</a>
                <button type="submit" id="btnSave" class="btn-save" data-testid="btn-save-user">Save</button>
              </div>
            </form>
          </div>
        </div>
      </body>
      </html>
    `);
  };

  app.get('/MasterV9.4/addUsers-no-button', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Add User No Button</title></head>
      <body>
        <form id="addUserForm">
          <label for="username">User Name *</label>
          <input type="text" id="username" name="username" />
          <label for="firstName">First Name *</label>
          <input type="text" id="firstName" name="firstName" />
          <label for="lastName">Last Name *</label>
          <input type="text" id="lastName" name="lastName" />
          <label for="mobileNo">Mobile No *</label>
          <input type="tel" id="mobileNo" name="mobileNumber" />
        </form>
      </body>
      </html>
    `);
  });

  app.get('/MasterV9.4/addUsers-disabled-button', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Add User Disabled Button</title></head>
      <body>
        <form id="addUserForm">
          <label for="username">User Name *</label>
          <input type="text" id="username" name="username" />
          <label for="firstName">First Name *</label>
          <input type="text" id="firstName" name="firstName" />
          <label for="lastName">Last Name *</label>
          <input type="text" id="lastName" name="lastName" />
          <label for="mobileNo">Mobile No *</label>
          <input type="tel" id="mobileNo" name="mobileNumber" />
          <button type="submit" id="btnSave" disabled>Save</button>
        </form>
      </body>
      </html>
    `);
  });

  app.get('/MasterV9.4/addUsers-no-verify', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Add User No Verify</title></head>
      <body>
        <form id="addUserForm" method="POST" action="/MasterV9.4/addUsers-no-verify">
          <label for="username">User Name *</label>
          <input type="text" id="username" name="username" />
          <label for="firstName">First Name *</label>
          <input type="text" id="firstName" name="firstName" />
          <label for="lastName">Last Name *</label>
          <input type="text" id="lastName" name="lastName" />
          <label for="mobileNo">Mobile No *</label>
          <input type="tel" id="mobileNo" name="mobileNumber" />
          <button type="submit" id="btnSave">Save</button>
        </form>
      </body>
      </html>
    `);
  });

  app.post('/MasterV9.4/addUsers-no-verify', (req: Request, res: Response) => {
    // Deliberately do not add user to clientUsers list so verification fails
    res.redirect('/MasterV9.4/users');
  });

  app.get('/MasterV9.4/addUsers-missing-field', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Portal - Add User</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; }
          .header { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
          .nav a { color: #94a3b8; text-decoration: none; margin-right: 1.5rem; font-weight: 500; }
          .content { padding: 2rem; max-width: 800px; margin: 0 auto; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.5rem; border: 1px solid #334155; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="font-weight: bold; font-size: 1.25rem; color: #38bdf8;">HMC Clinical Suite</div>
          <div class="nav"><a href="/MasterV9.4/users">Users</a></div>
        </div>
        <div class="content">
          <div class="card">
            <h2 class="screen-title">Add - User Details</h2>
            <form id="addUserForm">
              <div class="field">
                <label>Department</label>
                <input type="text" id="dept" />
              </div>
              <div class="field">
                <label>Employee Code</label>
                <input type="text" id="empCode" />
              </div>
            </form>
          </div>
        </div>
      </body>
      </html>
    `);
  });

  app.get('/MasterV9.4/addUsers-congrats-banner', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Add User Congrats</title></head>
      <body>
        <div class="content">
          <form id="addUserForm" method="POST" action="/MasterV9.4/addUsers-congrats-banner">
            <label for="username">User Name *</label>
            <input type="text" id="username" name="username" required />
            <label>Password</label>
            <input type="text" id="txtPassword" disabled value="DefaultSimplexPass!99" />
            <label for="firstName">First Name *</label>
            <input type="text" id="firstName" name="firstName" required />
            <label for="lastName">Last Name *</label>
            <input type="text" id="lastName" name="lastName" required />
            <label for="mobileNo">Mobile No *</label>
            <input type="tel" id="mobileNo" name="mobileNumber" required />
            <button type="submit" id="btnSave">Save</button>
          </form>
        </div>
      </body>
      </html>
    `);
  });

  app.post('/MasterV9.4/addUsers-congrats-banner', (req: Request, res: Response) => {
    const { username, firstName, lastName, mobileNumber } = req.body;
    clientUsers.push({
      username: username || 'congrats_user',
      firstName: firstName || 'Congrats',
      lastName: lastName || 'User',
      fullName: `${firstName || 'Congrats'} ${lastName || 'User'}`.trim(),
      email: 'congrats@test.com',
      mobileNumber: mobileNumber || '5551234567',
      nationality: 'Saudi Arabia',
      role: 'Physician',
      profileRole: 'Specialist',
      status: 'ACTIVE',
    });
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Success</title></head>
      <body>
        <div class="alert-warning">Congrats!! Added successfully</div>
        <script>setTimeout(() => { window.location.href = '/MasterV9.4/users'; }, 100);</script>
      </body>
      </html>
    `);
  });

  app.get('/MasterV9.4/addUsers-no-password', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Add User No Password</title></head>
      <body>
        <div class="content">
          <form id="addUserForm" method="POST" action="/MasterV9.4/addUsers-no-password">
            <label for="username">User Name *</label>
            <input type="text" id="username" name="username" required />
            <label for="firstName">First Name *</label>
            <input type="text" id="firstName" name="firstName" required />
            <label for="lastName">Last Name *</label>
            <input type="text" id="lastName" name="lastName" required />
            <label for="mobileNo">Mobile No *</label>
            <input type="tel" id="mobileNo" name="mobileNumber" required />
            <button type="submit" id="btnSave">Save</button>
          </form>
        </div>
      </body>
      </html>
    `);
  });

  app.post('/MasterV9.4/addUsers-no-password', (req: Request, res: Response) => {
    const { username, firstName, lastName, mobileNumber } = req.body;
    clientUsers.push({
      username: username || 'nopass_user',
      firstName: firstName || 'NoPass',
      lastName: lastName || 'User',
      fullName: `${firstName || 'NoPass'} ${lastName || 'User'}`.trim(),
      email: 'nopass@test.com',
      mobileNumber: mobileNumber || '5551234567',
      nationality: 'Saudi Arabia',
      role: 'Physician',
      profileRole: 'Specialist',
      status: 'ACTIVE',
    });
    res.redirect('/MasterV9.4/users');
  });

  const handleAddUsersPost = (req: Request, res: Response) => {
    const { username, firstName, middleName, lastName, nickName, email, mobileNumber, nationality, role, profileRole, barcodeNumber } = req.body;
    if (clientUsers.some((u) => u.username.toLowerCase() === (username || '').toLowerCase())) {
      return res.status(400).send('<div class="alert-danger">User already exists</div>');
    }
    const targetUrl = req.path.includes('MasterV9.3') ? '/MasterV9.3/users' : (req.path.includes('MasterV9.4') ? '/MasterV9.4/users' : '/users');
    clientUsers.push({
      username: username || `user_${Date.now()}`,
      firstName: firstName || 'First',
      middleName,
      lastName: lastName || 'Last',
      fullName: `${firstName || ''} ${lastName || ''}`.trim(),
      nickName,
      email: email || '',
      mobileNumber: mobileNumber || '',
      nationality: nationality || 'Other',
      role: role || 'Physician',
      profileRole: profileRole || 'Specialist',
      status: 'ACTIVE',
      barcodeNumber,
    });
    res.redirect(targetUrl);
  };

  app.get('/addUsers', handleAddUsersGet);
  app.get('/MasterV9.4/addUsers', handleAddUsersGet);
  app.get('/MasterV9.3/addUsers', handleAddUsersGet);
  app.post('/addUsers', handleAddUsersPost);
  app.post('/MasterV9.4/addUsers', handleAddUsersPost);
  app.post('/MasterV9.3/addUsers', handleAddUsersPost);

  // Client User Mutation APIs
  app.post('/MasterV9.4/api/users/:username/toggle-status', (req: Request, res: Response) => {
    const u = clientUsers.find((user) => user.username === req.params.username);
    if (u) {
      u.status = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      res.json({ success: true, status: u.status });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });

  app.post('/MasterV9.4/api/users/:username/reset-password', (req: Request, res: Response) => {
    const tempPassword = `Tmp@${Math.random().toString(36).substring(2, 8)}!1`;
    res.json({ success: true, temporaryPassword: tempPassword });
  });

  // User Role Master Screen (/addUserRole, /MasterV9.4/addUserRole, /MasterV9.3/addUserRole)
  const handleAddUserRoleGet = (req: Request, res: Response) => {
    const selectedUsername = (req.query.username as string) || '';
    const successMsg = req.query.success as string;
    const errorMsg = req.query.error as string;
    const currentRoles = selectedUsername ? (userRolesMap.get(selectedUsername) || []) : [];

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Portal - Add User Role Master</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; }
          .header { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
          .nav a { color: #94a3b8; text-decoration: none; margin-right: 1.5rem; font-weight: 500; }
          .content { padding: 2rem; max-width: 850px; margin: 0 auto; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.5rem; border: 1px solid #334155; }
          .field { margin-bottom: 1.25rem; }
          label { display: block; margin-bottom: 0.35rem; font-size: 0.875rem; color: #94a3b8; font-weight: 500; }
          input[type="text"], input[type="search"] { width: 100%; box-sizing: border-box; padding: 0.6rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.375rem; color: #fff; font-size: 0.9rem; }
          .user-dropdown { position: relative; }
          .dropdown-results { position: absolute; left: 0; right: 0; top: 100%; background: #0f172a; border: 1px solid #38bdf8; border-radius: 0.375rem; max-height: 220px; overflow-y: auto; z-index: 50; margin-top: 4px; box-shadow: 0 10px 25px rgba(0,0,0,0.7); }
          .user-option { padding: 0.6rem 1rem; border-bottom: 1px solid #1e293b; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
          .user-option:hover, .user-option.active { background: #1e293b; color: #38bdf8; }
          .role-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-top: 1rem; background: #0f172a; padding: 1.25rem; border-radius: 0.375rem; border: 1px solid #334155; }
          .role-checkbox-label { display: flex; align-items: center; gap: 0.5rem; color: #e2e8f0; font-size: 0.875rem; cursor: pointer; }
          .role-checkbox-label input { width: 16px; height: 16px; cursor: pointer; }
          .btn-update { background: #0284c7; color: white; border: none; padding: 0.65rem 1.5rem; border-radius: 0.375rem; font-weight: bold; cursor: pointer; font-size: 0.9rem; }
          .btn-update:hover { background: #0369a1; }
          .alert-success { background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; color: #34d399; padding: 0.75rem 1rem; border-radius: 0.375rem; margin-bottom: 1.25rem; font-size: 0.875rem; }
          .alert-danger { background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #f87171; padding: 0.75rem 1rem; border-radius: 0.375rem; margin-bottom: 1.25rem; font-size: 0.875rem; }
          .spinner { display: none; margin-left: 0.5rem; color: #38bdf8; font-size: 0.8rem; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="font-weight: bold; font-size: 1.25rem; color: #38bdf8;">HMC Clinical Suite</div>
          <div class="nav">
            <a href="/MasterV9.4/users">Users</a>
            <a href="/addUserRole" class="active">Add User Role</a>
            <a href="/login">Logout</a>
          </div>
        </div>
        <div class="content" data-testid="add-user-role-screen">
          <div class="card">
            <h2>User Role Master</h2>
            <p style="color: #64748b; font-size: 0.875rem; margin-bottom: 1.5rem;">Map single and multiple role permissions to client users.</p>

            ${successMsg ? `<div class="alert-success" id="successMsg" data-testid="msg-role-success">${successMsg}</div>` : ''}
            ${errorMsg ? `<div class="alert-danger" id="errorMsg" data-testid="msg-role-error">${errorMsg}</div>` : ''}

            <form id="UserRole" name="UserRole" method="POST" action="${req.path}" class="form-horizontal fv-form fv-form-bootstrap">
              <div class="field user-dropdown form-group">
                <label for="txtUserFirstname" class="control-label">User <span style="color:red;">*</span> <span id="searchSpinner" class="spinner" data-testid="search-spinner">(Searching…)</span></label>
                <input
                  type="text"
                  id="txtUserFirstname"
                  name="txtUserFirstname"
                  data-testid="input-user-role-search"
                  placeholder="User Id"
                  class="form-control filter-table ui-autocomplete-input"
                  value="${selectedUsername}"
                  autocomplete="off"
                  oninput="handleUserSearchInput(this.value)"
                  onfocus="handleUserSearchInput(this.value)"
                />
                <input type="hidden" id="txtUser" name="txtUser" data-testid="hidden-selected-username" value="${selectedUsername}" />
                <input type="hidden" id="txtUserFirhidden" name="txtUserFirhidden" value="${selectedUsername}" />
                <input type="hidden" id="selectedUsername" name="username" value="${selectedUsername}" />
                <ul id="userDropdownResults" class="ui-autocomplete ui-menu dropdown-results" style="display: none; list-style: none; padding: 0; margin: 4px 0 0 0;" data-testid="user-dropdown-results"></ul>
              </div>

              <div id="roleSelectionContainer" style="display: ${selectedUsername ? 'block' : 'none'};">
                <label>Available Role Controls for <strong id="displayUsername" style="color: #38bdf8;">${selectedUsername}</strong></label>

                <table class="table table-striped table-hover role-table" id="adduserrole" data-testid="table-adduserrole" style="width: 100%; margin-top: 1rem; border-collapse: collapse;">
                  <thead class="text-uppercase" style="background: #0f172a; color: #94a3b8; font-size: 0.8rem;">
                    <tr>
                      <th style="padding: 0.5rem; text-align: left;">Role Name</th>
                      <th style="padding: 0.5rem; text-align: center;">Assign</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${[
                      'ACCUMED',
                      'FRONT DESK',
                      'REPORTS',
                      'ADMIN',
                      'DOCTOR',
                      'NURSE',
                      'PHYSICIAN',
                      'PHARMACIST',
                      'LAB TECHNICIAN',
                      'OPERATOR',
                      'SUPER USER',
                      'BILLING SUPER USER',
                      'Physician',
                      'Nurse',
                      'Admin',
                      'Pharmacist',
                      'Super User',
                    ].map((role) => {
                      const isChecked = currentRoles.some((r) => r.toLowerCase().trim() === role.toLowerCase().trim());
                      return `
                        <tr style="border-bottom: 1px solid #334155;">
                          <td class="checkrole" style="padding: 0.5rem;">${role}</td>
                          <td style="padding: 0.5rem; text-align: center;">
                            <label class="role-checkbox-label" style="display: inline-flex; align-items: center; cursor: pointer;">
                              <input
                                type="checkbox"
                                name="txtRole[]"
                                value="${role}"
                                data-chckrole="${role}"
                                data-role="${role}"
                                class="adduserole checkrolehide"
                                data-testid="checkbox-role-${role.toLowerCase().replace(/\\s+/g, '-')}"
                                ${isChecked ? 'checked' : ''}
                              />
                            </label>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>

                <div style="margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 0.75rem;">
                  <button type="submit" id="btnUpdateRoles" class="btn btn-info btn-update" data-testid="btn-update-roles">ADD</button>
                </div>
              </div>
            </form>
          </div>
        </div>

        <script>
          const rawClientUsers = ${JSON.stringify(clientUsers)};
          const userRolesStore = ${JSON.stringify(Object.fromEntries(userRolesMap.entries()))};

          // Synthetic Ambiguity Candidates for automated test validation
          const extendedUsers = [
            ...rawClientUsers,
            { username: 'raja.testone', firstName: 'Raja', lastName: 'Testone', fullName: 'Raja Testone', remoteUserId: 'USER-101' },
            { username: 'raja.testtwo', firstName: 'Raja', lastName: 'Testtwo', fullName: 'Raja Testtwo', remoteUserId: 'USER-102' },
            { username: 'raja.testthree', firstName: 'Raja', lastName: 'Testthree', fullName: 'Raja Testthree', remoteUserId: 'USER-103' },
            // Ambiguous fixture with no username or ID exposed
            { username: 'ambig.1', firstName: 'AmbiguousOnly', lastName: '', fullName: 'AmbiguousOnly', isAmbiguousFixture: true },
            { username: 'ambig.2', firstName: 'AmbiguousOnly', lastName: '', fullName: 'AmbiguousOnly', isAmbiguousFixture: true },
          ];

          let searchDebounceTimer = null;

          function handleUserSearchInput(val) {
            const query = (val || '').trim().toLowerCase();
            const spinner = document.getElementById('searchSpinner');
            const resultsContainer = document.getElementById('userDropdownResults');
            if (spinner) spinner.style.display = 'inline';

            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
              if (spinner) spinner.style.display = 'none';
              if (!query) {
                resultsContainer.style.display = 'none';
                return;
              }

              const matched = extendedUsers.filter((u) => {
                const uNorm = (u.username || '').toLowerCase();
                const fNorm = (u.fullName || '').toLowerCase();
                const fnNorm = (u.firstName || '').toLowerCase();
                const idNorm = (u.remoteUserId || '').toLowerCase();
                return uNorm.includes(query) || fNorm.includes(query) || fnNorm.includes(query) || idNorm.includes(query);
              });

              if (matched.length === 0) {
                resultsContainer.innerHTML = '<li class="ui-menu-item user-option" style="color: #64748b; padding: 0.5rem 1rem;">No users found</li>';
                resultsContainer.style.display = 'block';
                return;
              }

              resultsContainer.innerHTML = matched.map((u, idx) => {
                if (u.isAmbiguousFixture) {
                  return \`<li class="ui-menu-item user-option" data-testid="user-option" onclick="selectUser('\${u.username}', '\${u.fullName}')"><span>\${u.fullName}</span></li>\`;
                }
                const idText = u.remoteUserId ? ' [' + u.remoteUserId + ']' : '';
                return \`<li class="ui-menu-item user-option" data-testid="user-option" data-value="\${u.username}" data-username="\${u.username}" data-userid="\${u.remoteUserId || ''}" onclick="selectUser('\${u.username}', '\${u.fullName}')" style="padding: 0.5rem 1rem; border-bottom: 1px solid #1e293b; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                  <span><strong>\${u.fullName}</strong> (\${u.username})</span>
                  <span style="color: #64748b; font-size: 0.75rem;">\${idText}</span>
                </li>\`;
              }).join('');
              resultsContainer.style.display = 'block';
            }, 100);
          }

          function selectUser(username, fullName) {
            document.getElementById('txtUserFirstname').value = fullName;
            document.getElementById('txtUser').value = username;
            document.getElementById('txtUserFirhidden').value = fullName;
            document.getElementById('selectedUsername').value = username;
            document.getElementById('displayUsername').textContent = username + ' (' + fullName + ')';
            document.getElementById('userDropdownResults').style.display = 'none';
            document.getElementById('roleSelectionContainer').style.display = 'block';

            // Refresh checkboxes based on current mapping
            const current = userRolesStore[username] || [];
            const checkboxes = document.querySelectorAll('input[name="txtRole[]"], input[name="roles"]');
            checkboxes.forEach((cb) => {
              const val = cb.getAttribute('data-chckrole') || cb.value;
              cb.checked = current.some((r) => r.toLowerCase().trim() === val.toLowerCase().trim());
            });
          }
        </script>
      </body>
      </html>
    `);
  };

  const handleAddUserRolePost = (req: Request, res: Response) => {
    const userVal = (req.body.txtUser || req.body.username || '').toString().trim();
    if (!userVal) {
      return res.redirect(`${req.path}?error=` + encodeURIComponent('Please select a user first.'));
    }

    const rawRoles = req.body['txtRole[]'] || req.body.txtRole || req.body.roles || [];
    const rolesArr = Array.isArray(rawRoles) ? rawRoles : (rawRoles ? [rawRoles] : []);
    userRolesMap.set(userVal, rolesArr);

    // Also update clientUsers in-memory snapshot if present
    const matchedUser = clientUsers.find((u) => u.username.toLowerCase() === userVal.toLowerCase());
    if (matchedUser && rolesArr.length > 0) {
      matchedUser.role = rolesArr.join(', ');
    }

    res.redirect(`${req.path}?username=` + encodeURIComponent(userVal) + '&success=' + encodeURIComponent(`Roles updated successfully for user '${userVal}'. Saved roles: [${rolesArr.join(', ')}].`));
  };

  app.get('/addUserRole', handleAddUserRoleGet);
  app.post('/addUserRole', handleAddUserRolePost);
  app.get('/MasterV9.4/addUserRole', handleAddUserRoleGet);
  app.post('/MasterV9.4/addUserRole', handleAddUserRolePost);
  app.get('/MasterV9.3/addUserRole', handleAddUserRoleGet);
  app.post('/MasterV9.3/addUserRole', handleAddUserRolePost);

  // User Role APIs
  app.get('/MasterV9.4/api/user-roles/:username', (req: Request, res: Response) => {
    const uname = String(req.params.username || '');
    const roles = userRolesMap.get(uname) || [];
    res.json({ success: true, username: uname, roles });
  });

  app.post('/MasterV9.4/api/user-roles/:username', (req: Request, res: Response) => {
    const uname = String(req.params.username || '');
    const { roles } = req.body;
    const rolesArr = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    userRolesMap.set(uname, rolesArr);
    res.json({ success: true, username: uname, roles: rolesArr });
  });

  // Services Screen
  app.get('/hmc/services', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Portal - Services</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; }
          .header { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
          .nav a { color: #94a3b8; text-decoration: none; margin-right: 1.5rem; font-weight: 500; }
          .nav a:hover, .nav a.active { color: #38bdf8; }
          .content { padding: 2rem; }
          table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; background: #1e293b; border-radius: 0.5rem; overflow: hidden; }
          th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #334155; }
          th { background: #0f172a; color: #94a3b8; }
          .btn-primary { background: #0284c7; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.25rem; font-weight: 600; cursor: pointer; }
          .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); align-items: center; justify-content: center; }
          .modal.active { display: flex; }
          .modal-content { background: #1e293b; padding: 2rem; border-radius: 0.5rem; width: 100%; max-width: 450px; border: 1px solid #334155; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="font-weight: bold; font-size: 1.25rem; color: #38bdf8;">HMC Clinical Suite</div>
          <div class="nav">
            <a href="/hmc/dashboard">Dashboard</a>
            <a href="/MasterV9.4/users">Users</a>
            <a href="/hmc/services" class="active">Services</a>
            <a href="/login">Logout</a>
          </div>
        </div>
        <div class="content" data-testid="hmc-services-screen">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h1>Configured Services</h1>
            <button class="btn-primary" id="btnAddService" data-testid="btn-add-service" onclick="openModal()">+ Add Service</button>
          </div>
          <div id="statusMessage" style="display:none; color: #34d399; margin: 1rem 0;" data-testid="success-status">Service saved successfully</div>
          <table>
            <thead>
              <tr><th>Service Code</th><th>Service Name</th><th>Unit Price</th></tr>
            </thead>
            <tbody id="servicesTableBody">
              ${services.map(s => `<tr><td>${s.serviceCode}</td><td>${s.serviceName}</td><td>$${s.unitPrice.toFixed(2)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div id="serviceModal" class="modal" data-testid="service-modal">
          <div class="modal-content">
            <h2>Add New Service</h2>
            <form onsubmit="handleSaveService(event)">
              <div style="margin-bottom: 1rem;">
                <label>Service Code</label>
                <input type="text" id="serviceCode" name="serviceCode" data-testid="input-service-code" required style="width:100%; box-sizing:border-box; padding:0.5rem; background:#0f172a; border:1px solid #334155; color:#fff; border-radius:0.25rem;" />
              </div>
              <div style="margin-bottom: 1rem;">
                <label>Service Name</label>
                <input type="text" id="serviceName" name="serviceName" data-testid="input-service-name" required style="width:100%; box-sizing:border-box; padding:0.5rem; background:#0f172a; border:1px solid #334155; color:#fff; border-radius:0.25rem;" />
              </div>
              <div style="margin-bottom: 1rem;">
                <label>Unit Price</label>
                <input type="number" id="unitPrice" name="unitPrice" data-testid="input-unit-price" required style="width:100%; box-sizing:border-box; padding:0.5rem; background:#0f172a; border:1px solid #334155; color:#fff; border-radius:0.25rem;" />
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

  app.post('/hmc/api/services', (req: Request, res: Response) => {
    const { serviceCode, serviceName, unitPrice } = req.body;
    services.push({ serviceCode, serviceName, unitPrice: Number(unitPrice) });
    res.json({ success: true, message: 'Service created' });
  });

  app.get('/hmc/iframe-login', (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>HMC Embedded Portal</title></head>
      <body style="margin:0; background:#0f172a;">
        <h1 style="color:white; padding:1rem;">Embedded Clinical Portal</h1>
        <iframe id="loginFrame" name="loginFrame" src="/login" style="width:100%; height:600px; border:none;"></iframe>
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
