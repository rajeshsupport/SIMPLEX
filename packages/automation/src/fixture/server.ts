import express, { Request, Response } from 'express';
import * as http from 'http';

export interface FixtureUserRoleRecord {
  id: number;
  userName: string;
  userId: string;
  role: string;
  status: 'A' | 'D';
}

export const fixtureClickCounters = {
  addUserRoleSubmitCount: 0,
  roleStatusClickCount: 0,
  passwordResetClickCount: 0,
  userStatusClickCount: 0,
  createUserSubmitCount: 0,
  addResourceUserSubmitCount: 0,
  reset() {
    this.addUserRoleSubmitCount = 0;
    this.roleStatusClickCount = 0;
    this.passwordResetClickCount = 0;
    this.userStatusClickCount = 0;
    this.createUserSubmitCount = 0;
    this.addResourceUserSubmitCount = 0;
  },
};

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
    {
      username: 'dr_samir',
      firstName: 'Samir',
      lastName: 'Ahmad',
      fullName: 'Dr. Samir Ahmad',
      email: 'dr.samir@hospital.example.com',
      mobileNumber: '0504445577',
      nationality: 'Saudi Arabia',
      role: 'Physician',
      profileRole: 'Specialist',
      status: 'ACTIVE',
      barcodeNumber: 'BC-0006',
    },
  ];

  const userRolesMap = new Map<string, string[]>();
  userRolesMap.set('hmc_admin', ['Admin', 'Super User']);
  userRolesMap.set('dr_sarah', ['Physician']);
  userRolesMap.set('nurse_ali', ['Nurse']);
  userRolesMap.set('abdul.p', ['Physician']);
  userRolesMap.set('synthetic.test.user', ['Admin']);

  let userRoleIdSeq = 1;
  const userRoleRegistry: FixtureUserRoleRecord[] = [
    { id: userRoleIdSeq++, userName: 'System Administrator', userId: 'hmc_admin', role: 'Admin', status: 'A' },
    { id: userRoleIdSeq++, userName: 'System Administrator', userId: 'hmc_admin', role: 'Super User', status: 'A' },
    { id: userRoleIdSeq++, userName: 'Sarah Al-Mansoor', userId: 'dr_sarah', role: 'Physician', status: 'A' },
    { id: userRoleIdSeq++, userName: 'Ali Hassan', userId: 'nurse_ali', role: 'Nurse', status: 'A' },
    { id: userRoleIdSeq++, userName: 'Abdul Qadeer Pathan', userId: 'abdul.p', role: 'Physician', status: 'A' },
    { id: userRoleIdSeq++, userName: 'Synthetic Test User', userId: 'synthetic.test.user', role: 'Admin', status: 'A' },
  ];

  const syncRolesMapFromRegistry = () => {
    userRolesMap.clear();
    for (const rec of userRoleRegistry) {
      if (rec.status === 'A') {
        const existing = userRolesMap.get(rec.userId) || [];
        if (!existing.includes(rec.role)) {
          existing.push(rec.role);
        }
        userRolesMap.set(rec.userId, existing);
      }
    }
  };

  const clientResources: Array<{
    resourceCode: string;
    resourceName: string;
    department?: string;
    specialization?: string;
    resourceType?: string;
    linkedUsername?: string;
    status: 'ACTIVE' | 'INACTIVE';
  }> = [
    {
      resourceCode: 'RES-001',
      resourceName: 'Dr. Sarah Mansoor',
      department: 'Cardiology',
      specialization: 'Interventional Cardiology',
      resourceType: 'DOCTOR',
      linkedUsername: 'dr_sarah',
      status: 'ACTIVE',
    },
    {
      resourceCode: 'RES-002',
      resourceName: 'Nurse Ali Hassan',
      department: 'Emergency',
      specialization: 'Critical Care',
      resourceType: 'STAFF',
      linkedUsername: 'nurse_ali',
      status: 'ACTIVE',
    },
    {
      resourceCode: 'RES-003',
      resourceName: 'Consultation Room 101',
      department: 'OPD',
      specialization: 'General OPD',
      resourceType: 'ROOM',
      status: 'ACTIVE',
    },
  ];

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
    res.setHeader('Set-Cookie', 'session_auth=true; Path=/');
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
                if (data && data.temporaryPassword) {
                  alert('Password reset: Temporary password is ' + data.temporaryPassword);
                } else {
                  alert((data && data.message) || 'Password Reseted Successfully');
                }
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
    fixtureClickCounters.createUserSubmitCount++;
    const { username, firstName, middleName, lastName, nickName, email, mobileNumber, nationality, role, profileRole, barcodeNumber } = req.body;
    if (clientUsers.some((u) => u.username.toLowerCase() === (username || '').toLowerCase())) {
      return res.status(400).send('<div class="alert-danger">User already exists</div>');
    }
    const targetUrl = req.path.includes('MasterV9.3') ? '/MasterV9.3/users' : (req.path.includes('MasterV9.4') ? '/MasterV9.4/users' : '/users');
    const assignedUsername = username || `user_${Date.now()}`;
    const assignedFullName = `${firstName || ''} ${lastName || ''}`.trim();
    const assignedRole = role || 'Physician';

    clientUsers.push({
      username: assignedUsername,
      firstName: firstName || 'First',
      middleName,
      lastName: lastName || 'Last',
      fullName: assignedFullName,
      nickName,
      email: email || '',
      mobileNumber: mobileNumber || '',
      nationality: nationality || 'Other',
      role: assignedRole,
      profileRole: profileRole || 'Specialist',
      status: 'ACTIVE',
      barcodeNumber,
    });

    userRoleRegistry.push({
      id: userRoleIdSeq++,
      userName: assignedFullName,
      userId: assignedUsername,
      role: assignedRole,
      status: 'A',
    });
    syncRolesMapFromRegistry();

    res.redirect(targetUrl);
  };

  app.get('/addUsers', handleAddUsersGet);
  app.get('/MasterV9.4/addUsers', handleAddUsersGet);
  app.get('/MasterV9.3/addUsers', handleAddUsersGet);
  app.post('/addUsers', handleAddUsersPost);
  app.post('/MasterV9.4/addUsers', handleAddUsersPost);
  app.post('/MasterV9.3/addUsers', handleAddUsersPost);

  // Client User Mutation APIs
  const handleToggleUserStatus = (req: Request, res: Response) => {
    fixtureClickCounters.userStatusClickCount++;
    const u = clientUsers.find((user) => user.username.toLowerCase() === String(req.params.username || '').toLowerCase());
    if (u) {
      u.status = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      res.json({ success: true, status: u.status });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  };

  const handleResetUserPassword = (req: Request, res: Response) => {
    fixtureClickCounters.passwordResetClickCount++;
    const tempPassword = 'Tmp@Pass123!'; // test fixture dummy password
    res.json({ success: true, temporaryPassword: tempPassword });
  };

  ['/api/users/:username/toggle-status', '/MasterV9.4/api/users/:username/toggle-status', '/MasterV9.3/api/users/:username/toggle-status'].forEach((p) => {
    app.post(p, handleToggleUserStatus);
  });

  ['/api/users/:username/reset-password', '/MasterV9.4/api/users/:username/reset-password', '/MasterV9.3/api/users/:username/reset-password'].forEach((p) => {
    app.post(p, handleResetUserPassword);
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
                      'CLINICAL PHARMACIST',
                      'SURGEON',
                      'ANESTHESIOLOGIST',
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
    fixtureClickCounters.addUserRoleSubmitCount++;
    const userVal = (req.body.txtUser || req.body.username || '').toString().trim();
    if (!userVal) {
      return res.redirect(`${req.path}?error=` + encodeURIComponent('Please select a user first.'));
    }

    const rawRoles = req.body['txtRole[]'] || req.body.txtRole || req.body.roles || [];
    const rolesArr = Array.isArray(rawRoles) ? rawRoles : (rawRoles ? [rawRoles] : []);

    const matchedUser = clientUsers.find((u) => u.username.toLowerCase() === userVal.toLowerCase());
    const fullName = matchedUser ? matchedUser.fullName : userVal;

    for (const rName of rolesArr) {
      const existing = userRoleRegistry.find(
        (r) => r.userId.toLowerCase() === userVal.toLowerCase() && r.role.toLowerCase() === rName.toLowerCase()
      );
      if (existing) {
        existing.status = 'A';
      } else {
        userRoleRegistry.push({
          id: userRoleIdSeq++,
          userName: fullName,
          userId: userVal,
          role: rName,
          status: 'A',
        });
      }
    }
    syncRolesMapFromRegistry();

    // Also update clientUsers in-memory snapshot if present
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

  // User Role Registry Screen (/userRole, /MasterV9.4/userRole, /MasterV9.3/userRole)
  const handleUserRoleGet = (req: Request, res: Response) => {
    const prefix = req.path.includes('MasterV9.4') ? '/MasterV9.4' : (req.path.includes('MasterV9.3') ? '/MasterV9.3' : '');
    const rowsHtml = userRoleRegistry
      .map((rec, idx) => {
        const statusHtml =
          rec.status === 'A'
            ? `<a href="${prefix}/changeUserRoleStatus/${rec.id}/A" title="Click to Deactive" class="btn-status-active"><i class="fa fa-check text-success"></i> Active</a>`
            : `<a href="${prefix}/changeUserRoleStatus/${rec.id}/D" class="remove btn-status-deactive" title="Click to Active"><i class="fa fa-remove text-danger"></i> Deactive</a>`;
        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${rec.userName}</td>
            <td>${rec.userId}</td>
            <td>${rec.role}</td>
            <td>General</td>
            <td>Staff</td>
            <td>Main</td>
            <td>admin</td>
            <td>2026-01-01</td>
            <td>${statusHtml}</td>
          </tr>
        `;
      })
      .join('');

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>User Role Registry</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; }
          .header { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
          .nav a { color: #94a3b8; text-decoration: none; margin-right: 1.5rem; font-weight: 500; }
          .content { padding: 2rem; max-width: 1200px; margin: 0 auto; }
          .card { background: #1e293b; padding: 1.5rem; border-radius: 0.5rem; border: 1px solid #334155; }
          .dataTables_filter { margin-bottom: 1rem; display: flex; justify-content: flex-end; }
          .dataTables_filter input { padding: 0.5rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.375rem; color: #fff; }
          table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
          th { background: #0f172a; color: #94a3b8; text-align: left; padding: 0.75rem 0.5rem; font-size: 0.75rem; text-transform: uppercase; border-bottom: 1px solid #334155; }
          td { padding: 0.75rem 0.5rem; border-bottom: 1px solid #1e293b; font-size: 0.85rem; }
          a.btn-status-active { color: #10b981; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
          a.btn-status-deactive { color: #ef4444; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div style="font-weight: bold; font-size: 1.25rem; color: #38bdf8;">HMC Clinical Suite</div>
          <div class="nav">
            <a href="${prefix}/users">Users</a>
            <a href="${prefix}/userRole" class="active">User Role</a>
            <a href="${prefix}/addUserRole">Add User Role</a>
            <a href="/login">Logout</a>
          </div>
        </div>
        <div class="content">
          <div class="card">
            <h2>User Role Mapping Registry</h2>
            <div class="dataTables_wrapper">
              <div class="dataTables_filter">
                <label>Search: <input type="search" id="roleSearch" class="form-control" placeholder="Search user or role..." oninput="filterRoleTable()" /></label>
              </div>
              <table id="tablaDatos" class="table table-striped table-bordered table-hover">
                <thead>
                  <tr>
                    <th>S.NO</th>
                    <th>USER NAME</th>
                    <th>USER ID</th>
                    <th>ROLE</th>
                    <th>DEPARTMENT</th>
                    <th>DESIGNATION</th>
                    <th>BRANCH</th>
                    <th>CREATED BY</th>
                    <th>CREATED DATE</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <script>
          function filterRoleTable() {
            var val = (document.getElementById('roleSearch').value || '').toLowerCase().trim();
            var rows = document.querySelectorAll('#tablaDatos tbody tr');
            rows.forEach(function(row) {
              var text = (row.textContent || '').toLowerCase();
              row.style.display = (!val || text.indexOf(val) > -1) ? '' : 'none';
            });
          }
        </script>
      </body>
      </html>
    `);
  };

  const handleChangeUserRoleStatus = (req: Request, res: Response) => {
    fixtureClickCounters.roleStatusClickCount++;
    const id = parseInt(String(req.params.id), 10);
    const rec = userRoleRegistry.find((r) => r.id === id);
    if (rec) {
      rec.status = rec.status === 'A' ? 'D' : 'A';
      syncRolesMapFromRegistry();
    }
    const prefix = req.path.includes('MasterV9.4') ? '/MasterV9.4' : (req.path.includes('MasterV9.3') ? '/MasterV9.3' : '');
    const referer = req.header('Referer');
    const redirectUrl = referer && referer.includes('userRole') ? referer : `${prefix}/userRole`;
    res.redirect(redirectUrl);
  };

  ['/userRole', '/MasterV9.4/userRole', '/MasterV9.3/userRole'].forEach((p) => {
    app.get(p, handleUserRoleGet);
  });

  ['/changeUserRoleStatus/:id/:status', '/MasterV9.4/changeUserRoleStatus/:id/:status', '/MasterV9.3/changeUserRoleStatus/:id/:status'].forEach((p) => {
    app.get(p, handleChangeUserRoleStatus);
    app.post(p, handleChangeUserRoleStatus);
  });

  // checkroleAddNewUser API endpoint (matching Simplex remote XHR)
  const handleCheckroleAddNewUser = (req: Request, res: Response) => {
    const userid = String(req.query.userid || req.query.username || '').trim().toLowerCase();
    const activeRoles = userRoleRegistry
      .filter((r) => r.userId.toLowerCase() === userid && r.status === 'A')
      .map((r) => ({ Role_Name: r.role, role_name: r.role, role: r.role, status: 'Active' }));
    res.json(activeRoles);
  };
  app.get('/checkroleAddNewUser', handleCheckroleAddNewUser);
  app.get('/MasterV9.4/checkroleAddNewUser', handleCheckroleAddNewUser);
  app.get('/MasterV9.3/checkroleAddNewUser', handleCheckroleAddNewUser);

  // Click counters API for invariant testing
  app.get('/api/test/click-counters', (_req: Request, res: Response) => {
    res.json(fixtureClickCounters);
  });
  app.post('/api/test/click-counters/reset', (_req: Request, res: Response) => {
    fixtureClickCounters.reset();
    res.json({ success: true, counters: fixtureClickCounters });
  });

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

  // =========================================================================
  // RESOURCE MANAGEMENT MOCK ROUTES
  // =========================================================================
  const handleResourcesGet = (req: Request, res: Response) => {
    const rowsHtml = clientResources
      .map(
        (r) => `
        <tr>
          <td>${r.resourceCode}</td>
          <td>${r.resourceName}</td>
          <td>${r.department || ''}</td>
          <td>${r.specialization || ''}</td>
          <td>${r.resourceType || 'DOCTOR'}</td>
          <td>${r.linkedUsername || '-'}</td>
          <td><span class="badge ${r.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}">${r.status}</span></td>
          <td><button type="button" class="btn-toggle" onclick="toggleStatus('${r.resourceCode}')">Toggle</button></td>
        </tr>
      `
      )
      .join('');

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Portal - Resource Master</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; border: 1px solid #334155; }
          table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
          th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #334155; }
          th { background: #0f172a; color: #38bdf8; }
          .badge-active { background: rgba(34, 197, 94, 0.2); color: #4ade80; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; }
          .badge-inactive { background: rgba(239, 68, 68, 0.2); color: #f87171; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; }
          .btn-toggle { background: #334155; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 0.25rem; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Resource Master Directory</h2>
          <table id="gridResources" class="table-resources">
            <thead>
              <tr>
                <th>Resource Code</th>
                <th>Resource Name</th>
                <th>Department</th>
                <th>Specialization</th>
                <th>Type</th>
                <th>Linked User</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `);
  };

  const handleAddResourceGet = (req: Request, res: Response) => {
    const error = req.query.error as string;
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>HMC Portal - Add Resource</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; display: flex; justify-content: center; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; border: 1px solid #334155; width: 100%; max-width: 500px; }
          .field { margin-bottom: 1rem; }
          label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
          input, select { width: 100%; box-sizing: border-box; padding: 0.75rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.375rem; color: #fff; font-size: 1rem; }
          button { width: 100%; padding: 0.75rem; background: #0284c7; color: #fff; border: none; border-radius: 0.375rem; font-weight: 600; cursor: pointer; font-size: 1rem; }
          .error { color: #f87171; background: rgba(239, 68, 68, 0.1); padding: 0.75rem; border-radius: 0.375rem; margin-bottom: 1rem; font-size: 0.875rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Add Client Resource</h2>
          ${error ? `<div class="error">${error}</div>` : ''}
          <form method="POST" action="${req.path}">
            <div class="field">
              <label for="txtResourceCode">Resource Code</label>
              <input type="text" id="txtResourceCode" name="resourceCode" required />
            </div>
            <div class="field">
              <label for="txtResourceName">Resource Name</label>
              <input type="text" id="txtResourceName" name="resourceName" required />
            </div>
            <div class="field">
              <label for="txtDepartment">Department</label>
              <input type="text" id="txtDepartment" name="department" />
            </div>
            <div class="field">
              <label for="txtSpecialization">Specialization</label>
              <input type="text" id="txtSpecialization" name="specialization" />
            </div>
            <div class="field">
              <label for="ddlResourceType">Resource Type</label>
              <select id="ddlResourceType" name="resourceType">
                <option value="DOCTOR">DOCTOR</option>
                <option value="STAFF">STAFF</option>
                <option value="ROOM">ROOM</option>
                <option value="EQUIPMENT">EQUIPMENT</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>
            <button type="submit" id="btnSave">Save Resource</button>
          </form>
        </div>
      </body>
      </html>
    `);
  };

  const handleAddResourceParentDetailsGet = (req: Request, res: Response) => {
    if (req.query.requireAuth === 'true' && !req.headers.cookie?.includes('session_auth=true')) {
      return res.redirect('/login');
    }
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>ADD-RESOURCE DETAILS</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; display: flex; justify-content: center; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; border: 1px solid #334155; width: 100%; max-width: 600px; }
          .field { margin-bottom: 1rem; }
          label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
          input, select { width: 100%; box-sizing: border-box; padding: 0.75rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.375rem; color: #fff; font-size: 1rem; }
          button { width: 100%; padding: 0.75rem; background: #0284c7; color: #fff; border: none; border-radius: 0.375rem; font-weight: 600; cursor: pointer; font-size: 1rem; }
          .alert-success { background: #064e3b; color: #6ee7b7; padding: 0.75rem; border-radius: 0.375rem; margin-bottom: 1rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 class="screen-title">ADD-RESOURCE DETAILS</h2>
          ${req.query.msg ? `<div class="alert-success" id="successMsg">${req.query.msg}</div>` : ''}
          ${req.query.error ? `<div class="alert-danger" id="errorMsg" style="background: #7f1d1d; color: #fca5a5; padding: 0.75rem; border-radius: 0.375rem; margin-bottom: 1rem;">${req.query.error}</div>` : ''}
          <form method="POST" action="${req.path}" id="addResourceParent" class="form-horizontal fv-form fv-form-bootstrap">
            <!-- FormValidation hidden submit button -->
            <button type="submit" class="fv-hidden-submit" style="display: none; width: 0px; height: 0px;" onclick="window.onControlClicked && window.onControlClicked('hidden')"></button>
            <div class="field">
              <label for="txtResourceName">Resource Name *</label>
              <input type="text" id="txtResourceName" name="resourceName" required />
              <input type="hidden" id="txtResource" name="txtResource" />
            </div>
            <div class="field">
              <label for="ddlIsHuman">Is Resource Human *</label>
              <label><input type="radio" id="txtResourceHumanYES" name="txtResourceHuman" value="Y" checked> Yes</label>
              <label><input type="radio" id="txtResourceHumanNO" name="txtResourceHuman" value="N"> No</label>
              <select id="ddlIsHuman" name="isResourceHuman" style="display: none;">
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
            <div class="field">
              <label for="txtResourceTypeName">Resource Type *</label>
              <select id="txtResourceTypeName" name="txtResourceTypeName">
                <option value="Consultant Physician">Consultant Physician</option>
                <option value="Specialist">Specialist</option>
                <option value="Staff Nurse">Staff Nurse</option>
                <option value="Room / Facility">Room / Facility</option>
                <option value="Equipment">Equipment</option>
              </select>
              <select id="ddlResourceType" name="resourceType" style="display: none;">
                <option value="Consultant Physician">Consultant Physician</option>
                <option value="Specialist">Specialist</option>
                <option value="Staff Nurse">Staff Nurse</option>
                <option value="Room / Facility">Room / Facility</option>
                <option value="Equipment">Equipment</option>
              </select>
            </div>
            <div class="field">
              <label for="txtSpecialityName">Specialty *</label>
              <input type="text" id="txtSpecialityName" name="txtSpecialityName" class="form-control ui-autocomplete-input" autocomplete="off" placeholder="Type to search specialty..." />
              <input type="hidden" id="txtSpecialityId" name="txtSpecialityId" />
              <input type="hidden" id="txtSpecialityHiddenName" name="txtSpecialityHiddenName" />
              <select id="ddlSpecialty" name="specialty" style="display: none;">
                <option value="Cardiology">Cardiology</option>
                <option value="Neurology">Neurology</option>
                <option value="Pediatrics">Pediatrics</option>
                <option value="Radiology">Radiology</option>
                <option value="General">General</option>
              </select>
              <!-- Live-identical autocomplete popup container -->
              <ul class="ui-autocomplete ui-front ui-menu ui-widget ui-widget-content ui-corner-all serviceGirdDetails pres_custom_class" id="specAutocompleteMenu" style="display: none; background: #1e293b; border: 1px solid #475569; position: absolute; z-index: 9999;">
                <table class="table table-striped table-hover" width="100%" id="specialityID" style="font-size: 11px; color: #fff;">
                  <thead>
                    <tr style="background: #d17519;">
                      <th style="display: none;">Speciality Code</th>
                      <th>Speciality Name</th>
                    </tr>
                  </thead>
                  <tbody id="loaditems">
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('Pediatrics', 'PEDIA')"><td style="display: none;">PEDIA</td><td>Pediatrics</td></tr>
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('Cardiology', 'CARDIO')"><td style="display: none;">CARDIO</td><td>Cardiology</td></tr>
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('Neurology', 'NEURO')"><td style="display: none;">NEURO</td><td>Neurology</td></tr>
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('Orthopaedic', 'ORHTO')"><td style="display: none;">ORHTO</td><td>Orthopaedic</td></tr>
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('Orthopedics', 'ORTHO')"><td style="display: none;">ORTHO</td><td>Orthopedics</td></tr>
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('Dermatology', 'DERM')"><td style="display: none;">DERM</td><td>Dermatology</td></tr>
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('Internal Medicine', 'INTMED')"><td style="display: none;">INTMED</td><td>Internal Medicine</td></tr>
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('Radiology', 'RAD')"><td style="display: none;">RAD</td><td>Radiology</td></tr>
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('General', 'GEN')"><td style="display: none;">GEN</td><td>General</td></tr>
                    <tr class="ui-menu-item" role="presentation" onclick="specialityID('Obstetrics and Gynaecology', 'OBSGYN')"><td style="display: none;">OBSGYN</td><td>Obstetrics and Gynaecology</td></tr>
                  </tbody>
                </table>
              </ul>
            </div>
            <div class="field">
              <label for="txtDepartmentName">Departments *</label>
              <input type="text" id="txtDepartmentName" name="txtDepartmentName" class="form-control ui-autocomplete-input" autocomplete="off" placeholder="Click for departments..." />
              <input type="hidden" id="txtDepartmentId" name="txtDepartmentId" />
              <input type="hidden" id="txtDepartmentHiddenName" name="txtDepartmentHiddenName" />
              <input type="hidden" id="txtDepartment" name="departments" value="ALL" />
              <!-- Live-identical department popup container -->
              <ul class="ui-autocomplete ui-front ui-menu ui-widget ui-widget-content ui-corner-all serviceGirdDetails pres_custom_class" id="deptAutocompleteMenu" style="display: none; background: #1e293b; border: 1px solid #475569; position: absolute; z-index: 9999;">
                <table class="table table-striped table-hover" width="100%" id="departmentID" style="font-size: 11px; color: #fff;">
                  <thead>
                    <tr style="background: #d17519;">
                      <th style="display: none;">Department Code</th>
                      <th>Department Name</th>
                      <th>Select All<input type="checkbox" name="checkallcheckbox" id="checkallcheckbox" class="checkallcheckbox" onclick="checkallcheckboxs()" style="margin-left: 5px;"></th>
                    </tr>
                  </thead>
                  <tbody id="loaditem">
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">1</td><td>Pediatrics</td><td><input type="checkbox" name="txtSplSubDept" value="1,Pediatrics" class="txtdepartmentbrachsno" /></td></tr>
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">2</td><td>Cardiology</td><td><input type="checkbox" name="txtSplSubDept" value="2,Cardiology" class="txtdepartmentbrachsno" /></td></tr>
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">20</td><td>Cardiology Dept</td><td><input type="checkbox" name="txtSplSubDept" value="20,Cardiology Dept" class="txtdepartmentbrachsno" /></td></tr>
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">3</td><td>General Medicine</td><td><input type="checkbox" name="txtSplSubDept" value="3,General Medicine" class="txtdepartmentbrachsno" /></td></tr>
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">4</td><td>Neurology Dept</td><td><input type="checkbox" name="txtSplSubDept" value="4,Neurology Dept" class="txtdepartmentbrachsno" /></td></tr>
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">5</td><td>Neurology</td><td><input type="checkbox" name="txtSplSubDept" value="5,Neurology" class="txtdepartmentbrachsno" /></td></tr>
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">6</td><td>Administration</td><td><input type="checkbox" name="txtSplSubDept" value="6,Administration" class="txtdepartmentbrachsno" /></td></tr>
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">7</td><td>Radiology</td><td><input type="checkbox" name="txtSplSubDept" value="7,Radiology" class="txtdepartmentbrachsno" /></td></tr>
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">8</td><td>Dental</td><td><input type="checkbox" name="txtSplSubDept" value="8,Dental" class="txtdepartmentbrachsno" /></td></tr>
                    <tr class="ui-menu-item" role="presentation"><td style="display: none;">9</td><td>Dermatology</td><td><input type="checkbox" name="txtSplSubDept" value="9,Dermatology" class="txtdepartmentbrachsno" /></td></tr>
                  </tbody>
                </table>
              </ul>
            </div>
            <div class="field">
              <label for="Color_Identification_Code">Color Identification Code</label>
              <input type="text" id="Color_Identification_Code" name="Color_Identification_Code" value="FFFFFF" />
              <input type="hidden" id="txtColorCode" name="colorIdentificationCode" value="FFFFFF" />
            </div>
            <div class="field">
              <label for="serviceRes">Services *</label>
              <label><input type="checkbox" id="serviceRes" name="serviceRes" checked value="on" /> Select All Services</label>
              <input type="hidden" id="txtServices" name="services" value="ALL" />
            </div>
            <div class="field">
              <label for="txtResOperHoursFrom">Operating From *</label>
              <input type="text" id="txtResOperHoursFrom" name="txtResOperHoursFrom" value="00:00" />
              <input type="hidden" id="txtOperatingFrom" name="operatingFrom" value="00:00" />
            </div>
            <div class="field">
              <label for="txtResOperHoursTo">Operating To *</label>
              <input type="text" id="txtResOperHoursTo" name="txtResOperHoursTo" value="23:55" />
              <input type="hidden" id="txtOperatingTo" name="operatingTo" value="23:55" />
            </div>
            ${req.query.missingControl === 'true' ? `
              <!-- Intentionally omitted submit controls to test missing control gate -->
            ` : req.query.ambiguousControl === 'true' ? `
              <input type="button" class="btn btn-info" value="ADD" id="submitForm" onclick="window.onControlClicked && window.onControlClicked('visible'); this.form.submit();">
              <button type="submit" class="btn btn-primary" id="btnSave" onclick="window.onControlClicked && window.onControlClicked('visible');">Save</button>
            ` : `
              <input type="button" class="btn btn-info" value="ADD" id="submitForm" onclick="window.onControlClicked && window.onControlClicked('visible'); this.form.submit();">
            `}
          </form>
          <script>
            // Synchronize mirror inputs
            document.getElementById('txtResourceName')?.addEventListener('input', function() {
              const el = document.getElementById('txtResource');
              if (el) el.value = this.value;
            });
            document.getElementById('txtSpecialityName')?.addEventListener('focus', function() {
              document.getElementById('specAutocompleteMenu').style.display = 'block';
            });
            document.getElementById('txtSpecialityName')?.addEventListener('input', function() {
              document.getElementById('specAutocompleteMenu').style.display = 'block';
              const filter = this.value.toLowerCase();
              const rows = document.querySelectorAll('#loaditems tr');
              rows.forEach(r => {
                const text = r.cells[1]?.textContent?.toLowerCase() || '';
                r.style.display = text.includes(filter) ? '' : 'none';
              });
            });
            document.getElementById('txtDepartmentName')?.addEventListener('focus', function() {
              document.getElementById('deptAutocompleteMenu').style.display = 'block';
            });
            function specialityID(name, id) {
              document.getElementById('txtSpecialityName').value = name;
              document.getElementById('txtSpecialityHiddenName').value = name;
              document.getElementById('txtSpecialityId').value = id;
              document.getElementById('specAutocompleteMenu').style.display = 'none';
            }
            function checkallcheckboxs() {
              const chk = document.getElementById('checkallcheckbox').checked;
              const boxes = document.querySelectorAll('.txtdepartmentbrachsno');
              let names = [];
              let ids = [];
              boxes.forEach(b => {
                b.checked = chk;
                if (chk) {
                  const parts = b.value.split(',');
                  ids.push(parts[0]);
                  names.push(parts[1]);
                }
              });
              document.getElementById('txtDepartmentName').value = names.join(',');
              document.getElementById('txtDepartmentHiddenName').value = names.join(',');
              document.getElementById('txtDepartmentId').value = ids.join(',');
            }
            document.querySelectorAll('.txtdepartmentbrachsno').forEach(b => {
              b.addEventListener('change', function() {
                let names = [];
                let ids = [];
                document.querySelectorAll('.txtdepartmentbrachsno:checked').forEach(cb => {
                  const parts = cb.value.split(',');
                  ids.push(parts[0]);
                  names.push(parts[1]);
                });
                document.getElementById('txtDepartmentName').value = names.join(',');
                document.getElementById('txtDepartmentHiddenName').value = names.join(',');
                document.getElementById('txtDepartmentId').value = ids.join(',');
              });
            });
          </script>
        </div>
      </body>
      </html>
    `);
  };

  const handleAddResourceParentDetailsPost = (req: Request, res: Response) => {
    const resourceName = req.body.resourceName || req.body.txtResource;
    const isResourceHuman = req.body.isResourceHuman || req.body.txtResourceHuman;
    const resourceType = req.body.resourceType || req.body.txtResourceTypeName;
    const specialty = req.body.specialty || req.body.txtSpecialityName || req.body.txtSpecialityHiddenName;
    const departments = req.body.departments || req.body.txtDepartmentName || req.body.txtDepartmentHiddenName;
    const services = req.body.services || req.body.serviceRes;
    const exists = clientResources.find((r) => r.resourceName.toLowerCase() === (resourceName || '').toLowerCase());
    if (exists) {
      return res.redirect(`${req.path}?error=` + encodeURIComponent(`Duplicate resource '${resourceName}' already exists`));
    }
    const newId = `RES-${100 + clientResources.length + 1}`;
    clientResources.push({
      resourceCode: newId,
      resourceName,
      department: departments || 'ALL',
      specialization: specialty || 'General',
      resourceType: resourceType || 'Consultant Physician',
      status: 'ACTIVE',
    });
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>ADD-RESOURCE DETAILS</title></head>
      <body>
        <div class="alert-success" id="successMsg">Congrats!! Resource added successfully with ID: ${newId}</div>
        <div id="remoteResourceId">${newId}</div>
        <script>setTimeout(() => { window.location.href = '${req.path}?msg=' + encodeURIComponent('Resource added successfully with ID: ${newId}'); }, 100);</script>
      </body>
      </html>
    `);
  };

  const handleAddParentResourceUserGet = (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>ADD-RESOURCE USER DETAILS</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; display: flex; flex-direction: column; align-items: center; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; border: 1px solid #334155; width: 100%; max-width: 650px; margin-bottom: 2rem; }
          .field { margin-bottom: 1rem; }
          label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
          input, select { width: 100%; box-sizing: border-box; padding: 0.75rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.375rem; color: #fff; font-size: 1rem; }
          button { width: 100%; padding: 0.75rem; background: #0284c7; color: #fff; border: none; border-radius: 0.375rem; font-weight: 600; cursor: pointer; font-size: 1rem; }
          table { width: 100%; max-width: 650px; border-collapse: collapse; margin-top: 1rem; background: #1e293b; }
          th, td { padding: 0.75rem; border: 1px solid #334155; text-align: left; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 class="screen-title">ADD-RESOURCE USER DETAILS</h2>
          <form method="POST" action="${req.path}" id="addParentResourceUser" class="form-horizontal fv-form fv-form-bootstrap">
            <!-- FormValidation hidden submit button -->
            <button type="submit" class="fv-hidden-submit" style="display: none; width: 0px; height: 0px;"></button>
            <div class="field">
              <label for="ddlUser">User Name *</label>
              <select id="ddlUser" name="username">
                ${clientUsers.map((u) => `<option value="${u.username}">${u.username} (${u.fullName})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="ddlResource">Resource *</label>
              <select id="ddlResource" name="resourceCode">
                ${clientResources.map((r) => `<option value="${r.resourceCode}">${r.resourceCode} - ${r.resourceName}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>
                <input type="checkbox" id="chkShownInReg" name="isShownInRegistration" value="Yes" checked style="width: auto;" />
                Is Shown in Registration *
              </label>
            </div>
            <button type="submit" id="btnSSDB" class="btn btn-info">ADD</button>
          </form>
        </div>
        <table id="tblResourceUserMappings">
          <thead>
            <tr>
              <th>Resource ID</th>
              <th>User Name</th>
              <th>Shown in Registration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${clientResources.filter((r) => r.linkedUsername).map((r) => `
              <tr data-resource-id="${r.resourceCode}" data-username="${r.linkedUsername}">
                <td>${r.resourceCode}</td>
                <td>${r.linkedUsername}</td>
                <td>Yes</td>
                <td>ACTIVE</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `);
  };

  const handleAddParentResourceUserPost = (req: Request, res: Response) => {
    fixtureClickCounters.addResourceUserSubmitCount++;
    const { resourceCode, username } = req.body;
    let target = clientResources.find((r) => r.resourceCode === resourceCode || r.resourceName === resourceCode);
    if (target) {
      target.linkedUsername = username;
    } else if (resourceCode && username) {
      clientResources.push({
        resourceCode,
        resourceName: resourceCode,
        linkedUsername: username,
        specialization: 'General',
        department: 'ALL',
        status: 'ACTIVE',
      });
    }
    res.redirect(req.path);
  };

  const handleParentResourceUserGet = (req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>RESOURCE USER</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
          table { width: 100%; border-collapse: collapse; margin-top: 1rem; background: #1e293b; }
          th, td { padding: 0.75rem; border: 1px solid #334155; text-align: left; }
        </style>
      </head>
      <body>
        <h2>RESOURCE USER DETAILS</h2>
        <div id="tablaDatos_filter">
          <input type="search" placeholder="SEARCH" />
        </div>
        <table id="tablaDatos">
          <thead>
            <tr>
              <th>S.NO</th>
              <th>USER NAME</th>
              <th>RESOURCE NAME</th>
              <th>STATUS</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            ${clientResources.filter((r) => r.linkedUsername).map((r, idx) => `
              <tr data-resource-id="${r.resourceCode}" data-username="${r.linkedUsername}">
                <td>${idx + 1}</td>
                <td>${r.linkedUsername}</td>
                <td>${r.resourceName || r.resourceCode}</td>
                <td>ACTIVE</td>
                <td></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `);
  };

  // Mock EMR Form Master (30 forms across multiple pages)
  const mockEmrForms = Array.from({ length: 30 }, (_, idx) => {
    const num = idx + 1;
    const formCode = `EMR-${String(num).padStart(3, '0')}`;
    const names = [
      'Initial Consultation Note',
      'Cardiology Evaluation Form',
      'Follow-up Progress Note',
      'Emergency Triage Record',
      'Discharge Summary',
      'Inpatient Admission Assessment',
      'Pediatric Well-Child Examination',
      'Neurological Examination Form',
      'Pre-Operative Assessment',
      'Post-Anesthesia Care Note',
      'Radiology Request & Findings',
      'Pathology Biopsy Record',
      'General Physical Exam',
      'Ophthalmology Vision Assessment',
      'Orthopedic Joint Examination',
      'OP - CLINICIANS',
    ];
    const formName = names[idx % names.length] + (num > names.length ? ` (Version ${Math.floor(num / names.length) + 1})` : '');
    const group = idx % 2 === 0 ? 'Clinical Documentation' : 'Specialist Assessment';
    const encType = idx % 3 === 0 ? 'Inpatient' : idx % 3 === 1 ? 'Outpatient' : 'Emergency';
    return {
      formId: formCode,
      formName,
      group,
      encounterType: encType,
      isDefault: num === 1,
      isAssigned: false,
      status: 'ACTIVE',
    };
  });

  const formAssignments: Record<string, string[]> = {};
  const formTransfers: Array<{ branch: string; username: string; forms: string[]; defaultForm: string }> = [];
  const eclaimUsers: Array<{ username: string; resourceCode: string; providerId: string; facilityId: string; licenseNo: string }> = [];

  const handleEmrPanelSelectionGet = (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = 10;
    const search = ((req.query.search as string) || '').toLowerCase();
    const filtered = mockEmrForms.filter((f) => !search || f.formName.toLowerCase().includes(search) || f.formId.toLowerCase().includes(search));
    const totalPages = Math.ceil(filtered.length / limit);
    const startIndex = (page - 1) * limit;
    const pageItems = filtered.slice(startIndex, startIndex + limit);

    const assignedUser = (req.query.assignedUser as string) || '';

    const rowsHtml = pageItems.map((f) => `
      <tr data-form-id="${f.formId}" class="form-row">
        <td><input type="checkbox" name="selectedForms" value="${f.formId}" class="chk-select-form" ${f.isAssigned ? 'checked' : ''} /></td>
        <td class="form-code">${f.formId}</td>
        <td class="form-name">${f.formName}</td>
        <td class="form-group">${f.group}</td>
        <td class="form-encounter">${f.encounterType}</td>
        <td><input type="radio" name="defaultForm" value="${f.formId}" class="rad-default-form" ${f.isDefault ? 'checked' : ''} /></td>
        <td><span class="badge badge-active">${f.status}</span></td>
      </tr>
    `).join('');

    const paginationHtml = Array.from({ length: totalPages }, (_, i) => i + 1)
      .map((p) => `<a href="?page=${p}&search=${encodeURIComponent(search)}" class="page-link ${p === page ? 'active' : ''}">${p}</a>`)
      .join(' ');

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>EMR PANEL SELECTION</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; border: 1px solid #334155; margin-bottom: 2rem; }
          table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
          th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #334155; }
          th { background: #0f172a; color: #38bdf8; }
          .badge-active { background: rgba(34, 197, 94, 0.2); color: #4ade80; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; }
          .pagination { margin-top: 1rem; display: flex; gap: 0.5rem; }
          .page-link { color: #38bdf8; padding: 0.25rem 0.5rem; text-decoration: none; border: 1px solid #334155; border-radius: 0.25rem; }
          .page-link.active { background: #0284c7; color: #fff; }
          input, select { padding: 0.5rem; background: #0f172a; border: 1px solid #334155; color: #fff; border-radius: 0.25rem; }
          button { background: #0284c7; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.25rem; cursor: pointer; font-weight: 600; }
          .field { margin-bottom: 1rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 class="screen-title">EMR Form Master & Panel Selection</h2>
          <div style="margin-bottom: 1rem; display: flex; gap: 1rem; align-items: center;">
            <input type="text" id="txtSearchForm" name="search" placeholder="Search forms..." value="${search}" />
            ${req.query.useAutocomplete === 'true'
              ? '<input type="text" id="txtUserName" name="username" class="form-control text-uppercase ui-autocomplete-input" autocomplete="off" />'
              : `<select id="ddlUserSelect" name="username" form="emrPanelForm">
                  ${clientUsers.map((u) => `<option value="${u.username}" ${u.username === assignedUser ? 'selected' : ''}>${u.username} (${u.fullName})</option>`).join('')}
                </select>`}
          </div>
          <form method="POST" action="${req.path}/assign" id="emrPanelForm">
            <table id="tblEmrForms" class="table-emr-forms">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Form Code</th>
                  <th>Form Name</th>
                  <th>Group</th>
                  <th>Encounter Type</th>
                  <th>Is Default</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            <div class="pagination" id="paginationControls">
              ${paginationHtml}
            </div>
            <div style="margin-top: 1.5rem; display: flex; gap: 1rem;">
              <button type="submit" id="btnAssignForms" data-testid="btn-assign-forms">Save & Assign Forms</button>
            </div>
          </form>
        </div>

        <div class="card" id="sectionTransferGroupForm">
          <h2>Transfer Group Form to Other Branch User</h2>
          <form method="POST" action="${req.path}/transfer" id="formTransferGroup">
            <div class="field">
              <label for="ddlTransferBranch">Target Branch *</label>
              <select id="ddlTransferBranch" name="targetBranchId">
                <option value="BR-001">Main Hospital Campus</option>
                <option value="BR-002">City Center Medical Clinic</option>
                <option value="BR-003">West Branch</option>
              </select>
            </div>
            <div class="field">
              <label for="ddlTransferUser">Exact User *</label>
              <select id="ddlTransferUser" name="username">
                ${clientUsers.map((u) => `<option value="${u.username}">${u.username} (${u.fullName})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="ddlTransferDefaultForm">Default Form Indicator *</label>
              <select id="ddlTransferDefaultForm" name="defaultFormIndicator">
                <option value="S" selected>S</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
            <button type="submit" id="btnTransferGroupForm" data-testid="btn-transfer-group-form">Transfer Group Forms</button>
          </form>
          ${req.query.transferSuccess ? '<div class="alert-success" id="transferSuccessMsg" style="margin-top:1rem; background:#064e3b; color:#6ee7b7; padding:0.75rem; border-radius:0.375rem;">Forms transferred successfully!</div>' : ''}
          ${req.query.assignSuccess ? '<div class="alert-success" id="assignSuccessMsg" style="margin-top:1rem; background:#064e3b; color:#6ee7b7; padding:0.75rem; border-radius:0.375rem;">Forms assigned successfully!</div>' : ''}
        </div>

        <!-- Real Simplex-compatible EMR Table and Transfer Modal -->
        <div class="card" id="sectionSimplexEmr">
          <table id="tablaDatos" class="table table-striped table-bordered">
            <thead>
              <tr>
                <th>Select</th>
                <th>Form Name</th>
                <th>Assign</th>
                <th>Is Default</th>
                <th>Encounter Type</th>
                <th>Action</th>
                <th>Group</th>
                <th>Search</th>
              </tr>
            </thead>
            <tbody>
              ${mockEmrForms.map((f, idx) => `
                <tr>
                  <td><input type="checkbox" name="emrGFEA_${idx + 1}" class="GFEACheck" id="GFEACheck_${idx + 1}" value="${f.formId}" data-form-id="${f.formId}" /></td>
                  <td>${f.formName}</td>
                  <td><span class="fa fa-check"></span></td>
                  <td>${f.isDefault ? 'Yes' : 'No'}</td>
                  <td>${f.encounterType || 'ALL'}</td>
                  <td><a href="#"><span class="fa fa-edit"></span></a></td>
                  <td>${f.group || 'Clinical'}</td>
                  <td><span class="fa fa-search"></span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <span id="gfeaTransfer" title="Transfer Form" style="cursor:pointer; padding: 6px 12px; background:#0284c7; border-radius:4px;"><i class="fa fa-share-alt"></i> Transfer Form</span>
        </div>

        <div id="gfeaTransferModal" style="display:none; position:fixed; top:20%; left:30%; background:#1e293b; padding:2rem; border:1px solid #475569; border-radius:8px; z-index:9999;">
          <div id="transferBody">
            <form id="postAssignFormUsers">
              <div><input type="text" id="txtBranchField_0" name="res[0][txtBranchName]" /></div>
              <div><input type="hidden" id="branchCode_0" name="res[0][branchCode]" /></div>
              <div><input type="radio" id="same" name="defAssign" value="same" checked /></div>
              <div><input type="text" id="txtUserNameMulti" name="res[0][txtUserNameMulti]" /></div>
              <div><input type="hidden" id="userId_0" name="res[0][userMultiId]" /></div>
              <div><select name="res[0][selectedForm]"><option value="OP - CLINICIANS">OP - CLINICIANS</option></select></div>
              <div><input type="radio" id="def_yes" name="res[0][default]" value="yes" /> Yes</div>
              <div><input type="radio" id="def_no" name="res[0][default]" value="no" checked /> No</div>
              <div style="margin-top:10px;"><button type="button" id="transfer_GFA">Add</button></div>
            </form>
          </div>
        </div>

        <script>
          // Minimal window.$ fixture
          window.$ = function(selector) {
            var elements = typeof selector === 'string' ? Array.from(document.querySelectorAll(selector)) : (Array.isArray(selector) ? selector : (selector ? [selector] : []));
            return {
              length: elements.length,
              each: function(cb) { elements.forEach(function(el, i) { cb.call(el, i, el); }); return this; },
              val: function(v) {
                if (v !== undefined) { elements.forEach(function(el) { el.value = v; }); return this; }
                return elements[0] ? elements[0].value : '';
              },
              click: function(fn) {
                if (fn) { elements.forEach(function(el) { el.addEventListener('click', fn); }); }
                else if (elements[0]) { elements[0].click(); }
                return this;
              },
              modal: function(action) {
                if (action === 'hide') { elements.forEach(function(el) { el.style.display = 'none'; }); }
                else { elements.forEach(function(el) { el.style.display = 'block'; }); }
                return this;
              },
              serialize: function() {
                var formEl = elements[0];
                if (!formEl) return '';
                var formData = new FormData(formEl);
                var params = new URLSearchParams();
                for (var pair of formData.entries()) {
                  params.append(pair[0], pair[1]);
                }
                return params.toString();
              }
            };
          };
          window.$.ajax = function(opts) {
            var method = (opts.type || 'GET').toUpperCase();
            var url = opts.url;
            var fetchOpts = { method: method };
            if (method === 'GET') {
              if (opts.data) {
                var params = new URLSearchParams();
                for (var k in opts.data) params.append(k, opts.data[k]);
                url += (url.indexOf('?') === -1 ? '?' : '&') + params.toString();
              }
            } else if (method === 'POST') {
              if (opts.data) {
                var bodyParams;
                if (typeof opts.data === 'string') {
                  bodyParams = opts.data;
                } else {
                  bodyParams = new URLSearchParams();
                  for (var k in opts.data) bodyParams.append(k, opts.data[k]);
                }
                fetchOpts.body = bodyParams;
              }
            }
            fetch(url, fetchOpts)
              .then(function(r) {
                var ct = r.headers.get('content-type') || '';
                if (ct.includes('application/json')) return r.json();
                return r.text();
              })
              .then(function(d) { if (opts.success) opts.success(d); })
              .catch(function(err) { if (opts.error) opts.error(err); });
          };

          document.getElementById('gfeaTransfer')?.addEventListener('click', function() {
            document.getElementById('gfeaTransferModal').style.display = 'block';
          });
          document.getElementById('transfer_GFA')?.addEventListener('click', function() {
            document.getElementById('gfeaTransferModal').style.display = 'none';
          });
        </script>
      </body>
      </html>
    `);
  };

  const handleEmrPanelSelectionPost = (req: Request, res: Response) => {
    const { username, selectedForms, defaultForm } = req.body;
    const forms = Array.isArray(selectedForms) ? selectedForms : selectedForms ? [selectedForms] : [];
    formAssignments[username || 'default'] = forms;
    mockEmrForms.forEach((f) => {
      if (forms.includes(f.formId)) f.isAssigned = true;
      if (f.formId === defaultForm) f.isDefault = true;
    });
    res.redirect(`${req.baseUrl || ''}/emrPanelSelection?assignSuccess=true&assignedUser=${encodeURIComponent(username || '')}`);
  };

  const handleEmrTransferPost = (req: Request, res: Response) => {
    const { targetBranchId, username, defaultFormIndicator, selectedForms } = req.body;
    const forms = Array.isArray(selectedForms) ? selectedForms : selectedForms ? [selectedForms] : ['EMR-001', 'EMR-002'];
    formTransfers.push({
      branch: targetBranchId || 'BR-001',
      username: username || 'user',
      forms,
      defaultForm: defaultFormIndicator || 'S',
    });
    res.redirect(`${req.baseUrl || ''}/emrPanelSelection?transferSuccess=true`);
  };

  let eclaimSubmitCount = 0;
  app.get('/api/test/eclaim-submits', (req: Request, res: Response) => {
    res.json({ count: eclaimSubmitCount });
  });
  app.post('/api/test/eclaim-submits/reset', (req: Request, res: Response) => {
    eclaimSubmitCount = 0;
    res.json({ count: eclaimSubmitCount });
  });

  const handleAddEclaimUserGet = (req: Request, res: Response) => {
    let tableUsers = clientUsers;
    if (req.query.userScenario === 'similar') {
      tableUsers = [
        { username: 'resourestewo2', fullName: 'Dr. Resourestewo Two' },
        { username: 'resourestewo_other', fullName: 'Dr. Resourestewo Other' },
      ] as any;
    } else if (req.query.userScenario === 'duplicate') {
      tableUsers = [
        { username: 'resourestewo', fullName: 'Dr. Resourestewo Primary' },
        { username: 'resourestewo', fullName: 'Dr. Resourestewo Secondary' },
      ] as any;
    } else if (req.query.userScenario === 'exact_with_similar') {
      tableUsers = [
        { username: 'resourestewo2', fullName: 'Dr. Resourestewo Two' },
        { username: 'resourestewo', fullName: 'Dr. Resourestewo Exact' },
        { username: 'resourestewo_admin', fullName: 'Dr. Resourestewo Admin' },
      ] as any;
    } else if (req.query.userScenario === 'none') {
      tableUsers = [
        { username: 'completely_different_user', fullName: 'Dr. Different User' },
      ] as any;
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>ADD-USER ECLAIM DETAILS</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
          .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; border: 1px solid #334155; max-width: 600px; margin: 0 auto; }
          .field { margin-bottom: 1rem; }
          label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
          input, select { width: 100%; box-sizing: border-box; padding: 0.75rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.375rem; color: #fff; }
          button { width: 100%; padding: 0.75rem; background: #0284c7; color: #fff; border: none; border-radius: 0.375rem; font-weight: 600; cursor: pointer; }
          .alert-success { background: #064e3b; color: #6ee7b7; padding: 0.75rem; border-radius: 0.375rem; margin-bottom: 1rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2 class="screen-title">eClaim User Configuration</h2>
          ${req.query.success ? `<div class="alert-success" id="successMsg">eClaim configuration saved successfully${req.query.savedUser ? ` for user ${req.query.savedUser}` : ''}.</div>` : ''}
          ${req.query.missingForm === 'true' ? `
            <!-- Intentionally missing form container to test preflight rejection -->
            <div id="noFormContainer">No form rendered</div>
          ` : `
            <form method="POST" action="${req.path}" id="addUserEclaim" class="form-horizontal fv-form fv-form-bootstrap">
              <!-- FormValidation hidden submit button -->
              <button type="submit" class="fv-hidden-submit" style="display: none; width: 0px; height: 0px;"></button>
              
              ${req.query.missingFields === 'true' ? `
                <!-- Missing required eClaim selectors -->
                <div class="field">
                  <input type="text" id="unrelatedInput" name="unrelated" value="test" />
                </div>
              ` : `
                <div class="field">
                  <label for="txtUserEclaimLink">eClaim Link *</label>
                  <input type="text" id="txtUserEclaimLink" name="txtUserEclaimLink" value="link123" />
                </div>
                <div class="field">
                  <label for="txtUserEclaimName">eClaim Name *</label>
                  <input type="text" id="txtUserEclaimName" name="txtUserEclaimName" value="name123" />
                </div>
                <div class="field">
                  <label for="txtUserEclaimPassword">eClaim Password *</label>
                  <input type="password" id="txtUserEclaimPassword" name="txtUserEclaimPassword" value="pwd123" />
                </div>
                <div class="field">
                  <label for="txtUserEclaimlicensNo">License Number *</label>
                  <input type="text" id="txtUserEclaimlicensNo" name="txtUserEclaimlicensNo" value="LIC-77889" />
                </div>
                <div class="field">
                  <label for="txtEclaimUserInsComSNo">Insurance Company</label>
                  <select id="txtEclaimUserInsComSNo" name="txtEclaimUserInsComSNo">
                    <option value="Tawuniya">Tawuniya</option>
                    <option value="Bupa">Bupa</option>
                  </select>
                </div>
                <div class="field">
                  <label for="txtActualLicenseNo">Actual License No</label>
                  <input type="text" id="txtActualLicenseNo" name="txtActualLicenseNo" value="ACT-999" />
                </div>
                <table class="table table-striped table table-hover table-responsive" id="tblEclaimUsers">
                  <thead><tr><th>User</th><th>Select*</th></tr></thead>
                  <tbody>
                    ${tableUsers.map((u) => `
                      <tr>
                        <td>${u.fullName}</td>
                        <td><input type="radio" name="txtEclaimUser" value="${u.username}" /></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}

              ${req.query.missingSubmit === 'true' ? `
                <!-- Missing visible submit control -->
              ` : `
                <button type="button" id="showhide" data-val="1">Show</button>
                <button type="button" id="showhide1" data-val="1">Show</button>
                <button type="submit" id="sub_but" class="btn">ADD</button>
              `}
            </form>
          `}
        </div>
      </body>
      </html>
    `);
  };

  const handleAddEclaimUserPost = (req: Request, res: Response) => {
    eclaimSubmitCount++;
    const username = req.body.txtEclaimUser || req.body.username || req.body.txtUserEclaimName;
    const resourceCode = req.body.resourceCode || 'RES-001';
    const providerId = req.body.providerId || 'PRV-10023';
    const facilityId = req.body.facilityId || 'FAC-001';
    const licenseNo = req.body.txtUserEclaimlicensNo || req.body.licenseNo || 'LIC-77889';
    eclaimUsers.push({ username, resourceCode, providerId, facilityId, licenseNo });
    res.redirect(`${req.path}?success=true&savedUser=${encodeURIComponent(username)}`);
  };

  // Register across various client paths
  ['/ResourceParent', '/MasterV9.3/ResourceParent', '/MasterV9.4/ResourceParent', '/resources', '/hmc/resources', '/MasterV9.4/resources', '/MasterV9.3/resources'].forEach((p) => {
    app.get(p, handleResourcesGet);
  });

  ['/addResourceParentDetails', '/hmc/addResourceParentDetails', '/MasterV9.4/addResourceParentDetails', '/MasterV9.3/addResourceParentDetails', '/addResource', '/hmc/addResource'].forEach((p) => {
    app.get(p, handleAddResourceParentDetailsGet);
    app.post(p, handleAddResourceParentDetailsPost);
  });

  ['/PostaddResourceParentDetails', '/MasterV9.3/PostaddResourceParentDetails', '/MasterV9.4/PostaddResourceParentDetails', '/hmc/PostaddResourceParentDetails'].forEach((p) => {
    app.post(p, (req: Request, res: Response) => {
      res.send('1');
    });
  });

  ['/addParentResourceUser', '/hmc/addParentResourceUser', '/MasterV9.4/addParentResourceUser', '/MasterV9.3/addParentResourceUser', '/resourceUserMapping', '/hmc/resourceUserMapping'].forEach((p) => {
    app.get(p, handleAddParentResourceUserGet);
    app.post(p, handleAddParentResourceUserPost);
  });

  ['/parentResourceUser', '/hmc/parentResourceUser', '/MasterV9.4/parentResourceUser', '/MasterV9.3/parentResourceUser'].forEach((p) => {
    app.get(p, handleParentResourceUserGet);
  });

  ['/emrPanelSelection', '/MasterV9.3/emrPanelSelection', '/MasterV9.4/emrPanelSelection', '/hmc/emrPanelSelection', '/MasterV9.5/emrPanelSelection'].forEach((p) => {
    app.get(p, handleEmrPanelSelectionGet);
    app.post(`${p}/assign`, handleEmrPanelSelectionPost);
    app.post(`${p}/transfer`, handleEmrTransferPost);
    app.post(p, handleEmrPanelSelectionPost);
  });

  const handleGetBranchCode = (req: Request, res: Response) => {
    res.json([
      { id: 'GAG', value: 'GAELAN MEDICAL CARE ONE DAY SURGERY HOSPITAL LLC' },
      { id: 'BR-001', value: 'MAIN HOSPITAL CAMPUS' },
    ]);
  };

  const handleGetUserforGFEATransferMulti = (req: Request, res: Response) => {
    const term = ((req.query.term as string) || '').toLowerCase();
    const filtered = clientUsers.filter((u) => !term || u.username.toLowerCase().includes(term) || u.fullName.toLowerCase().includes(term));
    res.json(
      filtered.map((u) => ({
        category: u.username,
        value: u.fullName,
        label: u.fullName,
      }))
    );
  };

  ['/getBranchCode', '/MasterV9.3/getBranchCode'].forEach((p) => {
    app.get(p, handleGetBranchCode);
  });

  ['/getUserforGFEATransferMulti', '/MasterV9.3/getUserforGFEATransferMulti'].forEach((p) => {
    app.get(p, handleGetUserforGFEATransferMulti);
  });

  const handleGetUserBasedEMRPanelInsert = (req: Request, res: Response) => {
    res.send('Form Assigned Successfully');
  };

  const handleSetEMRUserSSDB = (req: Request, res: Response) => {
    res.send(`<table><tr><td>EMR-001</td><td>Assigned</td></tr><tr><td>EMR-002</td><td>Assigned</td></tr></table>`);
  };

  [
    '/getUserBasedEMRPanelInsert',
    '/MasterV9.3/getUserBasedEMRPanelInsert',
    '/MasterV9.4/getUserBasedEMRPanelInsert',
    '/EDSC/getUserBasedEMRPanelInsert',
    '/hmc/getUserBasedEMRPanelInsert',
  ].forEach((p) => {
    app.post(p, handleGetUserBasedEMRPanelInsert);
    app.get(p, handleGetUserBasedEMRPanelInsert);
  });

  [
    '/setEMRUserSSDB',
    '/MasterV9.3/setEMRUserSSDB',
    '/MasterV9.4/setEMRUserSSDB',
    '/EDSC/setEMRUserSSDB',
    '/hmc/setEMRUserSSDB',
  ].forEach((p) => {
    app.get(p, handleSetEMRUserSSDB);
    app.post(p, handleSetEMRUserSSDB);
  });

  [
    '/addUserEclaim',
    '/MasterV9.3/addUserEclaim',
    '/MasterV9.4/addUserEclaim',
    '/hmc/addUserEclaim',
    '/addEclaimUser',
    '/MasterV9.3/addEclaimUser',
    '/MasterV9.4/addEclaimUser',
    '/hmc/addEclaimUser',
    '/eclaimUser',
    '/MasterV9.3/eclaimUser',
  ].forEach((p) => {
    app.get(p, handleAddEclaimUserGet);
    app.post(p, handleAddEclaimUserPost);
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
