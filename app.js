const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const pty = require('node-pty');

const app = express();
const PORT = Number(process.env.PORT || 7680);
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 15000);
const MAX_OUTPUT_CHARS = Number(process.env.MAX_OUTPUT_CHARS || 12000);
const ALLOW_CUSTOM = process.env.ALLOW_CUSTOM === 'true';

const TERMINAL_SESSION_TTL_MS = Number(process.env.TERMINAL_SESSION_TTL_MS || 43200000);
const TERMINAL_CLEANUP_INTERVAL_MS = Number(process.env.TERMINAL_CLEANUP_INTERVAL_MS || 20000);
const TERMINAL_DEFAULT_COLS = Number(process.env.TERMINAL_DEFAULT_COLS || 120);
const TERMINAL_DEFAULT_ROWS = Number(process.env.TERMINAL_DEFAULT_ROWS || 36);
const TERMINAL_HEARTBEAT_INTERVAL_MS = Number(process.env.TERMINAL_HEARTBEAT_INTERVAL_MS || 15000);

const ALLOWED_SESSION_ID = /^[0-9a-fA-F-]{8,}$/;

const appServer = app;

appServer.use(express.json({ limit: '32kb' }));
appServer.use(express.static(path.join(__dirname, 'public')));

const PRESET_COMMANDS = [
  { id: 'codex-exists', title: 'Check Codex CLI', command: 'where.exe codex', category: 'AI CLI' },
  { id: 'claude-exists', title: 'Check Claude CLI', command: 'where.exe claude', category: 'AI CLI' },
  { id: 'node-ver', title: 'Node Version', command: 'node -v', category: 'AI CLI' },
  { id: 'cwd', title: 'Current Path', command: 'Get-Location', category: 'Project' },
  { id: 'files', title: 'Top Files', command: 'Get-ChildItem -Force | Select-Object -First 20', category: 'Project' },
  { id: 'git-status', title: 'Git Status', command: 'git status --short', category: 'Git' },
  { id: 'git-branch', title: 'Git Branch', command: 'git branch --show-current', category: 'Git' },
  { id: 'git-log', title: 'Git Last 8', command: 'git log --oneline -n 8', category: 'Git' },
  { id: 'find-todo', title: 'Find TODO', command: "Get-ChildItem -Recurse -File | Select-String -Pattern 'TODO' | Select-Object -First 30", category: 'Project' },
  { id: 'public-ip', title: 'Public IP', command: "(Invoke-RestMethod -Uri 'https://api.ipify.org?format=text')", category: 'Network' },
  { id: 'terminal-sessions', title: 'Active terminal sessions', command: 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \"node.exe\" -and $_.CommandLine -like \"*terminal-socket*\" }', category: 'Network' }
];

const isWindows = process.platform === 'win32';
const SHELL = isWindows ? 'powershell.exe' : (process.env.SHELL || 'bash');
const SHELL_ARGS = isWindows
  ? [
      '-NoProfile',
      '-NoLogo',
      '-NoExit',
      '-Command',
      'chcp 65001 > $null; $OutputEncoding = New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false);'
    ]
  : ['-i'];

const terminalSessions = new Map();

const touchSession = (session) => {
  const now = Date.now();
  session.lastActiveAt = now;
  session.lastHeartbeatAt = now;
};

const buildShellEnv = () => ({
  ...process.env,
  LANG: process.env.LANG || 'en_US.UTF-8',
  LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
  PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
  TERM: 'xterm-256color'
});

const trimOutput = (text) => {
  if (!text) {
    return '';
  }
  if (text.length <= MAX_OUTPUT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated]`;
};

const createShellSession = (sessionId) => {
  const id = sessionId || randomUUID();
  const ptyProcess = pty.spawn(SHELL, SHELL_ARGS, {
    name: 'xterm-256color',
    cols: TERMINAL_DEFAULT_COLS,
    rows: TERMINAL_DEFAULT_ROWS,
    cwd: process.cwd(),
    env: buildShellEnv()
  });

  const now = Date.now();
  const session = {
    id,
    ptyProcess,
    createdAt: now,
    lastActiveAt: now,
    lastHeartbeatAt: now,
    clients: new Set(),
    cols: TERMINAL_DEFAULT_COLS,
    rows: TERMINAL_DEFAULT_ROWS
  };

  ptyProcess.onData((data) => {
    touchSession(session);
    const message = JSON.stringify({ type: 'output', data });
    session.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ptyProcess.onExit(() => {
    const cleanupClients = [...session.clients];
    session.clients.clear();
    cleanupClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1011, 'Session ended');
      }
    });
    terminalSessions.delete(id);
  });

  terminalSessions.set(id, session);
  return session;
};

const isValidSessionId = (value) => {
  return typeof value === 'string' && ALLOWED_SESSION_ID.test(value);
};

const getOrCreateSession = (sessionId) => {
  if (isValidSessionId(sessionId)) {
    const existing = terminalSessions.get(sessionId);
    if (existing) {
      touchSession(existing);
      return existing;
    }
  }

  return createShellSession();
};

const buildSessionUrl = (sessionId) => `/terminal-view?sid=${encodeURIComponent(sessionId)}`;
const buildWsUrl = (req, sessionId) => {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').startsWith('https') ? 'wss' : 'ws';
  return `${protocol}://${host}/terminal-socket?sid=${encodeURIComponent(sessionId)}`;
};

const runPowerShell = (command) => new Promise((resolve) => {
  const safeCommand = String(command || '');
  const runCommand = `$ProgressPreference = 'SilentlyContinue'; $OutputEncoding = [System.Text.UTF8Encoding]::new(); [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); [Console]::InputEncoding = [System.Text.UTF8Encoding]::new(); ${safeCommand}`;

  const child = spawn('powershell.exe', ['-NoProfile', '-Command', runCommand], {
    windowsHide: true,
    cwd: process.cwd(),
    env: process.env
  });

  let stdout = '';
  let stderr = '';
  let finished = false;

  const done = (result) => {
    if (finished) {
      return;
    }
    finished = true;
    resolve(result);
  };

  const timer = setTimeout(() => {
    child.kill();
    done({
      ok: false,
      code: -1,
      stdout: trimOutput(stdout),
      stderr: 'Command timed out.'
    });
  }, RUN_TIMEOUT_MS);

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    done({ ok: false, code: -1, stdout: '', stderr: String(err) });
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    done({
      ok: code === 0,
      code,
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr)
    });
  });
});

