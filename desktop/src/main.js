const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

/**
 * Phase 1: Electron shell that loads the live Sociva cloud web app.
 * Override with SOCIVA_APP_URL for staging (must be https://*.sociva.in or localhost).
 */
const DEFAULT_APP_URL = 'https://www.sociva.in';
const ALLOWED_HOST_SUFFIXES = ['sociva.in', 'localhost', '127.0.0.1'];

function resolveAppUrl() {
  const raw = (process.env.SOCIVA_APP_URL || DEFAULT_APP_URL).trim();
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return DEFAULT_APP_URL;
    const host = u.hostname.toLowerCase();
    const ok = ALLOWED_HOST_SUFFIXES.some(
      (s) => host === s || host.endsWith(`.${s}`)
    );
    return ok ? u.toString() : DEFAULT_APP_URL;
  } catch {
    return DEFAULT_APP_URL;
  }
}

const APP_URL = resolveAppUrl();

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Sociva',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const isSociva = ALLOWED_HOST_SUFFIXES.some(
        (s) => host === s || host.endsWith(`.${s}`)
      );
      if (isSociva && (u.protocol === 'https:' || u.protocol === 'http:')) {
        return { action: 'allow' };
      }
    } catch {
      /* fall through */
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const ok = ALLOWED_HOST_SUFFIXES.some(
        (s) => host === s || host.endsWith(`.${s}`)
      );
      if (!ok) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(APP_URL);
}

function buildMenu() {
  const template = [
    {
      label: 'Sociva',
      submenu: [
        {
          label: 'Open at Login',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => {
            app.setLoginItemSettings({ openAtLogin: item.checked });
          },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
