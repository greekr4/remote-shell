const QUICK_STORAGE_KEY = 'remote-shell.quick-commands.v1';
const SESSION_STORAGE_KEY = 'remote-shell.terminal-session.v1';

const el = {
  terminalFrame: document.getElementById('terminalFrame'),
  terminalUrl: document.getElementById('terminalUrl'),
  quickGrid: document.getElementById('quickGrid'),
  quickEmpty: document.getElementById('quickEmpty'),
  quickStatus: document.getElementById('quickStatus'),
  addQuick: document.getElementById('addQuick'),
  quickModal: document.getElementById('quickModal'),
  closeModal: document.getElementById('closeModal'),
  quickForm: document.getElementById('quickForm'),
  quickLabel: document.getElementById('quickLabel'),
  quickCommand: document.getElementById('quickCommand')
};

const isMobileViewport = () => window.matchMedia('(max-width: 639px)').matches;

const loadCommands = () => {
  try {
    const raw = window.localStorage.getItem(QUICK_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item) => (
      item &&
      typeof item.id === 'string' &&
      typeof item.label === 'string' &&
      typeof item.command === 'string'
    ));
  } catch {
    return [];
  }
};

const saveCommands = (commands) => {
  window.localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(commands));
};

const getStoredSessionId = () => {
  const value = window.localStorage.getItem(SESSION_STORAGE_KEY);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const saveSessionId = (value) => {
  if (typeof value !== 'string' || !value) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, value);
};

const setStatus = (text) => {
  el.quickStatus.textContent = text || '';
};

let quickCommands = loadCommands();
let terminalSessionId = null;
let terminalReady = false;
let isEnsuringSession = false;
let pendingCommands = [];
let isImeComposing = false;

const updateTerminalMeta = (stateText) => {
  if (!terminalSessionId) {
    el.terminalUrl.textContent = stateText ? `(Live terminal) ${stateText}` : '(Live terminal)';
    return;
  }
  el.terminalUrl.textContent = `/terminal-view?sid=${terminalSessionId} (${stateText})`;
};

const buildTerminalUrl = (sessionId) => `/terminal-view?sid=${encodeURIComponent(sessionId)}`;

const renderQuickCommands = () => {
  el.quickGrid.innerHTML = '';
  const hasCommands = quickCommands.length > 0;
  el.quickEmpty.style.display = hasCommands ? 'none' : 'block';

  quickCommands.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'chip-wrap';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.innerHTML = `<strong>${item.label}</strong><span>${item.command}</span>`;
    button.addEventListener('click', () => runCommand(item));

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'icon-btn';
    removeButton.setAttribute('aria-label', `${item.label} remove`);
    removeButton.textContent = 'x';
    removeButton.addEventListener('click', () => deleteCommand(item.id));

    card.appendChild(button);
    card.appendChild(removeButton);
    el.quickGrid.appendChild(card);
  });
};

const setTerminalFrame = (sessionId) => {
  terminalSessionId = sessionId;
  if (!sessionId) {
    el.terminalUrl.textContent = 'Live terminal session unavailable';
    return;
  }
  terminalReady = false;
  updateTerminalMeta('connecting');
  el.terminalFrame.src = buildTerminalUrl(sessionId);
};

const runCommand = (item) => {
  sendTextToTerminal(item.command);
};

const deleteCommand = (id) => {
  quickCommands = quickCommands.filter((item) => item.id !== id);
  saveCommands(quickCommands);
  renderQuickCommands();
  setStatus('Quick command removed.');
};

const addCommand = (label, command) => {
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    command
  };

  quickCommands = [item, ...quickCommands];
  saveCommands(quickCommands);
  renderQuickCommands();
  setStatus('Quick command added.');
};

const openModal = () => {
  el.quickForm.reset();
  document.body.classList.add('modal-open');
  el.quickModal.classList.remove('hidden');
  window.setTimeout(() => {
    const focusTarget = isMobileViewport() ? el.quickCommand : el.quickLabel;
    if (!focusTarget) {
      return;
    }

    try {
      focusTarget.focus({ preventScroll: true });
    } catch {
      focusTarget.focus();
    }
  }, 0);
};