appServer.get('/api/presets', (_req, res) => {
  res.json({ presets: PRESET_COMMANDS, allowCustom: ALLOW_CUSTOM });
});

appServer.post('/api/run', async (req, res) => {
  const { presetId, command } = req.body || {};

  let selected = null;
  if (presetId) {
    selected = PRESET_COMMANDS.find((item) => item.id === presetId) || null;
    if (!selected) {
      return res.status(400).json({ message: 'Unknown presetId.' });
    }
  }

  if (!selected && !ALLOW_CUSTOM) {
    return res.status(403).json({ message: 'Custom command is disabled.' });
  }

  const targetCommand = selected ? selected.command : String(command || '').trim();
  if (!targetCommand) {
    return res.status(400).json({ message: 'Command is required.' });
  }

  const startedAt = Date.now();
  const result = await runPowerShell(targetCommand);

  return res.json({
    source: selected ? selected.id : 'custom',
    command: targetCommand,
    durationMs: Date.now() - startedAt,
    ...result
  });
});

appServer.get('/api/health', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString(), activeTerminalSessions: terminalSessions.size });
});

appServer.post('/api/terminal/session', (req, res) => {
  const sessionId = req.body && typeof req.body.sessionId === 'string' ? req.body.sessionId.trim() : null;
  const session = getOrCreateSession(sessionId);

  res.json({
    sessionId: session.id,
    terminalUrl: buildSessionUrl(session.id),
    wsUrl: buildWsUrl(req, session.id)
  });
});

appServer.post('/api/terminal/session/heartbeat', (req, res) => {
  const sessionId = req.body && typeof req.body.sessionId === 'string' ? req.body.sessionId.trim() : null;
  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({ message: 'Invalid session id.' });
  }

  const session = terminalSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found.' });
  }

  touchSession(session);
  return res.json({
    ok: true,
    sessionId: session.id,
    ttlMs: TERMINAL_SESSION_TTL_MS
  });
});

appServer.get('/terminal-view', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terminal-view.html'));
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const sessionId = requestUrl.searchParams.get('sid');

  const session = isValidSessionId(sessionId) ? terminalSessions.get(sessionId) : null;
  if (!session) {
    ws.close(1008, 'Invalid terminal session');
    return;
  }

  session.clients.add(ws);
  touchSession(session);
  ws.send(JSON.stringify({ type: 'ready', sessionId: session.id }));

  const handleMessage = (payload) => {
    touchSession(session);
    if (typeof payload !== 'object' || payload === null) {
      session.ptyProcess.write(String(payload || ''));
      return;
    }

    if (payload.type === 'input') {
      const text = String(payload.data || '');
      if (text.length > 0) {
        session.ptyProcess.write(text);
      }
      return;
    }

    if (payload.type === 'resize') {
      const cols = Number.parseInt(payload.cols, 10);
      const rows = Number.parseInt(payload.rows, 10);
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
        session.cols = cols;
        session.rows = rows;
        try {
          session.ptyProcess.resize(cols, rows);
        } catch {
          // ignore resize errors
        }
      }
      return;
    }

    if (payload.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  };

  ws.on('message', (raw) => {
    session.lastActiveAt = Date.now();
    try {
      const parsed = JSON.parse(raw.toString());
      handleMessage(parsed);
      return;
    } catch {
      handleMessage(String(raw));
    }
  });

  ws.on('close', () => {
    touchSession(session);
    session.clients.delete(ws);
  });
});

const cleanupTerminalSessions = () => {
  const now = Date.now();
  terminalSessions.forEach((session, sessionId) => {
    if (session.clients.size > 0) {
      return;
    }

    const lastSeen = session.lastHeartbeatAt || session.lastActiveAt;
    if ((now - lastSeen) < TERMINAL_SESSION_TTL_MS) {
      return;
    }

    try {
      session.ptyProcess.kill();
    } catch {
      // ignore
    }
    terminalSessions.delete(sessionId);
  });
};

const server = appServer.listen(PORT, '0.0.0.0', () => {
  console.log(`remote-shell UI: http://0.0.0.0:${PORT}`);
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url || !req.url.startsWith('/terminal-socket')) {
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const sessionId = requestUrl.searchParams.get('sid');

  if (!isValidSessionId(sessionId) || !terminalSessions.has(sessionId)) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

setInterval(cleanupTerminalSessions, TERMINAL_CLEANUP_INTERVAL_MS);

setInterval(() => {
  terminalSessions.forEach((session) => {
    if (session.clients.size === 0) {
      return;
    }
    try {
      const payload = JSON.stringify({ type: 'ping', data: Date.now() });
      session.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    } catch {
      // ignore
    }
  });
}, TERMINAL_HEARTBEAT_INTERVAL_MS);

process.on('SIGINT', () => {
  terminalSessions.forEach((session) => {
    try {
      session.ptyProcess.kill();
    } catch {}
  });
  process.exit(0);
});

process.on('SIGTERM', () => {
  terminalSessions.forEach((session) => {
    try {
      session.ptyProcess.kill();
    } catch {}
  });
  process.exit(0);
});
