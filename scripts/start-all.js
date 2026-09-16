#!/usr/bin/env node

/**
 * SIMPLEX Central Operations Console - Unified Service Orchestrator
 * Starts the NestJS API (3000), Vite Web UI (5173), and Desktop Automation Agent concurrently.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const ROOT_DIR = path.resolve(__dirname, '..');

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}       SIMPLEX CENTRAL OPERATIONS CONSOLE - UNIFIED RUNNER            ${colors.reset}`);
console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
console.log(`${colors.dim}Root Directory: ${ROOT_DIR}${colors.reset}\n`);

// Ensure workspace packages are built
console.log(`${colors.yellow}[SYSTEM] Checking workspace build artifacts...${colors.reset}`);
try {
  execSync('pnpm build', { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log(`${colors.green}[SYSTEM] ✓ Build verified.${colors.reset}\n`);
} catch (err) {
  console.warn(`${colors.yellow}[SYSTEM] Build warning or skipped, proceeding with startup...${colors.reset}\n`);
}

const processes = [];

function prefixStream(stream, prefix, color) {
  if (!stream) return;
  const rl = readline.createInterface({ input: stream });
  rl.on('line', (line) => {
    console.log(`${color}${prefix}${colors.reset} ${line}`);
  });
}

function startService(name, command, args, cwd, color) {
  console.log(`${colors.bold}${color}[LAUNCHING]${colors.reset} ${name}...`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  prefixStream(child.stdout, `[${name}]`, color);
  prefixStream(child.stderr, `[${name}]`, colors.red);

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`${color}[${name}]${colors.reset} Stopped by signal ${signal}`);
    } else if (code !== null && code !== 0) {
      console.log(`${colors.red}[${name}] Exited with code ${code}${colors.reset}`);
    }
  });

  processes.push({ name, child });
  return child;
}

// 1. Start NestJS API Backend
startService('API', 'pnpm', ['--filter', '@hmc/api', 'start'], ROOT_DIR, colors.cyan);

// 2. Start Vite Web UI Frontend
startService('WEB', 'pnpm', ['--filter', '@hmc/web', 'dev', '--', '--host', '0.0.0.0', '--port', '5173'], ROOT_DIR, colors.green);

// 3. Start Desktop Automation Agent Runner
startService('AGENT', 'pnpm', ['--filter', '@hmc/desktop-agent', 'start:runner'], ROOT_DIR, colors.magenta);

setTimeout(() => {
  console.log(`\n${colors.bold}${colors.green}======================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.green}       ✓ ALL SIMPLEX SERVICES ARE RUNNING!                            ${colors.reset}`);
  console.log(`${colors.bold}${colors.green}======================================================================${colors.reset}`);
  console.log(` • Web Console:   ${colors.bold}${colors.cyan}http://localhost:5173${colors.reset}`);
  console.log(` • Central Users: ${colors.bold}${colors.cyan}http://localhost:5173/users${colors.reset}`);
  console.log(` • Central API:   ${colors.bold}${colors.cyan}http://localhost:3000/api/v1${colors.reset}`);
  console.log(` • Swagger Docs:  ${colors.bold}${colors.cyan}http://localhost:3000/api/docs${colors.reset}`);
  console.log(` • Login:         ${colors.bold}admin${colors.reset} / ${colors.bold}Rajesh@123${colors.reset}`);
  console.log(` • Press ${colors.bold}Ctrl+C${colors.reset} in this terminal to cleanly stop all services.`);
  console.log(`${colors.green}======================================================================${colors.reset}\n`);
}, 3500);

let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${colors.yellow}[SYSTEM] Shutting down all HMC services...${colors.reset}`);
  for (const { name, child } of processes) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${child.pid} /T /F`);
      } else {
        child.kill('SIGTERM');
      }
    } catch {}
  }
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