const closeModal = () => {
  document.body.classList.remove('modal-open');
  el.quickModal.classList.add('hidden');
};

const flushQueuedCommands = () => {
  if (!terminalReady) {
    return;
  }

  while (pendingCommands.length > 0) {
    const item = pendingCommands.shift();
    sendTextToTerminal(item);
  }
};

const sendTextToTerminal = (text) => {
  if (!text) {
    return;
  }

  const commandText = String(text).replace(/\r/g, '');
  const frameWindow = el.terminalFrame.contentWindow;

  if (!frameWindow || !terminalSessionId) {
    pendingCommands.push(commandText);
    setStatus('Waiting for terminal session. Command queued.');
    return;
  }

  if (!terminalReady) {
    pendingCommands.push(commandText);
    setStatus('Terminal not ready. Command queued.');
    return;
  }

  try {
    frameWindow.postMessage({ type: 'run-command', command: `${commandText}\r` }, window.location.origin);
    setStatus(`Sent: ${commandText}`);
  } catch {
    pendingCommands.push(commandText);
    setStatus('Failed to send command. Retrying...');
  }
};

const ensureSession = async () => {
  if (isEnsuringSession) {
    return;
  }

  isEnsuringSession = true;
  setStatus('Preparing live terminal session...');
  updateTerminalMeta('creating session');

  try {
    const storedSessionId = getStoredSessionId();
    const response = await fetch('/api/terminal/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sessionId: storedSessionId || null })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Session API failed (${response.status})`);
    }

    const payload = await response.json();
    const sessionId = payload.sessionId;

    if (typeof sessionId !== 'string' || !sessionId) {
      throw new Error('Invalid session id from server.');
    }

    saveSessionId(sessionId);
    setTerminalFrame(sessionId);
  } catch (error) {
    setStatus(`Session error: ${String(error.message || error)}`);
    updateTerminalMeta('offline');
    saveSessionId(null);
    terminalSessionId = null;
  } finally {
    isEnsuringSession = false;
  }
};

const bindCompositionState = (input) => {
  if (!input) {
    return;
  }

  input.addEventListener('compositionstart', () => {
    isImeComposing = true;
  });

  input.addEventListener('compositionend', () => {
    isImeComposing = false;
  });
};

const init = () => {
  renderQuickCommands();
  ensureSession();

  el.terminalFrame.addEventListener('load', () => {
    terminalReady = true;
    if (terminalSessionId) {
      updateTerminalMeta('connected');
      setStatus('Live terminal ready.');
    } else {
      setStatus('Live terminal is not available.');
    }
    flushQueuedCommands();
    window.scrollTo({ top: 0, behavior: 'auto' });
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) {
      return;
    }

    if (!event.data || typeof event.data !== 'object') {
      return;
    }

    if (event.data.type === 'terminal-ready') {
      terminalReady = true;
      flushQueuedCommands();
      setStatus('Live terminal connected.');
      updateTerminalMeta('connected');
      return;
    }

    if (event.data.type === 'terminal-session') {
      saveSessionId(event.data.sessionId);
      terminalSessionId = event.data.sessionId;
      updateTerminalMeta('connected');
      return;
    }
  });

  window.addEventListener('offline', () => {
    setStatus('Network offline.');
    updateTerminalMeta('offline');
  });

  window.addEventListener('online', () => {
    setStatus('Network restored. Reconnecting session...');
    ensureSession();
  });

  el.addQuick.addEventListener('click', openModal);
  el.closeModal.addEventListener('click', closeModal);

  bindCompositionState(el.quickLabel);
  bindCompositionState(el.quickCommand);

  el.quickModal.addEventListener('click', (event) => {
    if (event.target === el.quickModal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.isComposing || isImeComposing) {
      return;
    }

    if (event.key === 'Escape' && !el.quickModal.classList.contains('hidden')) {
      closeModal();
    }
  });

  el.quickForm.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.isComposing || isImeComposing)) {
      event.preventDefault();
    }
  });

  el.quickForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const label = el.quickLabel.value.trim();
    const command = el.quickCommand.value.trim();

    if (!label || !command) {
      setStatus('Label and command are required.');
      return;
    }

    addCommand(label, command);
    closeModal();
  });
};

init();
