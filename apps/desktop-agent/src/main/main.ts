import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { AgentClient } from '../agent-client.js';
import { AutomationWorker } from '../automation-worker.js';

let mainWindow: BrowserWindow | null = null;
let agentClient: AgentClient;
let worker: AutomationWorker;
let heartbeatTimer: NodeJS.Timeout | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'HMC Desktop Automation Agent',
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  createWindow();

  agentClient = new AgentClient();
  worker = new AutomationWorker(agentClient);

  // Setup Heartbeat loop
  heartbeatTimer = setInterval(async () => {
    const pendingTask = await agentClient.sendHeartbeat('ONLINE');
    if (pendingTask) {
      mainWindow?.webContents.send('agent-log', `Received pending task: ${pendingTask.taskType}`);
      await worker.executeTask(pendingTask, (msg) => {
        mainWindow?.webContents.send('agent-log', msg);
      });
    }
  }, 10000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers
ipcMain.handle('pair-agent', async (_, { userId, sharedSecret }) => {
  const success = await agentClient.pair(userId, sharedSecret);
  return { success, status: agentClient.getStatus() };
});

ipcMain.handle('get-status', () => {
  return agentClient ? agentClient.getStatus() : null;
});
